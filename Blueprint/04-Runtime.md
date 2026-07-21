# Runtime

> **Runtime Topology (Open — Preferred Direction: Multisite, xem ADR-005):** Runtime
> triển khai từ Phase 1 theo WordPress Multisite, nhưng ADR-005 vẫn ở trạng thái Open —
> chỉ chuyển Accepted sau khi đạt đủ Exit Criteria (spike 500–1000 site, isolation
> benchmark, restore-per-store test, plugin compatibility matrix). Mọi code phụ thuộc
> topology phải nằm sau WordPress Adapter để có thể đổi hướng mà không ảnh hưởng
> SaaS/Agent.

## Khái niệm Distribution

Distribution là **đơn vị phát hành** của Runtime — một bundle đã đóng gói và có
version, tương tự một Docker image, một bản "Ubuntu Server", hoặc "Laravel Starter Kit".
Mỗi store mới được tạo bằng cách clone một Distribution đã kiểm thử, không cài từng
plugin riêng lẻ.

```
Commerce Distribution 1.0.0
├── WordPress 6.x
├── WooCommerce 10.x
├── Store Theme 1.0.0
├── Core Plugin Set (Redis Cache, SEO, Image Optimization, SMTP, Security, Analytics,
│                     Platform Connector, Backup Client)
├── MU Platform Plugin 1.0.0
├── Default / Performance / Security Config
└── manifest.json
```

Ví dụ `manifest.json`:

```json
{
  "distribution": "commerce-basic",
  "version": "1.0.0",
  "wordpress": "6.9",
  "woocommerce": "10.2"
}
```

## Vì sao đóng gói thành Distribution (xem thêm ADR-004)

- Không phụ thuộc tải plugin/theme từ WordPress.org khi provisioning — nhanh, ổn định.
- Mọi store mới sinh ra từ cùng một bản đã kiểm thử → hành vi nhất quán.
- Dễ rollback nếu bản phát hành mới lỗi.
- Control Plane chỉ cần biết **tên + version Distribution**, không cần biết plugin cụ
  thể bên trong (SaaS không gọi WooCommerce hay RankMath trực tiếp, chỉ biết "Capability").
- Về sau hỗ trợ nhiều Distribution khác nhau (Fashion, Electronics, Wholesale...) mà
  không đổi kiến trúc nền tảng.

## Runtime Cluster

```
Cluster HK-01
├── Node-01: Go Agent, Caddy, PHP-FPM, Redis, WordPress Multisite, HyperDB
├── Node-02: Go Agent, PHP-FPM, WordPress
└── Database Pool: MySQL-A, MySQL-B, MySQL-C
```

Một Cluster có thể có một hoặc nhiều Node; mỗi Node đều chạy Go Agent riêng, tự đăng
ký (self-registration) và gửi Node Manifest khai báo capability:

```json
{
  "nodeId": "wp-hk-01",
  "capabilities": { "wordpress": true, "multisite": true, "hyperdb": true, "ssl": true },
  "versions": { "wordpress": "6.9", "php": "8.4", "agent": "1.2.0" }
}
```

Nhờ Node Manifest, Scheduler chỉ phân site mới vào node đủ khả năng, biết node nào cần
nâng cấp, và có thể rolling-update Agent/MU Plugin theo từng node.

## Tính độc lập của Runtime khỏi SaaS

Đây là nguyên tắc thiết kế quan trọng nhất của Runtime: **một Cluster sau khi cài đặt
xong phải tự hoạt động được, không cần Control Plane đang chạy.**

Cụ thể, sau khi cài Go Agent + Distribution + MU Platform Plugin, có thể:

- Tạo / xoá / backup store bằng CLI hoặc gọi REST của Agent trực tiếp (Postman, script).
- Cấp SSL, theo dõi health, chạy WP-CLI cho tác vụ quản trị (`wp core update`,
  `wp search-replace`, `wp cron event run`).

Lợi ích:

- Runtime được kiểm thử và tối ưu độc lập (stress test) *trước khi* xây SaaS.
- API giữa SaaS và Runtime được đóng băng sớm (API Contract), hai phía phát triển
  song song mà không phá vỡ nhau.
- Về sau có thể hỗ trợ thêm runtime khác (Magento, OpenCart...) chỉ bằng cách viết
  thêm Adapter + Agent, không phải sửa Control Plane.

## Distribution KHÔNG chứa

Billing, Subscription, User SaaS, Marketplace logic, Dashboard, UI quản trị SaaS —
tất cả những thứ này thuộc `platform/`.
