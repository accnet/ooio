# Spike Report #004 — Provisioning và Clone: Multisite vs Isolated

**Ngày:** 2026-07-22 · **Nền:** MySQL 8.4.10 (Docker, `:3310`), `table_open_cache=2000`,
`open_files_limit=1048576` · WordPress 7.0.2 · WSL2
**Bằng chứng:** `isolated-provisioning.csv` · `wpcli-mysql84.csv` · `store-lifecycle.csv`

Đây là báo cáo đầu tiên đo **cả hai topology trên cùng một database engine**. Spike
#001–#003 đều đo trên MariaDB 11.8, nên không so sánh trực tiếp được.

## Kết quả

| Phép đo | Multisite | Isolated | |
|---|---|---|---|
| **Provisioning** (wp-cli) | **1.461 ms** (n=50) | **2.306 ms** (n=100) | Isolated chậm 1,6× |
| **Clone** | **1.856 ms** (n=1) | **1.166 ms** (n=13) | Multisite chậm 1,6× |
| **Portability** | — | — | **chưa đo — xem cuối** |

Cả hai đường cong provisioning **phẳng qua toàn bộ mẫu** — không có suy giảm theo quy mô ở
mức đo được.

## Phát hiện 1 — Đổi engine gần như không ảnh hưởng

```
Multisite trên MariaDB 11.8  (Spike #003):  ~1.400 ms
Multisite trên MySQL 8.4     (báo cáo này):  1.461 ms     +4%
```

Điều này xác nhận việc chuyển MariaDB → MySQL 8.4 **không phải đánh đổi hiệu năng**. Nó
thuần tuý là quyết định về đường nâng cấp H2–H4 (binlog catch-up, semi-sync, Vitess) như
`ADR-006` yêu cầu.

## Phát hiện 2 — 87% chi phí provisioning của Isolated nằm ở một bước bỏ được

| Bước | p50 | Tỉ trọng |
|---|---|---|
| `CREATE DATABASE` | 31 ms | 1% |
| trải mã nguồn (symlink) | 32 ms | 1% |
| sinh `wp-config.php` | 249 ms | 11% |
| **`wp core install`** | **1.998 ms** | **87%** |

`wp core install` chạy installer đầy đủ: tạo bảng, seed options, tạo user, chạy hook. Thay
bằng **import một database mẫu** thì bước đó thành một `mysql < dump.sql`.

**Vì vậy con số 1,6× là khoảng cách giữa bản CHƯA tối ưu và bản ĐÃ tối ưu hết.** Multisite
không còn gì để tối ưu — `wpmu_create_blog` đã là đường ngắn nhất của nó. Isolated thì còn.

Tách theo bước là điều kiện để thấy điều này; một con số tổng "2,3 giây" sẽ dẫn tới kết
luận ngược.

## Phát hiện 3 — Chênh lệch thật của Clone không nằm ở thời gian

Thời gian gần nhau (1.856 vs 1.166 ms), nhưng số bước thì không:

| | Isolated | Multisite |
|---|---|---|
| Các bước | `mysqldump \| mysql` | copy từng bảng → viết lại tiền tố → cập nhật `wp_blogs` → tạo lại `wp_N_capabilities` trong `wp_usermeta` **global** → `search-replace` |
| Số điểm có thể sai | 1 | 5 |

**Cần ba lần sửa lỗi mới làm cho Multisite clone chạy đúng.** Ba lỗi đó là dữ liệu, không
phải phiền toái:

### 3a. `LIKE 'wp_2_%'` kéo nhầm bảng của 11 store khác

Trong SQL, `_` là **ký tự đại diện một ký tự**. Đo trên chính môi trường này:

```
LIKE 'wp\_2\_%'   →   10 bảng   (đúng: chỉ blog 2)
LIKE 'wp_2_%'     →  110 bảng   (sai: kéo cả wp_20_*, wp_21_*, …)
```

**Đây không phải lỗi của harness, mà là rủi ro cố hữu của mô hình tiền tố.** Bất kỳ đoạn
code nào lọc bảng theo `wp_N_` mà quên escape sẽ **trộn dữ liệu giữa các store** — và nó
chỉ lộ ra khi network đủ lớn để có blog hai chữ số. Ở môi trường 6 blog thì hoàn toàn im
lặng. Isolated không có lớp rủi ro này: ranh giới là database, không phải chuỗi tiền tố.

### 3b. MySQL 8.4 từ chối `CREATE TABLE ... LIKE` chính bảng WordPress vừa tạo

```
ERROR 1067 (42000): Invalid default value for 'comment_date'
```

WordPress tạo bảng với `DEFAULT '0000-00-00 00:00:00'` bằng cách **tự nới `sql_mode`**.
Phiên clone dùng `sql_mode` mặc định của MySQL 8.4 (có `NO_ZERO_DATE`) nên từ chối. MariaDB
dễ dãi hơn nên không gặp — đúng loại lỗi `infra/docker/README.md` cảnh báo: *chỉ lộ ra lúc
kết nối, không lộ lúc build*.

### 3c. `wp search-replace` không có cờ `--tables`

Bảng là **tham số vị trí**. Dùng sai làm clone fail **sau khi đã copy xong toàn bộ bảng** —
phần đắt tiền đã chạy, chỉ bước ghi lại URL hỏng. Một quy trình migration thật mà mắc lỗi
này sẽ để lại store nửa vời.

## Chưa đo: Portability

Harness `measure-store-portability.sh` đã sẵn sàng nhưng **chưa chạy được**: nó đòi bảng
`wp_2_wc_orders` (HPOS của WooCommerce). Cài WooCommerce cho 44 bảng nhưng **HPOS không
bật**; cả `dbDelta` thủ công lẫn `wp wc update` đều không tạo được bảng đó trong môi trường
này.

Kết luận cấu trúc thì đã chắc chắn (`class-wpdb.php:324`): Isolated cần **0** lần ánh xạ
user id vì user đi theo database; Multisite phải ánh xạ `post_author`, `comment_user_id`,
`customer_id` và khoá `wp_N_capabilities` vì `wp_users` là **global**. Nhưng **không có con
số nào được ghi ở đây mà chưa đo**.

## Giới hạn phải đọc kèm

- **Site không có WooCommerce đầy đủ.** Provisioning đo trên site core (12 bảng); store
  thật có ~48–50. Cùng sai lệch đã ghi ở Spike #002 và #003.
- **Clone Multisite n=1.** Đủ để chứng minh nó chạy và tốn bao nhiêu bước, chưa đủ để nói
  về phân phối.
- **WSL2, không phải phần cứng đích.** Số tương đối dùng được; số tuyệt đối thì không.
- **Chưa đo Delete và Upgrade Distribution** — hai phép đo còn lại trong
  `measure-store-lifecycle.sh`.

## Ý nghĩa cho ADR-005

Báo cáo này **không chốt** ADR-005. Nó bổ sung:

- Isolated **không chậm hơn về bản chất** — chi phí tập trung ở một bước thay được.
- Clone của Multisite **phức tạp hơn hẳn**, và độ phức tạp đó **sinh ra lỗi thật** — ba lỗi
  trong ba lần thử, trong đó một lỗi (3a) có thể **trộn dữ liệu giữa các tenant** mà không
  báo gì.

Điểm cuối đáng cân nhắc cùng luận điểm PII đã ghi trong `ADR-005`: với Multisite, ranh giới
giữa các store là **một quy ước đặt tên**, và quy ước thì có thể viết sai.
