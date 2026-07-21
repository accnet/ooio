package promexport

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/accnet/ooio/apps/agent/internal/metrics"
)

type fakeCollector struct {
	snapshot metrics.Snapshot
	err      error
}

func (f fakeCollector) Collect(context.Context) (metrics.Snapshot, error) {
	return f.snapshot, f.err
}

func TestHandlerExposesNodeAndStoreGauges(t *testing.T) {
	handler := NewHandler(fakeCollector{snapshot: metrics.Snapshot{
		Node: metrics.NodeMetrics{CPUPercent: 12.5, MemoryPercent: 75, DiskPercent: 40, SiteCount: 3},
		Stores: []metrics.StoreMetric{{
			StoreID: "store\\1", Hostname: "shop\"one\n.example",
			CPUPercent: 10, MemoryPercent: 20.5, DiskPercent: 30,
		}},
	}})

	request := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	if got := response.Header().Get("Content-Type"); got != contentType {
		t.Fatalf("content type = %q, want %q", got, contentType)
	}
	body := response.Body.String()
	for _, want := range []string{
		"# HELP platform_agent_node_cpu_percent",
		"# TYPE platform_agent_node_cpu_percent gauge",
		"platform_agent_node_cpu_percent 12.5",
		"platform_agent_node_memory_percent 75",
		"platform_agent_node_disk_percent 40",
		"platform_agent_node_site_count 3",
		`store_id="store\\1",hostname="shop\"one\n.example"`,
		`platform_agent_store_memory_percent{store_id="store\\1",hostname="shop\"one\n.example"} 20.5`,
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("metrics body does not contain %q:\n%s", want, body)
		}
	}
}

func TestHandlerRoutesMetricsAndRejectsOtherRequests(t *testing.T) {
	handler := NewHandler(fakeCollector{})

	otherPath := httptest.NewRecorder()
	handler.ServeHTTP(otherPath, httptest.NewRequest(http.MethodGet, "/health", nil))
	if otherPath.Code != http.StatusNotFound {
		t.Fatalf("other path status = %d, want %d", otherPath.Code, http.StatusNotFound)
	}

	post := httptest.NewRecorder()
	handler.ServeHTTP(post, httptest.NewRequest(http.MethodPost, "/metrics", nil))
	if post.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST status = %d, want %d", post.Code, http.StatusMethodNotAllowed)
	}
	if post.Header().Get("Allow") != http.MethodGet {
		t.Fatalf("Allow = %q, want %q", post.Header().Get("Allow"), http.MethodGet)
	}
}

func TestHandlerReportsCollectorErrors(t *testing.T) {
	handler := NewHandler(fakeCollector{err: errors.New("collector unavailable")})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/metrics", nil))

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusInternalServerError)
	}
	if !strings.Contains(response.Body.String(), "collector unavailable") {
		t.Fatalf("body = %q, want collector error", response.Body.String())
	}
}

func TestNewServerDefaultsToLocalhostAndAllowsConfiguredAddress(t *testing.T) {
	if got := NewServer("", fakeCollector{}).Addr; got != DefaultAddress {
		t.Fatalf("default address = %q, want %q", got, DefaultAddress)
	}
	if got := NewServer("127.0.0.1:9191", fakeCollector{}).Addr; got != "127.0.0.1:9191" {
		t.Fatalf("configured address = %q", got)
	}
}
