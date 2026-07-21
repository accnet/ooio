// Package domain manages the mapping between public hostnames and WordPress
// sites, together with the Caddy configuration derived from that mapping.
package domain

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"
	"unicode"
)

var (
	// ErrNotFound is returned by Store when a hostname has no mapping.
	ErrNotFound = errors.New("domain mapping not found")
	// ErrDomainExists is returned when a hostname is already mapped.
	ErrDomainExists = errors.New("domain is already mapped")
)

// Mapping is the durable association used to build a Caddy site block.
type Mapping struct {
	Domain string `json:"domain"`
	SiteID string `json:"siteId"`
}

// Store persists hostname-to-site mappings. Implementations can use a local
// file, SQLite, or another node-local store; this package does not choose one.
type Store interface {
	Get(context.Context, string) (Mapping, error)
	Put(context.Context, Mapping) error
	Delete(context.Context, string) error
	List(context.Context) ([]Mapping, error)
}

// Reloader is the seam for the local Caddy admin API. config is the complete
// generated Caddyfile, allowing removal to be represented as well as addition.
type Reloader interface {
	Reload(context.Context, string) error
}

// Manager coordinates durable mapping changes and Caddy reloads. It keeps
// the store update and reload aligned by restoring the previous mapping when
// configuration generation or reload fails.
type Manager struct {
	store    Store
	reloader Reloader
}

func NewManager(store Store, reloader Reloader) *Manager {
	return &Manager{store: store, reloader: reloader}
}

// New is an alias for callers wiring the agent at startup.
func New(store Store, reloader Reloader) *Manager {
	return NewManager(store, reloader)
}

// AddDomain validates and persists a hostname mapping, then reloads Caddy
// with the complete configuration for all currently mapped domains.
func (m *Manager) AddDomain(ctx context.Context, domain, siteID string) error {
	if err := m.validate(ctx); err != nil {
		return err
	}
	domain, err := normalizeHostname(domain)
	if err != nil {
		return err
	}
	siteID = strings.TrimSpace(siteID)
	if err := validateSiteID(siteID); err != nil {
		return err
	}

	previous, err := m.configuration(ctx)
	if err != nil {
		return err
	}
	_, err = m.store.Get(ctx, domain)
	if err == nil {
		return fmt.Errorf("%w: %q", ErrDomainExists, domain)
	}
	if !errors.Is(err, ErrNotFound) {
		return fmt.Errorf("check domain mapping %q: %w", domain, err)
	}

	mapping := Mapping{Domain: domain, SiteID: siteID}
	if err := m.store.Put(ctx, mapping); err != nil {
		if errors.Is(err, ErrDomainExists) {
			return fmt.Errorf("%w: %q", ErrDomainExists, domain)
		}
		return fmt.Errorf("store domain mapping %q: %w", domain, err)
	}

	if err := m.reload(ctx); err != nil {
		return m.rollbackAdd(ctx, mapping, previous, err)
	}
	return nil
}

// RemoveDomain removes a hostname mapping and reloads Caddy without its site
// block. A failed reload restores the mapping and the previous configuration.
func (m *Manager) RemoveDomain(ctx context.Context, domain string) error {
	if err := m.validate(ctx); err != nil {
		return err
	}
	domain, err := normalizeHostname(domain)
	if err != nil {
		return err
	}
	previous, err := m.configuration(ctx)
	if err != nil {
		return err
	}
	mapping, err := m.store.Get(ctx, domain)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return fmt.Errorf("%w: %q", ErrNotFound, domain)
		}
		return fmt.Errorf("get domain mapping %q: %w", domain, err)
	}
	if err := m.store.Delete(ctx, domain); err != nil {
		return fmt.Errorf("delete domain mapping %q: %w", domain, err)
	}

	if err := m.reload(ctx); err != nil {
		return m.rollbackRemove(ctx, mapping, previous, err)
	}
	return nil
}

// SiteBlock returns the Caddyfile block for one domain. The local upstream is
// intentionally stable; site identity is forwarded for the platform router.
func SiteBlock(mapping Mapping) string {
	return fmt.Sprintf("%s {\n\treverse_proxy 127.0.0.1:8080 {\n\t\theader_up X-Platform-Site-ID %s\n\t}\n}\n", mapping.Domain, quoteCaddyValue(mapping.SiteID))
}

// CaddyConfig returns a deterministic Caddyfile for the supplied mappings.
func CaddyConfig(mappings []Mapping) (string, error) {
	ordered := append([]Mapping(nil), mappings...)
	for index := range ordered {
		domain, err := normalizeHostname(ordered[index].Domain)
		if err != nil {
			return "", err
		}
		ordered[index].Domain = domain
		ordered[index].SiteID = strings.TrimSpace(ordered[index].SiteID)
		if err := validateSiteID(ordered[index].SiteID); err != nil {
			return "", err
		}
	}
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].Domain < ordered[j].Domain })

	var builder strings.Builder
	seen := make(map[string]struct{}, len(ordered))
	for _, mapping := range ordered {
		if _, exists := seen[mapping.Domain]; exists {
			return "", fmt.Errorf("%w: %q", ErrDomainExists, mapping.Domain)
		}
		seen[mapping.Domain] = struct{}{}
		builder.WriteString(SiteBlock(mapping))
	}
	return builder.String(), nil
}

