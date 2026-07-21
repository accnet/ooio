package jobsource

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/accnet/ooio/apps/agent/internal/jobrunner"
	"github.com/accnet/ooio/apps/agent/internal/transport"
)

// HTTPClient implements the outbound Agent-SaaS job contract. It only knows
// how to fetch opaque jobs and report their results; execution stays in the
// jobrunner handler seam.
type HTTPClient struct {
	jobsEndpoint string
	agentID      string
	authToken    string
	transport    transport.Client
}

// New creates a job client over the shared outbound transport seam.
func New(jobsEndpoint, agentID, authToken string, client transport.Client) *HTTPClient {
	return &HTTPClient{
		jobsEndpoint: strings.TrimRight(jobsEndpoint, "/"),
		agentID:      agentID,
		authToken:    authToken,
		transport:    client,
	}
}

// NewClient is an explicit alias for callers that prefer the transport client
// naming used by the other Agent API packages.
func NewClient(jobsEndpoint, agentID, authToken string, client transport.Client) *HTTPClient {
	return New(jobsEndpoint, agentID, authToken, client)
}

// NewHTTPClient wires the production HTTP transport.
func NewHTTPClient(jobsEndpoint, agentID, authToken string, requestTimeout time.Duration) *HTTPClient {
	return New(jobsEndpoint, agentID, authToken, transport.NewHTTPClient(requestTimeout))
}

// NewHTTPClientWithClient is useful when the caller owns an http.Client, such
// as a test server with a custom transport.
func NewHTTPClientWithClient(jobsEndpoint, agentID, authToken string, client *http.Client) *HTTPClient {
	return New(jobsEndpoint, agentID, authToken, transport.NewHTTPClientWithClient(client))
}

func (c *HTTPClient) Poll(ctx context.Context) ([]jobrunner.Job, error) {
	if c == nil || c.transport == nil {
		return nil, fmt.Errorf("job source is not configured")
	}
	if strings.TrimSpace(c.jobsEndpoint) == "" {
		return nil, nil
	}
	if strings.TrimSpace(c.agentID) == "" {
		return nil, fmt.Errorf("agent id is required")
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
		Jobs *[]jobrunner.Job `json:"jobs"`
	}
	if err := json.Unmarshal(response.Body, &payload); err != nil {
		return nil, fmt.Errorf("decode jobs response: %w", err)
	}
	if payload.Jobs == nil {
		return nil, fmt.Errorf("jobs response is missing required jobs field")
	}
	return *payload.Jobs, nil
}

func (c *HTTPClient) ReportResult(ctx context.Context, jobID string, result jobrunner.JobResult) error {
	if c == nil || c.transport == nil {
		return fmt.Errorf("job source is not configured")
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
	if result.Status != jobrunner.JobResultSucceeded && result.Status != jobrunner.JobResultFailed {
		return fmt.Errorf("job result status must be succeeded or failed")
	}
	if result.Status == jobrunner.JobResultFailed && (result.Error == nil || strings.TrimSpace(result.Error.Code) == "" || strings.TrimSpace(result.Error.Message) == "") {
		return fmt.Errorf("failed job result requires error code and message")
	}

	body, err := json.Marshal(result)
	if err != nil {
		return fmt.Errorf("encode job result: %w", err)
	}
	endpoint := c.jobsEndpoint + "/" + url.PathEscape(jobID) + "/result"
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
