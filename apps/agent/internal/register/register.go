package register

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/accnet/ooio/apps/agent/internal/transport"
)

type Request struct {
	RegistrationToken string            `json:"registrationToken"`
	NodeID            string            `json:"nodeId"`
	Hostname          string            `json:"hostname"`
	Capabilities      map[string]bool   `json:"capabilities"`
	Versions          map[string]string `json:"versions"`
}

type Response struct {
	AgentID     string `json:"agentId"`
	AccessToken string `json:"accessToken"`
	ExpiresIn   int    `json:"expiresIn"`
}

type Client struct {
	endpoint  string
	transport transport.Client
}

func NewClient(endpoint string, client transport.Client) *Client {
	return &Client{endpoint: endpoint, transport: client}
}

func (c *Client) Register(ctx context.Context, input Request) (Response, error) {
	if c == nil || c.transport == nil {
		return Response{}, fmt.Errorf("register client is not configured")
	}
	if err := validateRequest(input); err != nil {
		return Response{}, err
	}
	body, err := json.Marshal(input)
	if err != nil {
		return Response{}, fmt.Errorf("encode registration request: %w", err)
	}
	response, err := c.transport.Do(ctx, transport.Request{
		Method: http.MethodPost,
		URL:    c.endpoint,
		Body:   body,
	})
	if err != nil {
		return Response{}, err
	}
	if response.StatusCode != http.StatusCreated {
		return Response{}, fmt.Errorf("register returned status %d", response.StatusCode)
	}
	var result Response
	if err := json.Unmarshal(response.Body, &result); err != nil {
		return Response{}, fmt.Errorf("decode registration response: %w", err)
	}
	if strings.TrimSpace(result.AgentID) == "" || strings.TrimSpace(result.AccessToken) == "" || result.ExpiresIn < 1 {
		return Response{}, fmt.Errorf("registration response is missing required fields")
	}
	return result, nil
}

func validateRequest(input Request) error {
	for name, value := range map[string]string{
		"registrationToken": input.RegistrationToken,
		"nodeId":            input.NodeID,
		"hostname":          input.Hostname,
	} {
		if strings.TrimSpace(value) == "" {
			return fmt.Errorf("%s is required", name)
		}
	}
	if input.Capabilities == nil {
		return fmt.Errorf("capabilities is required")
	}
	if input.Versions == nil || strings.TrimSpace(input.Versions["agent"]) == "" {
		return fmt.Errorf("versions.agent is required")
	}
	return nil
}
