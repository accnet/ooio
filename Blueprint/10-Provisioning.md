# Provisioning

## Luồng tạo Store đầy đủ

```
User
  │
  ▼
Dashboard (React)
  │
  ▼
NestJS (nhận request, tạo Command)
  │
  ▼
Workflow Engine (tạo Operation "CreateStore")
  │
  ▼
Scheduler / Placement Service
  │   chọn Cluster theo capacity score (CPU/RAM/Disk/PHP/Region/Plan/Capabilities/Cost)
  ▼
Cluster Registry (xác định Cluster + Node còn khả năng)
  │
  ▼
BullMQ Job (pending) → Go Agent poll job
  │
  ▼
Go Agent (Workflow Runner)
  ├── Allocate / Create Database (HyperDB mapping)
  ├── WordPress Adapter → MU Plugin (REST 127.0.0.1)
  │      └── wpmu_create_blog() → switch_to_blog()
  ├── Activate Distribution (theme + core plugin set)
  ├── Configure (default/performance/security settings)
  ├── Create Admin User
  ├── Add Domain
  ├── Issue SSL (ACME/Let's Encrypt) → Reload Caddy
  └── Verify (health check toàn bộ)
  │
  ▼
Operation "Ready" → Event StoreCreated
  │
  ▼
Dashboard cập nhật realtime
```

Người dùng không biết và không cần biết store nằm ở Cluster nào.

## Domain & SSL — chi tiết

```
User thêm domain
  ↓
Control Plane verify DNS (CNAME/A record, ownership, trùng domain)
  ↓
Lưu domain (id, site_id, hostname, verified, ssl status)
  ↓
Tạo Operation "IssueSSL"
  ↓
Agent → ACME/Let's Encrypt → Issue → Install
  ↓
Reload Caddy
  ↓
Verify
  ↓
Done — WordPress không cần biết SSL tồn tại (transparent với Runtime)
```

## Nguyên tắc thứ tự Database trước Site

Agent luôn tạo database và cập nhật HyperDB mapping **trước**, MU Plugin mới tạo blog
và ghi bảng dữ liệu **sau** — tránh WordPress ghi vào database chưa tồn tại/chưa có
quyền (xem thêm `05-HyperDB.md`).

## Provisioning độc lập với SaaS ở giai đoạn Runtime-first

Theo roadmap ưu tiên (ADR-001), toàn bộ luồng Provisioning ở trên phải chạy được và
được kiểm chứng bằng CLI/script/Postman **trước khi** NestJS Control Plane tồn tại.
Chỉ sau khi luồng này ổn định qua stress test, API Contract mới được đóng băng và
NestJS mới được xây để gọi đúng các endpoint đã kiểm chứng.

## MVP tối thiểu (định nghĩa "xong Provisioning")

Người dùng có thể: đăng ký → chọn gói → bấm "Create Store" → sau vài phút nhận được
cửa hàng WooCommerce có theme + core plugin, domain riêng, HTTPS, quản lý được từ
Dashboard.
