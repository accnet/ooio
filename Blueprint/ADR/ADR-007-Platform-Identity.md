# ADR-007: Platform Identity — Platform sở hữu user, Store chỉ là projection

## Status

**Accepted** (Blueprint v1.1, 2026-07-21). Dẫn xuất từ `AP-002` (Platform Data Ownership).
Là điều kiện để `ADR-006` (database-per-store) sống được.

## Bối cảnh

Câu hỏi cốt lõi: **ai sở hữu user?**

Mặc định của WordPress là `wp_users` — nhưng nếu đặt `wp_users` ở tầng Runtime Global thì:
- Mọi JOIN nội dung ↔ user trở thành **cross-database JOIN**, và MySQL chỉ JOIN được
  cross-database khi cùng server ⇒ vỡ khi store nằm khác pool (`AP-001`).
- Restore một store phải **loại trừ** `wp_users`/`wp_usermeta` dùng chung — đúng giới hạn
  mà `ADR-005` và module restore (C6) đang phải chịu.
- Xoá store để lại rác ở bảng chung.

## Quyết định

### 1. Identity là một Bounded Context của Platform
Không chỉ là "Auth". Đây là một platform service đầy đủ:
```
Platform Identity
├── Organizations        ├── Roles              ├── API Keys
├── Accounts             ├── Permissions        ├── OAuth
├── Members              ├── Store Membership   └── Billing Identity
```

### 2. Platform là source of truth — Store là projection
```
Platform Identity → Organization → Member → Role
                          ↓ Provision (Operation qua Agent)
                    Store Identity → WordPress User (trong database của store)
```
**Chiều ngược lại bị cấm**: WordPress **không bao giờ** là nguồn sự thật, không ghi ngược
lên Platform.

### 3. `wp_users` là projection **per-store**
`wp_users`/`wp_usermeta` nằm **trong chính database của store**, không ở Runtime Global.
Một người có nhiều store sẽ có **nhiều WP user id khác nhau**, Platform giữ bảng ánh xạ:
```
John (platform account)
 ├── Store A → wp user id = 15
 └── Store B → wp user id = 3
```
Đây đúng mô hình các nền tảng thương mại (Shopify): **identity thuộc platform, không thuộc
store**.

### 4. Không JOIN, chỉ provision
```
❌ platform_user  JOIN  50 store databases
✅ Member Added → Event/Operation → Agent → tạo WP User trong store DB
```

## Lý do

Quyết định này **giải ba vấn đề cùng lúc**:
1. **Xoá bỏ cross-database JOIN** — JOIN nội dung ↔ user diễn ra trong cùng một database.
2. **Restore-per-store trở nên sạch** — restore nguyên một database, không còn ngoại lệ
   `wp_users` như hiện tại.
3. **Xoá store sạch** — drop một database, không rác ở bảng chung.

Đồng thời tách Platform khỏi schema WordPress: đổi cách WP lưu user không ảnh hưởng
Control Plane.

## Hệ quả

- **Auth ở Dashboard dùng Platform Identity** (JWT của Control Plane), không dùng
  `wp_users`. Đăng nhập vào wp-admin của một store là luồng riêng, được provision xuống.
- **RBAC hai tầng**: quyền ở Platform (owner/admin/member trên Organization) và role
  WordPress trong store — Platform là bên quyết định, store là bên nhận.
- **Billing Identity thuộc Platform** — không suy ra từ `wp_users`.
- Cần **Operation mới**: `provision-user`, `revoke-user`, `sync-role` (mở rộng bộ job
  type hiện có của Agent).
- Khi thêm/xoá member ở Platform, phải phát Operation tới **mọi store** người đó có quyền
  — cần idempotent và chịu được retry.
- `ADR-005`: store gần như tự chứa ⇒ giảm giá trị còn lại của Multisite (xem `ADR-006`
  mục Hệ quả).

## Open question

- Chiến lược đồng bộ khi Platform và store lệch nhau (ví dụ user bị xoá thủ công trong
  wp-admin): cần reconciliation định kỳ, chốt khi triển khai.
- SSO vào wp-admin (Platform JWT → phiên WordPress) thiết kế ở giai đoạn SaaS S-2+.
