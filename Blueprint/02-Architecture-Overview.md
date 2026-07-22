# Architecture Overview

## Ba Plane

### 1. Control Plane (NestJS)

Bộ não nghiệp vụ. Chứa toàn bộ business logic:

```
Auth · Users · Organizations · Billing · Plans · Subscriptions
Workflow Engine · Operations · Scheduler/Placement · Cluster Registry
Marketplace · Feature Flags · Analytics · Audit · Notifications
```

Lưu trữ: PostgreSQL + Redis + BullMQ + Object Storage (Artifact Repository).
Không lưu `wp_posts`, `wp_options`, orders, products — đó là dữ liệu của Runtime Plane.

### 2. Management Plane (Go Agent)

Chạy **native** (systemd) trên từng Node của Runtime Cluster — không container hoá
(xem ADR-002). Module: Heartbeat, Workflow Runner, WordPress Adapter, SSL, Backup,
Restore, Deploy, Metrics, Filesystem, Artifact. Không chứa business logic, chỉ thực thi
lệnh hạ tầng nhận từ Control Plane.

### 3. Runtime Plane / Data Plane (WordPress)

```
WordPress Multisite + WooCommerce + MU Platform Plugin
Shared Theme + Shared Plugins (đóng gói thành Distribution)
Database Router (routing) + MySQL Pool
PHP-FPM + Redis Object Cache + Caddy/Nginx
```

Đây là nơi xử lý request thật của khách truy cập website. Runtime có thể vận hành
độc lập (tạo/xoá/backup store qua CLI hoặc REST của Agent) mà không cần Control Plane
đang chạy — xem `04-Runtime.md`.

## Sơ đồ luồng tổng thể (text)

```
Users
  │
  ▼
React Dashboard (SPA)
  │
  ▼
NestJS Control Plane ───────────────────────────────┐
  │  Auth/Billing/Workflow/Scheduler/Marketplace/... │
  ▼                                                  │
PostgreSQL + Redis + BullMQ + Object Storage         │
  │                                                  │
  ▼                                                  │
Cluster Registry ──► chọn Cluster (Scheduler)        │
  │                                                  │
  ▼  HTTPS + JWT (outbound từ Agent, không SSH)       │
Go Agent (Management Plane, mỗi Node)                │
  │  Workflow Runner / WordPress Adapter / SSL / ...  │
  ▼  REST nội bộ trên 127.0.0.1                       │
MU Platform Plugin (Data Plane SDK)                  │
  │  gọi WordPress Core API (wpmu_create_blog, ...)   │
  ▼                                                  │
WordPress Multisite + WooCommerce                    │
  │                                                  │
  ▼                                                  │
Database Router ──► MySQL Pool (Database A/B/C...) ◄─────────┘
```

## Nguyên tắc kết nối bắt buộc

- **Control Plane chỉ nói chuyện với Go Agent**, không bao giờ SSH, không gọi MySQL
  hay WordPress REST trực tiếp (xem ADR-003).
- **Agent → Control Plane luôn là outbound HTTPS** (heartbeat, poll job) — không cần
  mở inbound port vào Cluster.
- **Agent → WordPress luôn local** (localhost REST tới MU Plugin), không đi qua Internet.
- Mọi tác vụ dài đều là **Operation/Workflow** (BullMQ), có retry/rollback/audit — không
  có request nào chạy đồng bộ hàng chục giây.

## Một Cluster gồm nhiều Node

```
Cluster HK-01
├── Node-01: Go Agent, Caddy, PHP-FPM, Redis, WordPress, Database Router
├── Node-02: Go Agent, PHP-FPM, WordPress
└── Database Pool: MySQL-A, MySQL-B, MySQL-C
```

Cluster Registry ở Control Plane chỉ lưu metadata (health, capacity, capabilities,
version) — không hardcode IP; Agent tự đăng ký (self-registration) khi khởi động.
