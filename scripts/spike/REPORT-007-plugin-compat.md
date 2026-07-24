# Spike Report #007 — Plugin Compatibility Matrix trên Multisite

**Ngày:** 2026-07-23 · **Đóng:** `ADR-005` Exit Criteria **#4** — tiêu chí cuối cùng còn có
thể **phủ định** quyết định Multisite
**Nền:** WordPress 7.0.2 Multisite subdirectory · WooCommerce 10.9.4 · PHP 8.3 · 3 store,
mỗi store 20 sản phẩm
**Bằng chứng:** `results/plugin-compat.csv` · harness `measure-plugin-compat.sh`

Quy trình mỗi plugin: cài → network-activate → gọi `/`, `/shop/`, `/cart/` của **hai store
khác nhau** → gỡ → xác nhận cả hai store trở lại 200 trước khi sang plugin kế.

## Ma trận

| Plugin | Nhóm | Cài | Network-activate | HTTP (2 store) | Drop-in | Kết luận |
|---|---|---|---|---|---|---|
| wordpress-seo | SEO | ✅ | ✅ | 200 ×6 | — | chạy được |
| seo-by-rank-math | SEO | ✅ | ✅ | 200 ×6 | — | chạy được |
| **w3-total-cache** | cache | ✅ | ✅ | **307** ×2 | `advanced-cache.php` | ⚠️ **xem Phát hiện 1** |
| **wp-super-cache** | cache | ✅ | ✅ | 200 ×6 | `advanced-cache.php` · `wp-cache-config.php` | ⚠️ ghi drop-in toàn network |
| litespeed-cache | cache | ✅ | ✅ | 200 ×6 | — | chạy được |
| woocommerce-gateway-stripe | thanh toán | ✅ | ✅ | 200 ×6 | — | chạy được |
| woo-stripe-payment | thanh toán | ✅ | ✅ | 200 ×6 | — | chạy được |
| flexible-shipping | vận chuyển | ✅ | ✅ | 200 ×6 | — | chạy được |
| woocommerce-shipping | vận chuyển | ✅ | ✅ | 200 ×6 | — | chạy được |
| elementor | builder | ✅ | ✅ | 200 ×6 | — | chạy được |
| contact-form-7 | form | ✅ | ✅ | 200 ×6 | — | chạy được |
| wpforms-lite | form | ✅ | ✅ | 200 ×6 | — | chạy được |
| redirection | tiện ích | ✅ | ✅ | 200 ×6 | — | chạy được |
| wordfence | bảo mật | ✅ | ✅ | 200 ×6 | — | chạy được (+1 dòng meta global) |

**14/14 cài được. 14/14 network-activate được. 0 fatal. 0 store hỏng không khôi phục
được.**

## Phát hiện 1 — W3 Total Cache: 307 trên mọi store, nhưng KHÔNG phải hỏng

```
GET /            → 307  Location: /?repeat=w3tc
GET /noisy/      → 307  Location: /noisy/?repeat=w3tc
GET /?repeat=w3tc → 200
```

Đây là cơ chế mồi cache của W3TC, không phải lỗi. Store vẫn phục vụ được nội dung đúng.

**Nhưng nó vẫn là vấn đề thật với một nền tảng thương mại**, và vấn đề nằm ở chỗ Multisite:

- `advanced-cache.php` là **drop-in, tức toàn network**. Một store bật W3TC ⇒ **mọi store
  trong cluster** đi qua drop-in đó.
- Redirect gắn `?repeat=w3tc` vào URL ⇒ URL bẩn, và **phá cache tầng trên** (CDN thấy hai
  URL khác nhau cho cùng một trang).
- Khách hàng A không thể tự bật W3TC mà không ảnh hưởng khách hàng B.

Harness ban đầu chấm `HONG-STORE`. **Chấm như vậy là quá nặng** — theo redirect thì ra 200.
Ghi lại cả hai để không ai đọc CSV rồi kết luận W3TC làm sập store.

## Phát hiện 2 — Nhóm cache là nhóm duy nhất có vấn đề, và vấn đề là drop-in

| Plugin cache | Ghi drop-in? |
|---|---|
| w3-total-cache | `advanced-cache.php` |
| wp-super-cache | `advanced-cache.php` · `wp-cache-config.php` |
| litespeed-cache | không (ở cấu hình mặc định) |

Drop-in trong `wp-content/` **không theo site — nó theo network**. Ba hệ quả:

1. **Không bán được "cache" như tính năng theo gói.** Bật cho một store là bật cho cả
   cluster.
2. **Xung đột.** Hai store muốn hai plugin cache khác nhau ⇒ chỉ một cái tồn tại, cái sau
   ghi đè cái trước.
3. **`object-cache.php` của nền tảng đang chiếm chỗ.** Redis object cache của ooio đã dùng
   drop-in này. Plugin nào muốn ghi vào đó sẽ **thay thế lớp cache của nền tảng**.

