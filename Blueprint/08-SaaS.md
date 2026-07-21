# SaaS (Control Plane)

## Stack

```
NestJS (API Gateway + Modules)
PostgreSQL (dữ liệu SaaS — không lưu wp_posts/wp_options/orders/products)
Redis + BullMQ (queue, workflow)
React + Vite Dashboard (SPA, chỉ gọi NestJS, không bao giờ gọi WordPress/Agent trực tiếp)
Object Storage (Artifact Repository)
```

## Module nghiệp vụ

```
Authentication          Billing & Plans          Workflow Engine
Users                   Subscriptions             Operations
Organizations · Teams   Payments · Invoices        Scheduler / Placement
Roles                   Credits                    Cluster Registry
Domains                 Coupons                    Marketplace
SSL                     Quotas                      Feature Flags
API Keys                Notifications               Analytics
Webhooks                Audit Logs                  AI (giai đoạn sau)
Settings
```

Đây là nơi chứa **toàn bộ business logic** của nền tảng. Deploy bằng Docker
(api, worker, scheduler, redis, postgres), CI/CD qua GitHub Actions.

## Nguyên tắc thiết kế nội bộ NestJS

- Tổ chức theo module (`modules/auth`, `modules/billing`, `modules/sites`,
  `modules/domains`, `modules/ssl`, `modules/wordpress`, `modules/workflows`...), không
  gộp thành một project khối lớn.
- **Event Bus** (Accepted — xuất hiện nhất quán trong nguồn): `SiteCreatedEvent →
  {Billing, Notification, Analytics, Audit}`. Các module không gọi trực tiếp nhau, chỉ
  subscribe event.
- **Command Bus / mô hình CQRS cụ thể trong NestJS** (`CreateSiteCommand →
  CreateSiteHandler → BullMQ Job`) *(Proposed — xem `DOC-STATUS.md`)*: đây là một cách
  hiện thực hoá Event Bus bằng pattern CQRS của NestJS, chỉ được đề xuất một lần ở bản
  nháp sớm (`idea/idea2.md`), không được các bản tổng hợp sau (`plan-11`/`plan-12`)
  nhắc lại như một quyết định — có thể thay bằng cách tổ chức module/event khác miễn
  giữ nguyên tắc "không gọi trực tiếp giữa module".
- Mọi lời gọi tới Runtime đi qua hai client thống nhất, không rải rác endpoint khắp
  code:
  - `WordPressClient` (createSite, deleteSite, createUser, activatePlugin, switchTheme...)
  - `AgentClient` (createDatabase, backupDatabase, issueSSL, reloadProxy, getSystemStatus...)

  Nếu sau này đổi REST sang **gRPC** *(Proposed — xem `DOC-STATUS.md`; nguồn `idea3.md`
  chỉ nhắc "REST hoặc gRPC" như một khả năng, chưa chốt)*, chỉ cần sửa trong hai client
  này.

## Scheduler / Placement

Khi tạo store, Scheduler chọn Cluster/Database theo điểm số (capacity score), không
random. Tiêu chí: Region, CPU, RAM, Disk, PHP Workers, MySQL/Database load, Redis,
Plan, Capabilities, Version, Maintenance window, Cost.

Scheduler không chỉ đặt store mới: nó theo dõi tải theo từng store (CPU, RAM, orders,
traffic từ heartbeat Agent) và khi một store vượt ngưỡng đủ lâu thì tạo
`Operation: MigrateStore` chuyển store sang cluster/tier phù hợp (Enterprise/Dedicated)
— chiến lược chống noisy neighbor, xem ADR-005 mục NFR. Cluster có **Tier** với mật độ
store khác nhau theo gói (Basic/Pro/Enterprise/Dedicated — con số cụ thể Proposed).

## Cluster Registry

Control Plane chỉ lưu metadata, không hardcode IP:

```
clusters: id, host, region, cpu, memory, site_count, status, capabilities, weight
nodes:    id, hostname, version, status, capabilities
```

Agent tự đăng ký (self-registration) khi khởi động và gửi heartbeat định kỳ.

## Marketplace (sau MVP)

```
Plugin/Theme submit → Review → Approved → Artifact → Version → Deploy (qua Agent)
```

Không cho user tự upload plugin tuỳ ý trong giai đoạn đầu — chỉ Distribution đã kiểm
thử. Marketplace được xây sau khi Runtime + Provisioning đã ổn định (xem `13-Roadmap.md`).

## Bảo mật

- JWT + refresh token cho Auth giữa Dashboard ↔ NestJS và giữa Agent ↔ NestJS.
- RBAC cho phân quyền nội bộ.
- Không SSH, không DB Direct — nhắc lại nguyên tắc xuyên suốt toàn nền tảng (ADR-003).
