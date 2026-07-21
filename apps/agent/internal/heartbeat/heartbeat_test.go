package heartbeat

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
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

func TestClientSendUsesAgentHeartbeatContract(t *testing.T) {
	fake := &fakeTransport{response: transport.Response{
		StatusCode: http.StatusOK,
		Body:       []byte(`{"acceptedAt":"2026-07-21T05:00:00Z","pollAfterSeconds":30}`),
	}}
	client := NewClient("https://control-plane.example/v1/agents/agent-1/heartbeat", "agent-1", "jwt", fake)
	input := Request{
		Status:       StatusReady,
		Capabilities: map[string]bool{"wordpress": true},
		Versions:     map[string]string{"agent": "1.2.0"},
		Capacity:     Capacity{CPUPercent: 12.5, MemoryPercent: 20, DiskPercent: 30, SiteCount: 4},
	}

	result, err := client.Send(context.Background(), input)
	if err != nil {
		t.Fatalf("Send() error = %v", err)
	}
	if result.PollAfterSeconds != 30 {
		t.Fatalf("PollAfterSeconds = %d, want 30", result.PollAfterSeconds)
	}
	if fake.request.Method != http.MethodPost || fake.request.AuthToken != "jwt" {
		t.Fatalf("request = %#v", fake.request)
	}
	var payload Request
	if err := json.Unmarshal(fake.request.Body, &payload); err != nil {
		t.Fatalf("decode request: %v", err)
	}
	if payload.Status != StatusReady || payload.Capacity.SiteCount != 4 {
		t.Fatalf("payload = %#v", payload)
	}
}

func TestClientRejectsInvalidRequest(t *testing.T) {
	client := NewClient("https://control-plane.example/heartbeat", "agent-1", "jwt", &fakeTransport{})
	_, err := client.Send(context.Background(), Request{Status: "unknown"})
	if err == nil || !strings.Contains(err.Error(), "status") {
		t.Fatalf("Send() error = %v, want status validation error", err)
	}
}
