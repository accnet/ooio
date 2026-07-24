# Spike Report #012 — Cache bypass theo cookie, và đính chính Spike #008

**Ngày:** 2026-07-23 · **Đính chính:** `REPORT-008-cache.md`
**Nền:** WSL2 · WordPress 7.0.2 Multisite · WooCommerce 10.9.4 · theme `twentytwentyfive`
(**block theme**) · store `/noisy/`, 20 sản phẩm
**Bằng chứng:** `results/cacheability.csv` · harness `measure-cacheability.sh` · mã nguồn
WooCommerce

Spike #008 kết luận `/shop/` và trang sản phẩm **không cache được**, trần cache thực tế chỉ
**15–40%**, và việc tách store notice là **điều kiện** để Protection layer 1 gánh nổi.

Báo cáo này gỡ bỏ kết luận đó. **Rào cản không tồn tại.**

## Kết quả

Ba phiên **ẩn danh độc lập** cùng gọi `/shop/`:

```
1 vs 2:  0 dòng khác
1 vs 3:  0 dòng khác
```

**Trang giống hệt từng byte.** Nó cache được, và luôn cache được — kể cả trước mọi thay đổi
thực hiện trong quá trình điều tra này.

## Sai lầm: hỏi sai câu

Spike #008 hỏi: *"hai khách khác nhau có nhận HTML giống nhau không?"*

Câu hỏi đó mô tả một kiến trúc cache **không ai dùng**: một bản lưu phục vụ cho tất cả.

Page cache thật sự hoạt động thế này:

```
request có cookie giỏ hàng   →  bypass cache, render tươi
không có                     →  phục vụ từ cache
```

Câu hỏi đúng là: **"trang ẩn danh có ổn định để lưu một lần không?"** — và câu trả lời là
**có**.

## WooCommerce đã tự nói điều này

`src/Blocks/Utils/BlocksSharedState.php:112`:

```php
if ( $cart_has_contents ) {
    self::prevent_cache();      // WC_Cache_Helper::set_nocache_constants() + nocache_headers()
}
```

WooCommerce **chủ động đánh dấu không-cache** khi giỏ có hàng. Đó không phải sơ suất — đó là
tín hiệu thiết kế. Và khách giữ giỏ nhận diện được bằng cookie, đo trực tiếp:

```
woocommerce_cart_hash
woocommerce_items_in_cart
```

Trung hoà HTML để phục vụ **một bản cho cả hai nhóm** là làm ngược lại điều WooCommerce
tuyên bố. Đi ngược một framework ở chỗ nó đã nói rõ ý định hiếm khi là ý hay.

## Ba lớp đã bóc, và vì sao cả ba đều không cần

Điều tra đi qua ba lớp trạng thái theo khách trên `/shop/`. Mỗi lớp **có thật** và **gỡ
được**, nhưng không lớp nào là điều kiện để cache.

| Lớp | Nội dung | Gỡ được? | Giá phải trả |
|---|---|---|---|
| 1. Store notice | `woocommerce/store-notices` block | ✅ 67→57 dòng | **một round-trip REST vào mọi trang** |
| 2. Nút Add to cart | `"tempQuantity":1` + nhãn "1 in cart" | ✅ 57→53 dòng | khách **không bật JS** thấy sai trạng thái nút |
| 3. Payload Interactivity API | toàn bộ `state.woocommerce.cart` | không làm | (dẫn tới phát hiện ở trên) |

Cả hai lớp đã hiện thực **đã được tắt đăng ký**, giữ code và test kèm 20 dòng ghi lại đo
được gì. Chúng vẫn đúng và vẫn có chỗ dùng: một edge cache **không vary được theo cookie**
sẽ cần đúng chúng.

## Ba lỗi phương pháp trong quá trình, đáng ghi hơn kết quả

### 1. Đo trên một store đã hỏng

Lần tái lập đường cơ sở đầu tiên báo `/shop/` **cacheable** — trông như vấn đề tự biến mất.
Truy nguyên:

```
/shop/         store-notices=0   woocommerce-block=3
/noisy/shop/   store-notices=1   woocommerce-block=54
```

Blog 1 đã **mất template WooCommerce**. Trang không còn render nội dung thật, nên "cacheable"
là hệ quả của hỏng hóc, không phải của sửa chữa. Harness mặc định đo `/`.

Đã đổi mặc định sang `/noisy/` kèm cách kiểm ngay trong comment:
`curl -s <store>/shop/ | grep -c wc-block-store-notices` phải là **1**.

