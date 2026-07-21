package metrics

import (
	"context"
	"fmt"
	"math"
	"os"
	"strconv"
	"strings"
	"sync"
	"syscall"
)

// RuntimeSource supplies measurements that are specific to the local
// WordPress runtime. Implementations can query PHP, MySQL, and WordPress
// without coupling this package to any of those systems.
type RuntimeSource interface {
	CollectRuntime(context.Context) (RuntimeMetrics, error)
}

// StoreSource supplies optional per-store measurements. The seam is kept
// separate so a later noisy-neighbor implementation can choose its own data
// source and sampling policy.
type StoreSource interface {
	CollectStores(context.Context) ([]StoreMetric, error)
}

type RuntimeMetrics struct {
	PHPVersion   string `json:"phpVersion,omitempty"`
	MySQLVersion string `json:"mysqlVersion,omitempty"`
	SiteCount    int    `json:"siteCount"`
}

type StoreMetric struct {
	StoreID       string  `json:"storeId"`
	Hostname      string  `json:"hostname"`
	CPUPercent    float64 `json:"cpuPercent"`
	MemoryPercent float64 `json:"memoryPercent"`
	DiskPercent   float64 `json:"diskPercent"`
}

type NodeMetrics struct {
	CPUPercent    float64 `json:"cpuPercent"`
	MemoryPercent float64 `json:"memoryPercent"`
	DiskPercent   float64 `json:"diskPercent"`
	PHPVersion    string  `json:"phpVersion,omitempty"`
	MySQLVersion  string  `json:"mysqlVersion,omitempty"`
	SiteCount     int     `json:"siteCount"`
}

type Snapshot struct {
	Node   NodeMetrics   `json:"node"`
	Stores []StoreMetric `json:"stores,omitempty"`
}

// Collector reads portable node metrics and delegates application-specific
// metrics to injected sources. It is safe to call Collect concurrently.
type Collector struct {
	procRoot string
	diskPath string
	runtime  RuntimeSource
	stores   StoreSource

	mu       sync.Mutex
	previous *cpuSample
}

type cpuSample struct {
	total uint64
	idle  uint64
}

func NewCollector(runtime RuntimeSource, stores StoreSource) *Collector {
	return NewCollectorWithPaths("/proc", "/", runtime, stores)
}

func NewCollectorWithPaths(procRoot, diskPath string, runtime RuntimeSource, stores StoreSource) *Collector {
	if strings.TrimSpace(procRoot) == "" {
		procRoot = "/proc"
	}
	if strings.TrimSpace(diskPath) == "" {
		diskPath = "/"
	}
	return &Collector{procRoot: procRoot, diskPath: diskPath, runtime: runtime, stores: stores}
}

func (c *Collector) Collect(ctx context.Context) (Snapshot, error) {
	if c == nil {
		return Snapshot{}, fmt.Errorf("metrics collector is not configured")
	}
	if err := ctx.Err(); err != nil {
		return Snapshot{}, err
	}

	cpu, err := c.cpuPercent()
	if err != nil {
		return Snapshot{}, err
	}
	memory, err := c.memoryPercent()
	if err != nil {
		return Snapshot{}, err
	}
	disk, err := c.diskPercent()
	if err != nil {
		return Snapshot{}, err
	}

	runtimeMetrics := RuntimeMetrics{}
	if c.runtime != nil {
		runtimeMetrics, err = c.runtime.CollectRuntime(ctx)
		if err != nil {
			return Snapshot{}, fmt.Errorf("collect runtime metrics: %w", err)
		}
		if runtimeMetrics.SiteCount < 0 {
			return Snapshot{}, fmt.Errorf("runtime site count must be non-negative")
		}
	}

	stores := []StoreMetric(nil)
	if c.stores != nil {
		stores, err = c.stores.CollectStores(ctx)
		if err != nil {
			return Snapshot{}, fmt.Errorf("collect store metrics: %w", err)
		}
		for index, store := range stores {
			if err := validatePercentage(store.CPUPercent, "cpuPercent"); err != nil {
				return Snapshot{}, fmt.Errorf("store %d: %w", index, err)
			}
			if err := validatePercentage(store.MemoryPercent, "memoryPercent"); err != nil {
				return Snapshot{}, fmt.Errorf("store %d: %w", index, err)
			}
			if err := validatePercentage(store.DiskPercent, "diskPercent"); err != nil {
				return Snapshot{}, fmt.Errorf("store %d: %w", index, err)
			}
		}
	}

	return Snapshot{
		Node: NodeMetrics{
			CPUPercent:    cpu,
			MemoryPercent: memory,
			DiskPercent:   disk,
			PHPVersion:    runtimeMetrics.PHPVersion,
			MySQLVersion:  runtimeMetrics.MySQLVersion,
			SiteCount:     runtimeMetrics.SiteCount,
		},
		Stores: stores,
	}, nil
}

