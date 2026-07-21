Sau toàn bộ các trao đổi, mình sẽ tổng kết thành một kiến trúc hoàn chỉnh. Nếu bắt đầu lại từ đầu, đây là mô hình mình sẽ xây.

# Mục tiêu

Xây dựng một nền tảng **WordPress SaaS** có khả năng:

* Quản lý hàng trăm đến hàng nghìn website.
* Dùng chung codebase WordPress.
* Dùng chung plugin, theme.
* Database có thể mở rộng theo chiều ngang.
* Quản lý user, organization, billing.
* Tự động cấp domain và SSL.
* Có Marketplace, AI, Analytics.
* Có thể mở rộng nhiều Cluster.

---

# Kiến trúc tổng thể

```text
                                Internet
                                    │
                                    ▼
                           React + Vite Dashboard
                                    │
                                    ▼
                           NestJS SaaS Platform
                                    │
      ┌─────────────────────────────┼─────────────────────────────┐
      │                             │                             │
      ▼                             ▼                             ▼
 Authentication               Billing & Plans              Workflow Engine
 Users & Organizations        Payments                    Operations
 Domains                      Quotas                      Scheduler
 SSL                          Marketplace                 Notifications
 AI                           Analytics                   Audit Logs
      │
      ▼
 PostgreSQL + Redis + BullMQ + Object Storage
      │
      ▼
 Placement / Cluster Registry / Event Bus
      │
 ┌────┴──────────────┬──────────────┬──────────────┐
 ▼                   ▼              ▼              ▼
Cluster HK01     Cluster HK02   Cluster SG01   Cluster US01
```

---

# Ba lớp (Three Planes)

## 1. Control Plane (SaaS)

Đây là trung tâm điều khiển.

Chứa toàn bộ Business Logic.

```text
Users

Organizations

Billing

Plans

Payments

Workflow

Operations

Scheduler

Marketplace

Domains

SSL

Notifications

Audit

Analytics

API

Dashboard
```

Không chứa WordPress.

Không chứa MySQL của website.

---

## 2. Management Plane (Go Agent)

Chạy trên mọi Node.

```text
Heartbeat

Job Runner

Deployment

Backup

Restore

SSL

Monitoring

Filesystem

System

WP Client
```

Agent nhận Job từ SaaS.

Agent điều khiển WordPress.

---

## 3. Data Plane (WordPress)

```text
WordPress Multisite

HyperDB

MU Platform Plugin

Shared Themes

Shared Plugins

Redis

PHP

Caddy
```

Đây là nơi chạy website.

---

# Một Cluster

```text
Cluster HK01

├── Node-01
│      ├── Go Agent
│      ├── Caddy
│      ├── PHP-FPM
│      ├── WordPress
│      └── HyperDB
│
├── Node-02
│      ├── Go Agent
│      └── WordPress
│
└── Database Pool
       ├── MySQL-A
       ├── MySQL-B
       └── MySQL-C
```

Một Cluster có thể có một hoặc nhiều Node.

Mỗi Node đều chạy Agent.

---

# Luồng tạo Website

```text
User
 │
 ▼
Dashboard
 │
 ▼
NestJS
 │
 ▼
Workflow Engine
 │
 ▼
Placement Service
 │
 ▼
Chọn Cluster
 │
 ▼
BullMQ
 │
 ▼
Go Agent
 │
 ▼
Workflow Executor
 │
 ├── Allocate Database
 ├── Create WordPress Site
 ├── Configure Theme
 ├── Activate Plugins
 ├── Add Domain
 ├── Issue SSL
 ├── Verify
 └── Complete
 │
 ▼
Dashboard cập nhật realtime
```

Người dùng không biết website nằm ở Cluster nào.

---

# Scheduler

Scheduler chọn theo nhiều tiêu chí:

```text
Region

Capacity

CPU

Memory

Disk

PHP Workers

Database Load

Plan

Capabilities

Cost

Maintenance
```

Không random.

---

# HyperDB

HyperDB chỉ làm Routing.

```text
WordPress

↓

HyperDB

↓

MySQL Pool
```

Không tạo Database.

Không Replication.

Không Sharding.

---

# Database Pool

Ví dụ:

```text
Cluster HK01

↓

MySQL-A

↓

Database A

↓

Site 1-100

↓

MySQL-B

↓

Database B

↓

Site 101-200

↓

MySQL-C

↓

Database C

↓

Site 201-300
```

Khi đầy.

↓

Tạo Database mới.

↓

HyperDB Mapping cập nhật.

---

# Go Agent

Không chứa Business Logic.

Chỉ Infrastructure.

```text
Heartbeat

Jobs

Metrics

SSL

Backup

Restore

Filesystem

WP Client

Updater
```

---

# MU Platform Plugin

Không có UI.

Không Billing.

Không Dashboard.

Chỉ API.

```text
Create Site

Delete Site

Users

Plugins

Themes

Settings

Health

Media
```

