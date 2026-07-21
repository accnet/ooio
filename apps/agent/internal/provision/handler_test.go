package provision

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/accnet/ooio/apps/agent/internal/backup"
	"github.com/accnet/ooio/apps/agent/internal/jobrunner"
	"github.com/accnet/ooio/apps/agent/internal/wpadapter"
)

type fakeWordPressClient struct {
	operation wpadapter.Operation
	result    wpadapter.Result
	err       error
}

func (f *fakeWordPressClient) Execute(_ context.Context, operation wpadapter.Operation) (wpadapter.Result, error) {
	f.operation = operation
	return f.result, f.err
}

type fakeSSLManager struct {
	domain string
	err    error
}

func (f *fakeSSLManager) Issue(_ context.Context, domain string) error {
	f.domain = domain
	return f.err
}

type fakeBackupManager struct {
	databaseCalls int
	filesCalls    int
	files         []backup.File
	err           error
}

func (f *fakeBackupManager) BackupDatabase(context.Context) (backup.Result, error) {
	f.databaseCalls++
	return backup.Result{}, f.err
}

func (f *fakeBackupManager) BackupFiles(_ context.Context, files []backup.File) (backup.Result, error) {
	f.filesCalls++
	f.files = append([]backup.File(nil), files...)
	return backup.Result{}, f.err
}

type fakeRestoreManager struct {
	backupKey string
	blogID    string
	siteCalls int
	err       error
}

func (f *fakeRestoreManager) Restore(_ context.Context, backupKey string) error {
	f.backupKey = backupKey
	return f.err
}

func (f *fakeRestoreManager) RestoreSite(_ context.Context, blogID, backupKey string) error {
	f.siteCalls++
	f.blogID = blogID
	f.backupKey = backupKey
	return f.err
}

func TestHandlerCreatesStoreThroughWordPressSeam(t *testing.T) {
	fake := &fakeWordPressClient{}
	handler := NewHandler(fake, nil, nil, nil)
	payload := json.RawMessage(`{"domain":"store.example.test","title":"Store"}`)

	if err := handler.Handle(context.Background(), jobrunner.Job{Type: CreateStore, Payload: payload}); err != nil {
		t.Fatalf("Handle() error = %v", err)
	}
	if fake.operation.Name != "create-site" || string(fake.operation.Payload) != string(payload) || fake.operation.Resource != "" {
		t.Fatalf("operation = %#v", fake.operation)
	}
}

func TestHandlerDeletesStoreThroughWordPressSeam(t *testing.T) {
	fake := &fakeWordPressClient{}
	handler := NewHandler(fake, nil, nil, nil)

	if err := handler.Handle(context.Background(), jobrunner.Job{
		Type:    DeleteStore,
		Payload: json.RawMessage(`{"siteId":"site-1"}`),
	}); err != nil {
		t.Fatalf("Handle() error = %v", err)
	}
	if fake.operation.Name != "delete-site" || fake.operation.Resource != "site-1" || len(fake.operation.Payload) != 0 {
		t.Fatalf("operation = %#v", fake.operation)
	}
}

func TestHandlerRejectsInvalidJobsAndPropagatesClientErrors(t *testing.T) {
	tests := []struct {
		name string
		job  jobrunner.Job
	}{
		{name: "unsupported type", job: jobrunner.Job{Type: "backup-store", Payload: json.RawMessage(`{}`)}},
		{name: "malformed create payload", job: jobrunner.Job{Type: CreateStore, Payload: json.RawMessage(`{`)}},
		{name: "missing delete site", job: jobrunner.Job{Type: DeleteStore, Payload: json.RawMessage(`{}`)}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := NewHandler(&fakeWordPressClient{}, nil, nil, nil).Handle(context.Background(), test.job); err == nil {
				t.Fatal("Handle() error = nil")
			}
		})
	}

	fake := &fakeWordPressClient{err: errors.New("MU Plugin unavailable")}
	err := NewHandler(fake, nil, nil, nil).Handle(context.Background(), jobrunner.Job{
		Type:    CreateStore,
		Payload: json.RawMessage(`{"domain":"store.example.test","title":"Store"}`),
	})
	if err == nil || !errors.Is(err, fake.err) {
		t.Fatalf("Handle() error = %v, want client error", err)
	}
}

func TestHandlerDispatchesRemainingWordPressOperations(t *testing.T) {
	tests := []struct {
		name      string
		typeName  string
		operation string
	}{
		{name: "activate plugin", typeName: ActivatePlugin, operation: "activate-plugin"},
		{name: "switch theme", typeName: SwitchTheme, operation: "switch-theme"},
		{name: "create user", typeName: CreateUser, operation: "create-user"},
		{name: "set option", typeName: SetOption, operation: "set-option"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			fake := &fakeWordPressClient{}
			payload := json.RawMessage(`{"siteId":"site-1","value":"value"}`)
			if err := NewHandler(fake, nil, nil, nil).Handle(context.Background(), jobrunner.Job{Type: test.typeName, Payload: payload}); err != nil {
				t.Fatalf("Handle() error = %v", err)
			}
			if fake.operation.Name != test.operation || string(fake.operation.Payload) != string(payload) {
				t.Fatalf("operation = %#v, want %q with payload", fake.operation, test.operation)
			}
		})
	}
}

func TestHandlerDispatchesSSLBackupAndRestoreJobs(t *testing.T) {
	sslManager := &fakeSSLManager{}
	backupManager := &fakeBackupManager{}
	restoreManager := &fakeRestoreManager{}
	handler := NewHandler(nil, sslManager, backupManager, restoreManager)

	if err := handler.Handle(context.Background(), jobrunner.Job{Type: IssueSSL, Payload: json.RawMessage(`{"domain":"store.example.test"}`)}); err != nil {
		t.Fatalf("issue SSL error = %v", err)
	}
	if sslManager.domain != "store.example.test" {
		t.Fatalf("SSL domain = %q", sslManager.domain)
	}

	if err := handler.Handle(context.Background(), jobrunner.Job{Type: BackupStore, Payload: json.RawMessage(`{}`)}); err != nil {
		t.Fatalf("database backup error = %v", err)
	}
	if err := handler.Handle(context.Background(), jobrunner.Job{Type: BackupStore, Payload: json.RawMessage(`{"kind":"files","files":[{"path":"/var/www/wp-config.php"}]}`)}); err != nil {
		t.Fatalf("files backup error = %v", err)
	}
	if backupManager.databaseCalls != 1 || backupManager.filesCalls != 1 || len(backupManager.files) != 1 || backupManager.files[0].Path != "/var/www/wp-config.php" {
		t.Fatalf("backup calls = %#v", backupManager)
	}

	if err := handler.Handle(context.Background(), jobrunner.Job{Type: RestoreStore, Payload: json.RawMessage(`{"backupKey":"backups/database/full.sql"}`)}); err != nil {
		t.Fatalf("full restore error = %v", err)
	}
	if err := handler.Handle(context.Background(), jobrunner.Job{Type: RestoreStore, Payload: json.RawMessage(`{"blogId":"7","backupKey":"backups/database/full.sql"}`)}); err != nil {
		t.Fatalf("site restore error = %v", err)
	}
	if restoreManager.siteCalls != 1 || restoreManager.blogID != "7" || restoreManager.backupKey != "backups/database/full.sql" {
		t.Fatalf("restore calls = %#v", restoreManager)
	}
}
