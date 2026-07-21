package jobsource

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/accnet/ooio/apps/agent/internal/jobrunner"
	"github.com/accnet/ooio/apps/agent/internal/transport"
)

type fakeSaaSTransport struct {
	handler http.Handler
}

func (f *fakeSaaSTransport) Do(_ context.Context, request transport.Request) (transport.Response, error) {
	httpRequest := httptest.NewRequest(request.Method, request.URL, bytes.NewReader(request.Body))
	if request.AuthToken != "" {
		httpRequest.Header.Set("Authorization", "Bearer "+request.AuthToken)
	}
	recorder := httptest.NewRecorder()
	f.handler.ServeHTTP(recorder, httpRequest)
	return transport.Response{StatusCode: recorder.Code, Body: recorder.Body.Bytes()}, nil
}

func TestHTTPClientPollAndReportResult(t *testing.T) {
	var gotResult jobrunner.JobResult
	client := New(
		"https://control-plane.example/v1/agents/agent-1/jobs",
		"agent-1",
		"jwt",
		&fakeSaaSTransport{handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Authorization") != "Bearer jwt" {
				t.Errorf("Authorization = %q, want bearer token", r.Header.Get("Authorization"))
			}
			switch {
			case r.Method == http.MethodGet && r.URL.Path == "/v1/agents/agent-1/jobs":
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"jobs":[{"id":"job-1","type":"create-store","payload":{"domain":"store.example.test"},"leasedUntil":"2026-07-21T06:30:00Z"}]}`))
			case r.Method == http.MethodPost && r.URL.Path == "/v1/agents/agent-1/jobs/job-1/result":
				if err := json.NewDecoder(r.Body).Decode(&gotResult); err != nil {
					t.Errorf("decode result: %v", err)
				}
				w.WriteHeader(http.StatusAccepted)
			default:
				http.NotFound(w, r)
			}
		})},
	)

	jobs, err := client.Poll(context.Background())
	if err != nil {
		t.Fatalf("Poll() error = %v", err)
	}
	if len(jobs) != 1 || jobs[0].ID != "job-1" || jobs[0].LeasedUntil.IsZero() {
		t.Fatalf("jobs = %#v", jobs)
	}

	if err := client.ReportResult(context.Background(), "job-1", jobrunner.JobResult{Status: jobrunner.JobResultSucceeded}); err != nil {
		t.Fatalf("ReportResult() error = %v", err)
	}
	if gotResult.Status != jobrunner.JobResultSucceeded {
		t.Fatalf("reported result = %#v", gotResult)
	}
}

func TestHTTPClientPollHandlesEmptyJobs(t *testing.T) {
	client := New(
		"https://control-plane.example/v1/agents/agent-1/jobs",
		"agent-1",
		"jwt",
		&fakeSaaSTransport{handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"jobs":[]}`))
		})},
	)
	jobs, err := client.Poll(context.Background())
	if err != nil {
		t.Fatalf("Poll() error = %v", err)
	}
	if jobs == nil || len(jobs) != 0 {
		t.Fatalf("jobs = %#v, want empty non-nil slice", jobs)
	}
}

func TestHTTPClientPollRejectsHTTPAndDecodeErrors(t *testing.T) {
	tests := []struct {
		name string
		body string
		code int
		want string
	}{
		{name: "http error", body: `{"jobs":[]}`, code: http.StatusUnauthorized, want: "status 401"},
		{name: "decode error", body: `{`, code: http.StatusOK, want: "decode jobs response"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client := New(
				"https://control-plane.example/v1/agents/agent-1/jobs",
				"agent-1",
				"jwt",
				&fakeSaaSTransport{handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.WriteHeader(tt.code)
					_, _ = w.Write([]byte(tt.body))
				})},
			)
			_, err := client.Poll(context.Background())
			if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("Poll() error = %v, want %q", err, tt.want)
			}
		})
	}
}

func TestHTTPClientReportResultRejectsHTTPError(t *testing.T) {
	client := New(
		"https://control-plane.example/v1/agents/agent-1/jobs",
		"agent-1",
		"jwt",
		&fakeSaaSTransport{handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusConflict)
		})},
	)
	err := client.ReportResult(context.Background(), "job-1", jobrunner.JobResult{Status: jobrunner.JobResultSucceeded})
	if err == nil || !strings.Contains(err.Error(), "status 409") {
		t.Fatalf("ReportResult() error = %v, want status error", err)
	}
}
