package restore

import (
	"context"
	"errors"
	"strings"
	"testing"
)

type fakeStorage struct {
	data  []byte
	err   error
	key   string
	calls int
}

func (f *fakeStorage) Fetch(_ context.Context, key string) ([]byte, error) {
	f.calls++
	f.key = key
	if f.err != nil {
		return nil, f.err
	}
	return append([]byte(nil), f.data...), nil
}

type fakeLoader struct {
	dumps [][]byte
	err   error
}

func (f *fakeLoader) Apply(_ context.Context, dump []byte) error {
	f.dumps = append(f.dumps, append([]byte(nil), dump...))
	return f.err
}

func TestRestoreFetchesAndAppliesFullBackup(t *testing.T) {
	storage := &fakeStorage{data: []byte("CREATE TABLE wp_options (name varchar(20));")}
	loader := &fakeLoader{}

	if err := NewManager(storage, loader).Restore(context.Background(), "backups/database/full.sql"); err != nil {
		t.Fatalf("Restore() error = %v", err)
	}
	if storage.calls != 1 || storage.key != "backups/database/full.sql" {
		t.Fatalf("storage calls/key = %d/%q, want one fetch of backup key", storage.calls, storage.key)
	}
	if len(loader.dumps) != 1 || string(loader.dumps[0]) != string(storage.data) {
		t.Fatalf("loaded dump = %q, want full backup", loader.dumps)
	}
}

func TestRestoreSiteFiltersToOneSiteAndExcludesSharedTables(t *testing.T) {
	dump := []byte("-- wp_7_posts in a comment must not match\n" +
		"DROP TABLE IF EXISTS `wp_7_posts`;\n" +
		"CREATE TABLE `wp_7_posts` (id bigint);\n" +
		"INSERT INTO `wp_7_posts` VALUES (1);\n" +
		"DROP TABLE IF EXISTS `wp_users`;\n" +
		"INSERT INTO `wp_users` VALUES (1, 'shared');\n" +
		"DROP TABLE IF EXISTS `wp_usermeta`;\n" +
		"INSERT INTO `wp_usermeta` VALUES (1, 'shared');\n" +
		"CREATE TABLE `wp_8_posts` (id bigint);\n")
	storage := &fakeStorage{data: dump}
	loader := &fakeLoader{}

	if err := NewManager(storage, loader).RestoreSite(context.Background(), "7", "backup.sql"); err != nil {
		t.Fatalf("RestoreSite() error = %v", err)
	}
	if len(loader.dumps) != 1 {
		t.Fatalf("loader calls = %d, want 1", len(loader.dumps))
	}
	filtered := string(loader.dumps[0])
	for _, want := range []string{"DROP TABLE IF EXISTS `wp_7_posts`", "CREATE TABLE `wp_7_posts`", "INSERT INTO `wp_7_posts`"} {
		if !strings.Contains(filtered, want) {
			t.Errorf("filtered dump missing %q: %s", want, filtered)
		}
	}
	for _, excluded := range []string{"wp_users", "wp_usermeta", "wp_8_posts"} {
		if strings.Contains(filtered, excluded) {
			t.Errorf("filtered dump contains excluded %q: %s", excluded, filtered)
		}
	}
}

func TestRestorePropagatesStorageAndLoaderErrors(t *testing.T) {
	storageErr := errors.New("object storage unavailable")
	if err := NewManager(&fakeStorage{err: storageErr}, &fakeLoader{}).Restore(context.Background(), "backup.sql"); !errors.Is(err, storageErr) {
		t.Fatalf("Restore() error = %v, want storage error", err)
	}

	loaderErr := errors.New("mysql unavailable")
	if err := NewManager(&fakeStorage{data: []byte("dump")}, &fakeLoader{err: loaderErr}).Restore(context.Background(), "backup.sql"); !errors.Is(err, loaderErr) {
		t.Fatalf("Restore() error = %v, want loader error", err)
	}
}

func TestRestoreSiteRejectsInvalidBlogIDAndMissingSite(t *testing.T) {
	manager := NewManager(&fakeStorage{data: []byte("CREATE TABLE `wp_7_posts` (id bigint);")}, &fakeLoader{})
	for _, blogID := range []string{"", "0", "7;DROP TABLE wp_users"} {
		if err := manager.RestoreSite(context.Background(), blogID, "backup.sql"); err == nil {
			t.Errorf("RestoreSite(%q) error = nil, want invalid blog ID", blogID)
		}
	}

	manager = NewManager(&fakeStorage{data: []byte("CREATE TABLE `wp_8_posts` (id bigint);")}, &fakeLoader{})
	if err := manager.RestoreSite(context.Background(), "7", "backup.sql"); err == nil || !strings.Contains(err.Error(), "no tables") {
		t.Fatalf("RestoreSite() error = %v, want missing-site error", err)
	}
}

func TestFilterSiteDumpKeepsSemicolonsInsideValues(t *testing.T) {
	dump := []byte("INSERT INTO `wp_7_posts` VALUES (1, 'one;two');\n" +
		"INSERT INTO `wp_8_posts` VALUES (2, 'other');\n")
	filtered, err := FilterSiteDump(dump, "7")
	if err != nil {
		t.Fatalf("FilterSiteDump() error = %v", err)
	}
	if string(filtered) != "INSERT INTO `wp_7_posts` VALUES (1, 'one;two');\n" {
		t.Fatalf("filtered dump = %q, want one complete statement", filtered)
	}
}
