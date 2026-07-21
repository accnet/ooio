**Đúng. Go Agent chạy trên chính server của WordPress Cluster.** Đây là mô hình mình khuyến nghị.

Ví dụ:

```text
                WordPress Cluster HK-01

Ubuntu / AlmaLinux
│
├── Go Agent              ← chạy trên server
├── Caddy
├── PHP-FPM
├── Redis
├── WordPress Multisite
├── HyperDB
└── MySQL Client
```

Go Agent được quản lý bởi `systemd`.

```bash
systemctl status platform-agent
```

---

# Tại sao Agent phải chạy cùng server?

Vì Agent cần thực hiện các thao tác mà SaaS không thể làm trực tiếp.

Ví dụ:

## 1. Tạo database

```text
NestJS

↓

Create Site Job

↓

Go Agent

↓

CREATE DATABASE xxx;

↓

Done
```

---

## 2. Reload Caddy

```text
Go Agent

↓

Caddy API

↓

Reload
```

---

## 3. WP-CLI

```text
Go Agent

↓

wp core update

wp plugin install

wp theme activate
```

---

## 4. Backup

```text
Go Agent

↓

mysqldump

↓

Compress

↓

Upload S3/R2
```

---

## 5. Health

```text
Go Agent

↓

CPU

RAM

Disk

PHP

Redis

↓

SaaS
```

---

# Agent không xử lý request web

Người dùng truy cập:

```text
Internet

↓

Caddy

↓

PHP

↓

WordPress
```

Agent **không nằm trên đường đi của request** (out-of-band), nên dù Agent bận tạo site hay backup thì website vẫn hoạt động bình thường.

---

# Một Cluster có nhiều server thì sao?

Ví dụ:

```text
           Load Balancer
                │
     ┌──────────┴──────────┐
     │                     │
 WP Server 1          WP Server 2
     │                     │
  Go Agent             Go Agent
```

Mỗi server đều chạy một Agent.

SaaS quản lý từng Agent.

---

# Nếu chỉ có 1 server

Đơn giản:

```text
WordPress Server

├── Go Agent
├── WordPress
├── PHP
├── Caddy
└── HyperDB
```

---

# Agent giao tiếp với ai?

```text
           SaaS

             ▲
             │ HTTPS
             │
        Go Agent
             │
 ┌───────────┼────────────┐
 │           │            │
 WP-CLI    Caddy      MySQL
 │
 WordPress
```

Agent **không nhận lệnh từ WordPress**.

Agent nhận lệnh từ SaaS.

---

# Có nên chạy Agent trong Docker không?

Theo mình là **không**.

Native sẽ đơn giản hơn nhiều.

```text
systemd

↓

platform-agent
```

Lý do:

* Dễ restart.
* Dễ đọc log (`journalctl`).
* Truy cập trực tiếp filesystem.
* Truy cập socket PHP/Caddy.
* Không cần mount rất nhiều volume.

---

# Khi Cluster có nhiều server

Đây là điểm mình sẽ nâng cấp so với mô hình trước.

Thay vì:

```text
1 Cluster = 1 Server
```

mình sẽ định nghĩa:

```text
1 Cluster = N Server
```

Ví dụ:

```text
                Cluster HK-01

          ┌────────────────────┐
          │  Control Metadata   │
          └────────────────────┘

     ┌──────────────┬──────────────┬──────────────┐
     │              │              │
     ▼              ▼              ▼
 WP-01          WP-02          WP-03
 Agent          Agent          Agent
```

Trong trường hợp này:

* SaaS quản lý **Cluster**.
* Cluster quản lý nhiều **Node** (máy chủ).
* Mỗi **Node** đều chạy **Go Agent**.
* Mỗi Agent chỉ quản lý **máy của mình**.

Điều này mở đường cho việc mở rộng sau này:

* Thêm web server mới vào cluster.
* Rolling update từng node.
* Drain một node để bảo trì.
* Cân bằng tải giữa nhiều PHP server.

## Mô hình phân cấp

```text
SaaS
│
├── Cluster HK-01
│   ├── Node-01 (Go Agent)
│   ├── Node-02 (Go Agent)
│   └── Node-03 (Go Agent)
│
├── Cluster HK-02
│   ├── Node-01 (Go Agent)
│   └── Node-02 (Go Agent)
│
└── Cluster SG-01
    └── Node-01 (Go Agent)
```

Đây là mô hình linh hoạt hơn việc đồng nhất "Cluster = Server", vì sau này bạn có thể mở rộng một cluster theo chiều ngang mà không cần thay đổi kiến trúc điều phối.
