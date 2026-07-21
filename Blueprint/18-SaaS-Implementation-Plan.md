# 18 · SaaS Control Plane — Implementation Plan

> **Phạm vi: 100% Control Plane (SaaS Platform).** Tài liệu này trả lời *"làm thế nào xây
> SaaS quản lý WooCommerce Cloud Platform"*. Runtime/WordPress, HyperDB, Go Agent,
> Distribution **không** mô tả chi tiết ở đây — xem `19-Runtime-Implementation.md`,
> `20-Platform-Services.md`. Ranh giới giữa SaaS và Runtime là **API Contract v1**
> (`docs/api/*.openapi.yaml`, đã đóng băng).
>
> **Triết lý:** WordPress chỉ là *Runtime Engine*; SaaS là *Platform*. Toàn bộ business
> logic (user, billing, workflow, phân phối, vận hành) nằm ở SaaS. Control Plane **không
> bao giờ** SSH / truy cập MySQL Runtime / sửa file WordPress — mọi thứ qua Agent.
>
> **Thứ tự thi công (vertical-slice-first, giống Runtime-first):** dựng nền (§2) → **thay
> mock SaaS bằng Control Plane thật + 1 Operation CreateStore chạy end-to-end tới Agent
> thật** (mốc quan trọng nhất) → Identity → Workflow/Scheduler → Billing → Dashboard →
> phần còn lại. Test dùng Runtime node local + mock làm test double, VPS/scale để sau.

---

## 1. Vision & Scope
Xây **Control Plane** điều phối toàn bộ platform: quản lý người dùng/tổ chức, thanh toán,
vòng đời cửa hàng, workflow/vận hành, phân phối Distribution, và giám sát cluster — trên
nền Runtime WordPress đã có. **Trong phạm vi:** NestJS API, Dashboard, Worker, Workflow,
Scheduler, Cluster Registry, Billing, Marketplace, Analytics, Audit, Notifications.
**Ngoài phạm vi (tài liệu khác):** nội bộ WordPress/MU Plugin, HyperDB, Agent, Distribution
build. **Mục tiêu quy mô:** vài trăm → vài nghìn store; Control Plane độc lập hoàn toàn với
Runtime để sau này cắm thêm runtime khác (Magento/headless) mà không đổi SaaS.

## 2. Technology Stack
```
API        NestJS (TypeScript) · Prisma · PostgreSQL · Redis · BullMQ
Dashboard  React + Vite (SPA)  — KHÔNG dùng Next.js
Contracts  OpenAPI v1 → generate SDK (TS/Go/PHP)
Infra      Docker · GitHub Actions · Cloudflare (edge)
```
API là **nơi duy nhất** truy cập PostgreSQL/Redis/BullMQ. Dashboard là SPA thuần, chỉ gọi
API qua JWT/HTTPS, không chạm DB.

## 3. Repository Structure
Monorepo cho Control Plane; Runtime là repo **riêng**.
```
woocloud-control-plane/           woocloud-runtime/   (repo riêng)
  apps/ api  dashboard  worker       agent/
  packages/ contracts sdk ui shared  wordpress/
  infra/                             distribution/
  docs/  .github/                    configs/ scripts/ docs/
```
`packages/contracts` = OpenAPI + schema đóng băng; `packages/sdk` = client sinh tự động.

## 4. Domain-Driven Design (Bounded Contexts)
Tổ chức module NestJS = bounded context, giao tiếp qua Event Bus/Application Service,
**không gọi trực tiếp lẫn nhau**:
- **Identity & Access** — auth, users, orgs, teams, roles, API keys
- **Billing & Plans** — plans, subscriptions, invoices, quotas
- **Store Lifecycle** — stores, domains, SSL state (nghiệp vụ, không phải dữ liệu WP)
- **Workflow & Operations** — Operation engine, retry/rollback, audit
- **Infrastructure** — Cluster Registry, Scheduler/Placement, Node metadata
- **Marketplace** — distribution/plugin/theme registry, capability
- **Analytics & Audit** · **AI & Integrations** · **Notifications**

Mỗi context sở hữu dữ liệu riêng (schema logic riêng trong Postgres). Không context nào
biết chi tiết WordPress — chỉ gọi qua `AgentClient`.

