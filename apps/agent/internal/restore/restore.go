// Package restore coordinates loading full database backups or one site's
// tables from a shared WordPress multisite database.
package restore

import (
	"context"
	"fmt"
	"strconv"
	"strings"
)

// Storage is the seam for object storage, such as S3-compatible storage.
// Implementations fetch the complete backup object identified by key.
type Storage interface {
	Fetch(context.Context, string) ([]byte, error)
}

// Loader is the seam for applying a database dump, such as through mysql.
// It receives the dump bytes and is responsible for executing them.
type Loader interface {
	Apply(context.Context, []byte) error
}

// Manager coordinates fetching and loading restore data. Storage and Loader
// are injected so S3 and mysql clients remain outside the agent core.
type Manager struct {
	storage Storage
	loader  Loader
}

// NewManager constructs a restore manager with the supplied infrastructure
// seams.
func NewManager(storage Storage, loader Loader) *Manager {
	return &Manager{storage: storage, loader: loader}
}

// New is an alias for callers wiring the agent at startup.
func New(storage Storage, loader Loader) *Manager {
	return NewManager(storage, loader)
}

// Restore fetches and applies the complete backup identified by backupKey.
func (m *Manager) Restore(ctx context.Context, backupKey string) error {
	if err := m.validate(ctx, backupKey); err != nil {
		return err
	}

	dump, err := m.storage.Fetch(ctx, backupKey)
	if err != nil {
		return fmt.Errorf("fetch backup %q: %w", backupKey, err)
	}
	if err := m.loader.Apply(ctx, dump); err != nil {
		return fmt.Errorf("apply backup %q: %w", backupKey, err)
	}
	return nil
}

// RestoreSite restores only tables belonging to blogID from a shared
// multisite database backup. Site tables are selected by the wp_<blogID>_
// prefix. The shared wp_users and wp_usermeta tables are deliberately omitted:
// restoring them would overwrite data shared by every site, and ADR-005 does
// not define a separate merge or conflict-resolution strategy for them.
func (m *Manager) RestoreSite(ctx context.Context, blogID, backupKey string) error {
	if err := m.validate(ctx, backupKey); err != nil {
		return err
	}
	if err := validateBlogID(blogID); err != nil {
		return err
	}

	dump, err := m.storage.Fetch(ctx, backupKey)
	if err != nil {
		return fmt.Errorf("fetch backup %q: %w", backupKey, err)
	}
	siteDump, err := FilterSiteDump(dump, blogID)
	if err != nil {
		return fmt.Errorf("filter backup %q for blog %s: %w", backupKey, blogID, err)
	}
	if err := m.loader.Apply(ctx, siteDump); err != nil {
		return fmt.Errorf("apply blog %s backup %q: %w", blogID, backupKey, err)
	}
	return nil
}

