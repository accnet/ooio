package config

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	saasBaseURLKey        = "PLATFORM_AGENT_SAAS_BASE_URL"
	controlPlaneURLKey    = "PLATFORM_AGENT_CONTROL_PLANE_URL"
	muPluginBaseURLKey    = "PLATFORM_AGENT_MU_PLUGIN_BASE_URL"
	wordpressURLKey       = "PLATFORM_AGENT_WORDPRESS_URL"
	agentIDKey            = "PLATFORM_AGENT_ID"
	authTokenKey          = "PLATFORM_AGENT_AUTH_TOKEN"
	wordpressTokenKey     = "PLATFORM_AGENT_WORDPRESS_AUTH_TOKEN"
	registrationKey       = "PLATFORM_AGENT_REGISTRATION_TOKEN"
	nodeIDKey             = "PLATFORM_AGENT_NODE_ID"
	hostnameKey           = "PLATFORM_AGENT_HOSTNAME"
	capabilitiesKey       = "PLATFORM_AGENT_CAPABILITIES"
	versionsKey           = "PLATFORM_AGENT_VERSIONS"
	agentVersionKey       = "PLATFORM_AGENT_VERSION"
	pollIntervalKey       = "PLATFORM_AGENT_POLL_INTERVAL"
	heartbeatKey          = "PLATFORM_AGENT_HEARTBEAT_INTERVAL"
	requestTimeoutKey     = "PLATFORM_AGENT_REQUEST_TIMEOUT"
	defaultMUPluginURL    = "http://127.0.0.1/wp-json"
	defaultPollInterval   = 30 * time.Second
	defaultHeartbeat      = 30 * time.Second
	defaultRequestTimeout = 10 * time.Second
)

// Config contains runtime wiring only. Job and WordPress business policy belongs
// to the control plane and MU Plugin contracts, respectively.
type Config struct {
	// SaaSBaseURL and MUPluginBaseURL are the canonical service endpoints.
	SaaSBaseURL     string
	MUPluginBaseURL string
	NodeID          string
	AuthToken       string

	// These fields are retained for the existing registration and job clients.
	// ControlPlaneURL mirrors SaaSBaseURL; AgentID may be assigned after register.
	ControlPlaneURL   string
	AgentID           string
	RegistrationToken string
	Hostname          string
	Capabilities      map[string]bool
	Versions          map[string]string
	PollInterval      time.Duration
	HeartbeatInterval time.Duration
	RequestTimeout    time.Duration
}

// Load reads the process environment. It remains the daemon's existing entry
// point; callers that need a specific file should use LoadFromFile.
func Load() (Config, error) {
	return LoadFromEnv()
}

// LoadFromEnv loads configuration from environment variables and validates it.
// Environment variables use the PLATFORM_AGENT_ prefix; legacy URL names are
// accepted so existing node installations can migrate without downtime.
func LoadFromEnv() (Config, error) {
	return load(valuesFromEnvironment())
}

// LoadFromFile loads KEY=VALUE settings from path, then applies explicitly set
// process environment variables as overrides. This keeps systemd EnvironmentFile
// and direct invocation behavior consistent.
func LoadFromFile(path string) (Config, error) {
	values, err := readEnvFile(path)
	if err != nil {
		return Config{}, err
	}
	for _, entry := range os.Environ() {
		key, value, ok := strings.Cut(entry, "=")
		if ok && strings.HasPrefix(key, "PLATFORM_AGENT_") {
			values[key] = value
		}
	}
	return load(values)
}

