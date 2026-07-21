# Executive Summary

## Mục tiêu

Xây dựng một **WooCommerce Cloud Platform** — nền tảng SaaS kiểu Shopify nhưng dùng
WordPress/WooCommerce làm engine vận hành cửa hàng. Không phải WordPress hosting,
không phải "thêm billing vào WordPress". WordPress chỉ là **Runtime**, còn Platform
mới là sản phẩm.

## Mô hình 3 Plane

- **Control Plane (NestJS)** — bộ não nghiệp vụ: Auth, Organizations, Billing, Plans,
  Workflow Engine, Scheduler, Cluster Registry, Marketplace, Feature Flags, Analytics,
  Audit. Không lưu dữ liệu WordPress (products/orders/posts).
- **Management Plane (Go Agent)** — chạy native (systemd, không Docker) trên từng node
  của Runtime Cluster. Nhận Operation từ Control Plane, thực thi hạ tầng: provision,
  backup/restore, SSL, deploy, metrics. Không chứa business logic.
- **Runtime Plane (Data Plane)** — WordPress Multisite + WooCommerce + HyperDB + MySQL
  Pool, đóng gói thành **Distribution** (artifact có version). Đây là nơi website
  khách hàng thực sự chạy.

Nguyên tắc xuyên suốt: Control Plane không bao giờ SSH vào server hay ghi thẳng
database WordPress; mọi thao tác đi qua Go Agent → MU Platform Plugin → WordPress
Core API.

## Roadmap ưu tiên: Runtime-first

Quyết định kiến trúc quan trọng nhất (xem ADR-001): **xây Runtime trước, SaaS sau**,
vì phần rủi ro kỹ thuật lớn nhất nằm ở WordPress Runtime (multisite, HyperDB, PHP-FPM,
WooCommerce ở quy mô hàng trăm–hàng nghìn store), không phải ở NestJS.

Thứ tự 11 phase (chi tiết ở `13-Roadmap.md`):

1. Architecture (thiết kế, không code)
2. Runtime Distribution (WordPress + WooCommerce + Theme + Plugin, deploy 1 cluster)
3. MU Plugin (API nội bộ)
4. Go Agent (quản lý hạ tầng, REST test bằng Postman/CLI)
5. Provisioning (workflow tạo store hoàn chỉnh, chưa cần SaaS)
6. Stress Test (100 → 1000 site, tìm giới hạn thật)
7. Multi Cluster (Cluster Registry, đăng ký nhiều cluster)
8. SaaS Core (Auth, Organization, Billing, Dashboard — lúc này NestJS rất nhẹ)
9. Workflow Engine (Operation có status/progress/retry/rollback)
10. Domain & SSL (tự động hoá domain + Let's Encrypt)
11. Production (monitoring, backup, rolling update, disaster recovery)

Sau Production mới đến Marketplace, AI Services, ERP/CRM Integration, Enterprise (HA,
multi-region, dedicated cluster) — các hạng mục này nằm ngoài phạm vi MVP.

## Vì sao đảo ngược thứ tự thông thường

Cách làm truyền thống (xây SaaS trước, gắn Runtime sau) khiến toàn bộ giả định về
khả năng của WordPress chỉ được kiểm chứng ở giai đoạn cuối — quá muộn để sửa kiến
trúc. Bằng cách đóng băng **API Contract** giữa Agent và SaaS sau khi Runtime đã được
stress-test, SaaS trở thành lớp điều phối mỏng, không phải nơi gánh rủi ro kỹ thuật.