func (c *Collector) cpuPercent() (float64, error) {
	data, err := os.ReadFile(c.procRoot + "/stat")
	if err != nil {
		return 0, fmt.Errorf("read cpu stats: %w", err)
	}
	current, err := parseCPUStat(string(data))
	if err != nil {
		return 0, err
	}

	c.mu.Lock()
	previous := c.previous
	c.previous = &current
	c.mu.Unlock()
	if previous == nil || current.total <= previous.total || current.idle < previous.idle {
		return 0, nil
	}
	totalDelta := current.total - previous.total
	idleDelta := current.idle - previous.idle
	if totalDelta == 0 {
		return 0, nil
	}
	if idleDelta > totalDelta {
		return 0, nil
	}
	return clampPercentage(float64(totalDelta-idleDelta) / float64(totalDelta) * 100), nil
}

func (c *Collector) memoryPercent() (float64, error) {
	data, err := os.ReadFile(c.procRoot + "/meminfo")
	if err != nil {
		return 0, fmt.Errorf("read memory stats: %w", err)
	}
	values := make(map[string]uint64)
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		value, err := strconv.ParseUint(fields[1], 10, 64)
		if err != nil {
			continue
		}
		values[strings.TrimSuffix(fields[0], ":")] = value
	}
	total := values["MemTotal"]
	if total == 0 {
		return 0, fmt.Errorf("memory stats are missing MemTotal")
	}
	available := values["MemAvailable"]
	if available == 0 {
		available = values["MemFree"] + values["Buffers"] + values["Cached"]
	}
	if available > total {
		available = total
	}
	return clampPercentage(float64(total-available) / float64(total) * 100), nil
}

func (c *Collector) diskPercent() (float64, error) {
	var stats syscall.Statfs_t
	if err := syscall.Statfs(c.diskPath, &stats); err != nil {
		return 0, fmt.Errorf("read disk stats: %w", err)
	}
	total := uint64(stats.Blocks) * uint64(stats.Bsize)
	available := uint64(stats.Bavail) * uint64(stats.Bsize)
	if total == 0 {
		return 0, nil
	}
	if available > total {
		available = total
	}
	return clampPercentage(float64(total-available) / float64(total) * 100), nil
}

func parseCPUStat(data string) (cpuSample, error) {
	for _, line := range strings.Split(data, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 6 || fields[0] != "cpu" {
			continue
		}
		var values []uint64
		for _, field := range fields[1:] {
			value, err := strconv.ParseUint(field, 10, 64)
			if err != nil {
				return cpuSample{}, fmt.Errorf("parse cpu stats: %w", err)
			}
			values = append(values, value)
		}
		var total uint64
		for _, value := range values {
			total += value
		}
		return cpuSample{total: total, idle: values[3] + values[4]}, nil
	}
	return cpuSample{}, fmt.Errorf("cpu stats are missing aggregate cpu line")
}

func validatePercentage(value float64, name string) error {
	if math.IsNaN(value) || math.IsInf(value, 0) || value < 0 || value > 100 {
		return fmt.Errorf("%s must be between 0 and 100", name)
	}
	return nil
}

func clampPercentage(value float64) float64 {
	if value < 0 {
		return 0
	}
	if value > 100 {
		return 100
	}
	return value
}
