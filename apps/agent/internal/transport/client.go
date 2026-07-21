package transport

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"time"
)

const maxResponseBytes int64 = 1 << 20

// Request is the common outbound request shape used by Agent API clients.
// AuthToken is never serialized into the request body.
type Request struct {
	Method    string
	URL       string
	Body      []byte
	AuthToken string
}

type Response struct {
	StatusCode int
	Body       []byte
}

// Client keeps API packages unit-testable without opening a network connection.
type Client interface {
	Do(context.Context, Request) (Response, error)
}

type HTTPClient struct {
	client *http.Client
}

func NewHTTPClient(requestTimeout time.Duration) *HTTPClient {
	if requestTimeout <= 0 {
		requestTimeout = 10 * time.Second
	}
	return &HTTPClient{client: &http.Client{Timeout: requestTimeout}}
}

func NewHTTPClientWithClient(client *http.Client) *HTTPClient {
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	return &HTTPClient{client: client}
}

func (c *HTTPClient) Do(ctx context.Context, input Request) (Response, error) {
	if c == nil || c.client == nil {
		return Response{}, fmt.Errorf("HTTP transport is not configured")
	}
	if input.Method == "" {
		return Response{}, fmt.Errorf("HTTP method is required")
	}
	request, err := http.NewRequestWithContext(ctx, input.Method, input.URL, bytes.NewReader(input.Body))
	if err != nil {
		return Response{}, fmt.Errorf("create outbound request: %w", err)
	}
	if len(input.Body) > 0 {
		request.Header.Set("Content-Type", "application/json")
	}
	if input.AuthToken != "" {
		request.Header.Set("Authorization", "Bearer "+input.AuthToken)
	}

	response, err := c.client.Do(request)
	if err != nil {
		return Response{}, fmt.Errorf("send outbound request: %w", err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes+1))
	if err != nil {
		return Response{}, fmt.Errorf("read outbound response: %w", err)
	}
	if int64(len(body)) > maxResponseBytes {
		return Response{}, fmt.Errorf("outbound response exceeds %d bytes", maxResponseBytes)
	}
	return Response{StatusCode: response.StatusCode, Body: body}, nil
}
