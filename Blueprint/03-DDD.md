# Domain Driven Design

> **Trạng thái: Proposed / Draft — cần review.** Ranh giới bounded context dưới đây là
> đề xuất của người viết tài liệu dựa trên danh sách module rời rạc trong `idea/plan-12.md`
> (Billing, User, Marketplace, AI, Workflow, Scheduler...), KHÔNG phải ranh giới đã được
> thảo luận và chốt trong nguồn. Đặc biệt việc tách "Commerce Platform" và "Marketplace"
> thành hai bounded context riêng, thứ tự phụ thuộc giữa chúng, và việc coi Marketplace
> là bounded context hay chỉ là subdomain — đều còn mở (xem `DOC-STATUS.md`), cần review
> trước khi dùng làm cơ sở chia team/module thật.

## Hai nhóm thư mục gốc

Tổ chức mã nguồn theo domain, không theo công nghệ. Root chia thành hai khu vực có
vòng đời khác nhau:

- **`platform/`** — Business Domain (Control Plane), nơi dành 70–80% thời gian phát
  triển.
- **`runtime/`** — WordPress Runtime (Distribution), không chứa logic SaaS.

```
woocommerce-cloud/
├── apps/            # dashboard, api, worker, scheduler, agent, cli
├── packages/        # sdk, types, ui, config, logger, events, workflow
├── platform/        # bounded contexts nghiệp vụ (bên dưới)
├── runtime/         # distribution, wordpress, theme, plugins, mu-plugin, installer
├── infra/           # docker, terraform, ansible, monitoring
├── docs/            # architecture, adr, api, runbooks
├── scripts/
└── .github/
```

## Bounded Context trong `platform/`

- **Identity & Auth** — authentication, users, roles, API keys.
- **Organization** — organizations, teams, membership.
- **Billing & Plans** — subscriptions, plans, invoices, credits, quota.
- **Store Lifecycle** — sites/stores, domains, SSL; nghiệp vụ vòng đời một cửa hàng.
- **Workflow & Operations** — Workflow Engine, Operation (status/progress/retry/rollback),
  Audit Log.
- **Infrastructure (Cluster)** — Cluster Registry, Placement/Scheduler, Node metadata.
- **Commerce Platform** *(Open — ranh giới với Marketplace chưa rõ, xem banner trên)* —
  tích hợp nghiệp vụ thương mại cấp SaaS (không phải WooCommerce runtime): integrations
  liên quan billing/plan.
- **Marketplace** *(Open — có thể là subdomain của Commerce Platform thay vì bounded
  context riêng)* — plugin/theme packs, review, version, rollout.
- **Analytics & Audit** — analytics, audit logs, reporting.
- **AI & Integrations** — AI services, ERP/CRM/shipping/payment integrations (giai đoạn
  sau Production).
- **Notifications** — email, webhook, thông báo hệ thống.

Các context giao tiếp qua **Event Bus** và **Application Service**, tránh gọi trực tiếp
lẫn nhau. Ví dụ: `StoreCreated` → Analytics, Billing, Email, AI đều subscribe độc lập,
không ai gọi thẳng ai.

## `runtime/` — không phải business domain

```
runtime/
├── distribution/    # bundle version hoá: wordpress + woocommerce + theme + plugin + manifest.json
├── wordpress/
├── theme/
├── plugins/          # core plugin set (không cho user upload tuỳ ý)
├── mu-plugin/         # platform-core, REST API nội bộ
├── installer/
└── migrations/
```

`runtime/` không biết Billing, Subscription, User SaaS — chỉ biết WordPress Core API.
Ranh giới này được giữ nghiêm ngặt để hai phía có vòng đời phát hành độc lập (xem
`04-Runtime.md`).

## Nguyên tắc áp dụng

- Mỗi bounded context sở hữu dữ liệu của riêng nó (database-per-context về mặt logic
  trong PostgreSQL, dù chung một instance ở giai đoạn đầu).
- Không có context nào trong `platform/` được phép biết chi tiết triển khai WordPress —
  chúng chỉ gọi qua `AgentClient`/`WordPressClient` (packages/sdk).
- `runtime/` không phụ thuộc ngược lại `platform/` dưới bất kỳ hình thức nào.
