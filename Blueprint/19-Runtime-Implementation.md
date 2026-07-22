# 19 · Runtime Plane — Implementation

> **Phạm vi: 100% Runtime Plane** (WordPress Execution Engine). Đồng cấp với `18` (Control
> Plane) và `20` (Agent + Distribution). Ranh giới với SaaS là **API Contract v1**. Runtime
> **không biết** SaaS/Billing/User — chỉ expose Platform API qua MU Plugin. Nội bộ Go Agent
> và build Distribution xem `20`.
>
> Tài liệu này gom chi tiết từ `04-Runtime`, `05-Database-Router`, `07-MU-Plugin` + kết quả đã kiểm
> chứng chạy thật (Gate 2 local). Đã build + test: MU Plugin 8 endpoint, LudicrousDB routing, serving
> stack, provisioning-completeness (B4), restore-per-store.

## 1. Một Runtime Node — thành phần
```
Caddy (:80/:443)  →  PHP-FPM  →  WordPress Multisite  →  WooCommerce
                                        │
                              Database Router
                              (LudicrousDB implementation)
                                        │
                                   MySQL Pool (primary/replica)
   Redis (object cache)   ·   MU Platform Plugin   ·   Go Agent (native/systemd)
```
Tất cả chạy **native/systemd** (ADR-002). Agent out-of-band (không nằm trên đường request).

## 2. Web tier — Caddy + PHP-FPM (KHÔNG dùng built-in server)
Subdirectory multisite yêu cầu web server thật rewrite `/{store}/` → `index.php`. **PHP
built-in server không route được** subsite front page (resolve đúng blog nhưng 404 mọi
path). → **Caddy `php_fastcgi` → php-fpm** là bắt buộc. Đã kiểm chứng: sau khi đổi sang
Caddy+php-fpm, front page + `/store/shop/` + product page đều HTTP 200. `install-node.sh`
dựng đúng stack này cho node thật.

## 3. WordPress Multisite
- **Subdirectory** multisite (không subdomain) — `SUBDOMAIN_INSTALL=false`.
- Mọi subsite dùng chung **domain của network**; chỉ khác `path`. Bảng riêng theo prefix
  `wp_{blogId}_`; bảng dùng chung `wp_users`/`wp_usermeta`/`wp_blogs`/`wp_site`.
- **Distribution** cung cấp core+plugin+theme+config đóng gói (immutable); node chạy đúng
  một version Distribution (xem `20`).

## 4. MU Platform Plugin (SDK của WordPress)
Must-use plugin, REST server chỉ bind `127.0.0.1`, Bearer/shared-secret (ADR-003). Kiến
trúc phân lớp: **REST Controller → Service (facade) → chuyên-service → WordPress Adapter →
WP Core API**. 8 endpoint (đã chạy live):
```
GET  /platform/v1/health
POST /platform/v1/sites            DELETE /platform/v1/sites/{id}   POST .../{id}/suspend
POST /platform/v1/plugins/activate POST /platform/v1/themes/switch
POST /platform/v1/users            POST /platform/v1/options
```
> URL thật khi chạy trong WordPress: `<site>/wp-json/platform/v1/...` (WP prepend `/wp-json`),
> dùng canonical host. Agent `WordPressClient` cấu hình baseURL kèm `/wp-json`.

**Nguyên tắc**: mọi thay đổi dữ liệu qua **WP Core API** (`wpmu_create_blog`,
`activate_plugin`, `wp_insert_user`, `update_option`…), **không ghi SQL thẳng** → hook/cache
đúng. `WordPressAdapter` cô lập thay đổi; ánh xạ **Capability → plugin cụ thể** (SEO→RankMath…).

## 5. createSite — network domain + finalize (fix B4)
`createSite` sản sinh site **sẵn sàng serve** (đã kiểm chứng: `POST /sites` → browse 200
ngay, không thao tác tay):
1. Subdirectory → dùng **network domain** (`get_current_site()->domain`), bỏ qua domain
   client (client domain chỉ dùng cho subdomain/mapped-domain).
2. Sau `wpmu_create_blog`: `switch_to_blog → flush_rewrite_rules(true) →
   update_option('blog_public',1) → restore_current_blog` (mỗi call guard `function_exists`).