**Bẫy này nguy hiểm vì nó cho kết quả TỐT HƠN sự thật** — không ai muốn nghi ngờ một tin tốt.

### 2. Kiểm bằng sản phẩm của store khác

Một phép đo tay cho **0 dòng khác** — trông như đã xong. Kiểm lại:

```
gio hang items: 0
```

Tôi hardcode `?add-to-cart=30`, nhưng sản phẩm 30 thuộc **blog 1**, không thuộc `/noisy/`.
Giỏ rỗng, nên tôi đang so **hai khách cùng ẩn danh**. Harness lấy đúng id qua
`wp post list --url=` nên số của nó mới đúng.

### 3. OPcache che mất bản sửa của chính mình

```
opcache.validate_timestamps => On
opcache.revalidate_freq     => 60
```

Sau khi thêm `wc_load_cart()` vào endpoint, đo lại vẫn thấy `{"html":""}` — suýt kết luận
bản sửa không hiệu quả. PHP đang phục vụ **bản cũ trong cache tới 60 giây**. Gửi `SIGUSR2`
cho php-fpm rồi đo lại thì đúng ngay.

> **Mọi thay đổi MU Plugin đo lại trong vòng 60 giây đều có thể là số của bản cũ.**

## Một lỗi thật đã tìm ra và sửa được

Endpoint `platform-core/v1/notices` trả `{"html":""}` dù trang có notice. Nguyên nhân đọc
được từ mã nguồn, không phải suy đoán:

`includes/class-woocommerce.php:660`

```php
case 'frontend':
    return ( ! is_admin() || defined( 'DOING_AJAX' ) )
        && ! defined( 'DOING_CRON' )
        && ! $this->is_rest_api_request();   // REST bị loại
```

`wc_load_cart()` — thứ khởi tạo `WC()->session` — **chỉ chạy cho frontend**. Trong REST,
`WC()->session` là `null` và `wc_get_notices()` trả mảng rỗng ngay tại
`wc-notice-functions.php:248`.

Cách sửa là khuôn mẫu chính WooCommerce dùng trong Store API của họ
(`StoreApi/Utilities/CartController.php:33`):

```php
if (function_exists('wc_load_cart') && !did_action('woocommerce_load_cart_from_session')) {
    wc_load_cart();
}
```

Sau khi sửa, endpoint trả đúng HTML của notice. Bản sửa **được giữ lại** — nó đúng bất kể
kiến trúc cache nào, và nó ghi lại một cái bẫy mà bất kỳ endpoint REST nào đọc trạng thái
WooCommerce cũng sẽ gặp.

## Ý nghĩa cho `ADR-005` và `DEPLOYMENT-PLAN`

**Trần cache 15–40% của Spike #008 không còn hiệu lực.** Nó dựa trên tiền đề sai.

Trần thật do **tỉ lệ lưu lượng không mang cookie giỏ hàng** quyết định. Với cửa hàng bán lẻ
điển hình, phần lớn lượt duyệt là khách chưa bỏ gì vào giỏ — nên mục tiêu **~90%** của
`ADR-005` **có thể đã đạt được sẵn**, không cần thay đổi WordPress nào.

⚠️ **Chưa khẳng định được** vì không có lưu lượng thật. Điều khẳng định được là: **rào cản
mà Spike #008 mô tả thì không tồn tại.**

Và `SA48` phải viết lại: không phải *"trung hoà HTML rồi cache"* mà **"cache + bypass theo
cookie"** — đơn giản hơn nhiều, không đụng WordPress, và khớp với ý định của WooCommerce.

## Giới hạn phải đọc kèm

- **Không có lưu lượng thật**, nên không có hit rate thật. Chỉ chứng minh được trang ẩn danh
  ổn định.
- **Chưa hiện thực cache bypass**, mới chứng minh điều kiện cho nó là đủ.
- **Chưa đo khách đã đăng nhập** — họ mang cookie `wordpress_logged_in_*` và gần như chắc
  chắn phải bypass. Đây là nhóm cần đo tiếp.
- **Một store, 20 sản phẩm, không đơn hàng, một theme.** Theme cổ điển (không phải block
  theme) render notice qua hook khác và có thể cho kết quả khác.
- **Phát hiện 4 của Spike #008 vẫn nguyên giá trị**: route mutation phải loại bằng **danh
  sách quy tắc**, không bằng so sánh thân trang.
