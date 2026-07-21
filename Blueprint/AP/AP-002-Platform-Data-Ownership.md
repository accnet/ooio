# AP-002 · Platform Data Ownership

> **Loại: Architecture Principle** — luôn đúng, ràng buộc mọi quyết định sau này.
> Khác ADR (quyết định tại một thời điểm, có thể bị superseded), AP không bị thay thế
> mà chỉ được làm rõ. Đây là nguyên lý **cốt lõi nhất** của Blueprint v1.1: mọi quyết
> định về database, identity, event bus, analytics, billing, migration, backup, failover
> đều phải nhất quán với nó.
>
> Ban hành: 2026-07-21 (Blueprint v1.1)

## Nguyên lý

Mỗi loại dữ liệu có **đúng một chủ sở hữu**. Không lớp nào đọc trực tiếp database của
lớp khác.

```
Platform  sở hữu  Business Data     →  PostgreSQL (Control Plane)
Runtime   sở hữu  Execution Data    →  MySQL Global (network metadata)
Store     sở hữu  Commerce Data     →  Database riêng của từng store
```

## Bảng ownership

| Dữ liệu | Chủ sở hữu | Lưu ở đâu |
|---|---|---|
| Organization, Account, Member, Role, Permission | Platform | PostgreSQL |
| Billing: Plan, Subscription, Invoice, Quota | Platform | PostgreSQL |
| Workflow, Operation, Audit, Cluster/Node/Pool registry | Platform | PostgreSQL |
| Analytics / projection (tổng hợp từ event) | Platform | PostgreSQL |
| **User (source of truth)** | **Platform** | **PostgreSQL** |
| **`wp_users` / `wp_usermeta` (PROJECTION)** | **Store** | **Database của store** |
| `wp_site`, `wp_blogs`, network metadata | Runtime | MySQL Global |
| Distribution version đang chạy trên node | Runtime | MySQL Global / node state |
| Products, Orders, Customers, Options, Posts, bảng WooCommerce | Store | Database riêng |

> **Dòng `wp_users` là bắt buộc phải đọc kỹ.** WordPress **không chạy được** nếu thiếu
> bảng `wp_users` — nó cần cho auth, capabilities, author, customer của đơn hàng. Vì vậy
> `wp_users` **tồn tại trong từng store database** dưới dạng **projection** của Platform
> Identity (xem `ADR-007`). Nó **KHÔNG** nằm ở Runtime Global. Đặt `wp_users` vào lớp
> global sẽ phá vỡ tính tự chứa của store database và làm sống lại bài toán cross-database
> JOIN (`AP-001`) lẫn bài toán restore-per-store.

## Hai chiều projection (không phải một chiều)

Bất biến là *"không lớp nào đọc trực tiếp database của lớp kia"* — chứ không phải
"mọi thứ chảy một chiều". Có **hai lớp dữ liệu, hai chiều**:

| Lớp dữ liệu | Chiều | Cơ chế |
|---|---|---|
| **Control data** — identity, entitlement, cấu hình, quota | Platform **→** Store | Provision / push (Operation qua Agent) |
| **Commerce facts** — orders, products, customers | Store **→** Platform | Event / projection (outbox → Agent → Event Bus) |

Ví dụ đúng:
```
Platform: Member Added  →  Operation  →  Agent  →  tạo WP User trong store DB
Store:    Order Completed →  outbox   →  Agent  →  Event Bus  →  Analytics (Postgres)  →  Billing
```
Ví dụ **sai**:
```
Billing  →  SELECT SUM(order_total) FROM store_245.wp_posts     ❌ Platform đọc DB store
WordPress →  ghi ngược vào PostgreSQL identity                   ❌ Store làm source of truth
```

## Hệ quả bắt buộc

1. **Platform không bao giờ phụ thuộc schema WordPress.** Nếu WooCommerce đổi cấu trúc
   bảng, Control Plane không bị ảnh hưởng — chỉ tầng phát sinh event trong MU Plugin đổi.
2. **Mọi tổng hợp (analytics, billing, dashboard) đi qua event/projection**, không đọc
   trực tiếp database store (xem `AP-001`).
3. **Runtime chỉ *thực thi*; Platform *điều phối và sở hữu* business logic.**
4. Store database **tự chứa** → migration = dump/restore một database; restore-per-store
   không còn phải loại trừ bảng dùng chung.
5. Xoá store = drop một database; không để lại rác ở bảng chung.

## Vì sao nguyên lý này quan trọng hơn từng ADR

Một khi đã xác định ai sở hữu loại dữ liệu nào, các quyết định phía sau trở nên **suy ra
được** thay vì phải tranh luận lại: database-per-store (ADR-006), identity projection
(ADR-007), event-first analytics/billing, cách migration, cách backup, cách failover.
Đây là bước đưa kiến trúc từ "hệ thống WordPress mở rộng" thành **Cloud Commerce Platform**.

Liên quan: `AP-001` (No Cross-Store Database Join) · `ADR-006` (Database Platform) ·
`ADR-007` (Platform Identity) · `ADR-005` (Runtime Topology).