## 6. Database Router — interface và implementation LudicrousDB

> **Bằng chứng lịch sử:** HyperDB KHÔNG dùng được: không còn bảo trì, fatal trên WP 6.4+/7.0
> + WooCommerce (require `wp-db.php` deprecated → `wp_kses()` undefined; `$wpdb->dbh` null
> → Action Scheduler `db_server_info()` chết → wp-admin trắng). Đây là lý do implementation
> hiện tại dùng LudicrousDB; cảnh báo lịch sử này phải được giữ lại.

Runtime contract là `blog_id → pool đã được DAS chọn → connection`. DAS quyết định store
thuộc pool nào; Agent đồng bộ mapping; Database Router chỉ thực thi kết nối tới pool đó.
Router không tạo database, không chọn pool, và không quản lý migration; migration thuộc
Workflow + Agent.

Dùng **LudicrousDB** — fork được bảo trì, **một implementation** của Database Router, có
API `add_database()` tương thích. Đã kiểm chứng: `db_server_info()` → `11.8.8-MariaDB`,
Action Scheduler OK, wp-admin OK, WooCommerce CLI OK.

Cài đặt: gói LudicrousDB vào `wp-content/plugins/ludicrousdb/`, drop-in
`ludicrousdb/drop-ins/db.php` → `wp-content/db.php`, config `db-config.php` ở **ABSPATH**
(LudicrousDB cũng chấp nhận `wp-content/` hoặc hằng `DB_CONFIG_FILE`). `install-node.sh`
tự động hoá toàn bộ.

Vai trò kiến trúc **không đổi** — Database Router chỉ **route**, không tự chọn pool:
```
DAS chọn Pool  →  Agent sync mapping (blog_id → pool)  →  Database Router chỉ route
```
- **H0 hiện tại:** `db-config.php` chỉ có **một** `add_database()` dataset `global`
  read+write trỏ tới một database duy nhất; không có `add_callback`; runtime dùng đúng một
  database và chưa có định tuyến store → nhiều pool.
- **Multi-pool (H1):** khi được DAS quyết định và triển khai, thêm `add_database()` partition
  theo dataset; không sửa code WordPress. Agent cấp DB *trước* khi tạo site (DB-before-site).

## 7. Redis Object Cache
Redis Object Cache drop-in (`wp redis enable`), `WP_REDIS_HOST/PORT` + `WP_CACHE`. Giảm tải
DB. **Caveat**: gỡ `object-cache.php` trước khi rebuild/install WordPress (drop-in gây nhiễu
lúc DB trống), bật lại sau.

## 8. WooCommerce + Core Plugin Set
WooCommerce network-active (commerce engine). Core Plugin Set (`core-plugin-set.json`):
redis-cache, SEO, SMTP, security, image, backup client, platform-connector. Cài qua
`install-plugins.sh`. Bảng WooCommerce per-site (`wp_{id}_wc_*`) tạo khi network-active.

## 9. Backup / Restore-per-store (ADR-005)
- Backup: DB dump + files → object storage, checksum.
- **Restore-per-store**: lọc bảng theo prefix `wp_{blogId}_`, **cố ý bỏ qua**
  `wp_users`/`wp_usermeta` (dùng chung — ghi đè sẽ hỏng mọi site). Đã kiểm chứng cấu trúc
  bảng trên WordPress thật.

## 10. Runtime độc lập với SaaS (ADR-001)
Node cài xong tự vận hành: tạo/xoá/backup/restore/SSL store qua **Runtime CLI** hoặc gọi
REST Agent trực tiếp, **không cần Control Plane**. API Contract đóng băng để hai phía phát
triển song song.

## 11. Trạng thái đã kiểm chứng
Live trên node local (`~/ooio-devenv`, systemd): tạo/xoá store, 8 endpoint, WooCommerce +
sản phẩm, LudicrousDB routing, Redis cache, full 3-plane (mock SaaS → Agent → MU Plugin →
store browse 200). Còn thiếu: multi-pool, Distribution bundle thật, **Gate 1 spike scale**
(→ chốt ADR-005).
