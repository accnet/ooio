package register

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/accnet/ooio/apps/agent/internal/transport"
)

type fakeTransport struct {
	request  transport.Request
	response transport.Response
}

func (f *fakeTransport) Do(_ context.Context, request transport.Request) (transport.Response, error) {
	f.request = request
	return f.response, nil
}

func TestClientRegisterSendsNodeManifest(t *testing.T) {
	fake := &fakeTransport{response: transport.Response{
		StatusCode: http.StatusCreated,
		Body:       []byte(`{"agentId":"agent-1","accessToken":"jwt","expiresIn":3600}`),
	}}
	client := NewClient("https://control-plane.example/v1/agents/register", fake)
	input := Request{
		RegistrationToken: "one-time-token",
		NodeID:            "wp-hk-01",
		Hostname:          "node.example",
		Capabilities:      map[string]bool{"wordpress": true, "multisite": true},
		Versions:          map[string]string{"agent": "1.2.0", "wordpress": "6.9"},
	}

	result, err := client.Register(context.Background(), input)
	if err != nil {
		t.Fatalf("Register() error = %v", err)
	}
	if result.AgentID != "agent-1" || result.AccessToken != "jwt" {
		t.Fatalf("result = %#v", result)
	}
	if fake.request.Method != http.MethodPost || fake.request.AuthToken != "" {
		t.Fatalf("request = %#v", fake.request)
	}
	var payload Request
	if err := json.Unmarshal(fake.request.Body, &payload); err != nil {
		t.Fatalf("decode request: %v", err)
	}
	if payload.NodeID != input.NodeID || !payload.Capabilities["multisite"] {
		t.Fatalf("payload = %#v", payload)
	}
}

func TestClientRegisterValidatesManifest(t *testing.T) {
	client := NewClient("https://control-plane.example/v1/agents/register", &fakeTransport{})
	_, err := client.Register(context.Background(), Request{RegistrationToken: "token"})
	if err == nil {
		t.Fatal("Register() error = nil, want validation error")
	}
}
