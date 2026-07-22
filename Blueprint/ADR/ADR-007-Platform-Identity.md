# ADR-007: Platform Identity — Platform sở hữu user, Store chỉ là projection

## Status

**Accepted** (Blueprint v1.1, 2026-07-21). Dẫn xuất từ `AP-002` (Platform Data Ownership).
Là điều kiện để `ADR-006` (database-per-store) sống được.

### ⚠️ Cập nhật 2026-07-22 — `ADR-005` chốt Multisite

Runtime Identity là **GLOBAL**, không per-store. `wp_users`/`wp_usermeta` dùng chung cho cả
network (`wp-includes/class-wpdb.php:324` — WordPress core, không cấu hình được).

**Cơ chế "Platform giữ bảng ánh xạ John → Store A wp user 15, Store B wp user 3" KHÔNG khả
thi** dưới Multisite: một người chỉ có **một** `wp_users.ID` trong cả network. Quyền theo
store nằm ở `wp_usermeta` với khoá `wp_N_capabilities`.

Phần Platform Identity (PostgreSQL là nguồn sự thật) **vẫn đúng nguyên vẹn**. Chỉ tầng
Runtime Identity đổi. Xem giới hạn cô lập tenant trong `ADR-005`.

## Bối cảnh

Câu hỏi cốt lõi: **ai sở hữu user?**

Identity có hai tầng, với hai trách nhiệm khác nhau:

| Tầng | Vai trò / dữ liệu | Phạm vi Runtime Identity |
|---|---|---|
| **Platform Identity** | **Source of truth**, PostgreSQL; giữ account, membership, role và ánh xạ tới Runtime | **Luôn dùng** |
| **Runtime Identity** | Projection trong WordPress/MySQL | **Per-store** nếu Isolated; **GLOBAL** nếu Multisite |

Vị trí Runtime Identity là hệ quả của topology, không phải nguyên lý của `AP-002`.
Trong WordPress, `wp-includes/class-wpdb.php:324` định nghĩa `global_tables =
['users', 'usermeta']` vô điều kiện. Do đó trong Multisite, `wp_users` và `wp_usermeta`
luôn là bảng global. Khi đó:
- JOIN nội dung ↔ user vẫn là JOIN trong cùng Runtime Global, nhưng không thể coi identity
  là dữ liệu tự chứa của từng store.
- Quyền của một site nằm trong `wp_usermeta` global với key như
  `wp_2_capabilities`, nên identity **không bao giờ portable dưới Multisite**.
- Restore hoặc clone riêng một site không thể mang theo đầy đủ identity của site đó; xoá
  site cũng không đồng nghĩa xoá sạch user global.

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

### 3. Runtime Identity là projection của Platform
Với topology **Isolated**, `wp_users`/`wp_usermeta` nằm **trong chính database của store**.
Một người có nhiều store sẽ có **nhiều WP user id khác nhau**, Platform giữ bảng ánh xạ:
```
John (platform account)
 ├── Store A → wp user id = 15
 └── Store B → wp user id = 3
```
Đây đúng mô hình các nền tảng thương mại (Shopify): **identity thuộc platform, không thuộc
store**.

Với topology **Multisite**, WordPress đặt `wp_users`/`wp_usermeta` ở Runtime Global theo
định nghĩa `global_tables` nêu trên. Đây là hệ quả vận hành của Multisite, không làm thay
đổi source of truth ở Platform; đồng thời nó khiến identity không thể portable theo từng
site.

### 4. Không JOIN, chỉ provision
```
❌ platform_user  JOIN  50 store databases
✅ Member Added → Event/Operation → Agent → tạo WP User trong store DB
```

## Lý do

Quyết định này **giải ba vấn đề cùng lúc**:
1. Với Isolated, **xoá bỏ cross-database JOIN** — JOIN nội dung ↔ user diễn ra trong cùng
   một database.
2. Với Isolated, **restore-per-store trở nên sạch** — restore nguyên một database, không
   còn ngoại lệ `wp_users` dùng chung.
3. Với Multisite, phải chấp nhận giới hạn portability và restore/clone do identity global;
   không được mô tả Multisite là per-store identity.

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
- `ADR-005`: store gần như tự chứa trong Isolated; Multisite vẫn có Runtime Identity global
  và vì vậy có giới hạn portability (xem `ADR-006` mục Hệ quả).

## Open question

- Chiến lược đồng bộ khi Platform và store lệch nhau (ví dụ user bị xoá thủ công trong
  wp-admin): cần reconciliation định kỳ, chốt khi triển khai.
- SSO vào wp-admin (Platform JWT → phiên WordPress) thiết kế ở giai đoạn SaaS S-2+.
