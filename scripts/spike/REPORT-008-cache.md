# Spike Report #008 — Store WooCommerce cache được bao nhiêu

**Ngày:** 2026-07-23 · **Đóng:** `ADR-005` Exit Criteria **#2**, phần B1
**Nền:** WSL2 · WordPress 7.0.2 Multisite · WooCommerce 10.9.4 · Redis object cache ·
`pm.max_children = 10` · store fixture 20 sản phẩm
**Bằng chứng:** `results/cacheability.csv` · `results/isolation.csv` · harness
`measure-cacheability.sh`

Spike #005 chứng minh request **không chạm PHP** thì miễn nhiễm tuyệt đối với noisy
neighbor (1,0× ở mức tải làm PHP chậm 12,9×) — nhưng đo trên **file tĩnh**. `ADR-005` đặt
mục tiêu **~90% request không chạm PHP**. Báo cáo này hỏi: mục tiêu đó có thật không.

## 🛑 ĐÍNH CHÍNH 2026-07-23 — kết luận chính của báo cáo này SAI

**Đọc `REPORT-012-cache-bypass.md` trước khi dùng bất kỳ con số nào dưới đây.**

Báo cáo này hỏi: *"hai khách khác nhau có nhận HTML giống nhau không?"* — và kết luận
`/shop/` cùng trang sản phẩm **không cache được**, trần cache thực tế **15–40%**.

**Câu hỏi đó sai.** Page cache không phục vụ một bản cho tất cả; nó **bypass** cho khách
đang giữ giỏ hàng. WooCommerce nhận diện họ bằng cookie `woocommerce_items_in_cart` /
`woocommerce_cart_hash`, và **tự gọi `nocache_headers()` cho họ**
(`BlocksSharedState.php:112`).

Câu hỏi đúng là: *"trang ẩn danh có ổn định để lưu một lần không?"* Đo 2026-07-23, ba phiên
ẩn danh độc lập trên `/shop/`:

```
1 vs 2:  0 dòng khác
1 vs 3:  0 dòng khác
```

**`/shop/` cache được, và luôn cache được** — kể cả trước mọi thay đổi.

Phần **vẫn đúng** của báo cáo này: phân loại route nào mang trạng thái theo khách, đo cache
hit/miss (98 ms vs 158 ms), và bốn phát hiện về phương pháp — đặc biệt Phát hiện 4 (so thân
trang không phát hiện được tác dụng phụ) vẫn là ràng buộc thiết kế bắt buộc.

Phần **sai**: mục *"Ý nghĩa cho ADR-005"*, bảng ba kịch bản hit rate, và yêu cầu tách store
notice như **điều kiện**.

---

## ⚠️ Báo cáo này KHÔNG đưa ra con số hit rate

Không có lưu lượng thật. Một con số "hit rate 9x%" ở đây sẽ là **bịa**. Thay vào đó là
**tính chất từng route** đo bằng thực nghiệm, và một **công thức** để người đọc thay tỉ lệ
lưu lượng của họ vào.

## Cách đo

Mỗi route được gọi bằng **hai khách khác nhau** — một ẩn danh, một đã có giỏ hàng — rồi so
sánh HTML. Khác nhau ⇒ không dùng chung một bản cache được.

Kèm **một phép đối chứng bắt buộc**: gọi hai lần bằng **cùng một khách ẩn danh**. Nếu hai
lần đó đã khác nhau thì trang render không tất định và mọi so sánh phía trên vô nghĩa.
Phép đối chứng này đã cứu báo cáo — xem Phát hiện 3.

## Kết quả phân loại

