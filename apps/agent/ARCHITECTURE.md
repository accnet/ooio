# Go Agent Architecture

The agent is a native, outbound-only runtime process for one WordPress node. It
contains infrastructure execution seams, not SaaS business decisions.

## Components

- `main.go` owns process startup and SIGINT/SIGTERM shutdown.
- `internal/config` reads environment configuration and timing values.
- `internal/heartbeat` periodically sends an outbound heartbeat over HTTP(S).
- `internal/jobrunner` polls for pending opaque jobs and passes them to an
  executor. The initial executor is a no-op stub.
- `internal/wpadapter` defines the transport- and topology-neutral
  `WordPressClient` interface. WordPress data changes must be implemented behind
  this seam through the MU Plugin; the agent does not write WordPress SQL.
- `deploy/` contains the native systemd unit and a conservative node installer.

## Runtime boundaries

The service opens no listener. Control-plane communication is initiated by the
agent through outbound requests for heartbeat and job polling. The transport
between the agent and MU Plugin is deliberately left open for a later contract
decision, so this skeleton contains no Multisite-specific behavior.

The unit is native systemd-managed deployment in accordance with ADR-002. The
agent is not packaged as a Docker container and is not an SSH target for the
control plane, in accordance with ADR-003.
