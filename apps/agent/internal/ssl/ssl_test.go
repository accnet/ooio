package ssl

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
)

type fakeIssuer struct {
	issued  []string
	renewed []string
	err     error
}

func (f *fakeIssuer) Issue(_ context.Context, domain string) error {
	f.issued = append(f.issued, domain)
	return f.err
}

func (f *fakeIssuer) Renew(_ context.Context, domain string) error {
	f.renewed = append(f.renewed, domain)
	return f.err
}

type fakeReloader struct {
	domains []string
	err     error
}

func (f *fakeReloader) Reload(_ context.Context, domain string) error {
	f.domains = append(f.domains, domain)
	return f.err
}

func TestManagerIssueAndRenewReloadAfterSuccessfulIssuance(t *testing.T) {
	issuer := &fakeIssuer{}
	reloader := &fakeReloader{}
	manager := NewManager(issuer, reloader)

	if err := manager.Issue(context.Background(), " example.test "); err != nil {
		t.Fatalf("Issue() error = %v", err)
	}
	if err := manager.Renew(context.Background(), "example.test"); err != nil {
		t.Fatalf("Renew() error = %v", err)
	}

	if strings.Join(issuer.issued, ",") != "example.test" {
		t.Fatalf("issued domains = %#v", issuer.issued)
	}
	if strings.Join(issuer.renewed, ",") != "example.test" {
		t.Fatalf("renewed domains = %#v", issuer.renewed)
	}
	if strings.Join(reloader.domains, ",") != "example.test,example.test" {
		t.Fatalf("reloaded domains = %#v", reloader.domains)
	}
}

func TestManagerDoesNotReloadWhenIssuanceFails(t *testing.T) {
	issuer := &fakeIssuer{err: errors.New("ACME unavailable")}
	reloader := &fakeReloader{}
	manager := New(issuer, reloader)

	err := manager.Issue(context.Background(), "example.test")
	if err == nil || !strings.Contains(err.Error(), "ACME unavailable") {
		t.Fatalf("Issue() error = %v, want issuer error", err)
	}
	if len(reloader.domains) != 0 {
		t.Fatalf("reloader calls = %d, want 0", len(reloader.domains))
	}
}

func TestManagerReturnsReloaderError(t *testing.T) {
	reloaderErr := errors.New("Caddy unavailable")
	issuer := &fakeIssuer{}
	reloader := &fakeReloader{err: reloaderErr}

	err := NewManager(issuer, reloader).Renew(context.Background(), "example.test")
	if err == nil || !strings.Contains(err.Error(), "Caddy unavailable") {
		t.Fatalf("Renew() error = %v, want reloader error", err)
	}
}

func TestCaddyReloaderUsesLocalAdminAPI(t *testing.T) {
	var gotRequest *http.Request
	var gotBody []byte
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		gotRequest = request
		var err error
		gotBody, err = io.ReadAll(request.Body)
		if err != nil {
			return nil, err
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader("ok")),
			Header:     make(http.Header),
			Request:    request,
		}, nil
	})}

	if err := NewCaddyReloader(client).Reload(context.Background(), "example.test"); err != nil {
		t.Fatalf("Reload() error = %v", err)
	}
	if gotRequest == nil || gotRequest.Method != http.MethodPost || gotRequest.URL.String() != DefaultCaddyAdminURL+"/load" {
		t.Fatalf("request = %#v, want POST %s/load", gotRequest, DefaultCaddyAdminURL)
	}
	if gotRequest.Header.Get("Content-Type") != "application/json" {
		t.Fatalf("Content-Type = %q, want application/json", gotRequest.Header.Get("Content-Type"))
	}
	var payload struct {
		Domain string `json:"domain"`
	}
	if err := json.Unmarshal(gotBody, &payload); err != nil {
		t.Fatalf("decode request: %v", err)
	}
	if payload.Domain != "example.test" {
		t.Fatalf("domain = %q, want example.test", payload.Domain)
	}
}

func TestCaddyReloaderReturnsHTTPError(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusBadRequest,
			Body:       io.NopCloser(strings.NewReader("reload rejected\n")),
			Header:     make(http.Header),
			Request:    request,
		}, nil
	})}

	err := NewCaddyReloader(client).Reload(context.Background(), "example.test")
	if err == nil || !strings.Contains(err.Error(), "status 400") {
		t.Fatalf("Reload() error = %v, want status error", err)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}