| Route | Tất định | Dòng khác | Kết luận |
|---|---|---|---|
| trang chủ | ✅ | 51 | **cacheable — chỉ khác prefetch** |
| danh mục | ✅ | 51 | **cacheable — chỉ khác prefetch** |
| tìm kiếm `?s=` | ✅ | 51 | **cacheable — chỉ khác prefetch** |
| `wp-json/wc/store/v1/products` | ✅ | 0 | **cacheable** |
| feed | ✅ | 0 | **cacheable** |
| shop | ✅ | 67 | ❌ không — có store notice |
| sản phẩm | ✅ | 53 | ❌ không — có store notice |
| my-account | ✅ | 53 | ❌ không |
| checkout | ✅ | 335 | ❌ không |
| cart | ❌ | 54 | ❌ không (đúng bản chất) |
| `?add-to-cart=` | ✅ | 0 | ⚠️ **thân giống nhau nhưng TUYỆT ĐỐI không được cache** — xem Phát hiện 4 |

## Phát hiện 1 — Phần lớn khác biệt chỉ là gợi ý prefetch, không phải nội dung

Trang chủ khác nhau **51 dòng** giữa hai khách. Toàn bộ 51 dòng đó là:

```html
<link href='.../blocks/cart-frontend.js?ver=...' as='script' rel='prefetch' />
<link href='.../wc-cart-checkout-base-frontend.js?ver=...' as='script' rel='prefetch' />
...
```

WooCommerce chèn gợi ý tải trước cho script giỏ hàng **khi khách đã có giỏ**. Đây là **gợi
ý hiệu năng, không phải nội dung**: cùng một thân HTML vẫn đúng cho mọi khách.

**Nếu đếm thô "51 dòng khác ⇒ không cache được" thì sẽ loại nhầm trang chủ, danh mục và
tìm kiếm** — ba route thuộc nhóm lưu lượng lớn nhất của một cửa hàng. Harness vì vậy tách
riêng trường hợp "chỉ khác prefetch".

## Phát hiện 2 — Thứ thật sự chặn cache là store notice, không phải nội dung sản phẩm

`/shop/` và trang sản phẩm **có** khác biệt nội dung thật. Lọc bỏ prefetch còn **16 dòng**:

```html
<div class="wc-block-components-notice-banner is-success" role="alert">
```

Đó là thông báo *"đã thêm vào giỏ"* — một **flash message theo phiên**, WooCommerce chèn
vào **bất kỳ trang nào** sau hành động của khách. Danh sách sản phẩm, giá, tồn kho **không
khác gì nhau**.

Hệ quả rất khác nhau tuỳ cách hiện thực:

- Cache HTML nguyên trang ⇒ `/shop/` **không** cache được.
- Cache nguyên trang + đẩy notice sang **fragment/AJAX** ⇒ `/shop/` và trang sản phẩm
  **cache được**.

Nói cách khác: **rào cản là kiến trúc notice, không phải bản chất thương mại của trang.**
Đây là đòn bẩy lớn nhất để tăng tỉ lệ không-chạm-PHP.

## Phát hiện 3 — Phép đối chứng bắt được một kết luận sai

Lần chạy đầu, trang sản phẩm bị đánh dấu **RENDER-KHÔNG-TẤT-ĐỊNH**: hai lần gọi bằng cùng
một khách ẩn danh đã khác nhau. Nếu tin thẳng thì kết luận sẽ là "trang sản phẩm không thể
cache" — sai hoàn toàn.

Khác biệt thật:

```
< <label class="screen-reader-text" for="quantity_6a610db0527a1">
> <label class="screen-reader-text" for="quantity_6a610db0689de">
```

WooCommerce sinh **id DOM ngẫu nhiên** (`uniqid()`) mỗi lần render để nối nhãn screen-reader
với ô nhập số lượng. Thuần thẩm mỹ, không ảnh hưởng tính đúng đắn của bản cache.

Không có phép đối chứng anon-vs-anon thì lỗi này sẽ **im lặng** biến thành "trang sản phẩm
không cache được" trong ADR.

## Phát hiện 4 — So thân trang KHÔNG phát hiện được tác dụng phụ

