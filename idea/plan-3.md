Đây là phần quan trọng nhất. Theo mình, **đừng kết nối các thành phần theo kiểu point-to-point**, mà hãy xây theo mô hình **Control Plane ↔ Management Plane ↔ Data Plane**.

Nếu triển khai thật, sơ đồ sẽ như sau:

```text
                          Internet
                              │
                              ▼
                    panel.example.com
                    (SaaS Control Plane)
                              │
               ┌──────────────┼──────────────┐
               │              │              │
         PostgreSQL        Redis         Object Storage
         (SaaS DB)        BullMQ         (Artifacts)
               │
               │ HTTPS + JWT
               ▼
──────────────────────────────────────────────────────────────

              Cluster HK-01

        Go Agent (Management Plane)
               │
     ┌─────────┼──────────┐
     │         │          │
     ▼         ▼          ▼
 WordPress   Caddy      System
 MU Plugin   API        (Linux)

               │
          HyperDB
               │
      ┌────────┴────────┐
      │                 │
   MySQL-01         MySQL-02
```

Điểm quan trọng:

> **SaaS chỉ giao tiếp với Go Agent.**

Không bao giờ:

* SSH vào server
* Gọi MySQL trực tiếp
* Gọi WordPress trực tiếp từ SaaS

---

# Luồng kết nối

## 1. Agent → SaaS

Luôn là outbound HTTPS.

```text
Go Agent

↓

POST /heartbeat

↓

SaaS
```

Không cần mở inbound port.

---

## 2. Agent → WordPress

Local.

Ví dụ

```text
localhost

↓

REST API
```

hoặc

```bash
wp-cli
```

hoặc

```php
wpmu_create_blog()
```

Agent không đi qua Internet.

---

## 3. Agent → Caddy

Local.

```text
localhost:2019
```

Reload config.

---

## 4. Agent → Linux

Ví dụ

```text
systemctl

journalctl

mysqldump
```

---

## 5. Agent → HyperDB

Không trực tiếp.

Agent chỉ gọi

```text
WordPress

↓

HyperDB
```

---

# SaaS không biết WordPress

Ví dụ

User

↓

Create Site

↓

NestJS

↓

Scheduler

↓

Agent

↓

WordPress

↓

Done.

SaaS không gọi

```php
wpmu_create_blog()
```

---

# Agent không biết Billing

Agent không biết:

* Stripe
* Subscription
* User
* Payment

Chỉ biết

```text
Create Site

Install Plugin

Backup

SSL
```

---

# MU Plugin không biết SaaS

MU Plugin cũng không biết

```text
Billing

Credit

Subscription
```

Chỉ biết

```text
WordPress API
```

---

# Scheduler

Scheduler cũng không gọi Agent.

Nó chỉ tạo Job.

```text
Scheduler

↓

BullMQ

↓

Database

↓

Pending Job
```

Agent tự lấy.

---

# Job Flow

```text
Create Site

↓

BullMQ

↓

Job Table

↓

Agent Poll

↓

Execute

↓

Complete
```

Không Push.

---

# Deployment Flow

Ví dụ

Update Plugin.

```text
GitHub

↓

Action

↓

Artifact

↓

Object Storage

↓

SaaS

↓

Create Deploy Job

↓

Agent

↓

Download

↓

Install

↓

Done
```

---

# SSL Flow

```text
User

↓

Add Domain

↓

SaaS

↓

Verify DNS

↓

Issue Job

↓

Agent

↓

ACME

↓

Install

↓

Reload Caddy
```

---

# Backup

```text
Backup Job

↓

Agent

↓

mysqldump

↓

Compress

↓

Upload R2
```

---

# Monitoring

```text
Agent

↓

Heartbeat

↓

Metrics

↓

Dashboard
```

---

# Nếu nhiều Cluster

```text
                    SaaS

           PostgreSQL + Redis

                  │

       ┌──────────┼───────────┐

       │          │           │

      HK01       HK02        SG01

       │          │           │

    Agent      Agent      Agent

       │          │           │

 WordPress  WordPress  WordPress
```

Mỗi Agent hoàn toàn độc lập.

---

# Nếu Cluster có nhiều Node

Đây là lúc xuất hiện tầng thứ hai.

```text
Cluster HK01

├── Node-01
│     └── Agent
│
├── Node-02
│     └── Agent
│
└── Node-03
      └── Agent
```

SaaS quản lý Cluster.

Cluster quản lý Node.

---

# Authentication

Register

↓

```text
Registration Token
```

↓

JWT

↓

Refresh

↓

Rotate.

---

# Object Storage

Mình sẽ dùng chung cho toàn Platform.

```text
Object Storage

├── agent/

├── plugin/

├── theme/

├── backup/

├── releases/

└── logs/
```

Agent tải từ đây.

---

# Service Discovery

Không hardcode IP.

SaaS chỉ lưu

```text
clusters

nodes
```

Ví dụ

```text
Node

id

hostname

version

status

capabilities
```

Agent tự Register.

---

# Mô hình kết nối cuối cùng

```text
                              GitHub
                                 │
                           GitHub Actions
                                 │
                          Build Artifacts
                                 │
                          Object Storage
                                 │
                                 ▼
                    ┌──────────────────────┐
                    │    SaaS Platform     │
                    │                      │
                    │ NestJS              │
                    │ Scheduler           │
                    │ Billing             │
                    │ PostgreSQL          │
                    │ Redis/BullMQ        │
                    └─────────┬────────────┘
                              │
                   HTTPS + JWT│
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
          ▼                   ▼                   ▼
    Cluster HK01        Cluster HK02       Cluster SG01
          │                   │                   │
      Go Agent           Go Agent           Go Agent
          │                   │                   │
   ┌──────┴──────┐     ┌──────┴──────┐     ┌──────┴──────┐
   │ WordPress   │     │ WordPress   │     │ WordPress   │
   │ MU Plugin   │     │ MU Plugin   │     │ MU Plugin   │
   │ HyperDB     │     │ HyperDB     │     │ HyperDB     │
   └─────────────┘     └─────────────┘     └─────────────┘
```

## Theo mình còn thiếu một thành phần rất quan trọng: **Artifact Repository**

Thay vì để Agent tải trực tiếp từ GitHub Releases, mình sẽ thêm một tầng trung gian:

```text
GitHub Actions
        │
        ▼
 Artifact Repository (S3/R2/MinIO)
        │
        ▼
      SaaS
        │
        ▼
     Go Agent
```

Artifact Repository sẽ chứa:

* Agent binary.
* MU Plugin ZIP.
* Theme ZIP.
* Plugin ZIP.
* Installer.
* Checksums (SHA-256).
* Metadata (version, release notes...).

SaaS chỉ lưu **metadata** và phát Job, còn Agent tải artifact từ Object Storage gần nhất (hoặc qua CDN nếu cần). Điều này giúp:

* Không phụ thuộc GitHub khi triển khai.
* Tăng tốc cập nhật cho nhiều cluster.
* Kiểm soát version và rollback tốt hơn.
* Dễ chuyển sang hạ tầng riêng trong tương lai.

Đây là mô hình mình sẽ chọn nếu xây dựng một nền tảng WordPress SaaS có định hướng vận hành lâu dài và mở rộng quy mô.