Ba nhóm còn lại — SEO, thanh toán, vận chuyển, builder, form, bảo mật — **không đụng
drop-in nào**. Rủi ro tập trung ở đúng một nhóm.

## Phát hiện 3 — Không tìm thấy plugin nào ghi bừa vào bảng global

Đo bằng `COUNT(*)` của `wp_usermeta` + `wp_sitemeta` trước và sau mỗi plugin:

```
13/14 plugin:  meta +0
wordfence:     meta +1
```

`wp_usermeta` và `wp_sitemeta` **dùng chung giữa mọi store**. Nếu plugin ghi dữ liệu theo
store vào đó thì đó là **rò rỉ giữa các tenant**. Kết quả: **không plugin nào làm vậy** ở
mức kích hoạt cơ bản.

⚠️ Đây là phép đo **ở trạng thái vừa kích hoạt**, chưa cấu hình, chưa có lưu lượng thật.
Plugin có thể ghi vào bảng global **sau đó** — xem mục Giới hạn.

## Ý nghĩa cho ADR-005

> **KHÔNG có plugin nào phủ định quyết định Multisite.**

14/14 chạy được, không fatal, không store nào hỏng vĩnh viễn. Tiêu chí #4 **không chặn**.

Nhưng có **một ràng buộc sản phẩm** phải ghi vào thiết kế:

**Plugin cache phải do nền tảng quản lý, không để khách hàng tự cài.** Lý do là kỹ thuật,
không phải chính sách: drop-in là network-wide, nên "khách hàng tự chọn plugin cache" là
điều **không thể thực hiện đúng** dưới Multisite. Cụ thể:

1. Chặn nhóm plugin ghi drop-in (`advanced-cache.php`, `object-cache.php`, `db.php`) khỏi
   marketplace, hoặc chặn ở tầng cài đặt.
2. Nền tảng cung cấp **một** lớp cache thống nhất cho cả cluster.
3. Điều này khớp với Spike #008: lớp cache đó phải **tách store notice** ra khỏi HTML
   nguyên trang, nếu không thì trần cache chỉ 15–40%.

Dưới Isolated thì ràng buộc này biến mất — mỗi store có `wp-content` riêng.

## Giới hạn phải đọc kèm

- **Chỉ đo tới mức "kích hoạt và trang vẫn tải được".** Không cấu hình plugin, không chạy
  luồng nghiệp vụ (thanh toán thật, tính phí ship thật, xuất sitemap). Một plugin có thể
  chạy được lúc kích hoạt và hỏng khi dùng thật.
- **Không đo phạm vi cấu hình per-site vs per-network.** Đây là mục trong đề bài mà harness
  **không** thực hiện — cần vào giao diện từng plugin, không tự động hoá được trong lần
  chạy này. **Còn nợ.**
- **Không đọc log PHP một cách hệ thống.** Harness khai báo `PHP_LOG` nhưng không dùng.
  Kết luận "0 fatal" dựa trên **mã HTTP**, không dựa trên log. Một warning hoặc deprecated
  notice sẽ không bị bắt. **Còn nợ.**
- **Không thử plugin trả phí** — Yoast Premium, WooCommerce Subscriptions, Bookings và các
  extension chính thức của WooCommerce đều cần license. Chúng là nhóm khách hàng thương mại
  hay dùng nhất, và **hoàn toàn chưa được đo**.
- **Chỉ 2 store, 20 sản phẩm mỗi store**, dữ liệu giản đơn.
- **WSL2**, không phải phần cứng đích.

## Phụ lục — lỗi harness lộ ra ở lần chạy đầu

Lần chạy đầu tiên **hỏng toàn bộ 11 dòng cuối** vì đúng cái bẫy mà đề bài đã cảnh báo:

`wp-super-cache` để lại `wp-cache-config.php` sau khi gỡ. Bước dọn dẹp của harness chỉ xoá
theo **danh sách cứng** (`advanced-cache.php`, `object-cache.php`, `db.php`) nên bỏ sót
file này. Kết quả: mọi plugin sau đó đều bị ghi `dropin=[wp-cache-config.php]` — quy tội
cho 11 plugin vô can. Cùng lúc `meta+39` là dư lượng của Stripe bị cộng dồn vào mọi dòng
sau.

Hai bản sửa:

1. Dọn **mọi** `wp-content/*.php` không có trong baseline, thay vì danh sách cứng.
2. Đo delta bảng global so với trạng thái **ngay trước plugin đó**, không so với baseline
   ban đầu.

Lỗi này thuộc loại nguy hiểm nhất: **nó cho ra một bảng trông hoàn chỉnh và hợp lý.** Nếu
không đối chiếu thì "11/14 plugin ghi drop-in" đã đi thẳng vào ADR — và đó là kết luận đủ
sức làm lung lay quyết định Multisite.
