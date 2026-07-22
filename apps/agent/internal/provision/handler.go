package provision

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/accnet/ooio/apps/agent/internal/backup"
	"github.com/accnet/ooio/apps/agent/internal/jobrunner"
	"github.com/accnet/ooio/apps/agent/internal/wpadapter"
)

const (
	CreateStore    = "create-store"
	DeleteStore    = "delete-store"
	ActivatePlugin = "activate-plugin"
	SwitchTheme    = "switch-theme"
	CreateUser     = "create-user"
	SetOption      = "set-option"
	BackupStore    = "backup-store"
	RestoreStore   = "restore-store"
	IssueSSL       = "issue-ssl"
)

type SSLManager interface {
	Issue(context.Context, string) error
}

type BackupManager interface {
	BackupDatabase(context.Context) (backup.Result, error)
	BackupFiles(context.Context, []backup.File) (backup.Result, error)
}

type RestoreManager interface {
	Restore(context.Context, string) error
	RestoreSite(context.Context, string, string) error
}

type Handler struct {
	wordpress   wpadapter.WordPressClient
	ssl         SSLManager
	backup      BackupManager
	restore     RestoreManager
	createStore *CreateStoreOrchestrator
}

func NewHandler(wordpress wpadapter.WordPressClient, sslManager SSLManager, backupManager BackupManager, restoreManager RestoreManager, orchestrators ...*CreateStoreOrchestrator) *Handler {
	var createStore *CreateStoreOrchestrator
	if len(orchestrators) != 0 {
		createStore = orchestrators[0]
	}
	return &Handler{wordpress: wordpress, ssl: sslManager, backup: backupManager, restore: restoreManager, createStore: createStore}
}

// SetCreateStoreOrchestrator wires the multi-step create-store flow after
// construction for hosts that build their infrastructure in phases.
func (h *Handler) SetCreateStoreOrchestrator(orchestrator *CreateStoreOrchestrator) *Handler {
	if h != nil {
		h.createStore = orchestrator
	}
	return h
}

func (h *Handler) Handle(ctx context.Context, job jobrunner.Job) (json.RawMessage, error) {
	if h == nil {
		return nil, fmt.Errorf("provision handler is not configured")
	}

	switch strings.TrimSpace(job.Type) {
	case CreateStore:
		if h.createStore != nil {
			return h.createStore.CreateStore(ctx, job.Payload)
		}
		return h.executeCreateStore(ctx, job.Payload)
	case DeleteStore:
		if h.wordpress == nil {
			return nil, fmt.Errorf("WordPress client is not configured")
		}
		resource, err := siteResource(job.Payload)
		if err != nil {
			return nil, fmt.Errorf("delete store payload: %w", err)
		}
		_, err = h.wordpress.Execute(ctx, wpadapter.Operation{
			Name:     "delete-site",
			Resource: resource,
		})
		return nil, err
	case ActivatePlugin:
		return h.executeWordPress(ctx, job.Payload, wpadapter.Operation{Name: "activate-plugin", Payload: job.Payload})
	case SwitchTheme:
		return h.executeWordPress(ctx, job.Payload, wpadapter.Operation{Name: "switch-theme", Payload: job.Payload})
	case CreateUser:
		return h.executeWordPress(ctx, job.Payload, wpadapter.Operation{Name: "create-user", Payload: job.Payload})
	case SetOption:
		return h.executeWordPress(ctx, job.Payload, wpadapter.Operation{Name: "set-option", Payload: job.Payload})
	case BackupStore:
		return nil, h.handleBackup(ctx, job.Payload)
	case RestoreStore:
		return nil, h.handleRestore(ctx, job.Payload)
	case IssueSSL:
		if h.ssl == nil {
			return nil, fmt.Errorf("SSL manager is not configured")
		}
		domain, err := stringField(job.Payload, "domain")
		if err != nil {
			return nil, fmt.Errorf("issue SSL payload: %w", err)
		}
		return nil, h.ssl.Issue(ctx, domain)
	default:
		return nil, fmt.Errorf("unsupported provisioning job type %q", job.Type)
	}
}

func (h *Handler) executeCreateStore(ctx context.Context, payload json.RawMessage) (json.RawMessage, error) {
	if h.wordpress == nil {
		return nil, fmt.Errorf("WordPress client is not configured")
	}
	if err := validateObjectPayload(payload); err != nil {
		return nil, fmt.Errorf("create-site payload: %w", err)
	}
	result, err := h.wordpress.Execute(ctx, wpadapter.Operation{Name: "create-site", Payload: payload})
	if err != nil {
		return nil, err
	}
	return createStoreResult(result.Payload)
}

