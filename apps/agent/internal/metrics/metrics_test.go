package metrics

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type fakeRuntimeSource struct {
	metrics RuntimeMetrics
	err     error
}

func (f fakeRuntimeSource) CollectRuntime(context.Context) (RuntimeMetrics, error) {
	return f.metrics, f.err
}

type fakeStoreSource struct {
	stores []StoreMetric
	err    error
}

func (f fakeStoreSource) CollectStores(context.Context) ([]StoreMetric, error) {
	return f.stores, f.err
}

func TestCollectorCollectsProcAndInjectedMetrics(t *testing.T) {
	procRoot := t.TempDir()
	writeProcFile(t, procRoot, "stat", "cpu  100 0 0 60 10 0 0 0 0 0\n")
	writeProcFile(t, procRoot, "meminfo", "MemTotal:       1000 kB\nMemAvailable:    250 kB\n")

	collector := NewCollectorWithPaths(procRoot, t.TempDir(), fakeRuntimeSource{metrics: RuntimeMetrics{
		PHPVersion: "8.3.0", MySQLVersion: "8.0.36", SiteCount: 3,
	}}, fakeStoreSource{stores: []StoreMetric{{
		StoreID: "store-1", Hostname: "shop.example", CPUPercent: 12, MemoryPercent: 25, DiskPercent: 40,
	}}})

	first, err := collector.Collect(context.Background())
	if err != nil {
		t.Fatalf("first Collect() error = %v", err)
	}
	if first.Node.CPUPercent != 0 {
		t.Fatalf("first CPUPercent = %v, want 0 until a delta is available", first.Node.CPUPercent)
	}

	writeProcFile(t, procRoot, "stat", "cpu  150 0 0 100 20 0 0 0 0 0\n")
	second, err := collector.Collect(context.Background())
	if err != nil {
		t.Fatalf("second Collect() error = %v", err)
	}
	if second.Node.CPUPercent != 50 {
		t.Fatalf("CPUPercent = %v, want 50", second.Node.CPUPercent)
	}
	if second.Node.MemoryPercent != 75 {
		t.Fatalf("MemoryPercent = %v, want 75", second.Node.MemoryPercent)
	}
	if second.Node.PHPVersion != "8.3.0" || second.Node.MySQLVersion != "8.0.36" || second.Node.SiteCount != 3 {
		t.Fatalf("runtime metrics = %#v", second.Node)
	}
	if len(second.Stores) != 1 || second.Stores[0].Hostname != "shop.example" {
		t.Fatalf("store metrics = %#v", second.Stores)
	}
	if second.Node.DiskPercent < 0 || second.Node.DiskPercent > 100 {
		t.Fatalf("DiskPercent = %v, want a percentage", second.Node.DiskPercent)
	}
}

func TestCollectorReportsSourceErrors(t *testing.T) {
	procRoot := t.TempDir()
	writeProcFile(t, procRoot, "stat", "cpu  100 0 0 60 10 0 0 0 0 0\n")
	writeProcFile(t, procRoot, "meminfo", "MemTotal: 1000 kB\nMemAvailable: 500 kB\n")
	wantErr := errors.New("runtime unavailable")
	collector := NewCollectorWithPaths(procRoot, t.TempDir(), fakeRuntimeSource{err: wantErr}, nil)
	_, err := collector.Collect(context.Background())
	if !errors.Is(err, wantErr) {
		t.Fatalf("Collect() error = %v, want %v", err, wantErr)
	}
}

func TestCollectorMissingProcIsAnError(t *testing.T) {
	collector := NewCollectorWithPaths(filepath.Join(t.TempDir(), "missing"), t.TempDir(), nil, nil)
	_, err := collector.Collect(context.Background())
	if err == nil || !strings.Contains(err.Error(), "read cpu stats") {
		t.Fatalf("Collect() error = %v, want missing proc error", err)
	}
}

func TestCollectorHonorsCanceledContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := NewCollector(nil, nil).Collect(ctx)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("Collect() error = %v, want context canceled", err)
	}
}

func writeProcFile(t *testing.T, root, name, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(root, name), []byte(content), 0o600); err != nil {
		t.Fatalf("write %s: %v", name, err)
	}
}
