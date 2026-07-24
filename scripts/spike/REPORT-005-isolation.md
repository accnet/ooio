# Spike Report #005 — Isolation Benchmark (noisy neighbor)

**Ngày:** 2026-07-22 · **Đáp ứng:** `ADR-005` Exit Criteria **#2**
**Nền:** WSL2, 16 vCPU · PHP 8.3.31 · MariaDB 11.8.8 · Caddy 2.6.4 · WordPress Multisite
subdirectory, `pm.max_children = 10`
**Bằng chứng:** `results/isolation.csv` · harness `measure-isolation.sh`

Câu hỏi: **khi một store trong network làm bão hoà PHP-FPM pool dùng chung, store KHÁC
trong cùng network chậm đi bao nhiêu — và bốn lớp Protection của ADR-005 chặn được không?**

## Kết quả

| Biện pháp | Tải lên store gây ồn | Store nạn nhân | Suy giảm p50 | Suy giảm p95 |
|---|---|---|---|---|
| **Không có** | 10 client | 78 → 123 ms | 1,6× | 1,7× |
| **Không có** | 20 client | 78 → 200 ms | 2,6× | 2,9× |
| **Không có** | 30 client | 78 → 309 ms | 4,0× | 4,6× |
| **Không có** | 50 client | 79 → 512 ms | 6,5× | 8,7× |
| **Không có** | 100 client | 77 → 993 ms | **12,9×** | **24,1×** |
| **Đường không chạm PHP** | 100 client | 1 → 1 ms | **1,0×** | 1,0× |
| **PHP-FPM pool riêng** | 30 client | 76 → 74 ms | **1,0×** | 1,0× |
| **PHP-FPM pool riêng** | 100 client | 76 → 74 ms | **1,0×** | 0,9× |

## Phát hiện 1 — Thiệt hại KHÔNG có trần, và tuyến tính theo số client

```
client:      10     20     30     50     100
suy giảm:   1,6×   2,6×   4,0×   6,5×   12,9×
```

Đường này **không bão hoà**. Nó khớp lý thuyết hàng đợi: mỗi worker chỉ phục vụ một
request, nên độ trễ ≈ thời gian phục vụ × (số client ÷ `pm.max_children`). Suy ra:

> Store gây ồn **không cần tấn công** — nó chỉ cần *đông khách*. 100 client đồng thời là
> lưu lượng của một chiến dịch quảng cáo bình thường, không phải DDoS. Với 1.000 client,
> hàng xóm chậm ~130×, tức là **hỏng**.

Đây là lý do "noisy neighbor" không thể để lại dạng cảnh báo suông trong ADR: **không có
cơ chế tự giới hạn nào trong Multisite + PHP-FPM.**

## Phát hiện 2 — Request không chạm PHP thì miễn nhiễm tuyệt đối

Ở đúng mức tải làm store PHP chậm **12,9×**, một tài nguyên do Caddy phục vụ trực tiếp
(`file_server`, không qua FastCGI) giữ nguyên **1 ms**:

```
PHP:     77 ms  →  993 ms     (12,9×)
tĩnh:     1 ms  →    1 ms     ( 1,0×)
```

**Điều này xác nhận Protection layer 1 (`CDN + Cache`) là lớp GÁNH CHÍNH, không phải một
trong bốn lớp ngang hàng.** Mục tiêu "~90% request không chạm PHP" trong ADR-005 nay có cơ
sở định lượng: mỗi phần trăm request bị đẩy xuống PHP là một phần trăm chịu hệ số suy giảm
ở Phát hiện 1.

⚠️ Đây là đo **file tĩnh**, chưa phải **FastCGI cache cho trang HTML**. Nó chứng minh *cơ
chế* (bỏ qua PHP thì miễn nhiễm), chưa chứng minh *sản phẩm* (page cache đạt hit rate bao
nhiêu trên store WooCommerce thật — giỏ hàng và checkout vốn không cache được).

## Phát hiện 3 — PHP-FPM pool riêng cô lập HOÀN TOÀN

Cấu hình đo: store gây ồn được cấp pool riêng `pm.max_children = 3`, Caddy định tuyến theo
đường dẫn:

