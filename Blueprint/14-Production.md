# Production

## Chế độ triển khai theo Plane

- **Control Plane (SaaS)** — Docker: `dashboard`, `api`, `worker`, `scheduler`, `redis`,
  `postgres`. CI/CD qua GitHub Actions, rolling deploy.
- **Management + Runtime Plane (Cluster)** — Native, không Docker: `systemd` quản lý
  Go Agent, PHP-FPM, Caddy, WordPress trực tiếp trên OS (xem ADR-002).

## Observability Stack

```
Metrics   → Prometheus + Grafana
Logs      → Loki (hoặc ELK)
Tracing   → OpenTelemetry
Heartbeat → Go Agent → Cluster Registry → Dashboard vận hành
```

Chi tiết ở `12-Monitoring.md`.

## Backup & Restore

- Backup: `Operation → Agent → mysqldump → Compress → Upload Object Storage (R2/S3/MinIO) → Done`.
- Phạm vi backup: Database, Media, Config (không chỉ database).
- Restore: ngược lại quy trình backup, luôn thông qua Operation có audit, không thao
  tác tay trên server.

## Rolling Update

- SaaS: rolling deploy container theo pipeline CI/CD chuẩn.
- Cluster: rolling update theo từng Node (drain → update Agent/Distribution → verify →
  node tiếp theo), dựa trên Node Manifest — xem `06-Go-Agent.md` và `11-Deployment.md`.
- Update Distribution: Backup → Maintenance mode → Update → Verify → Done (hoặc tự
  rollback nếu Verify thất bại) — xem `11-Deployment.md`.

## Multi-Cluster / Multi-Region

```
SaaS
├── Cluster HK01 (~300–500 site)
├── Cluster HK02
├── Cluster SG01
└── Cluster US01
```

Scheduler tự động phân bổ store mới theo capacity score (CPU/RAM/Disk/PHP Workers/
Region/Plan/Cost); thêm Cluster mới chỉ cần cài Runtime + đăng ký với Control Plane,
không cần thay đổi kiến trúc lõi.

## Disaster Recovery

- Mỗi Cluster có Database Pool và backup độc lập — sự cố một Cluster không ảnh hưởng
  Cluster khác.
- Artifact Repository (Object Storage) là nguồn phục hồi cho Agent/MU Plugin/Distribution
  khi cần dựng lại Node từ đầu.
- Runbook khôi phục nên được viết trong `docs/runbooks/` *(Proposed — gợi ý tổ chức tài
  liệu của người viết Blueprint, `idea/` không đề cập vị trí cụ thể này)*.

## Bảo mật vận hành

- Không SSH, không DB Direct, không public MU Plugin ra ngoài localhost (nhắc lại
  ADR-003) — áp dụng cả ở môi trường Production.
- JWT + refresh token giữa mọi thành phần outbound (Agent ↔ Control Plane).
- RBAC cho truy cập Dashboard vận hành nội bộ.

## Điều kiện để coi là "Production-ready"

Đã hoàn thành Stress Test (Phase 5 trong `13-Roadmap.md`) với số liệu cụ thể về giới
hạn mỗi Cluster, có Monitoring đầy đủ, có Backup/Restore đã kiểm chứng, và API Contract
giữa SaaS và Agent đã đóng băng.
