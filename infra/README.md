# Infrastructure

Infrastructure definitions cho local development và deployment.

## Trạng thái

| Thư mục | Trạng thái | Nội dung |
|---|---|---|
| `docker/` | **có code** | `compose.yaml` + `Caddyfile` cho local dev |
| `ansible/` | **rỗng** | Reserved — configuration management |
| `terraform/` | **rỗng** | Reserved — infrastructure as code |
| `monitoring/` | **rỗng** | Reserved — Prometheus/Grafana/Loki configs |

## Docker Compose (local dev)

```bash
cd infra/docker
docker compose up -d     # PostgreSQL + Redis + (optional services)
```

## Production deployment

Production deployment hiện dùng `install-node.sh` (one-shot shell script) thay vì
Docker/Terraform. Xem [docs/guides/deployment.md](../docs/guides/deployment.md).

Agent chạy native (systemd, không Docker) theo
[ADR-002](../Blueprint/ADR/ADR-002-Agent-Native-No-Docker.md).

## Observability (planned)

Prometheus + Grafana + Loki + OpenTelemetry. Hiện mới có Agent expose `/metrics`.
Xem [Blueprint/12-Monitoring.md](../Blueprint/12-Monitoring.md).