// CaddyReloader applies Caddyfile configuration using Caddy's local admin API.
// It is an HTTP implementation of Reloader; callers may inject a fake in tests.
type CaddyReloader struct {
	client   *http.Client
	adminURL string
}

const DefaultCaddyAdminURL = "http://127.0.0.1:2019"

func NewCaddyReloader(client *http.Client) *CaddyReloader {
	return NewCaddyReloaderAt(DefaultCaddyAdminURL, client)
}

func NewCaddyReloaderAt(adminURL string, client *http.Client) *CaddyReloader {
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	return &CaddyReloader{client: client, adminURL: strings.TrimRight(adminURL, "/")}
}

func (r *CaddyReloader) Reload(ctx context.Context, config string) error {
	if r == nil || r.client == nil {
		return fmt.Errorf("Caddy reloader is not configured")
	}
	if ctx == nil {
		return fmt.Errorf("Caddy reload requires a context")
	}
	if strings.TrimSpace(r.adminURL) == "" {
		return fmt.Errorf("Caddy admin URL is required")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, r.adminURL+"/load?adapter=caddyfile", bytes.NewBufferString(config))
	if err != nil {
		return fmt.Errorf("create Caddy reload request: %w", err)
	}
	request.Header.Set("Content-Type", "text/caddyfile")
	response, err := r.client.Do(request)
	if err != nil {
		return fmt.Errorf("send Caddy reload request: %w", err)
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("read Caddy reload response: %w", err)
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("Caddy reload returned status %d: %s", response.StatusCode, strings.TrimSpace(string(responseBody)))
	}
	return nil
}

func (m *Manager) validate(ctx context.Context) error {
	if m == nil || m.store == nil || m.reloader == nil {
		return fmt.Errorf("domain manager requires a store and reloader")
	}
	if ctx == nil {
		return fmt.Errorf("domain operation requires a context")
	}
	return ctx.Err()
}

func (m *Manager) configuration(ctx context.Context) (string, error) {
	mappings, err := m.store.List(ctx)
	if err != nil {
		return "", fmt.Errorf("list domain mappings: %w", err)
	}
	config, err := CaddyConfig(mappings)
	if err != nil {
		return "", fmt.Errorf("build Caddy configuration: %w", err)
	}
	return config, nil
}

func (m *Manager) reload(ctx context.Context) error {
	config, err := m.configuration(ctx)
	if err != nil {
		return err
	}
	if err := m.reloader.Reload(ctx, config); err != nil {
		return fmt.Errorf("reload Caddy configuration: %w", err)
	}
	return nil
}

func (m *Manager) rollbackAdd(ctx context.Context, mapping Mapping, previous string, reloadErr error) error {
	rollbackErr := m.store.Delete(ctx, mapping.Domain)
	if rollbackErr == nil {
		rollbackErr = m.reloader.Reload(ctx, previous)
	}
	if rollbackErr != nil {
		return fmt.Errorf("reload Caddy configuration: %w; rollback failed: %v", reloadErr, rollbackErr)
	}
	return fmt.Errorf("reload Caddy configuration: %w", reloadErr)
}

func (m *Manager) rollbackRemove(ctx context.Context, mapping Mapping, previous string, reloadErr error) error {
	rollbackErr := m.store.Put(ctx, mapping)
	if rollbackErr == nil {
		rollbackErr = m.reloader.Reload(ctx, previous)
	}
	if rollbackErr != nil {
		return fmt.Errorf("reload Caddy configuration: %w; rollback failed: %v", reloadErr, rollbackErr)
	}
	return fmt.Errorf("reload Caddy configuration: %w", reloadErr)
}

func normalizeHostname(value string) (string, error) {
	hostname := strings.ToLower(strings.TrimSpace(value))
	if hostname == "" {
		return "", fmt.Errorf("domain is required")
	}
	if len(hostname) > 253 || strings.ContainsAny(hostname, "/:?#[\\]@") {
		return "", fmt.Errorf("invalid hostname %q", value)
	}
	for _, character := range hostname {
		if unicode.IsSpace(character) || unicode.IsControl(character) {
			return "", fmt.Errorf("invalid hostname %q", value)
		}
	}
	if strings.HasSuffix(hostname, ".") {
		hostname = strings.TrimSuffix(hostname, ".")
	}
	labels := strings.Split(hostname, ".")
	for _, label := range labels {
		if label == "" || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return "", fmt.Errorf("invalid hostname %q", value)
		}
		for _, character := range label {
			if (character < 'a' || character > 'z') && (character < '0' || character > '9') && character != '-' {
				return "", fmt.Errorf("invalid hostname %q", value)
			}
		}
	}
	return hostname, nil
}

func validateSiteID(siteID string) error {
	if siteID == "" {
		return fmt.Errorf("site ID is required")
	}
	for _, character := range siteID {
		if unicode.IsControl(character) {
			return fmt.Errorf("invalid site ID")
		}
	}
	return nil
}

func quoteCaddyValue(value string) string {
	return strconvQuote(value)
}

// Kept as a tiny helper so Caddy value quoting remains isolated from the
// hostname validation rules above.
func strconvQuote(value string) string {
	quoted, _ := json.Marshal(value)
	return string(quoted)
}