`?add-to-cart=30` cho **0 dòng khác** giữa hai khách. Theo tiêu chí "thân giống nhau" thì
nó *cacheable*. **Sai nguy hiểm.**

Đó là một **thao tác thay đổi trạng thái**: mỗi lần gọi là một lần thêm hàng vào giỏ. Cache
nó lại thì khách thứ hai nhận phản hồi của khách thứ nhất **và giỏ hàng không được cập
nhật**.

> **Giới hạn của phương pháp:** so sánh thân trang chỉ trả lời *"phản hồi có riêng cho từng
> khách không"*. Nó **không** trả lời *"gọi route này có làm đổi trạng thái máy chủ không"*.
> Route mutation phải được loại bằng **danh sách quy tắc**, không bằng đo.

Harness đánh dấu route này bằng cờ `Set-Cookie` — điều kiện cần, nhưng **không đủ**. Ghi ra
đây để không ai đọc bảng rồi kết luận nhầm.

## Phát hiện 5 — Cache miss đắt gấp 1,7×, và đó mới chỉ là object cache

Cùng một trang sản phẩm, đo 5 lần mỗi bên:

| | Thời gian |
|---|---|
| Redis object cache **hit** | 92–103 ms (p50 **98 ms**) |
| **miss** (`wp cache flush` trước mỗi lần) | 153–195 ms (p50 **158 ms**) |
| chênh lệch | **1,7×** |

Lưu ý đây là **object cache**, không phải page cache — cả hai trường hợp đều **vẫn chạy
PHP**. Một page cache hit thật sự sẽ ở mức của Spike #005: **~1 ms**.

Ba mức chênh nhau hai bậc độ lớn:

```
page cache hit  (không chạm PHP)   ~1 ms
object cache hit (chạy PHP)        ~98 ms
object cache miss (chạy PHP)      ~158 ms
```

## Phát hiện 6 — Tỉ lệ suy giảm là tính chất của HÀNG ĐỢI, không phải của trang

Chạy lại `measure-isolation.sh` với nạn nhân là **trang sản phẩm WooCommerce thật**, 100
client:

