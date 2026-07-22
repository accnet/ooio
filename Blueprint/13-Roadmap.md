# Roadmap

## Nguyên tắc: Runtime-first (xem ADR-001)

Đây là roadmap **duy nhất được chốt**, thay thế mọi bản roadmap khác từng xuất hiện
trong quá trình brainstorm (idea/plan.md, plan-5, plan-6, plan-7, plan-8, plan-9 có số
phase và thứ tự khác nhau — các bản đó chỉ còn giá trị lịch sử, không dùng để tham
chiếu triển khai). Roadmap dưới đây theo đúng thứ tự và nội dung của `plan-11.md` /
`plan-12.md` (nguồn thẩm quyền).

Lý do đảo ngược thứ tự "SaaS trước, Runtime sau" thường thấy: 90% rủi ro kỹ thuật nằm
ở WordPress Runtime (multisite, Database Router, PHP-FPM, WooCommerce ở quy mô lớn), không
phải ở NestJS. Xây Runtime trước giúp de-risk sớm và đóng băng API Contract trước khi
đầu tư vào Control Plane.

## 11 Phase

| # | Phase | Nội dung | Thời gian ước tính |
|---|-------|----------|---------------------|
| 0 | **Architecture** | Không viết code. Domain Model, ERD, API Contract sơ bộ, Workflow, Folder Structure, Coding Standards, Distribution Manifest | 1–2 tuần |
| 1 | **Runtime Distribution** | Một Distribution (WordPress + WooCommerce + Theme + Core Plugins + MU Plugin + Config). Deploy trên 1 Cluster. Kết quả: tạo được 100–300 store bằng WP-CLI/script, chưa cần SaaS | 4–6 tuần |
| 2 | **MU Plugin** | API nội bộ ổn định: Create/Delete Site, Plugin, Theme, Settings, User, Health. Không UI, không Billing, không business logic | 2–3 tuần |
| 3 | **Go Agent** | Heartbeat, Workflow Runner, WordPress Adapter, SSL, Backup, Restore, Metrics, Deploy. Có REST API, test bằng Postman — chưa cần NestJS | 3–4 tuần |
| 4 | **Provisioning** | Hoàn thiện workflow tạo store end-to-end (Allocate DB → Create Site → Theme/Plugin → Domain → SSL → Verify → Ready). Runtime đã vận hành độc lập | 2–3 tuần |
| 5 | **Stress Test** | Test thật với 100 → 300 → 500 → 1000 site. Đo PHP Workers, Redis hit rate, MySQL latency, Database Router routing, WooCommerce checkout, Action Scheduler, Cron, Backup, SSL, Media upload. Mục tiêu: xác định giới hạn thật của 1 Cluster | 4–8 tuần |
| 6 | **Multi Cluster** | Cluster Registry, Agent Registration, Health Report, Cluster Metadata (ban đầu có thể dùng file cấu hình hoặc PostgreSQL đơn giản) | 2–4 tuần |
| 7 | **SaaS Core** | Bắt đầu xây Control Plane: Authentication, Organizations, Users, Roles, Plans, Billing, API Keys, Dashboard. Lúc này NestJS rất nhẹ vì chỉ gọi Agent API đã kiểm chứng | 4–6 tuần |
| 8 | **Workflow (Engine)** | Mọi thao tác trở thành Operation có ID/Status/Progress/Logs/Retry/Rollback (Create Store, Delete, Backup, Restore, SSL, Deploy Plugin...) | 3–4 tuần |
| 9 | **Domain & SSL** | Tự động Add Domain → Verify → Issue SSL → Renew SSL. Agent thao tác với Caddy và Let's Encrypt | 2 tuần |
| 10 | **Production** | Monitoring (Prometheus/Grafana/Loki/OTel), Centralized Logs, Alerting, Artifact Repository, Rolling Update, Backup & Restore, Disaster Recovery | 4–6 tuần |

Tổng ước tính đến hết Production: khoảng **7–9 tháng** với một đội nhỏ (theo `plan-11.md`).

## Sau Production (không thuộc phạm vi roadmap 11 phase)

Chỉ triển khai sau khi có khách hàng thực tế và dữ liệu vận hành:

1. **Marketplace** — Plugin Packs, Theme Packs, Distribution Manager (version/rollback/changelog).
2. **AI Services** — SEO, mô tả sản phẩm, tự động hoá, support.
3. **ERP/CRM Integrations** — shipping, payment, marketplace connector.
4. **Enterprise** — Multi-region, Auto Scaling, Dedicated Cluster, HA, SSO, RBAC nâng cao.

## Những gì chủ động KHÔNG làm trong 11 phase (giảm rủi ro, ra mắt sớm)

- Kubernetes (trừ khi có yêu cầu rõ ràng).
- Microservices hoá mọi module — module hoá trong NestJS monolith là đủ.
- Marketplace mở cho user tự upload plugin.
- Multi-region.
- Event-driven phức tạp với Kafka/NATS — Redis + BullMQ là đủ cho giai đoạn đầu.

## Ghi chú về các phase cũ (KHÔNG dùng)

Các file nguồn `idea/plan.md`, `plan-5.md` đến `plan-9.md` từng đề xuất roadmap 4/7/10/13
phase theo thứ tự "SaaS trước, Runtime sau" hoặc gộp/tách phase khác với bảng trên. Các
bản đó bị **ghi đè hoàn toàn** bởi quyết định Runtime-first ở `plan-10/11/12.md`. Giữ
nguyên trong `idea/` chỉ để tham chiếu lịch sử, không dùng để lập kế hoạch triển khai.
