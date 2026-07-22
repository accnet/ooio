# Remaining Work — Danh sách để hoàn thành dự án

> **Living checklist — cập nhật 2026-07-21.** Runtime + Agent đã hoàn thiện, có test và
> chạy thật; API Contract v1 đóng băng; env production-like + gói deploy sẵn sàng. Còn
> lại: **kiểm chứng scale trên VPS**, **SaaS Control Plane**, và **production hardening**.

## ✅ ĐÃ XONG (30 task, có test, chứng minh chạy thật)

- **Phase 0**: monorepo scaffold, `manifest.schema.json`, OpenAPI (F0).
- **Runtime/Distribution (R1/R3/R4/A3)**: WooCommerce + Core Plugin Set, config profiles
  (default/perf/security), Distribution builder, DB module (DB-before-site + Database Router gen).
- **MU Plugin (B1–B4)**: 8 endpoint live; createSite dùng network domain + finalize
  (flush rewrite + public) → store tạo ra **browse được ngay**.
- **Go Agent (C1–C6, P1–P5, N1–N5)**: register/heartbeat/job-loop, provisioning +
  CreateStore orchestration có rollback, SSL/backup/restore-per-store, domain+Caddy,
  metrics + Prometheus, Runtime CLI, install-node.sh one-shot (Redis+LudicrousDB+plugins).
- **API Contract v1 (F1)**: đóng băng Stable, khớp code Go/PHP.
- **Database Router**: cấu hình single-pool, chạy qua toàn bộ query bằng implementation LudicrousDB.
- **Env production-like**: 6 systemd user service + Redis object cache + Agent daemon;
  **full 3-plane chạy thật** (mock SaaS → Agent → MU Plugin → store browse được).
- **Gói deploy**: `install-node.sh` + `node-config.env.sample` + `DEPLOY.md`.
- **Gate 2 chức năng**: đã kiểm chứng live.

---

## 🚀 A — Kiểm chứng trên VPS thật (bước kế tiếp — cần bạn cấp VPS)

- [ ] **A1** Chạy `install-node.sh --system` thật trên VPS Ubuntu → vá dry-run→real
  (tên php-fpm service, MariaDB root auth, Caddy repo…). Xem `apps/agent/deploy/DEPLOY.md`.
- [ ] **A2** **Gate 1 spike** 500 → 1000 site bằng `scripts/spike/*` → *Spike Report #001*
  (provisioning time, `wp_blogs` size, Database Router routing latency).
- [ ] **A3** **Isolation / noisy-neighbor benchmark** (2 chế độ) — Exit Criteria ADR-005.
- [ ] **A4** **Chốt ADR-005** (Accepted/Superseded) bằng số liệu thật.

## 🕓 S — SaaS Control Plane (XÂY SAU — hiện chỉ có mock)

Code theo Contract v1 đã đóng băng. Nhiện có mock SaaS cho dev; NestJS thật chưa xây.

- [ ] **S1** NestJS skeleton + module structure.
- [ ] **S2** Auth / Users / Organizations / Roles / API Keys.
- [ ] **S3** Billing / Plans / Subscriptions / Quotas.
- [ ] **S4** Cluster Registry + Scheduler/Placement (capacity score).
- [ ] **S5** Workflow Engine (Operation status/progress/retry/rollback) + BullMQ.
- [ ] **S6** `AgentClient` / `WordPressClient` SDK — generate từ `docs/api/*.openapi.yaml` v1.
- [ ] **S7** React Dashboard (chỉ gọi NestJS).
- [ ] **S8** Marketplace, Feature Flags, Analytics, Audit, Notifications.
- [ ] **S9** Store Migration (escalation noisy-neighbor → tier/cluster khác, ADR-005).

## 🧱 H — Runtime hardening / production-completeness

- [ ] **H1** **Database Router multi-pool**: dựng thêm MySQL pool (B/C), `db-config.php` partition
  theo dataset, wire module R4 để Agent cấp DB tự động. (single-pool đã xong.)
- [ ] **H2** **Distribution bundle thật**: đóng gói một bản v1 có version + checksum, đẩy
  Artifact Repo (MinIO/S3), + quy trình rollout (canary/staged) & rollback per-store.
- [ ] **H3** **Observability stack**: Prometheus + Grafana + Loki + OpenTelemetry
  (hiện mới có Agent expose `/metrics`).
- [ ] **H4** **Multi-cluster**: Cluster Registry nhiều node, rolling update theo node,
  Node Manifest routing.
- [ ] **H5** **SSL thật** trên domain public (C4 live, Let's Encrypt) — cần domain.
- [ ] **H6** Backup/restore ở quy mô + **disaster recovery drill** trên DB lớn.
- [ ] **H7** Vá nhỏ: LudicrousDB + PHP 8.3 + WP-CLI shutdown notice; consolidate `idea/context`.

## 🧪 T — QA cuối

- [ ] **T1** Security review + **Plugin Compatibility Matrix v1**.
- [ ] **T2** Stress test toàn hệ + **production readiness checklist** (alerting/logs đầy đủ).

---

## Thứ tự đề xuất (từ hiện trạng)

1. **A1–A4** — cấp VPS, chạy installer thật, spike scale, **chốt ADR-005**. Đây là bằng
   chứng còn thiếu để khoá kiến trúc Runtime.
2. **S1–S9** — xây SaaS Control Plane trên nền Contract v1.
3. **H1–H6** — hardening (multi-pool, distribution rollout, observability, multi-cluster, SSL).
4. **T1–T2** — QA cuối trước production.
