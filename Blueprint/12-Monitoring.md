# Monitoring & Observability

## Heartbeat từ Go Agent

Mỗi Agent định kỳ gửi heartbeat outbound tới Control Plane:

```
CPU · RAM · Disk · PHP-FPM status · Redis · MySQL · Site Count · Version · Errors · Latency
```

Control Plane cập nhật Cluster Registry (health, capacity) từ dữ liệu này — Scheduler
dùng chính dữ liệu này để tính capacity score khi đặt store mới.

## Stack quan sát

```
Metrics    → Prometheus + Grafana
Logs       → Loki (hoặc ELK nếu cần)
Tracing    → OpenTelemetry
Alerting   → gắn với Prometheus/Grafana alerting rules
```

Luồng log từ Runtime lên Control Plane:

```
WordPress → Agent → OpenTelemetry → SaaS (Loki/ELK)
```

## Những gì cần theo dõi

- **Hạ tầng Node**: CPU, RAM, Disk, PHP Workers, MySQL latency, Redis hit rate.
- **Theo từng store/hostname** (phục vụ detect noisy neighbor — ADR-005): CPU, PHP
  worker chiếm dụng, request rate, MySQL/Redis theo hostname; là đầu vào để Scheduler
  quyết định throttle hoặc `MigrateStore`.
- **Ứng dụng**: WooCommerce checkout success rate, Action Scheduler queue, Cron.
- **Vận hành**: Backup completion, SSL issue/renew, thời gian trung bình mỗi Operation
  (CreateStore, Backup, Deploy...), tỷ lệ retry/rollback.
- **Phiên bản**: Distribution version đang chạy trên từng store, Agent version từng
  node — phục vụ rollout theo dõi và audit.

## Dashboard

Toàn bộ metrics/log/trace hiển thị trên Dashboard vận hành nội bộ (không phải Dashboard
khách hàng) để đội vận hành theo dõi sức khoẻ toàn bộ Cluster theo thời gian thực.

## Ngưỡng cần xác định qua Stress Test (Phase 6 của Roadmap)

Trước khi vào Production, Monitoring phải trả lời được các câu hỏi định lượng: một
Cluster/Node chịu được bao nhiêu site đồng thời trước khi PHP Worker bão hoà, Database Router
routing có phát sinh nghẽn khi database pool lớn, Redis hit rate giảm ở ngưỡng nào —
xem `13-Roadmap.md` (Phase Stress Test).