| Nạn nhân | baseline | dưới tải | suy giảm |
|---|---|---|---|
| WordPress core (Spike #005) | 77 ms | 993 ms | **12,9×** |
| WooCommerce sản phẩm (báo cáo này) | 96 ms | 1.099 ms | **11,4×** |

**Dự đoán của tôi khi giao việc là sai.** Tôi viết trong đề bài rằng WooCommerce sẽ suy
giảm *tệ hơn* vì trang nặng hơn giữ worker lâu hơn. Thực tế **tỉ lệ gần như không đổi**
(11,4× vs 12,9×), dù độ trễ tuyệt đối cao hơn ở cả hai đầu.

Lý do: tỉ lệ ≈ `số client ÷ pm.max_children`. Trang nặng làm **cả baseline lẫn dưới tải**
tăng cùng hệ số, nên thương số không đổi. Ghi lại vì đây là lần dự đoán trong acceptance
criteria bị số liệu bác — và acceptance criteria đã yêu cầu báo cáo nếu điều đó xảy ra.

## Công thức — thay tỉ lệ lưu lượng của bạn vào

```
tỉ lệ không chạm PHP  =  Σ (tỉ lệ lưu lượng của route i × cacheable(i))
```

Với **kiến trúc hiện tại** (cache nguyên trang, notice nằm trong HTML):

| Nhóm | cacheable? |
|---|---|
| trang chủ · danh mục · tìm kiếm · feed · REST đọc | ✅ |
| shop · trang sản phẩm | ❌ (chỉ vì store notice) |
| cart · checkout · my-account · add-to-cart | ❌ |

Với **notice tách sang fragment/AJAX**, `shop` và trang sản phẩm chuyển sang ✅ — và đó
thường là hai route chiếm tỉ trọng lớn nhất của một cửa hàng.

**Ba kịch bản minh hoạ dưới đây dùng tỉ lệ lưu lượng GIẢ ĐỊNH, không phải đo được:**

| Kịch bản (giả định) | duyệt | shop+sp | giỏ/checkout/tài khoản | Hiện tại | Nếu tách notice |
|---|---|---|---|---|---|
| A — nhiều người xem, ít mua | 40% | 50% | 10% | 40% | 90% |
| B — cân bằng | 25% | 55% | 20% | 25% | 80% |
| C — tỉ lệ chuyển đổi cao | 15% | 50% | 35% | 15% | 65% |

## Ý nghĩa cho ADR-005

> **Mục tiêu ~90% KHÔNG đạt được với kiến trúc cache mặc định — nhưng đạt được nếu tách
> store notice ra khỏi HTML nguyên trang.**

Đây là điều kiện cụ thể, không phải "cần tối ưu thêm":

1. **Tách store notice sang fragment/AJAX.** Đây là việc mở khoá `shop` + trang sản phẩm —
   hai route quyết định. Không làm thì trần thực tế nằm ở mức **15–40%**, không phải 90%.
2. **Bỏ `Set-Cookie` trên route đọc**, hoặc cấu hình cache bỏ qua cookie WooCommerce khi
   giỏ rỗng.
3. **Chấp nhận mất gợi ý prefetch** cho khách có giỏ hàng, hoặc vary theo cookie giỏ hàng
   (hai bản cache thay vì một).
4. **Loại route mutation bằng danh sách quy tắc**, không bằng đo — xem Phát hiện 4.

Nếu 1 không làm được, `ADR-005` phải hạ mục tiêu và Protection layer 1 **không còn là lớp
gánh chính** — khi đó layer 3 (pool riêng) phải gánh nhiều hơn, mà layer 3 lại **không mở
rộng tới mọi store**.

## Giới hạn phải đọc kèm

- **Không có lưu lượng thật.** Mọi con số tổng trong bảng kịch bản là **giả định**, đã ghi
  rõ. Chỉ phần phân loại route là đo được.
- **Chưa cài page cache thật.** Đo là *tính chất* route, không phải hiệu năng của một sản
  phẩm cache cụ thể. Việc thử plugin cache thuộc `SA45`.
- **Store fixture đơn giản**: 20 sản phẩm giản đơn, một danh mục, không biến thể, không
  khuyến mãi, không thuế theo vùng, không đa tiền tệ. Mọi thứ đó **đều làm giảm** khả năng
  cache.
- **Chưa đo khách đã đăng nhập.** Khách đăng nhập gần như luôn phá cache nguyên trang.
- **WSL2**, số tuyệt đối không dùng cho sizing; số tương đối thì dùng được.
- Store notice là **flash message**: nó chỉ xuất hiện sau hành động. Một khách chỉ duyệt
  sẽ **không** kích hoạt nó — nghĩa là tỉ lệ thực tế có thể **cao hơn** bảng trên. Chưa đo
  được vì cần lưu lượng thật.

## Phụ lục — hai lỗi harness lộ ra khi chạy thật

| # | Lỗi | Hậu quả |
|---|---|---|
| 1 | Dùng **chung một cookie jar ẩn danh** cho mọi route | Route trước để lại cookie giỏ hàng, khiến hai "khách" thành một; `?add-to-cart=` bị báo là **cacheable** — ngược hoàn toàn sự thật |
| 2 | Không chuẩn hoá `quantity_<uniqid>` | Trang sản phẩm bị báo **render không tất định**, dẫn tới kết luận "không cache được" |

Cả hai đều thuộc loại **cho ra kết quả trông hợp lý**. Lỗi 1 chỉ lộ ra vì kết quả
`add-to-cart = cacheable` mâu thuẫn với hiểu biết cơ bản về WooCommerce; lỗi 2 chỉ lộ ra
nhờ phép đối chứng anon-vs-anon.
