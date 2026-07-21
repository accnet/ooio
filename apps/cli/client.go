package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	defaultBaseURL = "http://127.0.0.1/wp-json"
	healthPath     = "/platform/v1/health"
	sitesPath      = "/platform/v1/sites"
)

// CreateStoreRequest is the request body accepted by the MU Plugin create
// site endpoint. NetworkID is retained for callers using a named network.
type CreateStoreRequest struct {
	Domain    string `json:"domain"`
	Title     string `json:"title"`
	Path      string `json:"path,omitempty"`
	NetworkID string `json:"networkId,omitempty"`
}

// Client talks directly to the localhost MU Plugin REST API. It does not
// depend on the Agent package or the SaaS control plane.
type Client struct {
	baseURL    string
	authToken  string
	httpClient *http.Client
}

// NewClient creates a client with a bounded request timeout.
func NewClient(baseURL, authToken string) *Client {
	return NewClientWithHTTPClient(baseURL, authToken, &http.Client{Timeout: 10 * time.Second})
}

// NewClientWithHTTPClient allows tests and callers to provide an HTTP client.
func NewClientWithHTTPClient(baseURL, authToken string, httpClient *http.Client) *Client {
	return &Client{
		baseURL:    strings.TrimRight(strings.TrimSpace(baseURL), "/"),
		authToken:  strings.TrimSpace(authToken),
		httpClient: httpClient,
	}
}

func (c *Client) CreateStore(ctx context.Context, input CreateStoreRequest) (json.RawMessage, error) {
	if strings.TrimSpace(input.Domain) == "" {
		return nil, fmt.Errorf("domain is required")
	}
	if strings.TrimSpace(input.Title) == "" {
		return nil, fmt.Errorf("title is required")
	}

	body, err := json.Marshal(input)
	if err != nil {
		return nil, fmt.Errorf("encode create-store request: %w", err)
	}
	return c.doJSON(ctx, http.MethodPost, sitesPath, body, http.StatusCreated)
}

func (c *Client) DeleteStore(ctx context.Context, siteID string) (json.RawMessage, error) {
	siteID = strings.TrimSpace(siteID)
	if !isPositiveInteger(siteID) {
		return nil, fmt.Errorf("site-id must be a positive integer")
	}
	return c.doJSON(ctx, http.MethodDelete, sitesPath+"/"+url.PathEscape(siteID), nil, http.StatusAccepted)
}

func (c *Client) Health(ctx context.Context) (json.RawMessage, error) {
	return c.doJSON(ctx, http.MethodGet, healthPath, nil, http.StatusOK)
}

func (c *Client) doJSON(ctx context.Context, method, path string, body []byte, expectedStatus int) (json.RawMessage, error) {
	if c == nil || c.httpClient == nil {
		return nil, fmt.Errorf("CLI client is not configured")
	}
	if err := validateBaseURL(c.baseURL); err != nil {
		return nil, err
	}

	request, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	request.Header.Set("Accept", "application/json")
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if c.authToken != "" {
		request.Header.Set("Authorization", "Bearer "+c.authToken)
	}

	response, err := c.httpClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("request %s %s: %w", method, path, err)
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}
	if response.StatusCode != expectedStatus {
		return nil, fmt.Errorf("MU Plugin returned status %d: %s", response.StatusCode, strings.TrimSpace(string(responseBody)))
	}
	if len(bytes.TrimSpace(responseBody)) == 0 {
		return json.RawMessage(`{}`), nil
	}
	if !json.Valid(responseBody) {
		return nil, fmt.Errorf("MU Plugin returned invalid JSON")
	}
	return json.RawMessage(responseBody), nil
}

func validateBaseURL(raw string) error {
	parsed, err := url.ParseRequestURI(raw)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return fmt.Errorf("base URL must be an absolute URL: %q", raw)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return fmt.Errorf("base URL must use http or https: %q", raw)
	}
	return nil
}

func isPositiveInteger(value string) bool {
	if value == "" {
		return false
	}
	parsed, err := strconv.ParseUint(value, 10, 64)
	return err == nil && parsed > 0
}
