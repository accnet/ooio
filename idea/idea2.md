Với stack này thì mình sẽ **không để WordPress là trung tâm nữa**, mà để **NestJS trở thành Platform Core**. WordPress chỉ là một trong các "runtime" mà Platform quản lý.

Đây là kiến trúc mình sẽ chọn.

```text
                           Users
                             │
                    React + Vite Dashboard
                             │
                       NestJS API Gateway
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
   Auth/Billing         Site Service       Domain Service
        │                    │                    │
        ├──────────────┬─────┴─────────────┬──────┤
        │              │                   │
  SSL Service     Plugin Service    Workflow Service
        │              │                   │
        └──────────────┴──────────────┬────┘
                                      │
                           Redis + BullMQ
                                      │
                     ┌────────────────┴────────────────┐
                     │                                 │
                WP Agent #1                       WP Agent #2
                     │                                 │
              WordPress Cluster                 WordPress Cluster
              (Multisite+HyperDB)              (Multisite+HyperDB)
```

---

# Module trong NestJS

Thay vì một project lớn, mình sẽ chia theo module.

```
apps/
    api

modules/

    auth/
    users/
    billing/
    plans/

    sites/
    domains/
    ssl/

    wordpress/
    plugins/
    themes/

    workflows/
    queues/

    analytics/
    notifications/
```

NestJS rất hợp với cách tổ chức này.

---

# PostgreSQL

PostgreSQL **không lưu dữ liệu WordPress**.

Chỉ lưu SaaS.

Ví dụ

```
users

plans

subscriptions

sites

domains

clusters

jobs

plugin_modules

audit_logs

api_keys
```

Không bao giờ lưu

```
wp_posts
```

hay

```
wp_options
```

---

# Redis + BullMQ

BullMQ sẽ là xương sống.

Ví dụ Queue

```
site.create

site.delete

site.clone

ssl.issue

ssl.renew

backup.run

plugin.install

theme.switch

domain.verify
```

Một request tạo site sẽ chỉ tạo Job.

Không chạy ngay.

---

# Workflow

Ví dụ

```
CreateSiteWorkflow

1 Check Plan

2 Allocate Cluster

3 Create Blog

4 Create Database

5 Register HyperDB

6 Install Theme

7 Install Plugins

8 Create Admin

9 Return URL
```

Nếu bước 6 lỗi.

Workflow retry.

Không rollback bằng tay.

---

# WordPress Agent

Mình sẽ viết Agent bằng Go (hoặc Node nếu bạn muốn đồng nhất TypeScript).

Agent expose API nội bộ:

```
POST /site/create

POST /site/delete

POST /plugin/install

POST /plugin/update

POST /ssl/reload

POST /backup

GET /health
```

Agent gọi:

* WP-CLI
* REST API
* System API

Không để NestJS SSH vào server.

---

# Cluster

NestJS biết Cluster nào còn tài nguyên.

Ví dụ

```
clusters

id

host

cpu

memory

sites

status
```

Create Site

↓

Allocate

↓

Cluster #3

↓

Agent

↓

Done

Sau này thêm server mới chỉ cần thêm một cluster vào bảng.

---

# Plugin Service

Đây là phần rất hay.

Ví dụ

```
Plugin Module

WooCommerce

SEO

Analytics

AI

Backup
```

NestJS chỉ biết Module.

Không biết plugin.

Adapter sẽ map:

```
SEO

↓

RankMath
```

hoặc

```
SEO

↓

Yoast
```

---

# Event

Mình sẽ dùng Event-driven.

```
SiteCreated

↓

PluginInstalled

↓

SSLIssued

↓

BackupCompleted
```

Các module không gọi nhau trực tiếp.

Ví dụ

```
Billing

↓

PlanChanged Event

↓

Plugin Service

↓

Disable Plugin
```

---

# React Dashboard

Dashboard chỉ gọi NestJS.

Không gọi WordPress.

```
React

↓

NestJS

↓

Queue

↓

Agent

↓

WordPress
```

---

# Điều mình sẽ thêm

Với stack **NestJS + BullMQ**, mình sẽ thêm một khái niệm là **Command Bus** và **Event Bus** (NestJS hỗ trợ rất tốt qua CQRS).

Ví dụ:

```
CreateSiteCommand
        │
        ▼
CreateSiteHandler
        │
        ▼
BullMQ Job
        │
        ▼
WP Agent
        │
        ▼
SiteCreatedEvent
        │
        ├── Billing Module
        ├── Notification Module
        ├── Analytics Module
        └── Audit Module
```

Điều này có lợi vì:

* Module không phụ thuộc trực tiếp vào nhau.
* Dễ thêm tính năng mới (ví dụ gửi email khi tạo site thành công chỉ cần lắng nghe `SiteCreatedEvent`).
* Workflow rõ ràng và dễ kiểm thử.

## Một điểm mình sẽ thay đổi

Mình sẽ **không để Agent là nơi chứa business logic**.

Phân chia như sau:

* **NestJS**: toàn bộ business logic (billing, plan, phân bổ cluster, workflow, quyền, quota...).
* **BullMQ**: điều phối các tác vụ bất đồng bộ.
* **Agent**: chỉ là executor trên máy chủ, nhận lệnh và thực thi (WP-CLI, quản lý database, SSL, proxy, backup...).
* **WordPress (MU Plugin + Multisite + HyperDB)**: xử lý các thao tác nội bộ của WordPress.

Nhờ vậy Agent luôn "mỏng" và dễ thay thế. Nếu sau này bạn muốn quản lý thêm một loại runtime khác ngoài WordPress, chỉ cần viết một agent mới mà không phải thay đổi các module của NestJS.

Dựa trên những gì mình biết về dự án của bạn (AI Kit, quản lý WordPress quy mô lớn, định hướng SaaS), đây là kiến trúc mình đánh giá là có khả năng mở rộng và bảo trì tốt nhất trong dài hạn.