// Validate checks the fields required to contact SaaS and the local MU Plugin.
// A registration token may temporarily stand in for AuthToken and AgentID.
func (c Config) Validate() error {
	missing := make([]string, 0, 4)
	if strings.TrimSpace(c.NodeID) == "" {
		missing = append(missing, nodeIDKey)
	}
	if strings.TrimSpace(c.SaaSBaseURL) == "" {
		missing = append(missing, saasBaseURLKey)
	}
	if strings.TrimSpace(c.MUPluginBaseURL) == "" {
		missing = append(missing, muPluginBaseURLKey)
	}
	if strings.TrimSpace(c.AuthToken) == "" && strings.TrimSpace(c.RegistrationToken) == "" {
		missing = append(missing, authTokenKey)
	}
	if strings.TrimSpace(c.AgentID) == "" && strings.TrimSpace(c.RegistrationToken) == "" {
		missing = append(missing, agentIDKey)
	}
	if len(missing) > 0 {
		return fmt.Errorf("missing required agent configuration: %s", strings.Join(missing, ", "))
	}
	if err := validateAbsoluteURL(saasBaseURLKey, c.SaaSBaseURL); err != nil {
		return err
	}
	if err := validateAbsoluteURL(muPluginBaseURLKey, c.MUPluginBaseURL); err != nil {
		return err
	}
	if c.PollInterval <= 0 {
		return fmt.Errorf("%s must be positive", pollIntervalKey)
	}
	if c.HeartbeatInterval <= 0 {
		return fmt.Errorf("%s must be positive", heartbeatKey)
	}
	if c.RequestTimeout <= 0 {
		return fmt.Errorf("%s must be positive", requestTimeoutKey)
	}
	return nil
}

func load(values map[string]string) (Config, error) {
	saasBaseURL := firstValue(values, saasBaseURLKey, controlPlaneURLKey)
	muPluginBaseURL := firstValue(values, muPluginBaseURLKey, wordpressURLKey)
	if muPluginBaseURL == "" {
		muPluginBaseURL = defaultMUPluginURL
	}
	var err error
	saasBaseURL, err = normalizeURL(saasBaseURLKey, saasBaseURL, false)
	if err != nil {
		return Config{}, err
	}
	muPluginBaseURL, err = normalizeURL(muPluginBaseURLKey, muPluginBaseURL, true)
	if err != nil {
		return Config{}, err
	}

	pollInterval, err := durationFromValues(values, pollIntervalKey, defaultPollInterval)
	if err != nil {
		return Config{}, err
	}
	heartbeatInterval, err := durationFromValues(values, heartbeatKey, defaultHeartbeat)
	if err != nil {
		return Config{}, err
	}
	requestTimeout, err := durationFromValues(values, requestTimeoutKey, defaultRequestTimeout)
	if err != nil {
		return Config{}, err
	}

	capabilities, err := boolMapFromValue(capabilitiesKey, values[capabilitiesKey])
	if err != nil {
		return Config{}, err
	}
	versions, err := stringMapFromValue(versionsKey, values[versionsKey])
	if err != nil {
		return Config{}, err
	}
	if versions["agent"] == "" {
		versions["agent"] = firstValue(values, agentVersionKey)
		if versions["agent"] == "" {
			versions["agent"] = "dev"
		}
	}
	hostname := strings.TrimSpace(values[hostnameKey])
	if hostname == "" {
		hostname, err = os.Hostname()
		if err != nil {
			return Config{}, fmt.Errorf("resolve hostname: %w", err)
		}
	}
	agentID := strings.TrimSpace(values[agentIDKey])
	nodeID := firstValue(values, nodeIDKey, agentIDKey)
	authToken := firstValue(values, authTokenKey, wordpressTokenKey)
	registrationToken := strings.TrimSpace(values[registrationKey])

	config := Config{
		SaaSBaseURL:       saasBaseURL,
		MUPluginBaseURL:   muPluginBaseURL,
		NodeID:            nodeID,
		AuthToken:         authToken,
		ControlPlaneURL:   saasBaseURL,
		AgentID:           agentID,
		RegistrationToken: registrationToken,
		Hostname:          hostname,
		Capabilities:      capabilities,
		Versions:          versions,
		PollInterval:      pollInterval,
		HeartbeatInterval: heartbeatInterval,
		RequestTimeout:    requestTimeout,
	}
	if err := config.Validate(); err != nil {
		return Config{}, err
	}
	return config, nil
}

func (c Config) HeartbeatURL() string {
	return c.AgentHeartbeatURL(c.AgentID)
}

func (c Config) JobsURL() string {
	if c.AgentID == "" {
		return ""
	}
	return endpoint(c.ControlPlaneURL, "/v1/agents/"+url.PathEscape(c.AgentID)+"/jobs")
}

func (c Config) RegisterURL() string {
	return endpoint(c.ControlPlaneURL, "/v1/agents/register")
}