Bên trong gọi WordPress Core API.

---

# Deployment

## SaaS

Docker.

```text
api

worker

scheduler

postgres

redis
```

CI/CD từ GitHub.

---

## WordPress Node

Native.

```text
systemd

↓

Agent

↓

WordPress

↓

PHP

↓

Caddy
```

Không Docker.

---

# Giao tiếp

```text
SaaS

↓

HTTPS

↓

Go Agent

↓

Local API

↓

MU Plugin

↓

WordPress Core
```

Không SSH.

Không truy cập MySQL trực tiếp.

---

# Workflow Engine

Mọi thao tác đều là Workflow.

```text
Create Site

Delete Site

Clone

Backup

Restore

SSL

Deploy Plugin

Deploy Theme

Update Core
```

Mỗi Workflow gồm nhiều Step.

Có:

* Progress.
* Retry.
* Rollback.
* Audit.

---

# Event Bus

Ví dụ:

```text
Site Created

↓

Analytics

↓

Billing

↓

Email

↓

AI
```

Không để các Service gọi trực tiếp lẫn nhau.

---

# Artifact Repository

Chứa:

```text
Agent

Plugin

Theme

MU Plugin

Installer

Checksums
```

Agent tải từ đây.

Không tải GitHub trực tiếp.

---

# CI/CD

```text
GitHub

↓

Actions

↓

Build

↓

Artifact

↓

Object Storage

↓

Deploy Job

↓

Go Agent

↓

Rolling Update
```

---

# Monorepo giai đoạn đầu

```text
platform/

├── apps/
│   ├── saas-api
│   ├── saas-web
│   ├── wp-agent
│   ├── wp-platform
│   └── installer
│
├── packages/
├── services/
├── infra/
├── docs/
├── scripts/
└── .github/
```

Sau này có thể tách repo.

---

# Điểm khác biệt so với WordPress.com

Thay vì coi WordPress là "nền tảng", hãy coi WordPress là **Execution Engine**.

```text
               SaaS
         (Business Logic)

              │

          Go Agent
      (Infrastructure)

              │

         WordPress
     (Execution Engine)
```

Điều này giúp:

* Thay đổi Business Logic mà không phụ thuộc WordPress.
* Thêm AI, Marketplace, Billing, CRM... mà không sửa WordPress nhiều.
* Có thể hỗ trợ nhiều loại workload trong tương lai, không chỉ WordPress.

---

# Roadmap triển khai

### Phase 1 – MVP

* SaaS (NestJS + React).
* Một WordPress Cluster.
* Go Agent.
* MU Platform Plugin.
* Workflow tạo website.
* Domain và SSL tự động.

### Phase 2 – Multi-Cluster

* Scheduler.
* Placement Service.
* HyperDB.
* Database Pool.
* Monitoring.
* Backup/Restore.

### Phase 3 – SaaS hoàn chỉnh

* Billing.
* Marketplace.
* Plugin/Theme Deployment.
* Quota.
* Audit Log.
* Notifications.
* API Keys.

### Phase 4 – Enterprise

* Auto Scaling.
* Multi-Region.
* Object Storage.
* CDN.
* Observability (Metrics, Logs, Traces).
* AI Services.
* High Availability.

---

## Kiến trúc cuối cùng

```text
                           Users
                              │
                     React + Vite SPA
                              │
                      NestJS API Gateway
                              │
     ┌────────────────────────┼────────────────────────┐
     │                        │                        │
 Authentication         Workflow Engine          Billing
 Domains                Scheduler               Marketplace
 SSL                    Operations              Analytics
 AI                     Event Bus               Notifications
     │
 PostgreSQL + Redis + BullMQ + Object Storage
     │
 Cluster Registry + Placement Service
     │
 ┌───┴───────────────┬────────────────┬────────────────┐
 │                   │                │
 ▼                   ▼                ▼
Cluster HK01     Cluster SG01     Cluster US01
 │                   │                │
Go Agent         Go Agent         Go Agent
 │                   │                │
MU Plugin        MU Plugin        MU Plugin
 │                   │                │
WordPress        WordPress        WordPress
 │                   │                │
HyperDB          HyperDB          HyperDB
 │                   │                │
MySQL Pool       MySQL Pool       MySQL Pool
```

Nếu triển khai theo kiến trúc này, bạn sẽ có một nền tảng có các đặc điểm:

* **Điều khiển tập trung**: mọi logic nghiệp vụ nằm trong SaaS.
* **Thực thi phân tán**: mỗi Cluster tự xử lý website của mình thông qua Agent.
* **Mở rộng theo chiều ngang**: chỉ cần bổ sung Cluster hoặc Node mới và đăng ký với SaaS.
* **Dễ bảo trì**: SaaS, Agent và WordPress có vòng đời phát hành độc lập.
* **Phù hợp với quy mô lớn**: từ vài trăm đến nhiều nghìn website mà không cần thay đổi kiến trúc cốt lõi.
