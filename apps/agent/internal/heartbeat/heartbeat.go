package heartbeat

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/accnet/ooio/apps/agent/internal/metrics"
	"github.com/accnet/ooio/apps/agent/internal/transport"
)

type Status string

const (
	StatusReady       Status = "ready"
	StatusBusy        Status = "busy"
	StatusDraining    Status = "draining"
	StatusMaintenance Status = "maintenance"
)

type Capacity struct {
	CPUPercent    float64 `json:"cpuPercent"`
	MemoryPercent float64 `json:"memoryPercent"`
	DiskPercent   float64 `json:"diskPercent"`
	SiteCount     int     `json:"siteCount"`
}

type Request struct {
	Status       Status            `json:"status"`
	Capabilities map[string]bool   `json:"capabilities"`
	Versions     map[string]string `json:"versions"`
	Capacity     Capacity          `json:"capacity"`
	Metrics      *metrics.Snapshot `json:"metrics,omitempty"`
}

type Response struct {
	AcceptedAt       time.Time `json:"acceptedAt"`
	PollAfterSeconds int       `json:"pollAfterSeconds"`
}

// Client sends heartbeats through the shared outbound transport. It does not
// expose an HTTP listener or collect policy decisions for the control plane.
type Client struct {
	endpoint  string
	agentID   string
	authToken string
	transport transport.Client
}

func NewClient(endpoint, agentID, authToken string, client transport.Client) *Client {
	return &Client{endpoint: endpoint, agentID: agentID, authToken: authToken, transport: client}
}

func (c *Client) Send(ctx context.Context, input Request) (Response, error) {
	if c == nil || c.transport == nil {
		return Response{}, fmt.Errorf("heartbeat client is not configured")
	}
	if c.endpoint == "" {
		return Response{}, nil
	}
	if err := validateRequest(c.agentID, input); err != nil {
		return Response{}, err
	}
	body, err := json.Marshal(input)
	if err != nil {
		return Response{}, fmt.Errorf("encode heartbeat request: %w", err)
	}
	response, err := c.transport.Do(ctx, transport.Request{
		Method:    http.MethodPost,
		URL:       c.endpoint,
		Body:      body,
		AuthToken: c.authToken,
	})
	if err != nil {
		return Response{}, err
	}
	if response.StatusCode != http.StatusOK {
		return Response{}, fmt.Errorf("heartbeat returned status %d", response.StatusCode)
	}
	var result Response
	if err := json.Unmarshal(response.Body, &result); err != nil {
		return Response{}, fmt.Errorf("decode heartbeat response: %w", err)
	}
	if result.AcceptedAt.IsZero() || result.PollAfterSeconds < 1 {
		return Response{}, fmt.Errorf("heartbeat response is missing required fields")
	}
	return result, nil
}

func validateRequest(agentID string, input Request) error {
	if strings.TrimSpace(agentID) == "" {
		return fmt.Errorf("agent id is required")
	}
	switch input.Status {
	case StatusReady, StatusBusy, StatusDraining, StatusMaintenance:
	default:
		return fmt.Errorf("status must be one of ready, busy, draining, maintenance")
	}
	if input.Capabilities == nil {
		return fmt.Errorf("capabilities is required")
	}
	if input.Versions == nil || strings.TrimSpace(input.Versions["agent"]) == "" {
		return fmt.Errorf("versions.agent is required")
	}
	if input.Capacity.CPUPercent < 0 || input.Capacity.CPUPercent > 100 {
		return fmt.Errorf("capacity.cpuPercent must be between 0 and 100")
	}
	if input.Capacity.MemoryPercent < 0 || input.Capacity.MemoryPercent > 100 {
		return fmt.Errorf("capacity.memoryPercent must be between 0 and 100")
	}
	if input.Capacity.DiskPercent < 0 || input.Capacity.DiskPercent > 100 {
		return fmt.Errorf("capacity.diskPercent must be between 0 and 100")
	}
	if input.Capacity.SiteCount < 0 {
		return fmt.Errorf("capacity.siteCount must be non-negative")
	}
	return nil
}

// HTTPReporter periodically sends a fixed manifest and a live capacity
// snapshot from its metrics collector.
type HTTPReporter struct {
	client    *Client
	request   Request
	collector MetricsCollector
	interval  time.Duration
	logger    *log.Logger
}

// MetricsCollector is the heartbeat seam for live node and store telemetry.
// Keeping it as an interface lets tests and future platform sources inject
// snapshots without changing the outbound heartbeat client.
type MetricsCollector interface {
	Collect(context.Context) (metrics.Snapshot, error)
}

func NewHTTPReporter(endpoint, agentID, authToken string, requestTimeout time.Duration, logger *log.Logger) *HTTPReporter {
	return NewHTTPReporterWithClient(
		endpoint,
		agentID,
		authToken,
		Request{
			Status:       StatusReady,
			Capabilities: map[string]bool{},
			Versions:     map[string]string{"agent": "dev"},
		},
		transport.NewHTTPClient(requestTimeout),
		logger,
	)
}

func NewHTTPReporterWithClient(endpoint, agentID, authToken string, request Request, client transport.Client, logger *log.Logger) *HTTPReporter {
	return NewHTTPReporterWithMetrics(endpoint, agentID, authToken, request, client, metrics.NewCollector(nil, nil), logger)
}

func NewHTTPReporterWithMetrics(endpoint, agentID, authToken string, request Request, client transport.Client, collector MetricsCollector, logger *log.Logger) *HTTPReporter {
	if logger == nil {
		logger = log.Default()
	}
	return &HTTPReporter{
		client:    NewClient(endpoint, agentID, authToken, client),
		request:   request,
		collector: collector,
		logger:    logger,
	}
}

func NewHTTPReporterWithCollector(endpoint, agentID, authToken string, request Request, client transport.Client, collector MetricsCollector, logger *log.Logger) *HTTPReporter {
	return NewHTTPReporterWithMetrics(endpoint, agentID, authToken, request, client, collector, logger)
}

func (r *HTTPReporter) Run(ctx context.Context, interval time.Duration) error {
	if interval <= 0 {
		return fmt.Errorf("heartbeat interval must be positive")
	}
	if r == nil || r.client == nil {
		return fmt.Errorf("heartbeat reporter is not configured")
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if err := r.send(ctx); err != nil {
				r.logger.Printf("heartbeat failed: %v", err)
			}
		}
	}
}

func (r *HTTPReporter) send(ctx context.Context) error {
	request := r.request
	if r.collector != nil {
		snapshot, err := r.collector.Collect(ctx)
		if err != nil {
			return fmt.Errorf("collect heartbeat metrics: %w", err)
		}
		request.Metrics = &snapshot
		request.Capacity = Capacity{
			CPUPercent:    snapshot.Node.CPUPercent,
			MemoryPercent: snapshot.Node.MemoryPercent,
			DiskPercent:   snapshot.Node.DiskPercent,
			SiteCount:     snapshot.Node.SiteCount,
		}
	}
	_, err := r.client.Send(ctx, request)
	return err
}
