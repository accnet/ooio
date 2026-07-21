package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

var configEnvironmentKeys = []string{
	saasBaseURLKey, controlPlaneURLKey, muPluginBaseURLKey, wordpressURLKey,
	agentIDKey, authTokenKey, wordpressTokenKey, registrationKey, nodeIDKey,
	hostnameKey, capabilitiesKey, versionsKey, agentVersionKey, pollIntervalKey,
	heartbeatKey, requestTimeoutKey,
}

func TestLoadFromEnvNormalizesURLsAndUsesDefaults(t *testing.T) {
	clearConfigEnvironment(t)
	t.Setenv(nodeIDKey, "node-1")
	t.Setenv(agentIDKey, "agent-1")
	t.Setenv(saasBaseURLKey, "https://saas.example.test/")
	t.Setenv(muPluginBaseURLKey, "http://127.0.0.1/")
	t.Setenv(authTokenKey, "secret-token")

	config, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("LoadFromEnv() error = %v", err)
	}
	if config.SaaSBaseURL != "https://saas.example.test" {
		t.Fatalf("SaaSBaseURL = %q", config.SaaSBaseURL)
	}
	if config.MUPluginBaseURL != "http://127.0.0.1/wp-json" {
		t.Fatalf("MUPluginBaseURL = %q", config.MUPluginBaseURL)
	}
	if config.ControlPlaneURL != config.SaaSBaseURL {
		t.Fatalf("ControlPlaneURL = %q, SaaSBaseURL = %q", config.ControlPlaneURL, config.SaaSBaseURL)
	}
	if config.PollInterval != defaultPollInterval || config.HeartbeatInterval != defaultHeartbeat || config.RequestTimeout != defaultRequestTimeout {
		t.Fatalf("defaults = poll %s, heartbeat %s, timeout %s", config.PollInterval, config.HeartbeatInterval, config.RequestTimeout)
	}
}

func TestLoadFromFileReadsQuotedValuesAndEnvironmentOverrides(t *testing.T) {
	clearConfigEnvironment(t)
	path := filepath.Join(t.TempDir(), "agent.env")
	contents := strings.Join([]string{
		"PLATFORM_AGENT_NODE_ID='file-node'",
		"PLATFORM_AGENT_ID=file-agent",
		"PLATFORM_AGENT_SAAS_BASE_URL=https://file-saas.example.test",
		"PLATFORM_AGENT_MU_PLUGIN_BASE_URL=http://127.0.0.1/wp-json/",
		"PLATFORM_AGENT_AUTH_TOKEN=\"file-token\"",
		"PLATFORM_AGENT_POLL_INTERVAL=15s",
		"PLATFORM_AGENT_HEARTBEAT_INTERVAL=45s",
	}, "\n")
	if err := os.WriteFile(path, []byte(contents), 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv(saasBaseURLKey, "https://env-saas.example.test/")

	config, err := LoadFromFile(path)
	if err != nil {
		t.Fatalf("LoadFromFile() error = %v", err)
	}
	if config.NodeID != "file-node" || config.AuthToken != "file-token" {
		t.Fatalf("file values = node %q, token %q", config.NodeID, config.AuthToken)
	}
	if config.SaaSBaseURL != "https://env-saas.example.test" {
		t.Fatalf("SaaSBaseURL = %q", config.SaaSBaseURL)
	}
	if config.MUPluginBaseURL != "http://127.0.0.1/wp-json" {
		t.Fatalf("MUPluginBaseURL = %q", config.MUPluginBaseURL)
	}
	if config.PollInterval != 15*time.Second || config.HeartbeatInterval != 45*time.Second {
		t.Fatalf("intervals = poll %s, heartbeat %s", config.PollInterval, config.HeartbeatInterval)
	}
}

func TestLoadFromEnvReportsMissingRequiredValues(t *testing.T) {
	clearConfigEnvironment(t)
	_, err := LoadFromEnv()
	if err == nil {
		t.Fatal("LoadFromEnv() error = nil, want missing configuration error")
	}
	for _, key := range []string{nodeIDKey, saasBaseURLKey, authTokenKey, agentIDKey} {
		if !strings.Contains(err.Error(), key) {
			t.Fatalf("error = %q, want %s", err, key)
		}
	}
}

func TestLoadFromEnvRejectsInvalidDuration(t *testing.T) {
	clearConfigEnvironment(t)
	t.Setenv(nodeIDKey, "node-1")
	t.Setenv(agentIDKey, "agent-1")
	t.Setenv(saasBaseURLKey, "https://saas.example.test")
	t.Setenv(authTokenKey, "secret-token")
	t.Setenv(pollIntervalKey, "0s")

	_, err := LoadFromEnv()
	if err == nil || !strings.Contains(err.Error(), pollIntervalKey) {
		t.Fatalf("error = %v, want %s validation error", err, pollIntervalKey)
	}
}

func clearConfigEnvironment(t *testing.T) {
	t.Helper()
	for _, key := range configEnvironmentKeys {
		value, present := os.LookupEnv(key)
		_ = os.Unsetenv(key)
		t.Cleanup(func() {
			if present {
				_ = os.Setenv(key, value)
			} else {
				_ = os.Unsetenv(key)
			}
		})
	}
}
