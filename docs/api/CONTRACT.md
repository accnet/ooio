# API Contract v1

This document freezes the two Agent-facing API slices delivered in Phase 0 at
version `1.0.0`.

## SaaS control plane

The native Go Agent uses an outbound-only contract for:

- `POST /v1/agents/register`, carrying `register.Request` and returning
  `register.Response`.
- `POST /v1/agents/{agentId}/heartbeat`, carrying status, capabilities,
  versions, capacity, and the optional `metrics.Snapshot`.
- `GET /v1/agents/{agentId}/jobs`, returning `jobrunner.Job` values.
- `POST /v1/agents/{agentId}/jobs/{jobId}/result`, carrying
  `jobrunner.JobResult` and its optional `jobrunner.JobError`.

The JSON field names in the OpenAPI document are the Go struct JSON tags.
Job payloads and result values remain JSON values owned by the job handler.

## MU Plugin

The Agent calls the WordPress MU Plugin through the `/wp-json` REST base with
bearer authentication. The v1 operation responses are:

- `POST /platform/v1/sites`: `siteId`, `domain`, `status`.
- `DELETE /platform/v1/sites/{siteId}`: `siteId`, `status: deletion_accepted`.
- `POST /platform/v1/plugins/activate`: `siteId`, `plugin`, `networkWide`, `status`.
- `POST /platform/v1/themes/switch`: `siteId`, `theme`, `status`.
- `POST /platform/v1/users`: `userId`, `username`, `role`.
- `POST /platform/v1/options`: `siteId`, `name`, `updated`.
- `GET /platform/v1/health`: `status`, `plugin`, `wordpress`.

## Versioning

Changes within v1 must be additive and preserve existing field meanings and
paths. A removed field, renamed field, changed required field, incompatible
type, or changed operation meaning is breaking and requires a major version
bump.

## Open item

Transport selection under ADR-003 remains open: localhost REST and Unix domain
socket are both retained as deployment options. The operation and JSON
boundaries must remain stable if the transport changes.

## Evidence

Gate 2 live evidence was collected on `2026-07-21` against the local WordPress
7.0.2 multisite runtime. The MU Plugin routes were exercised end-to-end with
bearer authentication using the canonical WordPress host and `/wp-json` REST
base; the verified details are retained in the MU Plugin OpenAPI document.
