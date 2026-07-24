# Spike Report #013 — Cache-with-bypass: chứng minh cơ chế + đo throughput

**Ngày: 2026-07-23.** · **Thuộc:** `SA48` (Runtime, trong phạm vi Freeze — performance)
**Nền:** devenv, Caddy 2.6.4 vanilla, `/noisy/` (store WooCommerce lành), 800 request @ 80
đồng thời

Spike #012 chứng minh trang ẩn danh cache được và khách giữ giỏ nhận diện bằng cookie. Báo
cáo này **hiện thực và đo** cơ chế đó, không thêm module Caddy nào.

## Cấu hình — Caddy vanilla, không plugin

```
caddy list-modules | grep -i cache   →   rỗng
```

Không dùng FastCGI cache (không có), không build lại Caddy. Dùng **static page cache**:
file HTML render sẵn + `file_server`, đúng đường Spike #011 đo được **1.774 req/s**.

Matcher `@cached` phục vụ từ cache **chỉ khi** request là GET, **không** mang cookie
giỏ hàng/đăng nhập, và **không** trỏ tới route mutation:

```caddyfile
@cached {
    method GET
    not header Cookie *woocommerce_items_in_cart*
    not header Cookie *woocommerce_cart_hash*
    not header Cookie *wordpress_logged_in_*
    not path /wp-admin/* /wp-json/* /cart* /checkout* /my-account*
    not path *add-to-cart*
    file { root <cache_root>; try_files {path}/index.html }
}
```

## Kết quả — cơ chế đúng ở cả bốn nhánh

| Request | Kỳ vọng | Đo được |
|---|---|---|
| ẩn danh `/shop/` | phục vụ từ cache | **`X-Cache: HIT`** |
| có cookie giỏ hàng | qua PHP | `X-Powered-By: PHP` |
| `/cart/` | qua PHP | `X-Powered-By: PHP` |
| `?add-to-cart=` | qua PHP | `X-Powered-By: PHP` |

**Route mutation loại bằng danh sách quy tắc trong matcher, không bằng so sánh thân trang**
— đúng ràng buộc Spike #008 Phát hiện 4.

## Throughput

| Đường | req/s |
|---|---|
| **Cache HIT** (ẩn danh, không chạm PHP) | **1.606** |
| Bypass (có giỏ, qua PHP đầy đủ) | **47,8** |

Chênh **33×**. Cache HIT **1.606 req/s** nằm cùng bậc với đường tĩnh thuần **1.774 req/s**
(Spike #011) — thấp hơn chút vì file HTML 170 KB nặng hơn `emoji.js`. Xác nhận: request
phục vụ từ cache **không chạm PHP**, nên năng lực node cho lưu lượng ẩn danh đi từ 127 lên
**~1.600 req/s**.

Đây là con số Spike #011 dự đoán: cache là **hệ số nhân năng lực**, không phải tối ưu.

## Đã chứng minh / còn nợ

**Chứng minh:**
- Cache bypass theo cookie hoạt động ở cả bốn nhánh
- Throughput cache HIT ≈ đường tĩnh
- Loại route mutation bằng quy tắc, không bằng đo

**Còn nợ để thành production — thuộc MU Plugin, không thuộc Caddy:**

1. **Ghi cache tự động.** Proof này warm bằng `curl` thủ công. Production cần WordPress tự
   ghi HTML ra file khi render một trang ẩn danh cacheable — output buffering trong MU
   Plugin, chỉ ghi khi **không** có notice/giỏ hàng trong response.
2. **Invalidation.** Sửa sản phẩm, giá, tồn kho phải **xoá file cache tương ứng**. Không có
   nó thì cache phục vụ nội dung cũ — nguy hiểm hơn không cache. Cần hook
   `save_post` / `woocommerce_update_product` / `woocommerce_variation_*` trong MU Plugin.

Hai phần này có biên giới rõ và là **phần còn lại thật sự của SA48**. Cơ chế Caddy đã xong;
việc còn lại nằm ở tầng WordPress.

## Giới hạn

- **WSL2**, số tuyệt đối không chuyển sang VPS; tỉ lệ 33× và quan hệ với đường tĩnh thì
  chuyển được.
- **Cache warm thủ công**, chưa đo chi phí ghi cache lúc miss đầu tiên.
- **Chưa đo hit rate thật** — cần lưu lượng thật (Spike #012 ghi rõ đây là biến quyết định).
- Matcher `not path *add-to-cart*` khớp chuỗi trong path/query; production nên rà thêm các
  tham số WooCommerce khác mang trạng thái (`?orderby=`, `?add_to_wishlist=`…).
- Devenv đã được **khôi phục** về Caddyfile không cache sau khi đo — cache thủ công không
  invalidation không được để chạy.
