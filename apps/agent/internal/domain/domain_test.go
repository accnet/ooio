package domain

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
)

type fakeStore struct {
	mappings  map[string]Mapping
	getErr    error
	putErr    error
	deleteErr error
	listErr   error
}

func newFakeStore() *fakeStore {
	return &fakeStore{mappings: make(map[string]Mapping)}
}

func (s *fakeStore) Get(_ context.Context, domain string) (Mapping, error) {
	if s.getErr != nil {
		return Mapping{}, s.getErr
	}
	mapping, ok := s.mappings[domain]
	if !ok {
		return Mapping{}, ErrNotFound
	}
	return mapping, nil
}

func (s *fakeStore) Put(_ context.Context, mapping Mapping) error {
	if s.putErr != nil {
		return s.putErr
	}
	if _, exists := s.mappings[mapping.Domain]; exists {
		return ErrDomainExists
	}
	s.mappings[mapping.Domain] = mapping
	return nil
}

func (s *fakeStore) Delete(_ context.Context, domain string) error {
	if s.deleteErr != nil {
		return s.deleteErr
	}
	if _, exists := s.mappings[domain]; !exists {
		return ErrNotFound
	}
	delete(s.mappings, domain)
	return nil
}

func (s *fakeStore) List(_ context.Context) ([]Mapping, error) {
	if s.listErr != nil {
		return nil, s.listErr
	}
	mappings := make([]Mapping, 0, len(s.mappings))
	for _, mapping := range s.mappings {
		mappings = append(mappings, mapping)
	}
	return mappings, nil
}

type fakeReloader struct {
	configs []string
	err     error
}

func (r *fakeReloader) Reload(_ context.Context, config string) error {
	r.configs = append(r.configs, config)
	return r.err
}

func TestManagerAddAndRemoveDomain(t *testing.T) {
	store := newFakeStore()
	reloader := &fakeReloader{}
	manager := NewManager(store, reloader)

	if err := manager.AddDomain(context.Background(), " Example.COM ", "site-1"); err != nil {
		t.Fatalf("AddDomain() error = %v", err)
	}
	mapping, err := store.Get(context.Background(), "example.com")
	if err != nil || mapping.SiteID != "site-1" {
		t.Fatalf("stored mapping = %#v, error = %v", mapping, err)
	}
	if len(reloader.configs) != 1 || !strings.Contains(reloader.configs[0], "example.com {") || !strings.Contains(reloader.configs[0], "site-1") {
		t.Fatalf("add config = %q", reloader.configs)
	}

	if err := manager.RemoveDomain(context.Background(), "EXAMPLE.com"); err != nil {
		t.Fatalf("RemoveDomain() error = %v", err)
	}
	if _, err := store.Get(context.Background(), "example.com"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("mapping after remove error = %v, want not found", err)
	}
	if len(reloader.configs) != 2 || reloader.configs[1] != "" {
		t.Fatalf("remove config = %q, want empty configuration", reloader.configs[1])
	}
}

func TestManagerRejectsDuplicateDomain(t *testing.T) {
	store := newFakeStore()
	reloader := &fakeReloader{}
	manager := New(store, reloader)

	if err := manager.AddDomain(context.Background(), "example.com", "site-1"); err != nil {
		t.Fatalf("first AddDomain() error = %v", err)
	}
	if err := manager.AddDomain(context.Background(), "example.com", "site-2"); !errors.Is(err, ErrDomainExists) {
		t.Fatalf("duplicate AddDomain() error = %v, want ErrDomainExists", err)
	}
	if len(reloader.configs) != 1 {
		t.Fatalf("reload count = %d, want 1", len(reloader.configs))
	}
}

func TestManagerRollsBackWhenReloadFails(t *testing.T) {
	store := newFakeStore()
	reloader := &fakeReloader{err: errors.New("Caddy unavailable")}
	manager := NewManager(store, reloader)

	err := manager.AddDomain(context.Background(), "example.com", "site-1")
	if err == nil || !strings.Contains(err.Error(), "Caddy unavailable") {
		t.Fatalf("AddDomain() error = %v, want reload error", err)
	}
	if _, lookupErr := store.Get(context.Background(), "example.com"); !errors.Is(lookupErr, ErrNotFound) {
		t.Fatalf("mapping after rollback error = %v, want not found", lookupErr)
	}
}

func TestManagerValidatesHostname(t *testing.T) {
	manager := NewManager(newFakeStore(), &fakeReloader{})
	for _, value := range []string{"", "https://example.com", "bad domain.com", "-example.com", "example..com"} {
		if err := manager.AddDomain(context.Background(), value, "site-1"); err == nil {
			t.Errorf("AddDomain(%q) succeeded, want validation error", value)
		}
	}
}

func TestCaddyConfigIsDeterministic(t *testing.T) {
	config, err := CaddyConfig([]Mapping{{Domain: "z.example", SiteID: "z"}, {Domain: "a.example", SiteID: "a"}})
	if err != nil {
		t.Fatalf("CaddyConfig() error = %v", err)
	}
	if strings.Index(config, "a.example {") > strings.Index(config, "z.example {") {
		t.Fatalf("config is not sorted: %q", config)
	}
}

func TestCaddyReloaderUsesCaddyfileAdapter(t *testing.T) {
	var gotRequest *http.Request
	var gotBody []byte
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		gotRequest = request
		var err error
		gotBody, err = io.ReadAll(request.Body)
		if err != nil {
			return nil, err
		}
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader("ok")), Header: make(http.Header), Request: request}, nil
	})}

	if err := NewCaddyReloader(client).Reload(context.Background(), "example.com {}\n"); err != nil {
		t.Fatalf("Reload() error = %v", err)
	}
	if gotRequest == nil || gotRequest.Method != http.MethodPost || gotRequest.URL.String() != DefaultCaddyAdminURL+"/load?adapter=caddyfile" {
		t.Fatalf("request = %#v", gotRequest)
	}
	if gotRequest.Header.Get("Content-Type") != "text/caddyfile" || string(gotBody) != "example.com {}\n" {
		t.Fatalf("request content type/body = %q/%q", gotRequest.Header.Get("Content-Type"), gotBody)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}
