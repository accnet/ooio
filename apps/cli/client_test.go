package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClientCreateStoreUsesMUPluginEndpoint(t *testing.T) {
	client := newTestClient(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost || request.URL.Path != "/wp-json/platform/v1/sites" {
			t.Fatalf("request = %s %s, want POST /wp-json/platform/v1/sites", request.Method, request.URL.Path)
		}
		if request.Header.Get("Authorization") != "Bearer local-token" {
			t.Fatalf("authorization = %q", request.Header.Get("Authorization"))
		}
		if request.Header.Get("Content-Type") != "application/json" {
			t.Fatalf("content type = %q", request.Header.Get("Content-Type"))
		}
		var input CreateStoreRequest
		if err := json.NewDecoder(request.Body).Decode(&input); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if input.Domain != "store.example.test" || input.Title != "Store" {
			t.Fatalf("request body = %#v", input)
		}
		writer.Header().Set("Content-Type", "application/json")
		writer.WriteHeader(http.StatusCreated)
		_, _ = writer.Write([]byte(`{"siteId":"7","domain":"store.example.test","status":"active"}`))
	}))
	result, err := client.CreateStore(context.Background(), CreateStoreRequest{Domain: "store.example.test", Title: "Store"})
	if err != nil {
		t.Fatalf("CreateStore() error = %v", err)
	}
	if !json.Valid(result) || string(result) == "" {
		t.Fatalf("result = %s, want valid JSON", result)
	}
}

func TestClientDeleteStoreUsesMUPluginEndpoint(t *testing.T) {
	client := newTestClient(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodDelete || request.URL.Path != "/wp-json/platform/v1/sites/7" {
			t.Fatalf("request = %s %s, want DELETE /wp-json/platform/v1/sites/7", request.Method, request.URL.Path)
		}
		if request.Header.Get("Authorization") != "Bearer local-token" {
			t.Fatalf("authorization = %q", request.Header.Get("Authorization"))
		}
		writer.WriteHeader(http.StatusAccepted)
		_, _ = writer.Write([]byte(`{"siteId":"7","status":"deleted"}`))
	}))
	result, err := client.DeleteStore(context.Background(), "7")
	if err != nil {
		t.Fatalf("DeleteStore() error = %v", err)
	}
	if string(result) != `{"siteId":"7","status":"deleted"}` {
		t.Fatalf("result = %s", result)
	}
}

func TestClientHealthUsesMUPluginEndpoint(t *testing.T) {
	client := newTestClient(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodGet || request.URL.Path != "/wp-json/platform/v1/health" {
			t.Fatalf("request = %s %s, want GET /wp-json/platform/v1/health", request.Method, request.URL.Path)
		}
		if request.Header.Get("Authorization") != "Bearer local-token" {
			t.Fatalf("authorization = %q", request.Header.Get("Authorization"))
		}
		writer.WriteHeader(http.StatusOK)
		_, _ = writer.Write([]byte(`{"status":"ok","plugin":"platform-core"}`))
	}))
	result, err := client.Health(context.Background())
	if err != nil {
		t.Fatalf("Health() error = %v", err)
	}
	if !json.Valid(result) {
		t.Fatalf("result = %s, want valid JSON", result)
	}
}

func TestClientRejectsHTTPErrorAndInvalidInput(t *testing.T) {
	client := newTestClient(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.WriteHeader(http.StatusUnauthorized)
		_, _ = writer.Write([]byte(`{"code":"unauthorized"}`))
	}))
	if _, err := client.CreateStore(context.Background(), CreateStoreRequest{Title: "missing domain"}); err == nil {
		t.Fatal("CreateStore() error = nil, want validation error")
	}
	if _, err := client.DeleteStore(context.Background(), "0"); err == nil {
		t.Fatal("DeleteStore() error = nil, want site id validation error")
	}
	if _, err := client.Health(context.Background()); err == nil {
		t.Fatal("Health() error = nil, want HTTP status error")
	}
}

func newTestClient(handler http.Handler) *Client {
	return NewClientWithHTTPClient("http://127.0.0.1/wp-json", "local-token", &http.Client{
		Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, request)
			return recorder.Result(), nil
		}),
	})
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}
