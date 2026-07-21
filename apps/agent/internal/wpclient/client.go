package wpclient

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/accnet/ooio/apps/agent/internal/transport"
	"github.com/accnet/ooio/apps/agent/internal/wpadapter"
)

const (
	CreateSiteOperation     = "create-site"
	DeleteSiteOperation     = "delete-site"
	ActivatePluginOperation = "activate-plugin"
	SwitchThemeOperation    = "switch-theme"
	CreateUserOperation     = "create-user"
	SetOptionOperation      = "set-option"

	createSitePath     = "/platform/v1/sites"
	activatePluginPath = "/platform/v1/plugins/activate"
	switchThemePath    = "/platform/v1/themes/switch"
	createUserPath     = "/platform/v1/users"
	setOptionPath      = "/platform/v1/options"
)

// Client implements the localhost HTTP contract exposed by the MU Plugin.
// Agent code uses the wpadapter interface, so the WordPress topology remains
// outside this package.
type Client struct {
	baseURL   string
	authToken string
	transport transport.Client
}

func New(baseURL, authToken string, client transport.Client) *Client {
	return &Client{baseURL: strings.TrimRight(baseURL, "/"), authToken: authToken, transport: client}
}

func NewHTTPClient(baseURL, authToken string, requestTimeout time.Duration) *Client {
	return New(baseURL, authToken, transport.NewHTTPClient(requestTimeout))
}

func NewHTTPClientWithClient(baseURL, authToken string, client *http.Client) *Client {
	return New(baseURL, authToken, transport.NewHTTPClientWithClient(client))
}

func (c *Client) Execute(ctx context.Context, operation wpadapter.Operation) (wpadapter.Result, error) {
	if c == nil || c.transport == nil {
		return wpadapter.Result{}, fmt.Errorf("WordPress client is not configured")
	}
	if err := validateBaseURL(c.baseURL); err != nil {
		return wpadapter.Result{}, err
	}

	request := transport.Request{AuthToken: c.authToken}
	switch strings.TrimSpace(operation.Name) {
	case CreateSiteOperation:
		if len(operation.Payload) == 0 {
			return wpadapter.Result{}, fmt.Errorf("create site payload is required")
		}
		request.Method = http.MethodPost
		request.URL = c.baseURL + createSitePath
		request.Body = operation.Payload
	case DeleteSiteOperation:
		if strings.TrimSpace(operation.Resource) == "" {
			return wpadapter.Result{}, fmt.Errorf("delete site resource is required")
		}
		request.Method = http.MethodDelete
		request.URL = c.baseURL + "/platform/v1/sites/" + url.PathEscape(operation.Resource)
	case ActivatePluginOperation:
		if len(operation.Payload) == 0 {
			return wpadapter.Result{}, fmt.Errorf("activate plugin payload is required")
		}
		request = postRequest(c.baseURL+activatePluginPath, c.authToken, operation.Payload)
	case SwitchThemeOperation:
		if len(operation.Payload) == 0 {
			return wpadapter.Result{}, fmt.Errorf("switch theme payload is required")
		}
		request = postRequest(c.baseURL+switchThemePath, c.authToken, operation.Payload)
	case CreateUserOperation:
		if len(operation.Payload) == 0 {
			return wpadapter.Result{}, fmt.Errorf("create user payload is required")
		}
		request = postRequest(c.baseURL+createUserPath, c.authToken, operation.Payload)
	case SetOptionOperation:
		if len(operation.Payload) == 0 {
			return wpadapter.Result{}, fmt.Errorf("set option payload is required")
		}
		request = postRequest(c.baseURL+setOptionPath, c.authToken, operation.Payload)
	default:
		return wpadapter.Result{}, fmt.Errorf("unsupported WordPress operation %q", operation.Name)
	}

	response, err := c.transport.Do(ctx, request)
	if err != nil {
		return wpadapter.Result{}, err
	}
	wantStatus := expectedStatus(operation.Name)
	if response.StatusCode != wantStatus {
		return wpadapter.Result{}, fmt.Errorf("WordPress operation %q returned status %d", operation.Name, response.StatusCode)
	}
	return wpadapter.Result{Payload: response.Body}, nil
}

func postRequest(endpoint, authToken string, payload []byte) transport.Request {
	return transport.Request{
		Method:    http.MethodPost,
		URL:       endpoint,
		Body:      payload,
		AuthToken: authToken,
	}
}

func expectedStatus(operation string) int {
	if operation == CreateSiteOperation || operation == CreateUserOperation {
		return http.StatusCreated
	}
	if operation == DeleteSiteOperation {
		return http.StatusAccepted
	}
	return http.StatusOK
}

func validateBaseURL(raw string) error {
	parsed, err := url.ParseRequestURI(raw)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return fmt.Errorf("WordPress base URL must be an absolute URL: %q", raw)
	}
	return nil
}
