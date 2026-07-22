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
| **Delete** | **962 ms** (n=6) | **306 ms** (n=9) | Multisite chậm **3,8×** |
| **Upgrade Distribution** | *(một codebase)* | **symlink 21 ms** / copy 1.351 ms | xem Phát hiện 4 |
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

## Phát hiện 4 — Delete là chỗ Multisite thua nặng nhất

| | Multisite | Isolated |
|---|---|---|
| Cách làm | `wpmu_delete_blog(N, true)` — xoá 10 bảng trong database dùng chung | `DROP DATABASE` + `rm -rf` |
| Thời gian | **962 ms** | **306 ms** |
| Dung lượng thu hồi | 560 KB | 680 KB |

**Chậm 3,8×**, và khoảng cách sẽ giãn thêm với store WooCommerce thật (~50 bảng thay vì 10).
Đây là thao tác diễn ra **nhiều hơn tạo** trong vòng đời một nền tảng.

## Phát hiện 5 — Phép đo lẽ ra bênh Multisite lại cho kết quả ngược

`Upgrade Distribution` được đưa vào bộ đo **vì nó là phép đo duy nhất có khả năng nghiêng
về Multisite** — lợi thế "một codebase, cập nhật một lần cho cả network". Kết quả:

| Cách của Isolated | Thời gian/store | File tạo | Đĩa thêm |
|---|---|---|---|
| **symlink tới codebase chung** | **21 ms** | 1 | **0 MB** |
| copy riêng mỗi store | 1.351 ms | 10.818 | **145 MB** |

Chênh **64×** về thời gian và **145 MB mỗi store**.

**Isolated dùng symlink đạt đúng thứ Multisite tự hào:** cập nhật Distribution = thay bản
gốc một lần, cả N store thấy ngay, không tốn thêm byte nào. Với 1.000 store: symlink
**0 GB**, copy riêng **145 GB** — nên "copy riêng" không phải phương án nghiêm túc, và
**so sánh công bằng là Multisite vs Isolated-symlink: hai bên bằng nhau**.

Đây là lý do phải đo cả hai cách của Isolated. Nếu chỉ đo bản copy riêng, kết quả sẽ kết
luận sai rằng Multisite có lợi thế 64× ở khâu này.

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
- **Delete n=6/9, Upgrade n=3** — đủ để thấy khoảng cách, chưa đủ nói về phân phối.

## Ý nghĩa cho ADR-005

Báo cáo này **không chốt** ADR-005. Nó bổ sung:

- Isolated **không chậm hơn về bản chất** — chi phí tập trung ở một bước thay được.
- Clone của Multisite **phức tạp hơn hẳn**, và độ phức tạp đó **sinh ra lỗi thật** — ba lỗi
  trong ba lần thử, trong đó một lỗi (3a) có thể **trộn dữ liệu giữa các tenant** mà không
  báo gì.

- Delete — thao tác lặp lại nhiều nhất trong vòng đời — Multisite **chậm 3,8×**.
- Lợi thế "một codebase" của Multisite **không còn là lợi thế**: Isolated dùng symlink đạt
  cùng kết quả với 21 ms và 0 byte thêm mỗi store.

Điểm cuối đáng cân nhắc cùng luận điểm PII đã ghi trong `ADR-005`: với Multisite, ranh giới
giữa các store là **một quy ước đặt tên**, và quy ước thì có thể viết sai.

## Phụ lục — sáu lỗi harness lộ ra khi chạy thật

Harness được viết nhưng chưa từng chạy; sáu lỗi chỉ xuất hiện khi đo thật. Ghi lại vì hai
lỗi cuối thuộc loại nguy hiểm nhất: **chúng cho ra con số trông hợp lý**.

| # | Lỗi | Hậu quả |
|---|---|---|
| 1 | `mysqldump` nhận cờ `--batch`/`--skip-column-names` của client `mysql` | mọi dump/restore fail |
| 2 | vòng lặp dùng process substitution | không đọc được danh sách bảng |
| 3 | `LIKE 'wp_2_%'` không escape | kéo 110 bảng thay vì 10 |
| 4 | `CREATE TABLE ... LIKE` dưới `sql_mode` nghiêm ngặt | MySQL 8.4 từ chối bảng WordPress vừa tạo |
| 5 | `wp search-replace --tables` (cờ không tồn tại) | clone fail **sau khi** đã copy xong bảng |
| 6 | `record_operation` multisite delete **thiếu một cột** | mọi giá trị lệch trái: `elapsed 1.022 ms` bị ghi thành `0.435 ms` |
| 7 | `read -r _ before _ ...` bỏ qua trường đầu | ghi `data_length 180224` vào cột số bảng |

Lỗi 6 và 7 **không làm chương trình dừng** — chúng ghi số sai vào CSV. Chỉ phát hiện được
vì `0.435 ms` mâu thuẫn với trực giác "xoá 10 bảng không thể nhanh hơn nửa mili giây".
Một báo cáo dựa trên số đó sẽ dẫn tới quyết định kiến trúc sai.
