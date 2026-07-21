package wpclient

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/accnet/ooio/apps/agent/internal/wpadapter"
)

func TestClientExecuteCreateSiteUsesMUPluginContract(t *testing.T) {
	serverURL := "http://127.0.0.1"
	client := NewHTTPClientWithClient(serverURL, "local-jwt", &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		writer := httptest.NewRecorder()
		if request.Method != http.MethodPost || request.URL.Path != "/platform/v1/sites" {
			t.Fatalf("request = %s %s, want POST /platform/v1/sites", request.Method, request.URL.Path)
		}
		if request.Header.Get("Authorization") != "Bearer local-jwt" {
			t.Fatalf("authorization = %q", request.Header.Get("Authorization"))
		}
		var payload map[string]string
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatalf("decode payload: %v", err)
		}
		if payload["domain"] != "store.example.test" {
			t.Fatalf("payload = %#v", payload)
		}
		writer.Header().Set("Content-Type", "application/json")
		writer.WriteHeader(http.StatusCreated)
		_, _ = writer.Write([]byte(`{"siteId":"site-1","domain":"store.example.test"}`))
		return writer.Result(), nil
	})})
	result, err := client.Execute(context.Background(), wpadapter.Operation{
		Name:    CreateSiteOperation,
		Payload: []byte(`{"domain":"store.example.test","title":"Store"}`),
	})
	if err != nil {
		t.Fatalf("Execute() error = %v", err)
	}
	if string(result.Payload) != `{"siteId":"site-1","domain":"store.example.test"}` {
		t.Fatalf("result payload = %s", result.Payload)
	}
}

func TestClientExecuteDeleteSiteUsesResourcePath(t *testing.T) {
	client := NewHTTPClientWithClient("http://127.0.0.1/", "local-jwt", &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		writer := httptest.NewRecorder()
		if request.Method != http.MethodDelete || request.URL.Path != "/platform/v1/sites/site-1" {
			t.Fatalf("request = %s %s, want DELETE /platform/v1/sites/site-1", request.Method, request.URL.Path)
		}
		if request.Header.Get("Authorization") != "Bearer local-jwt" {
			t.Fatalf("authorization = %q", request.Header.Get("Authorization"))
		}
		writer.WriteHeader(http.StatusAccepted)
		return writer.Result(), nil
	})})
	if _, err := client.Execute(context.Background(), wpadapter.Operation{
		Name:     DeleteSiteOperation,
		Resource: "site-1",
	}); err != nil {
		t.Fatalf("Execute() error = %v", err)
	}
}

func TestClientExecuteUsesMUPluginPathsForRemainingOperations(t *testing.T) {
	tests := []struct {
		name      string
		operation string
		path      string
		status    int
	}{
		{name: "activate plugin", operation: ActivatePluginOperation, path: "/platform/v1/plugins/activate", status: http.StatusOK},
		{name: "switch theme", operation: SwitchThemeOperation, path: "/platform/v1/themes/switch", status: http.StatusOK},
		{name: "create user", operation: CreateUserOperation, path: "/platform/v1/users", status: http.StatusCreated},
		{name: "set option", operation: SetOptionOperation, path: "/platform/v1/options", status: http.StatusOK},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			client := NewHTTPClientWithClient("http://127.0.0.1", "local-jwt", &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
				writer := httptest.NewRecorder()
				if request.Method != http.MethodPost || request.URL.Path != test.path {
					t.Fatalf("request = %s %s, want POST %s", request.Method, request.URL.Path, test.path)
				}
				if request.Header.Get("Authorization") != "Bearer local-jwt" {
					t.Fatalf("authorization = %q", request.Header.Get("Authorization"))
				}
				writer.WriteHeader(test.status)
				_, _ = writer.Write([]byte(`{"status":"ok"}`))
				return writer.Result(), nil
			})})
			if _, err := client.Execute(context.Background(), wpadapter.Operation{
				Name:    test.operation,
				Payload: []byte(`{"siteId":"site-1"}`),
			}); err != nil {
				t.Fatalf("Execute() error = %v", err)
			}
		})
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}

func TestClientRejectsUnsupportedOperation(t *testing.T) {
	client := New("http://127.0.0.1", "", nil)
	_, err := client.Execute(context.Background(), wpadapter.Operation{Name: "unknown"})
	if err == nil {
		t.Fatal("Execute() error = nil, want unsupported operation error")
	}
}
