package jobrunner

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/accnet/ooio/apps/agent/internal/transport"
)

type fakeTransport struct {
	requests  []transport.Request
	responses []transport.Response
	onRequest func(transport.Request, int)
}

func (f *fakeTransport) Do(_ context.Context, request transport.Request) (transport.Response, error) {
	f.requests = append(f.requests, request)
	if f.onRequest != nil {
		f.onRequest(request, len(f.requests))
	}
	if len(f.responses) == 0 {
		return transport.Response{}, errors.New("fake transport has no response")
	}
	response := f.responses[0]
	f.responses = f.responses[1:]
	return response, nil
}

type fakeHandler struct {
	jobs []Job
}

func (h *fakeHandler) Handle(_ context.Context, job Job) error {
	h.jobs = append(h.jobs, job)
	if job.ID == "job-fail" {
		return errors.New("provisioning unavailable")
	}
	return nil
}

func TestClientPollAndReportUsesAgentSaaSContract(t *testing.T) {
	fake := &fakeTransport{responses: []transport.Response{
		{StatusCode: http.StatusOK, Body: []byte(`{"jobs":[{"id":"job-1","type":"create-store","payload":{"site":"example.test"},"leasedUntil":"2026-07-21T06:30:00Z"}]}`)},
		{StatusCode: http.StatusAccepted},
	}}
	client := NewClient("https://control-plane.example/v1/agents/agent-1/jobs", "agent-1", "jwt", fake)

	jobs, err := client.Poll(context.Background())
	if err != nil {
		t.Fatalf("Poll() error = %v", err)
	}
	if len(jobs) != 1 || jobs[0].ID != "job-1" || jobs[0].LeasedUntil.IsZero() {
		t.Fatalf("jobs = %#v", jobs)
	}
	if err := client.ReportResult(context.Background(), "job/1", JobResult{Status: JobResultSucceeded}); err != nil {
		t.Fatalf("ReportResult() error = %v", err)
	}

	if len(fake.requests) != 2 {
		t.Fatalf("request count = %d, want 2", len(fake.requests))
	}
	if fake.requests[0].Method != http.MethodGet || fake.requests[0].AuthToken != "jwt" {
		t.Fatalf("poll request = %#v", fake.requests[0])
	}
	if fake.requests[1].Method != http.MethodPost || fake.requests[1].URL != "https://control-plane.example/v1/agents/agent-1/jobs/job%2F1/result" || fake.requests[1].AuthToken != "jwt" {
		t.Fatalf("result request = %#v", fake.requests[1])
	}
	var result JobResult
	if err := json.Unmarshal(fake.requests[1].Body, &result); err != nil {
		t.Fatalf("decode result request: %v", err)
	}
	if result.Status != JobResultSucceeded {
		t.Fatalf("result = %#v", result)
	}
}

func TestRunnerHandlesJobsAndReportsPassOrFail(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	fake := &fakeTransport{responses: []transport.Response{
		{StatusCode: http.StatusOK, Body: []byte(`{"jobs":[{"id":"job-ok","type":"create-store"},{"id":"job-fail","type":"delete-store"}]}`)},
		{StatusCode: http.StatusAccepted},
		{StatusCode: http.StatusAccepted},
	}}
	fake.onRequest = func(request transport.Request, count int) {
		if request.Method == http.MethodPost && count == 3 {
			cancel()
		}
	}
	handler := &fakeHandler{}
	runner := New(
		NewClient("https://control-plane.example/v1/agents/agent-1/jobs", "agent-1", "jwt", fake),
		handler,
		time.Hour,
		nil,
	)

	err := runner.Run(ctx)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("Run() error = %v, want context canceled", err)
	}
	if len(handler.jobs) != 2 {
		t.Fatalf("handled jobs = %d, want 2", len(handler.jobs))
	}
	if len(fake.requests) != 3 {
		t.Fatalf("request count = %d, want 3", len(fake.requests))
	}
	var failed JobResult
	if err := json.Unmarshal(fake.requests[2].Body, &failed); err != nil {
		t.Fatalf("decode failed result: %v", err)
	}
	if failed.Status != JobResultFailed || failed.Error == nil || failed.Error.Code != "handler_error" {
		t.Fatalf("failed result = %#v", failed)
	}
}

func TestRunnerStopsWhenContextIsCanceled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	runner := New(&fakeJobClient{}, &fakeHandler{}, time.Second, nil)

	if err := runner.Run(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("Run() error = %v, want context canceled", err)
	}
}

type fakeJobClient struct{}

func (*fakeJobClient) Poll(context.Context) ([]Job, error) { return nil, context.Canceled }

func (*fakeJobClient) ReportResult(context.Context, string, JobResult) error { return nil }
