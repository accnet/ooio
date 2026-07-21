# Deployment

## Hai chế độ triển khai

- **SaaS (Control Plane)** — Docker. Services: `api`, `worker`, `scheduler`, `redis`,
  `postgres`, `nginx`/dashboard. CI/CD qua GitHub Actions.
- **Runtime Cluster** — Native, không Docker. `systemd` quản lý Agent, PHP-FPM, Caddy,
  WordPress trực tiếp trên OS (Ubuntu/AlmaLinux). Xem lý do ở ADR-002.

## Luồng CI/CD chung

```
GitHub
  │
  ▼
GitHub Actions (test → build)
  │
  ▼
Build Artifacts (Agent binary, MU Plugin zip, Theme zip, Distribution bundle, Dashboard/API image)
  │
  ▼
Artifact Repository (Object Storage: S3/R2/MinIO)
  │
  ▼
Control Plane lưu metadata (version, changelog, checksum SHA-256)
  │
  ▼
Tạo Deploy Job (Operation)
  │
  ▼
Go Agent poll job → tải artifact từ Object Storage gần nhất
  │
  ▼
Rolling Update trên từng Node
```

Agent **không** tải trực tiếp từ GitHub Releases — luôn qua Artifact Repository trung
gian. Lý do: không phụ thuộc GitHub khi triển khai, tăng tốc cập nhật nhiều cluster,
kiểm soát version/rollback tốt hơn, dễ chuyển sang hạ tầng riêng sau này.

Artifact Repository chứa: `agent/`, `mu-plugin/`, `theme/`, `plugin/`, `distribution/`,
`backup/`, `releases/`, kèm checksum và metadata version.

## Chiến lược rollout Distribution version

```
GitHub → Build Distribution vX.Y.Z → Artifact Repository
  │
  ▼
Control Plane tạo Operation "UpdateDistribution"
  │
  ▼
Agent:
  ├── Backup (trước khi động vào bất cứ gì)
  ├── Bật Maintenance mode
  ├── Update Plugins / Theme theo Distribution mới
  ├── Verify (health check + smoke test)
  └── Done — hoặc tự động rollback về bản backup nếu Verify thất bại
```

Nguyên tắc: mỗi Store chỉ lưu **một con số version Distribution** đang dùng (ví dụ Store
A → 1.0.0, Store B → 1.2.0) — không bắt buộc mọi store update cùng lúc (Accepted, theo
`plan-8.md`/`plan-12.md`), nên có thể rollback độc lập theo từng store.

Cụ thể hoá thành **canary/staged rollout** (cập nhật theo lô nhỏ trước, mở rộng dần)
*(Proposed — xem `DOC-STATUS.md`)*: đây là cách hiện thực hoá hợp lý cho nguyên tắc trên,
nhưng thuật ngữ và quy trình canary cụ thể không được `idea/` mô tả — chỉ là suy luận kỹ
thuật thông thường khi triển khai.

## Node Registration & Rolling Update theo Node

Vì Cluster = N Node, rolling update triển khai lần lượt từng Node (drain → update →
verify → tiếp node kế) để không gây gián đoạn toàn Cluster cùng lúc — dựa trên Node
Manifest (capabilities/version) mà mỗi Agent tự khai báo khi đăng ký.
