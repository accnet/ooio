package jobrunner

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/accnet/ooio/apps/agent/internal/transport"
)

// Job is an opaque control-plane instruction. The agent does not make
// scheduling or business decisions from its contents in this skeleton.
type Job struct {
	ID          string          `json:"id"`
	Type        string          `json:"type"`
	Payload     json.RawMessage `json:"payload"`
	LeasedUntil time.Time       `json:"leasedUntil"`
}

type JobResultStatus string

const (
	JobResultSucceeded JobResultStatus = "succeeded"
	JobResultFailed    JobResultStatus = "failed"
)

type JobError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type JobResult struct {
	Status JobResultStatus `json:"status"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  *JobError       `json:"error,omitempty"`
}

// Client implements the outbound jobs portion of the Agent-SaaS contract.
// It depends on the shared transport interface so tests never need a network.
type Client struct {
	jobsEndpoint string
	agentID      string
	authToken    string
	transport    transport.Client
}

func NewClient(jobsEndpoint, agentID, authToken string, client transport.Client) *Client {
	return &Client{
		jobsEndpoint: jobsEndpoint,
		agentID:      agentID,
		authToken:    authToken,
		transport:    client,
	}
}

func (c *Client) Poll(ctx context.Context) ([]Job, error) {
	if c == nil || c.transport == nil {
		return nil, fmt.Errorf("job client is not configured")
	}
	if c.jobsEndpoint == "" {
		return nil, nil
	}
	response, err := c.transport.Do(ctx, transport.Request{
		Method:    http.MethodGet,
		URL:       c.jobsEndpoint,
		AuthToken: c.authToken,
	})
	if err != nil {
		return nil, err
	}
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("poll jobs returned status %d", response.StatusCode)
	}
	var payload struct {
		Jobs *[]Job `json:"jobs"`
	}
	if err := json.Unmarshal(response.Body, &payload); err != nil {
		return nil, fmt.Errorf("decode jobs response: %w", err)
	}
	if payload.Jobs == nil {
		return nil, fmt.Errorf("jobs response is missing required jobs field")
	}
	return *payload.Jobs, nil
}

func (c *Client) ReportResult(ctx context.Context, jobID string, result JobResult) error {
	if c == nil || c.transport == nil {
		return fmt.Errorf("job client is not configured")
	}
	if strings.TrimSpace(c.jobsEndpoint) == "" {
		return nil
	}
	if strings.TrimSpace(c.agentID) == "" {
		return fmt.Errorf("agent id is required")
	}
	if strings.TrimSpace(jobID) == "" {
		return fmt.Errorf("job id is required")
	}
	if result.Status != JobResultSucceeded && result.Status != JobResultFailed {
		return fmt.Errorf("job result status must be succeeded or failed")
	}
	if result.Status == JobResultFailed && (result.Error == nil || strings.TrimSpace(result.Error.Code) == "" || strings.TrimSpace(result.Error.Message) == "") {
		return fmt.Errorf("failed job result requires error code and message")
	}
	body, err := json.Marshal(result)
	if err != nil {
		return fmt.Errorf("encode job result: %w", err)
	}
	endpoint := strings.TrimRight(c.jobsEndpoint, "/") + "/" + url.PathEscape(jobID) + "/result"
	response, err := c.transport.Do(ctx, transport.Request{
		Method:    http.MethodPost,
		URL:       endpoint,
		Body:      body,
		AuthToken: c.authToken,
	})
	if err != nil {
		return err
	}
	if response.StatusCode != http.StatusAccepted {
		return fmt.Errorf("report job result returned status %d", response.StatusCode)
	}
	return nil
}