func (h *Handler) executeWordPress(ctx context.Context, payload json.RawMessage, operation wpadapter.Operation) (json.RawMessage, error) {
	if h.wordpress == nil {
		return nil, fmt.Errorf("WordPress client is not configured")
	}
	if err := validateObjectPayload(payload); err != nil {
		return nil, fmt.Errorf("%s payload: %w", operation.Name, err)
	}
	_, err := h.wordpress.Execute(ctx, operation)
	return nil, err
}

func (h *Handler) handleBackup(ctx context.Context, payload json.RawMessage) error {
	if h.backup == nil {
		return fmt.Errorf("backup manager is not configured")
	}
	if err := validateObjectPayload(payload); err != nil {
		return fmt.Errorf("backup payload: %w", err)
	}
	var input struct {
		Kind  string `json:"kind"`
		Files []struct {
			Path string `json:"path"`
		} `json:"files"`
	}
	if err := json.Unmarshal(payload, &input); err != nil {
		return fmt.Errorf("backup payload: must be valid JSON: %w", err)
	}
	switch strings.ToLower(strings.TrimSpace(input.Kind)) {
	case "", backup.DatabaseKind:
		if len(input.Files) != 0 {
			return fmt.Errorf("backup payload: files require kind %q", backup.FilesKind)
		}
		_, err := h.backup.BackupDatabase(ctx)
		return err
	case backup.FilesKind:
		files := make([]backup.File, len(input.Files))
		for i, file := range input.Files {
			files[i] = backup.File{Path: file.Path}
		}
		_, err := h.backup.BackupFiles(ctx, files)
		return err
	default:
		return fmt.Errorf("backup payload: unsupported kind %q", input.Kind)
	}
}

func (h *Handler) handleRestore(ctx context.Context, payload json.RawMessage) error {
	if h.restore == nil {
		return fmt.Errorf("restore manager is not configured")
	}
	if err := validateObjectPayload(payload); err != nil {
		return fmt.Errorf("restore payload: %w", err)
	}
	backupKey, err := stringField(payload, "backupKey")
	if err != nil {
		return fmt.Errorf("restore payload: %w", err)
	}
	blogID, err := optionalStringField(payload, "blogId")
	if err != nil {
		return fmt.Errorf("restore payload: %w", err)
	}
	if blogID == "" {
		return h.restore.Restore(ctx, backupKey)
	}
	return h.restore.RestoreSite(ctx, blogID, backupKey)
}

func validateObjectPayload(payload json.RawMessage) error {
	if len(payload) == 0 || string(payload) == "null" {
		return fmt.Errorf("object payload is required")
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(payload, &object); err != nil {
		return fmt.Errorf("must be valid JSON: %w", err)
	}
	if object == nil {
		return fmt.Errorf("must be a JSON object")
	}
	return nil
}

func siteResource(payload json.RawMessage) (string, error) {
	if err := validateObjectPayload(payload); err != nil {
		return "", err
	}
	var input struct {
		SiteID string `json:"siteId"`
		ID     string `json:"id"`
	}
	if err := json.Unmarshal(payload, &input); err != nil {
		return "", fmt.Errorf("must be valid JSON: %w", err)
	}
	resource := strings.TrimSpace(input.SiteID)
	if resource == "" {
		resource = strings.TrimSpace(input.ID)
	}
	if resource == "" {
		return "", fmt.Errorf("siteId is required")
	}
	return resource, nil
}

func stringField(payload json.RawMessage, name string) (string, error) {
	if err := validateObjectPayload(payload); err != nil {
		return "", err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(payload, &fields); err != nil {
		return "", fmt.Errorf("must be valid JSON: %w", err)
	}
	raw, ok := fields[name]
	if !ok {
		return "", fmt.Errorf("%s is required", name)
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", fmt.Errorf("%s must be a string", name)
	}
	value = strings.TrimSpace(value)
	if value == "" {
		return "", fmt.Errorf("%s is required", name)
	}
	return value, nil
}

func optionalStringField(payload json.RawMessage, name string) (string, error) {
	if err := validateObjectPayload(payload); err != nil {
		return "", err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(payload, &fields); err != nil {
		return "", fmt.Errorf("must be valid JSON: %w", err)
	}
	raw, ok := fields[name]
	if !ok || string(raw) == "null" {
		return "", nil
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", fmt.Errorf("%s must be a string", name)
	}
	return strings.TrimSpace(value), nil
}
