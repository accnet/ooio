package backup

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type fakeDumper struct {
	data []byte
	err  error
}

func (f fakeDumper) Dump(context.Context) ([]byte, error) {
	if f.err != nil {
		return nil, f.err
	}
	return append([]byte(nil), f.data...), nil
}

type storedObject struct {
	key      string
	data     []byte
	metadata Metadata
}

type fakeStorage struct {
	objects []storedObject
	err     error
}

func (f *fakeStorage) Put(_ context.Context, key string, data []byte, metadata Metadata) error {
	if f.err != nil {
		return f.err
	}
	f.objects = append(f.objects, storedObject{
		key:      key,
		data:     append([]byte(nil), data...),
		metadata: metadata,
	})
	return nil
}

func TestBackupDatabaseStoresChecksumAndTimestampMetadata(t *testing.T) {
	storage := &fakeStorage{}
	manager := NewManager(fakeDumper{data: []byte("CREATE TABLE stores;")}, storage)
	createdAt := time.Date(2026, time.July, 21, 6, 40, 0, 0, time.UTC)
	manager.now = func() time.Time { return createdAt }

	result, err := manager.BackupDatabase(context.Background())
	if err != nil {
		t.Fatalf("BackupDatabase() error = %v", err)
	}
	if len(storage.objects) != 1 {
		t.Fatalf("stored objects = %d, want 1", len(storage.objects))
	}
	object := storage.objects[0]
	if object.key != result.Key || result.Metadata.Kind != DatabaseKind {
		t.Fatalf("result = %#v, object = %#v", result, object)
	}
	if !strings.Contains(object.key, "backups/database/20260721T064000.000000000Z-") {
		t.Fatalf("key = %q, want kind and timestamp", object.key)
	}
	if object.metadata.Timestamp != createdAt || object.metadata.Size != len(object.data) {
		t.Fatalf("metadata = %#v, want timestamp and size", object.metadata)
	}
	if object.metadata.Checksum == "" || !strings.HasSuffix(object.key, object.metadata.Checksum+".sql") {
		t.Fatalf("metadata checksum = %q, key = %q", object.metadata.Checksum, object.key)
	}
}

func TestBackupFilesStoresReadableTarGzip(t *testing.T) {
	directory := t.TempDir()
	first := filepath.Join(directory, "first.txt")
	second := filepath.Join(directory, "second.txt")
	if err := os.WriteFile(first, []byte("first"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(second, []byte("second"), 0o600); err != nil {
		t.Fatal(err)
	}

	storage := &fakeStorage{}
	manager := NewManager(fakeDumper{}, storage)
	result, err := manager.BackupFiles(context.Background(), []File{{Path: first}, {Path: second}})
	if err != nil {
		t.Fatalf("BackupFiles() error = %v", err)
	}
	if result.Metadata.Kind != FilesKind || result.Metadata.ContentType != filesContentType {
		t.Fatalf("metadata = %#v, want files archive metadata", result.Metadata)
	}
	if len(storage.objects) != 1 {
		t.Fatalf("stored objects = %d, want 1", len(storage.objects))
	}

	reader, err := gzip.NewReader(strings.NewReader(string(storage.objects[0].data)))
	if err != nil {
		t.Fatalf("open gzip archive: %v", err)
	}
	tarReader := tar.NewReader(reader)
	contents := make(map[string]string)
	for {
		header, readErr := tarReader.Next()
		if errors.Is(readErr, io.EOF) {
			break
		}
		if readErr != nil {
			t.Fatalf("read tar archive: %v", readErr)
		}
		data, readErr := io.ReadAll(tarReader)
		if readErr != nil {
			t.Fatalf("read %q: %v", header.Name, readErr)
		}
		contents[filepath.Base(header.Name)] = string(data)
	}
	if err := reader.Close(); err != nil {
		t.Fatal(err)
	}
	if contents["first.txt"] != "first" || contents["second.txt"] != "second" {
		t.Fatalf("archive contents = %#v", contents)
	}
	if result.Metadata.Checksum == "" || result.Metadata.Size != len(storage.objects[0].data) {
		t.Fatalf("metadata = %#v, want checksum and size", result.Metadata)
	}
}

func TestBackupPropagatesDumperAndStorageErrors(t *testing.T) {
	dumpErr := errors.New("mysqldump failed")
	storage := &fakeStorage{}
	err := NewManager(fakeDumper{err: dumpErr}, storage)
	if got := errString(err.BackupDatabase(context.Background())); !strings.Contains(got, dumpErr.Error()) {
		t.Fatalf("BackupDatabase() error = %q, want dumper error", got)
	}

	storeErr := errors.New("object storage unavailable")
	manager := NewManager(fakeDumper{data: []byte("dump")}, &fakeStorage{err: storeErr})
	if got := errString(manager.BackupDatabase(context.Background())); !strings.Contains(got, storeErr.Error()) {
		t.Fatalf("BackupDatabase() error = %q, want storage error", got)
	}
}

func TestBackupFilesRejectsEmptyInput(t *testing.T) {
	_, err := NewManager(fakeDumper{}, &fakeStorage{}).BackupFiles(context.Background(), nil)
	if err == nil || !strings.Contains(err.Error(), "at least one file") {
		t.Fatalf("BackupFiles() error = %v, want empty input validation", err)
	}
}

func errString(result Result, err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}
