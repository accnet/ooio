# Spike Report #014 — Cache auto-write + invalidation (SA48 hoàn tất)

**Ngày: 2026-07-23.** · **Đóng:** `SA48`
**Nền:** devenv, MU Plugin `platform-core.php` + `StaticCacheService`, `/noisy/` store

Spike #013 chứng minh cơ chế Caddy (serve từ file, bypass theo cookie) và đo throughput
1.606 req/s, nhưng để `SA48` ở `todo` vì thiếu hai nửa một cache không thể thiếu:
**auto-write** (WordPress tự ghi trang) và **invalidation** (xoá khi dữ liệu đổi). Báo cáo
này hiện thực và đo cả hai.

## Kiến trúc

```
WRITE:       template_redirect → ob_start → (shutdown) capture → StaticCacheService::write
INVALIDATE:  save_post_product / woocommerce_update_product / … → invalidateAll
SERVE:       Caddy @cached (Spike #013) — không đổi
```

`StaticCacheService` là **pure policy + filesystem**, unit-test được; hook WordPress trong
MU Plugin gọi nó. Đường dẫn cache lấy từ `OOIO_STATIC_CACHE_ROOT` (env hoặc constant);
vắng thì cache **trơ** — không ghi gì, không hỏng gì.

## Kết quả — ba nhánh đúng

| Nhánh | Kỳ vọng | Đo được |
|---|---|---|
| Ẩn danh `/shop/` | tự ghi ra file | **170.582 bytes** tại `cache_root/noisy/shop/index.html` |
| Khách có giỏ hàng | **không** ghi | không tạo file |
| Sửa giá sản phẩm | xoá cache | **`da xoa`** |

Unit test `StaticCacheServiceTest`: 4 nhóm (storable mirror bypass rules · path traversal
refused · write/invalidate round-trip · invalidateAll). MU test 4/4 PASS, `verify.sh all`
xanh.

## Ba lỗi phải sửa trước khi nó chạy — cả ba là "khớp chuỗi con nhầm"

### 1. `wc-block-store-notices` là container, không phải notice

Bản đầu coi trang có notice nếu html chứa `wc-block-store-notices`. Nhưng đó là **container
block luôn có mặt** trong template shop (Spike #012: container=1, notice thật=0). Kết quả:
**mọi trang shop bị coi là có notice → không bao giờ ghi.**

### 2. `wc-block-components-notice-banner` cũng xuất hiện khi KHÔNG có notice

Sửa lần một sang khớp `wc-block-components-notice-banner`. Vẫn sai: class đó xuất hiện
**5 lần** trong html ẩn danh — trong CSS `<style>` (selector) và trong một `<template>`
block rỗng. Đo:

```
ẩn danh:      'notice-banner is-(success|error|info)'  →  0
có giỏ hàng:  cùng mẫu                                 →  1
```

Notice **render thật** mới mang modifier trạng thái. Sửa detect thành
`preg_match('/notice-banner is-(success|error|info)/')`. Đây là dấu hiệu phân biệt đúng.

### 3. OPcache che mọi thay đổi trong 60 giây

`opcache.revalidate_freq = 60`. Sau mỗi lần sửa MU Plugin, đo lại vẫn thấy hành vi cũ —
suýt kết luận bản sửa vô tác dụng ba lần liên tiếp. Phải `kill -USR2` php-fpm sau **mỗi**
lần sửa. Đây là lần thứ ba trong phiên bẫy này xuất hiện (Spike #012, SA51, và đây).

> **Quy tắc vận hành cho mọi phép đo runtime:** sau khi sửa PHP, reload php-fpm trước khi
> đo — nếu không, số đo có thể là của bản cũ.

## Quyết định thiết kế: invalidate TẤT CẢ, không đoán phạm vi

`invalidateAll` xoá mọi entry khi bất kỳ sản phẩm nào đổi, thay vì tính chính xác trang
nào bị ảnh hưởng. Lý do: một product edit chạm shop grid, trang category của nó, trang chủ,
và kết quả tìm kiếm. Tính đúng tập bị ảnh hưởng là loại "khôn ngoan" dẫn tới phục vụ trang
cũ. Xoá tất cả rẻ (file dựng lại ở lần miss kế) và **đúng**. Tối ưu phạm vi invalidation là
việc sau, khi có dữ liệu về tần suất edit vs traffic.

## Giới hạn

- **WSL2**, devenv. Cache root cấu hình bằng constant trong `wp-config.php`; production
  dùng env do Agent đặt (`install-node.sh` cần thêm — chưa làm).
- **Chưa nối `install-node.sh`**: Caddy `@cached` matcher và `OOIO_STATIC_CACHE_ROOT` chưa
  vào installer. Đây là bước đưa SA48 từ "chạy trong devenv" sang "mọi node có".
- **Invalidation theo `updated_option`** khá rộng — mọi thay đổi option xoá cache. Đúng về
  an toàn (giá, thuế, tiền tệ đều là option), nhưng có thể xoá thừa. Chưa đo tần suất.
- **Chưa đo cache miss storm**: khi invalidateAll xoá sạch, N request đầu cùng lúc đều
  miss và cùng render. Cần single-flight/lock ở tải cao — chưa làm.
- **TTL chưa có**: cache chỉ xoá khi có sự kiện, không hết hạn theo thời gian. Trang không
  bao giờ được sửa sẽ cache vĩnh viễn — đúng cho catalog tĩnh, cần cân nhắc cho trang động.