func (m *Manager) validate(ctx context.Context, backupKey string) error {
	if m == nil || m.storage == nil {
		return fmt.Errorf("restore manager requires storage")
	}
	if m.loader == nil {
		return fmt.Errorf("restore manager requires loader")
	}
	if ctx == nil {
		return fmt.Errorf("restore operation requires a context")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if strings.TrimSpace(backupKey) == "" {
		return fmt.Errorf("backup key is required")
	}
	return nil
}

func validateBlogID(blogID string) error {
	if strings.TrimSpace(blogID) == "" {
		return fmt.Errorf("blog ID is required")
	}
	value, err := strconv.ParseUint(blogID, 10, 32)
	if err != nil || value == 0 {
		return fmt.Errorf("blog ID must be a positive integer")
	}
	return nil
}

// FilterSiteDump selects complete SQL statements that reference the requested
// site's table prefix. It is intentionally a small mysqldump filter, not a SQL
// parser: quoted identifiers, comments, and string escapes are handled enough
// to avoid splitting statements at semicolons inside them.
func FilterSiteDump(dump []byte, blogID string) ([]byte, error) {
	if err := validateBlogID(blogID); err != nil {
		return nil, err
	}
	prefix := "wp_" + blogID + "_"
	statements := splitStatements(string(dump))
	var filtered strings.Builder
	matched := 0
	for _, statement := range statements {
		if !containsTablePrefix(statement, prefix) {
			continue
		}
		filtered.WriteString(statement)
		filtered.WriteString("\n")
		matched++
	}
	if matched == 0 {
		return nil, fmt.Errorf("backup contains no tables with prefix %q", prefix)
	}
	return []byte(filtered.String()), nil
}

func splitStatements(dump string) []string {
	statements := make([]string, 0)
	start := 0
	var quote byte
	lineComment := false
	blockComment := false
	escaped := false

	for i := 0; i < len(dump); i++ {
		c := dump[i]
		if lineComment {
			if c == '\n' || c == '\r' {
				lineComment = false
			}
			continue
		}
		if blockComment {
			if c == '*' && i+1 < len(dump) && dump[i+1] == '/' {
				blockComment = false
				i++
			}
			continue
		}
		if quote != 0 {
			if escaped {
				escaped = false
				continue
			}
			if c == '\\' && quote != '`' {
				escaped = true
				continue
			}
			if c == quote {
				quote = 0
			}
			continue
		}

		switch c {
		case '\'', '"', '`':
			quote = c
		case '#':
			lineComment = true
		case '-':
			if i+2 < len(dump) && dump[i+1] == '-' && isWhitespace(dump[i+2]) {
				lineComment = true
				i++
			}
		case '/':
			if i+1 < len(dump) && dump[i+1] == '*' {
				blockComment = true
				i++
			}
		case ';':
			if statement := strings.TrimSpace(dump[start : i+1]); statement != "" {
				statements = append(statements, statement)
			}
			start = i + 1
		}
	}
	if statement := strings.TrimSpace(dump[start:]); statement != "" {
		statements = append(statements, statement)
	}
	return statements
}

func containsTablePrefix(statement, prefix string) bool {
	masked := maskComments(statement)
	for offset := 0; offset < len(masked); {
		index := strings.Index(masked[offset:], prefix)
		if index < 0 {
			return false
		}
		index += offset
		beforeOK := index == 0 || !isIdentifier(masked[index-1])
		after := index + len(prefix)
		afterOK := after < len(masked) && isIdentifier(masked[after])
		quotedString := index > 0 && (masked[index-1] == '\'' || masked[index-1] == '"')
		if beforeOK && afterOK && !quotedString {
			return true
		}
		offset = index + len(prefix)
	}
	return false
}

func maskComments(statement string) string {
	masked := []byte(statement)
	var quote byte
	lineComment := false
	blockComment := false
	escaped := false
	for i := 0; i < len(masked); i++ {
		c := masked[i]
		if lineComment {
			if c == '\n' || c == '\r' {
				lineComment = false
			} else {
				masked[i] = ' '
			}
			continue
		}
		if blockComment {
			if c == '*' && i+1 < len(masked) && masked[i+1] == '/' {
				masked[i], masked[i+1] = ' ', ' '
				blockComment = false
				i++
			} else if c != '\n' && c != '\r' {
				masked[i] = ' '
			}
			continue
		}
		if quote != 0 {
			if escaped {
				escaped = false
				continue
			}
			if c == '\\' && quote != '`' {
				escaped = true
				continue
			}
			if c == quote {
				quote = 0
			}
			continue
		}
		switch c {
		case '\'', '"', '`':
			quote = c
		case '#':
			masked[i] = ' '
			lineComment = true
		case '-':
			if i+2 < len(masked) && masked[i+1] == '-' && isWhitespace(masked[i+2]) {
				masked[i], masked[i+1] = ' ', ' '
				lineComment = true
				i++
			}
		case '/':
			if i+1 < len(masked) && masked[i+1] == '*' {
				masked[i], masked[i+1] = ' ', ' '
				blockComment = true
				i++
			}
		}
	}
	return string(masked)
}

func isIdentifier(c byte) bool {
	return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
		(c >= '0' && c <= '9') || c == '_' || c == '$'
}

func isWhitespace(c byte) bool {
	return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f'
}