```caddyfile
@noisy path /noisy/*
php_fastcgi @noisy unix//.../php-fpm-noisy.sock
php_fastcgi unix//.../php-fpm.sock
```

Kết quả ở **100 client**: nạn nhân **74 ms** — *nhanh hơn* baseline 76 ms trong sai số đo.
Suy giảm **1,0×**, so với **12,9×** khi dùng chung pool.

### Và chính store gây ồn phải trả giá

| Đo trên store gây ồn, 100 client, pool riêng 3 worker | |
|---|---|
| baseline | 75 ms |
| under load | **2.289 ms** |
| suy giảm | **30,5×** (p95 **45,3×**) |

Đây là tính chất **đúng như mong muốn**: thiệt hại bị nhốt trong store gây ra nó. Hàng xóm
1,0×, thủ phạm 30,5×.

## Ý nghĩa cho ADR-005

**Exit Criteria #2 coi như đã đo.** Chiến lược `Detect → Throttle → Move → Dedicated` được
số liệu ủng hộ, nhưng phải sửa lại thứ tự ưu tiên:

| Lớp ADR-005 | Trạng thái sau đo |
|---|---|
| 1. CDN + Cache | ✅ **chứng minh là lớp gánh chính** — 1,0× ở mức tải làm PHP chậm 12,9× |
| 2. Rate limit theo hostname | chưa đo — Caddy bản chuẩn không có, cần plugin |
| 3. PHP worker budget | ✅ **chứng minh cô lập hoàn toàn** — 1,0× ở 100 client |
| 4. Scheduler + Migration | không đo được ở đây; và `Move` nay là thao tác nặng (ADR-005) |

**Lớp 3 không mở rộng tới mọi store.** Không thể chạy 300 PHP-FPM pool trên một node — mỗi
pool cần worker riêng, và tổng worker bị chặn bởi RAM. Vì vậy lớp 3 là công cụ **theo
tier**, đúng như ADR-005 viết (*"các gói cao cấp có thể tách PHP-FPM pool riêng"*):

```
Basic / Pro   →  pool dùng chung  →  dựa vào lớp 1 (cache) để sống sót
Store nặng    →  pool riêng       →  cô lập 1,0×, tự chịu 30,5×
```

Nói cách khác: **lớp 1 bảo vệ số đông, lớp 3 xử lý cá biệt.** Không có lớp 1, nền tảng
không chịu nổi một store đông khách.

## Giới hạn phải đọc kèm

- **`pm.max_children = 10`** là cấu hình dev, production sẽ cao hơn. Nhưng hệ số suy giảm
  là **tỉ lệ** `client ÷ max_children`, nên kết luận không đổi — chỉ dịch điểm gãy.
- **Store là WordPress core, không phải WooCommerce đầy đủ.** Trang WooCommerce nặng hơn
  ⇒ mỗi worker bị giữ lâu hơn ⇒ **suy giảm tệ hơn**, không nhẹ hơn. Cùng sai lệch đã ghi ở
  Spike #002/#003/#004.
- **Multisite subdirectory, một hostname.** Lớp 2 (rate limit theo hostname) vì vậy không
  đo được ở môi trường này.
- **WSL2, 16 vCPU, tải sinh từ cùng máy.** Client và server tranh CPU; số tuyệt đối không
  dùng được, số tương đối thì dùng được.
- **Không đo MySQL và Redis.** Một store làm quá tải MySQL sẽ ảnh hưởng hàng xóm qua đường
  khác mà pool riêng **không** chặn — pool riêng chỉ tách worker PHP, không tách database.
  **Đây là khoảng trống lớn nhất còn lại của tiêu chí #2.**
- **Cột `mitigation` trong CSV của lần chạy này được gán sau** theo nhật ký chạy; harness
  đã được sửa để tự ghi nhãn từ cấu hình sống ở các lần chạy sau.

## Việc còn lại của Exit Criteria #2

1. Đo **FastCGI page cache thật** trên store WooCommerce — hit rate là con số quyết định
   lớp 1 có gánh nổi không.
2. Đo **cô lập ở tầng MySQL** — pool PHP riêng không bảo vệ được database dùng chung.
3. Đo **rate limit theo hostname** khi môi trường có nhiều hostname.
