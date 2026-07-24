# SaaS Phase 2 — đối chiếu roadmap với thực trạng

**Ngày: 2026-07-23.** Đối chiếu roadmap **S1–S9** với `18-SaaS-Implementation-Plan.md` và
với **mã nguồn thật**, trước khi bắt tay code.

Kết luận ngắn: **roadmap viết như bắt đầu từ số 0, nhưng phần lớn S1–S7 và S9 đã tồn tại và
đã chạy thật.** Lập kế hoạch như greenfield sẽ làm lại việc đã có.

---

## 1. Thực trạng đã đo

**20 module trong `apps/api/src/`:**

```
admin · agents · analytics · api-keys · audit · auth · billing · das · events
flags · health · marketplace · migrations · notifications · operations · orgs
prisma · scheduler · stores · workflow
```

**22 bảng PostgreSQL:**

```
api_keys · audit_log · clusters · db_pools · distributions · domains · events
feature_flags · invoices · mapping_epochs · memberships · nodes
notification_channels · notifications · operations · organizations · plans
store_migrations · store_placement_history · stores · subscriptions · users
```

Và luồng 3-plane **đã chứng minh đầu-cuối**: `POST /stores` → Agent → WordPress →
storefront browsable.

---

## 2. Roadmap S1–S9 so với thực tế

| | Roadmap | Thực tế | Còn thiếu |
|---|---|---|---|
| **S1** | Auth: JWT, Refresh, OAuth, Magic Link | `auth/` — `register` · `login` · `refresh`, JWT strategy, `rbac.guard`, `platform-role.guard` | **OAuth, Magic Link, Email** |
| **S2** | User, Org, Team, Invitation, RBAC | `orgs/`, bảng `organizations` + `memberships`, hai guard RBAC | **Invitation flow** |
| **S3** | Billing: Plan, Subscription, Credit, Invoice, Usage | `billing/`, bảng `plans` · `subscriptions` · `invoices` | **Credit, Usage metering** |
| **S4** | Store: Wizard, Provision, Cluster Allocation, Destroy, Suspend | `stores/` · `scheduler/` · `das/` · `operations/`, `apps/web/CreateStore.tsx` | **Suspend**, và `das` cần đổi tên theo ADR-005 |
| **S5** | Dashboard: Overview, Orders, Products, Traffic, Health, Logs, AI | `apps/web` (12 trang), `analytics/`, `health/` | **Orders/Products/Traffic** — dữ liệu WordPress, phải qua Agent |
| **S6** | Agent API: Provision, Update, Backup, Deploy, Health, Metrics, Heartbeat | `agents/`, `operations/`, Go Agent có `backup` · `restore` · `ssl` · `heartbeat` · `metrics` · `promexport` | rà lại độ phủ |
| **S7** | Worker: BullMQ, Queue, Retry, Saga, Workflow, Rollback | BullMQ **đã dùng** trong `workflow/operations.processor.ts` + `events/events.dispatcher.ts` | **`apps/worker` chỉ có README** — chạy in-process |
| **S8** | AI: Blueprint, Planner, Task, Review | không có gì trong `apps/api` | **toàn bộ** |
| **S9** | Admin: Cluster, Node, Worker, Queue, Logs, Users, Billing, Support | `admin/`, `apps/admin`, `apps/ops` (6 trang: Distributions · Events · Flags · Health · Pools) | **Queue, Support** |

> **S1–S7 và S9 phần lớn đã có.** Việc thật là **hoàn thiện chỗ thiếu**, không phải dựng
> lại. S8 là thứ duy nhất trắng.

---

## 3. `18-SaaS-Implementation-Plan.md` — bốn chỗ đã lỗi thời

Tài liệu này viết trước khi có số liệu, và bốn khẳng định của nó **mâu thuẫn với repo hiện
tại**:

### 3.1 Cấu trúc repo — sai về căn bản

`§3` ghi:

```
woocloud-control-plane/        woocloud-runtime/   (repo RIÊNG)
  apps/ api dashboard worker     agent/
```

Thực tế là **một monorepo duy nhất** `ooio/` chứa cả `apps/api`, `apps/agent`, `runtime/`,
`packages/`. Không có hai repo.

### 3.2 `apps/dashboard` không còn tồn tại

`§3` và `§23` nói về **một** dashboard. Thực tế đã tách **ba SPA theo ranh giới uỷ quyền**:

```
apps/web     khách hàng
apps/ops     vận hành hệ thống (operator)
apps/admin   hỗ trợ khách hàng (support)
```

Ranh giới này là **quyết định bảo mật**, không phải sở thích tổ chức — nó gắn với
`platform-role.guard.ts` và `User.platformRoles`. Roadmap của bạn đề xuất
`apps/web/{marketing,dashboard,admin}` — tức gộp ba app thành ba thư mục trong một app.
**Làm vậy là bỏ ranh giới uỷ quyền**: ba vai trò sẽ dùng chung một bundle, một token
storage key, một origin.

Hiện mỗi app có key riêng: `woocloud.*` · `ooio.ops.*` · `ooio.support.*`.

### 3.3 "Ngoài phạm vi: Database Router"

Router **không còn tồn tại** — `ADR-005`. Câu này giờ vô nghĩa thay vì sai, nhưng nó khiến
người đọc tưởng có một tài liệu Router đang được duy trì ở đâu đó.

### 3.4 "Control Plane mới chỉ có bản Mock"

Không còn đúng. `apps/api` là NestJS + Prisma + PostgreSQL thật, 20 module, đã tạo store
thật qua Agent thật.

---

## 4. Khoảng trống giữa hai bản

Roadmap của bạn có, tài liệu 18 **không** có:

| Hạng mục | Ghi chú |
|---|---|
| **S8 AI** (Blueprint, Planner, Task, Review, Codex/Claude) | `18` chỉ có `§17 AI Modules` một dòng |
| **Credit** | `18 §13 Billing` không nhắc credit |
| **Magic Link / OAuth** | `18 §7` chỉ có JWT + RBAC |
| **Support** trong Admin | `18` không có |

Tài liệu 18 có, roadmap **không** nhắc — và đều đã hiện thực:

**Marketplace** · **Feature Flags** · **Audit Log** · **Notification** · **Event Bus** ·
**API Versioning** · **SDK Generation**

Bỏ chúng khỏi roadmap không có nghĩa bỏ khỏi sản phẩm; chúng đang chạy.

---

## 5. Đề nghị

**Không viết lại `18` từ đầu.** Thay vào đó:

1. **Sửa bốn chỗ lỗi thời ở mục 3** — chi phí thấp, và để nguyên thì mọi người đọc sau sẽ
   đi sai hướng ngay từ cấu trúc repo.
2. **Bổ sung S8 (AI) và các mục thiếu ở mục 4** vào `18`, thay vì giữ hai tài liệu song
   song mô tả cùng một hệ thống.
3. **Giữ ba SPA tách rời.** Nếu muốn gộp, cần một ADR nói rõ ranh giới uỷ quyền được bảo vệ
   bằng cách nào khác.
4. **Bắt đầu bằng rà soát độ phủ, không phải bằng code mới.** Với mỗi mục S1–S9, chạy thử
   cái đã có trước khi kết luận nó thiếu — `18` từng ghi "Control Plane chỉ có bản Mock"
   trong khi thực tế đã chạy thật, và đó chính là loại sai lệch cần tránh lặp lại.

**Thứ tự bạn đề xuất (Foundation → Dashboard → Ops/Admin → Billing & AI) là hợp lý** — chỉ
cần đọc lại là *hoàn thiện* bốn tầng đó, không phải *dựng mới*.