## 5. Database Schema (PostgreSQL, phác thảo)
```
organizations(id, name, plan_id, status)
users(id, email, password_hash) · memberships(user_id, org_id, role)
api_keys(id, org_id, hash, scopes)
plans(id, name, limits jsonb) · subscriptions(org_id, plan_id, status, period)
clusters(id, region, capabilities jsonb, weight, status)
nodes(id, cluster_id, hostname, version, capacity jsonb, health, last_heartbeat)
db_pools(id, cluster_id, name, capacity, used)
stores(id, org_id, cluster_id, db_pool, distribution, runtime_ver, tier, blog_id, status)
domains(id, store_id, hostname, verified, ssl_status)
operations(id, org_id, store_id, type, status, progress, payload jsonb, attempts, logs)
audit_log(id, org_id, actor, action, target, at, meta jsonb)
```
Store lưu **metadata** đủ để định vị (§12); không query nhiều bảng để tìm store ở đâu.

## 6. API Contract Strategy
**Contract-first.** OpenAPI là nguồn sự thật; **không viết client tay**.
```
docs/api/*.openapi.yaml  →  generate  →  TS (dashboard/api) · Go (agent) · PHP (mu-plugin)
```
Hai mặt cắt đã đóng băng v1 (`agent-saas`, `agent-mu-plugin`). Mặt cắt thứ ba
**public API** (Dashboard/khách hàng ↔ NestJS) định nghĩa mới ở đây, cùng chuẩn.

## 7. Authentication & Authorization
JWT (access + refresh) cho Dashboard↔API và Agent↔API (Agent dùng registration token →
JWT, xem Contract v1). RBAC theo role trong membership (owner/admin/member). API Keys cho
truy cập chương trình. Mọi request gán `org_id` scope; không rò rỉ chéo tổ chức.

## 8. Workflow & Operations
Không dùng "job đơn". Mọi tác vụ dài là **Workflow** gồm nhiều Step, mỗi Step map sang một
**Operation** mà Agent hiểu:
```
CreateStore Workflow:  Allocate(cluster,pool,distribution) → Provision → Domain → SSL → Verify → Ready
```
Operation có `status/progress/logs/retry/rollback/cancel/audit`. Rollback tự động khi
Step lỗi (vd xoá blog, giải phóng DB). SaaS enqueue Operation vào BullMQ → Agent poll
(`GET /v1/agents/{id}/jobs`) → thực thi → `POST .../result` (202) cập nhật Operation.

## 9. Scheduler (Placement)
Khi tạo store, Scheduler chọn **Cluster → Database Pool → Distribution → Capability**, không
random. HyperDB **không tự chọn pool** — Scheduler quyết định, Agent đồng bộ mapping,
HyperDB chỉ route. Tiêu chí capacity score: region, CPU/RAM/disk, PHP workers, DB pool load,
Redis, plan, capabilities, version, cost. **Ngưỡng capacity là config** — nạp số thật sau
Gate 1 spike, không hardcode.

## 10. Event Bus
Workflow hoàn tất → publish event; các context subscribe độc lập, không gọi trực tiếp:
```
StoreCreated → Analytics · Billing · Notification · Marketplace · Audit
PlanChanged  → Store quota re-eval
```
Cài trên Redis/BullMQ (hoặc NestJS CQRS event). Đảm bảo idempotent + retry.

## 11. Cluster Registry
Agent tự đăng ký (`POST /v1/agents/register`) + heartbeat định kỳ; Registry lưu metadata,
**không hardcode IP**:
```
cluster: id, region, capabilities, weight, status
node:    version(Distribution/PHP/WP/Woo), health, capacity, last_heartbeat
```
SaaS **đọc** Registry để Scheduler đặt store và Dashboard hiển thị sức khoẻ.

## 12. Metadata Service
Mỗi store mang metadata đủ để định vị nhanh, tránh join nhiều bảng:
```json
{ "cluster":"hk01", "dbPool":"pool-a", "distribution":"commerce-stable",
  "runtime":"1.0.0", "tier":"pro" }
```
Dùng cho routing thao tác (Operation gửi tới đúng cluster/agent), báo cáo, và migration.

## 13. Billing
Plans (limits jsonb), Subscriptions, Quotas (số store/tier), Invoices, Credits. Gate action
theo quota (vượt → chặn tạo store). Payment: bắt đầu **stub**, tích hợp Stripe sau. Sự kiện
`StoreCreated`/`PlanChanged` cập nhật usage.