func (c Config) AgentHeartbeatURL(agentID string) string {
	if agentID == "" {
		return ""
	}
	return endpoint(c.ControlPlaneURL, "/v1/agents/"+url.PathEscape(agentID)+"/heartbeat")
}

func valuesFromEnvironment() map[string]string {
	values := make(map[string]string)
	for _, entry := range os.Environ() {
		key, value, ok := strings.Cut(entry, "=")
		if ok && strings.HasPrefix(key, "PLATFORM_AGENT_") {
			values[key] = value
		}
	}
	return values
}

func readEnvFile(path string) (map[string]string, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open agent config %q: %w", path, err)
	}
	defer file.Close()

	values := make(map[string]string)
	scanner := bufio.NewScanner(file)
	for lineNumber := 1; scanner.Scan(); lineNumber++ {
		line := strings.TrimSpace(strings.TrimPrefix(scanner.Text(), "\ufeff"))
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, rawValue, ok := strings.Cut(line, "=")
		key = strings.TrimSpace(key)
		if !ok || key == "" || !strings.HasPrefix(key, "PLATFORM_AGENT_") {
			return nil, fmt.Errorf("agent config %q line %d must be PLATFORM_AGENT_KEY=VALUE", path, lineNumber)
		}
		value, err := parseEnvValue(strings.TrimSpace(rawValue))
		if err != nil {
			return nil, fmt.Errorf("agent config %q line %d: %w", path, lineNumber, err)
		}
		values[key] = value
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("read agent config %q: %w", path, err)
	}
	return values, nil
}

func parseEnvValue(value string) (string, error) {
	if len(value) < 2 {
		return value, nil
	}
	if value[0] == '\'' {
		if value[len(value)-1] != '\'' {
			return "", fmt.Errorf("single-quoted value is not closed")
		}
		return value[1 : len(value)-1], nil
	}
	if value[0] == '"' {
		if value[len(value)-1] != '"' {
			return "", fmt.Errorf("double-quoted value is not closed")
		}
		parsed, err := strconv.Unquote(value)
		if err != nil {
			return "", fmt.Errorf("invalid double-quoted value: %w", err)
		}
		return parsed, nil
	}
	return value, nil
}

func normalizeURL(key, raw string, addWPJSON bool) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", nil
	}
	parsed, err := url.ParseRequestURI(raw)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", fmt.Errorf("%s must be an absolute URL without credentials, query, or fragment: %q", key, raw)
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	if addWPJSON && !strings.HasSuffix(parsed.Path, "/wp-json") {
		parsed.Path += "/wp-json"
	}
	return strings.TrimRight(parsed.String(), "/"), nil
}

func validateAbsoluteURL(key, raw string) error {
	_, err := normalizeURL(key, raw, false)
	return err
}

func durationFromValues(values map[string]string, key string, fallback time.Duration) (time.Duration, error) {
	value := strings.TrimSpace(values[key])
	if value == "" {
		return fallback, nil
	}
	parsed, err := time.ParseDuration(value)
	if err != nil || parsed <= 0 {
		return 0, fmt.Errorf("%s must be a positive duration (for example 30s): %q", key, value)
	}
	return parsed, nil
}

func firstValue(values map[string]string, keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(values[key]); value != "" {
			return value
		}
	}
	return ""
}

func endpoint(base, path string) string {
	if base == "" {
		return ""
	}
	return strings.TrimRight(base, "/") + path
}

func boolMapFromValue(key, value string) (map[string]bool, error) {
	if strings.TrimSpace(value) == "" {
		return map[string]bool{}, nil
	}
	var result map[string]bool
	if err := json.Unmarshal([]byte(value), &result); err != nil {
		return nil, fmt.Errorf("%s must be a JSON object of booleans: %w", key, err)
	}
	if result == nil {
		return nil, fmt.Errorf("%s must be a JSON object of booleans", key)
	}
	return result, nil
}

func stringMapFromValue(key, value string) (map[string]string, error) {
	if strings.TrimSpace(value) == "" {
		return map[string]string{}, nil
	}
	var result map[string]string
	if err := json.Unmarshal([]byte(value), &result); err != nil {
		return nil, fmt.Errorf("%s must be a JSON object of strings: %w", key, err)
	}
	if result == nil {
		return nil, fmt.Errorf("%s must be a JSON object of strings", key)
	}
	return result, nil
}
