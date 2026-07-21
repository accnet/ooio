Đây là phần mình nghĩ **không nên để Agent điều khiển WordPress trực tiếp bằng WP-CLI cho mọi thứ**. Thay vào đó nên phân chia rõ trách nhiệm.

## Kiến trúc bên trong Cluster

```text
                    Go Agent
                       │
        ┌──────────────┴──────────────┐
        │                             │
 Infrastructure                WordPress Module
 (Linux)                            │
        │                            │
        │                    Local REST API
        │                            │
        ▼                            ▼
 systemctl                    MU Platform Plugin
 mysqldump                          │
 caddy reload                       │
 filesystem                  WordPress Core API
                                     │
                         wpmu_create_blog()
                         switch_to_blog()
                         activate_plugin()
                         wp_insert_user()
```

**Agent không thao tác trực tiếp vào database của WordPress.**

---

# Tại sao cần MU Platform Plugin?

Ví dụ tạo site.

Nếu Agent chạy:

```bash
wp site create ...
```

thì:

* Khó kiểm soát
* Parse output CLI
* Khó version API
* Khó rollback
* Khó mở rộng

Thay vào đó:

```text
Agent
    │
POST http://127.0.0.1/platform/v1/sites
    │
MU Plugin
    │
wpmu_create_blog()
```

Đây là API nội bộ (localhost), không public Internet.

---

# Agent giao tiếp thế nào?

Ví dụ Create Site

```text
SaaS
    │
Job
    │
Go Agent
    │
HTTP localhost
    │
MU Plugin
    │
WordPress API
```

Payload

```json
{
  "siteSlug": "demo",
  "title": "Demo Site",
  "adminEmail": "admin@example.com"
}
```

MU Plugin xử lý.

---

# MU Plugin

Ví dụ

```php
register_rest_route(
    'platform/v1',
    '/sites',
    ...
);
```

Bên trong

```php
wpmu_create_blog();

switch_to_blog();

update_option();

activate_plugin();

restore_current_blog();
```

---

# Agent chỉ gọi REST

Ví dụ

```http
POST http://127.0.0.1/platform/v1/sites
```

↓

JSON

↓

Success.

---

# Khi nào Agent dùng WP-CLI?

Theo mình chỉ dùng WP-CLI cho việc quản trị hệ thống.

Ví dụ

```bash
wp core update
```

```bash
wp search-replace
```

```bash
wp cache flush
```

```bash
wp cron event run
```

Những việc này REST không phù hợp.

---

# Khi nào Agent dùng Linux?

Ví dụ

```bash
systemctl restart php-fpm
```

```bash
systemctl reload caddy
```

```bash
mysqldump
```

Không liên quan WordPress.

---

# Module WordPress trong Agent

```text
wordpress/

client.go

sites.go

users.go

plugins.go

themes.go

options.go

health.go
```

Ví dụ

```go
client.CreateSite()

client.DeleteSite()

client.ActivatePlugin()
```

Chỉ là REST Client.

---

# MU Plugin là Server

```text
REST Controller

↓

Application Service

↓

WordPress Adapter

↓

Core API
```

Ví dụ

```text
SiteController

↓

SiteService

↓

WordPressAdapter

↓

wpmu_create_blog()
```

---

# WordPress Adapter

Đây là lớp rất quan trọng.

Không gọi

```php
wpmu_create_blog()
```

lung tung.

Ví dụ

```php
interface SiteAdapter
{
    create();

    delete();

    suspend();
}
```

Sau này WordPress đổi API.

Chỉ sửa Adapter.

---

# Authentication

Agent

↓

Bearer Token

↓

MU Plugin

↓

Verify JWT

↓

Done.

Hoặc đơn giản hơn, vì chỉ chạy trên localhost, bạn có thể dùng **Unix socket** hoặc **shared secret**. Không cần OAuth phức tạp.

---

# Ví dụ Create Site

```text
SaaS
 │
 ▼
BullMQ

 │
 ▼
Go Agent

 │
 ▼
POST localhost/platform/v1/sites

 │
 ▼
MU Plugin

 │
 ▼
wpmu_create_blog()

 │
 ▼
switch_to_blog()

 │
 ▼
Install Theme

 │
 ▼
Activate Plugins

 │
 ▼
Done

 │
 ▼
Agent

 │
 ▼
SaaS
```

---

# Ví dụ Install Plugin

```text
Agent

↓

POST

/platform/v1/plugins/install
```

↓

MU Plugin

↓

```php
activate_plugin()
```

↓

Done.

---

# Ví dụ Create User

```text
Agent

↓

POST

/platform/v1/users
```

↓

MU Plugin

↓

```php
wp_insert_user()
```

↓

Done.

---

# Không cho Agent ghi DB

Đây là nguyên tắc mình sẽ giữ:

❌ Không làm:

```sql
INSERT INTO wp_blogs
```

❌ Không làm:

```sql
UPDATE wp_options
```

Tất cả thay đổi dữ liệu WordPress phải đi qua **WordPress Core API** để đảm bảo:

* Hook (`do_action`, `apply_filters`) được chạy.
* Cache được cập nhật.
* Plugin tương thích.
* Dữ liệu nhất quán.

---

# Mình sẽ tiến thêm một bước nữa: RPC thay vì REST nội bộ

Nếu đây là nền tảng của riêng bạn, mình sẽ **không dùng REST nội bộ giữa Agent và MU Plugin**, mà dùng **RPC qua Unix Domain Socket (UDS)** hoặc FastCGI bridge.

Ví dụ:

```text
Go Agent
      │
 Unix Socket
      │
MU Platform Plugin
```

Ưu điểm:

* Không cần mở cổng HTTP nội bộ.
* Hiệu năng tốt hơn.
* Chỉ tiến trình trên cùng máy mới truy cập được.
* Giảm bề mặt tấn công.

Tuy nhiên, **REST trên `127.0.0.1` vẫn là lựa chọn rất tốt để bắt đầu** vì:

* Dễ debug bằng `curl`.
* Dễ version API (`/platform/v1/...`).
* Agent và MU Plugin tách biệt rõ ràng.
* Sau này có thể chuyển sang RPC mà không ảnh hưởng kiến trúc tổng thể nếu đã có lớp `WordPressClient` trong Agent.

### Tóm tắt trách nhiệm

| Thành phần             | Trách nhiệm                                                 |
| ---------------------- | ----------------------------------------------------------- |
| **SaaS**               | Quyết định *làm gì* (Create Site, Issue SSL, Backup...)     |
| **Go Agent**           | Điều phối và thực thi hạ tầng, gọi API nội bộ của WordPress |
| **MU Platform Plugin** | Chuyển yêu cầu thành các lời gọi WordPress Core API         |
| **WordPress Core**     | Thực hiện logic thật sự và cập nhật dữ liệu                 |

Theo cách này, mỗi lớp chỉ có một trách nhiệm rõ ràng, giúp hệ thống dễ bảo trì và mở rộng lâu dài.
