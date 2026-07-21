package ssl

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const (
	DefaultCaddyAdminURL = "http://127.0.0.1:2019"
	maxCaddyResponseSize = 1 << 20
)

// CaddyReloader calls Caddy's local admin API. The admin endpoint is local by
// default; an explicit endpoint is available for tests and controlled wiring.
type CaddyReloader struct {
	client   *http.Client
	adminURL string
}

func NewCaddyReloader(client *http.Client) *CaddyReloader {
	return NewCaddyReloaderAt(DefaultCaddyAdminURL, client)
}

func NewCaddyReloaderAt(adminURL string, client *http.Client) *CaddyReloader {
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	return &CaddyReloader{
		client:   client,
		adminURL: strings.TrimRight(adminURL, "/"),
	}
}

func (r *CaddyReloader) Reload(ctx context.Context, domain string) error {
	if r == nil || r.client == nil {
		return fmt.Errorf("Caddy reloader is not configured")
	}
	if ctx == nil {
		return fmt.Errorf("Caddy reload requires a context")
	}
	if strings.TrimSpace(r.adminURL) == "" {
		return fmt.Errorf("Caddy admin URL is required")
	}
	domain = strings.TrimSpace(domain)
	if domain == "" {
		return fmt.Errorf("domain is required")
	}

	body, err := json.Marshal(struct {
		Domain string `json:"domain"`
	}{Domain: domain})
	if err != nil {
		return fmt.Errorf("encode Caddy reload request: %w", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, r.adminURL+"/load", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create Caddy reload request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := r.client.Do(request)
	if err != nil {
		return fmt.Errorf("send Caddy reload request: %w", err)
	}
	defer response.Body.Close()
	responseBody, readErr := io.ReadAll(io.LimitReader(response.Body, maxCaddyResponseSize+1))
	if readErr != nil {
		return fmt.Errorf("read Caddy reload response: %w", readErr)
	}
	if len(responseBody) > maxCaddyResponseSize {
		return fmt.Errorf("Caddy reload response exceeds %d bytes", maxCaddyResponseSize)
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("Caddy reload returned status %d: %s", response.StatusCode, strings.TrimSpace(string(responseBody)))
	}
	return nil
}
