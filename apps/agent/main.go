package main

import (
	"context"
	"errors"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/accnet/ooio/apps/agent/internal/backup"
	"github.com/accnet/ooio/apps/agent/internal/config"
	"github.com/accnet/ooio/apps/agent/internal/heartbeat"
	"github.com/accnet/ooio/apps/agent/internal/jobrunner"
	"github.com/accnet/ooio/apps/agent/internal/jobsource"
	"github.com/accnet/ooio/apps/agent/internal/provision"
	agentregister "github.com/accnet/ooio/apps/agent/internal/register"
	"github.com/accnet/ooio/apps/agent/internal/restore"
	"github.com/accnet/ooio/apps/agent/internal/ssl"
	"github.com/accnet/ooio/apps/agent/internal/transport"
	"github.com/accnet/ooio/apps/agent/internal/wpclient"
)

const defaultWordPressURL = "http://127.0.0.1"

func main() {
	logger := log.Default()

	cfg, err := config.Load()
	if err != nil {
		logger.Fatalf("load config: %v", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	outbound := transport.NewHTTPClient(cfg.RequestTimeout)
	if cfg.RegistrationToken != "" {
		registration, err := agentregister.NewClient(cfg.RegisterURL(), outbound).Register(ctx, agentregister.Request{
			RegistrationToken: cfg.RegistrationToken,
			NodeID:            cfg.NodeID,
			Hostname:          cfg.Hostname,
			Capabilities:      cfg.Capabilities,
			Versions:          cfg.Versions,
		})
		if err != nil {
			logger.Fatalf("register agent: %v", err)
		}
		cfg.AgentID = registration.AgentID
		cfg.AuthToken = registration.AccessToken
		logger.Printf("agent registered: id=%s token_expires_in=%ds", cfg.AgentID, registration.ExpiresIn)
	}

	heartbeatReporter := heartbeat.NewHTTPReporterWithClient(
		cfg.AgentHeartbeatURL(cfg.AgentID),
		cfg.AgentID,
		cfg.AuthToken,
		heartbeat.Request{
			Status:       heartbeat.StatusReady,
			Capabilities: cfg.Capabilities,
			Versions:     cfg.Versions,
		},
		outbound,
		logger,
	)
	go func() {
		if err := heartbeatReporter.Run(ctx, cfg.HeartbeatInterval); err != nil && !errors.Is(err, context.Canceled) {
			logger.Printf("heartbeat stopped: %v", err)
		}
	}()

	wordpressURL := os.Getenv("PLATFORM_AGENT_WORDPRESS_URL")
	if wordpressURL == "" {
		wordpressURL = defaultWordPressURL
	}
	wordpressToken := os.Getenv("PLATFORM_AGENT_WORDPRESS_AUTH_TOKEN")
	if wordpressToken == "" {
		wordpressToken = cfg.AuthToken
	}
	wordpress := wpclient.NewHTTPClient(wordpressURL, wordpressToken, cfg.RequestTimeout)
	sslManager := ssl.New(nil, nil)
	backupManager := backup.New(nil, nil)
	restoreManager := restore.New(nil, nil)
	runner := jobrunner.New(
		jobsource.New(cfg.JobsURL(), cfg.AgentID, cfg.AuthToken, outbound),
		provision.NewHandler(wordpress, sslManager, backupManager, restoreManager),
		cfg.PollInterval,
		logger,
	)
	if err := runner.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
		logger.Fatalf("job runner stopped: %v", err)
	}
}
