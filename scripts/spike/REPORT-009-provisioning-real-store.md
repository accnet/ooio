# Spike Report #009 — Provisioning một store THẬT, và Wordfence

**Ngày:** 2026-07-23 · **Thuộc:** `DEPLOYMENT-PLAN` giai đoạn B4
**Nền:** WSL2 16 vCPU · WordPress 7.0.2 Multisite · WooCommerce 10.9.4 · MariaDB 11.8.8
**Bằng chứng:** đo trực tiếp, n=3 mỗi cấu hình

Mục tiêu ban đầu là tìm điểm gãy `table_open_cache`. Phép đo đầu tiên — thời gian tạo một
store — ra **53 giây**, lệch **38×** so với con số 1,4 s mà `ADR-005` đang dựa vào. Việc
truy nguyên con số đó chiếm toàn bộ báo cáo này, và tìm ra hai thứ quan trọng hơn.

## Kết quả

| Cấu hình | Tạo site | Cài WooCommerce | **Tổng/store** |
|---|---|---|---|
| WordPress core trần (Spike #003/#004) | 1.461 ms | — | **1.461 ms** |
| Bộ plugin chuẩn **có** Wordfence | 21.881 ms | 31.254 ms | **53.135 ms** |
| Bộ plugin chuẩn **không** Wordfence | 1.736 ms | 6.004 ms | **7.740 ms** |

n=3 cho hai dòng dưới, độ lệch < 2%.

## Phát hiện 1 — Wordfence làm MỌI request chậm ~250×

Wordfence nằm trong `runtime/distribution/core-plugin-set.json`, tức **mọi store đều
nhận**. Đo trang chủ, bật/tắt để xác nhận cả hai chiều:

```
Wordfence BẬT :  21,57 s · 20,12 s · 20,10 s
Wordfence TẮT :   0,085 s ·  0,086 s ·  0,078 s
```

**~250×.** Tắt ba plugin còn lại (`ewww-image-optimizer`, `wp-mail-smtp`, `wordpress-seo`)
**không** thay đổi gì — 0,08–0,09 s. Chỉ mình Wordfence.

Bảng lưỡng phân đầy đủ:

| Tắt plugin | Trang chủ |
|---|---|
| wordfence | **0,104 s** ← trở lại bình thường ngay tại đây |
| ewww-image-optimizer | 0,082 s |
| wp-mail-smtp | 0,088 s |
| wordpress-seo | 0,079 s |

### Không phải chờ mạng

Giả thuyết đầu tiên là Wordfence gọi API và bị timeout — 20 s rất giống một timeout. Kiểm
tra bác bỏ:

```
https://noc1.wordfence.com/  →  HTTP 200 trong 0,70 s
DNS phân giải bình thường (3 bản ghi A)
```

**Nguyên nhân gốc chưa xác định.** Ghi lại nguyên trạng thay vì đoán. Ứng viên còn lại:
WAF của Wordfence chạy trước mọi request, hoặc quét 25 bảng `wp_wf*` mà nó tạo ở mức
network.

### Vì sao đây là vấn đề của Multisite, không chỉ của Wordfence

Wordfence được **network-activate**, nên chi phí đó áp lên **mọi store trong cluster**. Một
plugin bảo mật cấu hình sai không làm chậm một cửa hàng — nó làm chậm cả trăm cửa hàng.
Đây đúng là hình thái `ADR-005` cảnh báo, và Spike #007 đã ghi cho nhóm plugin cache: **cái
gì network-wide thì hỏng cũng network-wide.**

## Phát hiện 2 — Provisioning thật là 7,7 s/store, không phải 1,4 s

Kể cả sau khi bỏ Wordfence:

```
Spike #003/#004 (WordPress core trần):  1.461 ms
Store thật (WooCommerce + plugin set):  7.740 ms     ← chậm 5,3×
```

Tách theo bước: tạo site **1.736 ms** (khớp Spike #003 — phần này không đổi), cài
WooCommerce **6.004 ms** (78% tổng chi phí).

`Spike #004` đã ghi rõ giới hạn *"site không có WooCommerce đầy đủ; store thật có ~48–50
bảng"* và dự đoán sai lệch. Báo cáo này **định lượng** sai lệch đó: **5,3×**.

### Ý nghĩa cho ADR-005

`ADR-005` ghi lợi thế provisioning của Multisite là **1,6×** so với Isolated (1.461 ms vs
2.306 ms) — **cả hai đều đo trên WordPress core trần**.

Con số **tỉ lệ** nhiều khả năng vẫn giữ, vì bước đắt nhất (`WC_Install::install()`) chạy
giống nhau ở cả hai topology. Nhưng **con số tuyệt đối trong ADR phải sửa**: không được nói
"provisioning vài giây" khi thực tế là **~8 giây**, và Spike #004 Phát hiện 2 đã chỉ ra
Isolated còn có đường tối ưu (import database mẫu) mà Multisite không có.

**Chưa đo:** Isolated với cùng bộ plugin. Không có con số đó thì **không được** kết luận tỉ
lệ 1,6× còn đúng.

## Phát hiện 3 — Điều làm hỏng phép đo cũng làm hỏng chính buổi đo

Mục tiêu ban đầu (điểm gãy `table_open_cache`) **không đạt được**. Ở 53 s/store, tạo 120
store mất ~1,8 giờ. Sau khi bỏ Wordfence còn 7,7 s/store ⇒ ~15 phút, khả thi — nhưng chỉ
biết được điều đó **sau khi** đã truy ra thủ phạm.

Ghi lại vì nó là bài học về thứ tự: **đo thời gian một đơn vị trước khi lên lịch cho hàng
trăm đơn vị.** Nếu chạy thẳng vòng lặp 120 store, buổi đo sẽ treo 1,8 giờ và con số thu
được sẽ là con số của một môi trường đang hỏng.

## Việc phải quyết

**Wordfence không thể ship trong `core-plugin-set.json` ở trạng thái hiện tại.** Ba lựa
chọn, theo thứ tự tôi khuyến nghị:

1. **Bỏ khỏi bộ plugin chuẩn**, thay bằng bảo vệ ở tầng hạ tầng (rate limit ở Caddy, WAF ở
   CDN) — đúng với `ADR-005` Protection layer 1–2 vốn đã có. Bảo mật không biến mất, nó
   chuyển chỗ và chuyển sang chỗ **không nhân theo store**.
2. **Giữ nhưng phải cấu hình sẵn trong Distribution** và **đo lại** — chỉ hợp lệ nếu tìm
   được nguyên nhân gốc và chứng minh cấu hình đúng đưa chi phí về mức chấp nhận được.
3. Giữ nguyên — **không chấp nhận được**: 20 s mỗi request là store không dùng được.

Quyết định này thuộc về chủ sản phẩm, không thuộc về phép đo. Báo cáo dừng ở đây.

## Giới hạn phải đọc kèm

- **Nguyên nhân gốc của Wordfence chưa tìm ra.** Chỉ chứng minh được quan hệ nhân quả bằng
  bật/tắt hai chiều, chưa giải thích được cơ chế.
- **Wordfence chưa được cấu hình.** Đo ở trạng thái vừa network-activate. Có thể cấu hình
  đúng sẽ khác hẳn — đó chính là lựa chọn 2 ở trên.
- **Chưa đo Isolated với cùng bộ plugin**, nên không kết luận được về tỉ lệ 1,6×.
- **WSL2**, số tuyệt đối không dùng cho sizing; tỉ lệ giữa hai cấu hình thì dùng được.
- Store fixture giản đơn: 20 sản phẩm, không biến thể, không lưu lượng thật.
- **Điểm gãy `table_open_cache` vẫn chưa đo** — mục tiêu ban đầu của buổi này. Còn nợ.
