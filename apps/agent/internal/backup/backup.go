// Package backup coordinates creation and storage of node backups.
package backup

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	DatabaseKind = "database"
	FilesKind    = "files"

	databaseContentType = "application/sql"
	filesContentType    = "application/gzip"
	timestampFormat     = "20060102T150405.000000000Z"
)

// Dumper is the seam for the node's database dump command, such as mysqldump.
// The manager only handles the resulting bytes and does not execute commands.
type Dumper interface {
	Dump(context.Context) ([]byte, error)
}

// Storage is the seam for object storage, such as S3-compatible storage.
// Metadata is supplied with every object so the storage implementation can
// persist searchable backup attributes without inspecting the payload.
type Storage interface {
	Put(context.Context, string, []byte, Metadata) error
}

// Metadata describes the uploaded backup object.
type Metadata struct {
	Kind        string    `json:"kind"`
	Timestamp   time.Time `json:"timestamp"`
	Checksum    string    `json:"checksum"`
	Size        int       `json:"size"`
	ContentType string    `json:"contentType"`
}

// Result identifies an object written to storage.
type Result struct {
	Key      string   `json:"key"`
	Metadata Metadata `json:"metadata"`
}

// Backup is the descriptive name for a stored backup result.
type Backup = Result

// File identifies one regular file to include in a files backup. The archive
// name is derived from the path after cleaning and removing a leading root.
type File struct {
	Path string
}

// Manager coordinates backup creation and upload. Dumper and Storage are
// intentionally injected so mysqldump and object-storage clients remain
// outside the agent's core and unit tests need no external services.
type Manager struct {
	dumper  Dumper
	storage Storage
	now     func() time.Time
}

func NewManager(dumper Dumper, storage Storage) *Manager {
	return &Manager{dumper: dumper, storage: storage, now: time.Now}
}

// New is an alias for callers wiring the agent at startup.
func New(dumper Dumper, storage Storage) *Manager {
	return NewManager(dumper, storage)
}

// BackupDatabase dumps the database and uploads the dump as one object.
func (m *Manager) BackupDatabase(ctx context.Context) (Result, error) {
	if err := m.validate(ctx); err != nil {
		return Result{}, err
	}
	if m.dumper == nil {
		return Result{}, fmt.Errorf("database backup requires a dumper")
	}
	data, err := m.dumper.Dump(ctx)
	if err != nil {
		return Result{}, fmt.Errorf("dump database: %w", err)
	}
	return m.upload(ctx, DatabaseKind, databaseContentType, ".sql", data)
}

// BackupFiles archives the supplied regular files and uploads the archive as
// one object. Directory traversal and directory entries are deliberately out
// of scope for this foundation module; callers should provide regular files.
func (m *Manager) BackupFiles(ctx context.Context, files []File) (Result, error) {
	if err := m.validate(ctx); err != nil {
		return Result{}, err
	}
	data, err := archiveFiles(ctx, files)
	if err != nil {
		return Result{}, fmt.Errorf("archive files: %w", err)
	}
	return m.upload(ctx, FilesKind, filesContentType, ".tar.gz", data)
}

func (m *Manager) validate(ctx context.Context) error {
	if m == nil || m.storage == nil {
		return fmt.Errorf("backup manager requires storage")
	}
	if ctx == nil {
		return fmt.Errorf("backup operation requires a context")
	}
	return ctx.Err()
}

func (m *Manager) upload(ctx context.Context, kind, contentType, suffix string, data []byte) (Result, error) {
	createdAt := time.Now().UTC()
	if m.now != nil {
		createdAt = m.now().UTC()
	}
	checksumBytes := sha256.Sum256(data)
	checksum := hex.EncodeToString(checksumBytes[:])
	metadata := Metadata{
		Kind:        kind,
		Timestamp:   createdAt,
		Checksum:    checksum,
		Size:        len(data),
		ContentType: contentType,
	}
	key := fmt.Sprintf("backups/%s/%s-%s%s", kind, createdAt.Format(timestampFormat), checksum, suffix)
	if err := m.storage.Put(ctx, key, data, metadata); err != nil {
		return Result{}, fmt.Errorf("store %s backup: %w", kind, err)
	}
	return Result{Key: key, Metadata: metadata}, nil
}

func archiveFiles(ctx context.Context, files []File) ([]byte, error) {
	if len(files) == 0 {
		return nil, fmt.Errorf("at least one file is required")
	}

	var archive bytes.Buffer
	gzipWriter := gzip.NewWriter(&archive)
	tarWriter := tar.NewWriter(gzipWriter)
	seen := make(map[string]struct{}, len(files))
	for _, file := range files {
		if err := ctx.Err(); err != nil {
			_ = tarWriter.Close()
			_ = gzipWriter.Close()
			return nil, err
		}
		name, err := archiveName(file.Path)
		if err != nil {
			_ = tarWriter.Close()
			_ = gzipWriter.Close()
			return nil, err
		}
		if _, exists := seen[name]; exists {
			_ = tarWriter.Close()
			_ = gzipWriter.Close()
			return nil, fmt.Errorf("duplicate archive path %q", name)
		}
		seen[name] = struct{}{}

		info, err := os.Stat(file.Path)
		if err != nil {
			_ = tarWriter.Close()
			_ = gzipWriter.Close()
			return nil, fmt.Errorf("stat %q: %w", file.Path, err)
		}
		if !info.Mode().IsRegular() {
			_ = tarWriter.Close()
			_ = gzipWriter.Close()
			return nil, fmt.Errorf("%q is not a regular file", file.Path)
		}
		header, err := tar.FileInfoHeader(info, "")
		if err != nil {
			_ = tarWriter.Close()
			_ = gzipWriter.Close()
			return nil, fmt.Errorf("create archive header for %q: %w", file.Path, err)
		}
		header.Name = name
		if err := tarWriter.WriteHeader(header); err != nil {
			_ = tarWriter.Close()
			_ = gzipWriter.Close()
			return nil, fmt.Errorf("write archive header for %q: %w", file.Path, err)
		}
		input, err := os.Open(file.Path)
		if err != nil {
			_ = tarWriter.Close()
			_ = gzipWriter.Close()
			return nil, fmt.Errorf("open %q: %w", file.Path, err)
		}
		_, copyErr := io.Copy(tarWriter, input)
		closeErr := input.Close()
		if copyErr != nil {
			_ = tarWriter.Close()
			_ = gzipWriter.Close()
			return nil, fmt.Errorf("read %q: %w", file.Path, copyErr)
		}
		if closeErr != nil {
			_ = tarWriter.Close()
			_ = gzipWriter.Close()
			return nil, fmt.Errorf("close %q: %w", file.Path, closeErr)
		}
	}
	if err := tarWriter.Close(); err != nil {
		_ = gzipWriter.Close()
		return nil, fmt.Errorf("close tar archive: %w", err)
	}
	if err := gzipWriter.Close(); err != nil {
		return nil, fmt.Errorf("close gzip archive: %w", err)
	}
	return archive.Bytes(), nil
}

func archiveName(path string) (string, error) {
	if strings.TrimSpace(path) == "" {
		return "", fmt.Errorf("file path is required")
	}
	cleaned := filepath.ToSlash(filepath.Clean(path))
	cleaned = strings.TrimLeft(cleaned, "/")
	if cleaned == "" || cleaned == "." || cleaned == ".." || strings.HasPrefix(cleaned, "../") {
		return "", fmt.Errorf("invalid file path %q", path)
	}
	return cleaned, nil
}
