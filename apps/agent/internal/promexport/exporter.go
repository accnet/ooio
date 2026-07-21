// Package promexport exposes agent metrics in Prometheus text format.
package promexport

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/accnet/ooio/apps/agent/internal/metrics"
)

const (
	// DefaultAddress keeps the optional metrics listener local to the node.
	DefaultAddress = "127.0.0.1:9090"
	metricsPath    = "/metrics"
	contentType    = "text/plain; version=0.0.4; charset=utf-8"
)

// MetricsCollector is the seam used by the exporter. metrics.Collector is the
// production implementation; an interface keeps the HTTP surface unit-testable.
type MetricsCollector interface {
	Collect(context.Context) (metrics.Snapshot, error)
}

// Exporter serves a point-in-time snapshot from a metrics collector.
type Exporter struct {
	collector MetricsCollector
}

// New creates an exporter for collector. A nil collector is accepted so the
// handler can return a useful configuration error instead of panicking.
func New(collector MetricsCollector) *Exporter {
	return &Exporter{collector: collector}
}

// NewHandler returns an HTTP handler serving only /metrics.
func NewHandler(collector MetricsCollector) http.Handler {
	return New(collector)
}

// NewServer returns a configurable metrics server. An empty address uses the
// localhost-only default; callers can provide another bind address explicitly.
func NewServer(address string, collector MetricsCollector) *http.Server {
	if strings.TrimSpace(address) == "" {
		address = DefaultAddress
	}
	return &http.Server{Addr: address, Handler: New(collector)}
}

// ServeHTTP implements http.Handler.
func (e *Exporter) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != metricsPath {
		http.NotFound(w, r)
		return
	}
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if e == nil || e.collector == nil {
		http.Error(w, "metrics collector is not configured\n", http.StatusInternalServerError)
		return
	}

	snapshot, err := e.collector.Collect(r.Context())
	if err != nil {
		http.Error(w, fmt.Sprintf("collect metrics: %v\n", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", contentType)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(formatSnapshot(snapshot)))
}

func formatSnapshot(snapshot metrics.Snapshot) string {
	var output strings.Builder
	writeGauge(&output, "platform_agent_node_cpu_percent", "Current node CPU utilization percentage.", snapshot.Node.CPUPercent)
	writeGauge(&output, "platform_agent_node_memory_percent", "Current node memory utilization percentage.", snapshot.Node.MemoryPercent)
	writeGauge(&output, "platform_agent_node_disk_percent", "Current node disk utilization percentage.", snapshot.Node.DiskPercent)
	writeGauge(&output, "platform_agent_node_site_count", "Number of WordPress sites on the node.", snapshot.Node.SiteCount)

	for _, store := range snapshot.Stores {
		labels := `store_id="` + escapeLabel(store.StoreID) + `",hostname="` + escapeLabel(store.Hostname) + `"`
		writeGaugeWithLabels(&output, "platform_agent_store_cpu_percent", "Current store CPU utilization percentage.", labels, store.CPUPercent)
		writeGaugeWithLabels(&output, "platform_agent_store_memory_percent", "Current store memory utilization percentage.", labels, store.MemoryPercent)
		writeGaugeWithLabels(&output, "platform_agent_store_disk_percent", "Current store disk utilization percentage.", labels, store.DiskPercent)
	}
	return output.String()
}

func writeGauge(output *strings.Builder, name, help string, value any) {
	writeGaugeWithLabels(output, name, help, "", value)
}

func writeGaugeWithLabels(output *strings.Builder, name, help, labels string, value any) {
	output.WriteString("# HELP ")
	output.WriteString(name)
	output.WriteByte(' ')
	output.WriteString(help)
	output.WriteByte('\n')
	output.WriteString("# TYPE ")
	output.WriteString(name)
	output.WriteString(" gauge\n")
	output.WriteString(name)
	if labels != "" {
		output.WriteByte('{')
		output.WriteString(labels)
		output.WriteByte('}')
	}
	output.WriteByte(' ')
	output.WriteString(formatValue(value))
	output.WriteByte('\n')
}

func formatValue(value any) string {
	switch typed := value.(type) {
	case int:
		return strconv.Itoa(typed)
	case int64:
		return strconv.FormatInt(typed, 10)
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	default:
		return fmt.Sprint(value)
	}
}

func escapeLabel(value string) string {
	value = strings.ReplaceAll(value, `\`, `\\`)
	value = strings.ReplaceAll(value, `"`, `\"`)
	return strings.ReplaceAll(value, "\n", `\n`)
}