## 14. Marketplace
Registry của **Distribution** (immutable artifact có version) + plugin/theme packs +
capability. Không cho user upload plugin tuỳ ý ở giai đoạn đầu — chỉ Distribution đã kiểm
thử. Deploy Distribution mới = Operation `DeployDistribution` (Agent pull artifact).

## 15. Feature Flags
Bật/tắt tính năng theo org/plan/cluster/version. Đọc ở API + Dashboard. Dùng cho rollout
dần (canary tính năng, không phải canary hạ tầng).

## 16. Analytics
Tổng hợp từ event (StoreCreated/OperationCompleted…) + heartbeat metrics. **Không** query
trực tiếp DB WooCommerce của Runtime (trừ khi bật đồng bộ có chủ đích — thiết kế ETL riêng
ở tài liệu Runtime). Dashboard hiển thị tăng trưởng store, tình trạng operation, capacity.

## 17. AI Modules
Giai đoạn sau Production: SEO, mô tả sản phẩm, hỗ trợ, tự động hoá. Là context riêng,
subscribe event, gọi API ngoài. Không chặn phần lõi — để cuối.

## 18. Audit Log
Mọi Operation + hành động người dùng ghi audit (ai / khi nào / làm gì / kết quả). Phục vụ
compliance + truy vết vận hành. Bất biến, chỉ ghi thêm.

## 19. Notification
Email/webhook/thông báo hệ thống, subscribe event (StoreCreated, OperationFailed, quota…).
Tách khỏi luồng chính (async).

## 20. Background Jobs (BullMQ)
Redis + BullMQ chạy: hàng đợi Operation (Agent poll), event dispatch, tác vụ định kỳ
(reconcile heartbeat, dọn operation cũ, tính usage). Worker (`apps/worker`) tách khỏi API.

## 21. API Versioning
Public API version qua path (`/v1/...`). Contract v1 (agent-facing) đã đóng băng; thay đổi
additive trong major, breaking = major bump (chính sách `docs/api/CONTRACT.md`).

## 22. SDK Generation
CI sinh SDK từ OpenAPI mỗi lần contract đổi: TS (`packages/sdk` cho api + dashboard),
Go (agent), PHP (mu-plugin). Không client viết tay → không lệch spec.

## 23. Dashboard Architecture
React + Vite SPA. Auth JWT, org switcher, danh sách/tạo store, theo dõi Operation realtime
(polling/websocket), cluster health, billing. Chỉ gọi NestJS; không truy cập DB; build tĩnh
→ CDN.

## 24. CI/CD
```
API:       GitHub → test → Docker image → deploy
Dashboard: GitHub → build → CDN
Runtime:   (repo riêng) GitHub → build Distribution → Artifact Repo → Agent pull → deploy
```

## 25. Production Readiness Checklist
- [ ] Auth/RBAC + rate limit + secrets management
- [ ] Postgres backup/restore + migration an toàn
- [ ] Workflow retry/rollback/audit đầy đủ mọi Operation
- [ ] Cluster Registry + heartbeat reconcile + alert khi node mất
- [ ] Scheduler capacity thresholds **nạp từ Gate 1 spike**
- [ ] Observability: metrics/logs/traces (Prometheus/Grafana/Loki/OTel)
- [ ] Contract v1 tests (SaaS trả đúng register 201 · jobs `{jobs:[]}` · result 202)
- [ ] SDK sinh tự động trong CI
- [ ] Load test API + end-to-end với Runtime thật trên VPS

---

## Kiến trúc production (tham chiếu)
```
Users → Cloudflare → React Dashboard (SPA)
                         │  JWT/HTTPS
                     NestJS API ── PostgreSQL · Redis · BullMQ
                         │        (Workflow / Events)
                   Cluster Registry
                         │
                   Operations Queue
        ══════════════════════════════════════  ◄ API Contract v1 (đóng băng)
                     Go Agent (Node)
                         │  WordPress Adapter → MU Platform Plugin
                   WordPress Multisite → HyperDB → MySQL Primary/Replica Pools
```
Control Plane hoàn toàn độc lập Runtime; WordPress chỉ là Execution Engine.
