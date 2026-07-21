# Go Agent (Management Plane)

## Triển khai: Native, không Docker

Agent chạy trên chính server WordPress, quản lý bởi **systemd** (`platform-agent.service`),
không container hoá (xem ADR-002). Lý do: dễ restart, dễ đọc log (`journalctl`), truy
cập trực tiếp filesystem và socket PHP-FPM/Caddy, không cần mount nhiều volume.

Agent **không nằm trên đường đi của request web** (out-of-band):

```
Internet → Caddy → PHP-FPM → WordPress   (đường đi request, không có Agent)
```

Nên dù Agent đang bận backup hay provisioning, website vẫn phục vụ traffic bình thường.

## Mô hình Cluster = N Node

Không cố định "1 Cluster = 1 Server". Một Cluster có thể gồm nhiều Node, mỗi Node chạy
một Agent độc lập, chỉ quản lý máy của chính nó:

```
SaaS
│
├── Cluster HK-01
│   ├── Node-01 (Go Agent)
│   ├── Node-02 (Go Agent)
│   └── Node-03 (Go Agent)
└── Cluster SG-01
    └── Node-01 (Go Agent)
```

Mô hình phân cấp này cho phép: thêm web server mới vào cluster, rolling update từng
node, drain một node để bảo trì, cân bằng tải giữa nhiều PHP server — mà không cần đổi
kiến trúc điều phối.

## Outbound-only, Job Polling — không SSH

- **Agent → Control Plane**: luôn là outbound HTTPS (heartbeat, poll job). Không cần
  mở inbound port vào Cluster.
- **Job Flow**: Scheduler chỉ tạo Job trong BullMQ/DB (pending), Agent tự poll và lấy
  job để thực thi — không phải mô hình push.
- Control Plane **không bao giờ** SSH vào server, không gọi MySQL trực tiếp, không gọi
  WordPress REST trực tiếp (xem ADR-003).

## Module trong Agent

```
Agent Core · Authentication · Job Runner · Heartbeat · Metrics
WordPress Adapter · Database · SSL · Storage · Filesystem
WP-CLI · System · Backup · Restore · Updater/Deploy
```

Agent **không chứa business logic** — chỉ là executor hạ tầng. Toàn bộ quyết định
("làm gì, khi nào") thuộc Control Plane; Agent chỉ quyết định "làm như thế nào" trên
máy chủ.

## Khi nào dùng WP-CLI vs Linux command vs API nội bộ MU Plugin

- **WP-CLI**: chỉ cho tác vụ quản trị hệ thống không phù hợp với gọi API — `wp core
  update`, `wp search-replace`, `wp cache flush`, `wp cron event run`.
- **Linux/systemctl/mysqldump**: việc không liên quan WordPress — reload Caddy, restart
  PHP-FPM, backup file.
- **API nội bộ của MU Plugin** (transport cụ thể xem phần trên — Open): mọi thao tác
  thay đổi dữ liệu WordPress (tạo site, tạo user, activate plugin...) — xem
  `07-MU-Plugin.md`.

## Giao tiếp Agent ↔ MU Plugin

```
Go Agent ──(transport chưa chốt)──► MU Plugin (localhost) → wpmu_create_blog()
```

**Giao thức tầng vận chuyển giữa Agent và MU Plugin chưa được chốt (Open — xem
`ADR-003` và `DOC-STATUS.md`).** Hai phương án đang được cân nhắc, không phương án nào
đã được nguồn xác nhận là quyết định cuối:

- **REST qua HTTP trên `127.0.0.1`** — ví dụ `POST http://127.0.0.1/platform/v1/sites`.
  Dễ debug bằng `curl`/Postman, dễ version API, nhưng vẫn mở một cổng HTTP nội bộ.
- **RPC qua Unix Domain Socket (UDS)** hoặc FastCGI bridge — không cần mở cổng HTTP nội
  bộ, giảm bề mặt tấn công, hiệu năng tốt hơn, nhưng khó debug hơn và cần tự định nghĩa
  framing/serialization.

Xem đầy đủ bảng so sánh ưu/nhược và điều kiện chốt quyết định ở
`Blueprint/ADR/ADR-003-No-Direct-DB-No-SSH.md`. Dù chọn phương án nào, Agent cần một
lớp `WordPressClient` đủ trừu tượng để đổi transport không ảnh hưởng phần còn lại của
hệ thống.

## Authentication

- Agent ↔ Control Plane: đăng ký bằng Registration Token → nhận JWT → heartbeat →
  refresh/rotate token định kỳ.
- Agent ↔ MU Plugin (cùng máy): do chỉ chạy trên localhost, có thể dùng Bearer/JWT đơn
  giản hoặc shared secret — không cần OAuth phức tạp.
