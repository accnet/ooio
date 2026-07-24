# Spike Report #010 — Điểm gãy `table_open_cache`, và một biến sai trong công thức sizing

**Ngày:** 2026-07-23 · **Thuộc:** `DEPLOYMENT-PLAN` B4
**Nền:** WSL2 16 vCPU · MariaDB 11.8.8 · `table_open_cache = 4000` · 125 store WooCommerce
thật (mỗi store ~53–61 bảng)
**Bằng chứng:** `results/table-cache-breakpoint.csv` · harness
`measure-table-cache-breakpoint.sh`

Spike #002 chứng minh `Open_tables` bão hoà đúng bằng `table_open_cache`. Nó **không** cho
biết điều gì xảy ra **sau** bão hoà. Đó mới là câu hỏi đứng sau con số "bao nhiêu store mỗi
cluster".

## Kết quả — không có điểm gãy trong toàn dải đo

| Store | Tổng bảng | `Open_tables` | `Opened`/request | p50 nạn nhân |
|---|---|---|---|---|
| 15 | 879 | 870 | 0 | 78 ms |
| 45 | 2.469 | 2.400 | 0 | 61 ms |
| 75 | 4.059 | 3.930 | 0 | 60 ms |
| **85** | 4.589 | **4.000 (đầy)** | **0** | 61 ms |
| 105 | 5.649 | 4.000 | 0 | 60 ms |
| **125** | **6.709** | 4.000 | **0** | **62 ms** |

`Open_tables` chạm trần 4.000 từ mốc 85 store — **đúng như Spike #002**. Nhưng
`Opened_tables` **không tăng một lần nào**, và độ trễ **phẳng tuyệt đối** từ 45 tới 125
store, dù tổng số bảng (6.709) **gấp 1,7 lần** dung lượng cache.

Nạn nhân đo là `/noisy/` — **store đã tồn tại từ trước**, không phải store vừa tạo. Đo
store mới sẽ cho số đẹp giả vì bảng của nó còn nóng.

## Phát hiện 1 — Kể cả khi MỌI store cùng nhận lưu lượng vẫn không thrash

Giả thuyết tiếp theo: không thrash vì chỉ một store có lưu lượng. Kiểm bằng cách gọi luân
phiên **tất cả** store, hai vòng, sau một vòng nạp nóng:

| Store hoạt động đồng thời | `Opened_tables` thêm | mỗi request |
|---|---|---|
| 5 | 0 | 0,0 |
| 40 | 0 | 0,0 |
| 80 | 0 | 0,0 |
| **125 (toàn bộ)** | **0** | **0,0** |

Độ trễ 68 ms → 77 ms trên toàn dải. **Không thrash ở bất kỳ mức nào.**

## Phát hiện 2 — Vì sao: tập bảng NÓNG nhỏ hơn nhiều số bảng sở hữu

```sql
SHOW OPEN TABLES FROM ooio_wp WHERE `Table` LIKE 'wp\_3\_%'   →  14
SELECT COUNT(*) ... WHERE table_name LIKE 'wp\_3\_%'          →  61
```

Store blog 3 **sở hữu 61 bảng** nhưng chỉ **14 bảng nằm trong cache**. Một request duyệt
web đọc options, posts, postmeta, terms, users… — nó **không** chạm `wc_orders`,
`wc_tax_rate_classes`, `actionscheduler_*` và phần lớn bảng thương mại.

Cache LRU giữ đúng tập đang dùng. Bảng của store không có lưu lượng nằm ngoài cache và
**không gây chi phí gì**.

## Phát hiện 3 — Công thức sizing dùng SAI BIẾN, và Spike #002 đã có biến đúng

Spike #002 viết rõ:

```
Số store tối đa ≈ table_open_cache ÷ số bảng NÓNG mỗi store
Ngưỡng đo được: 105 × 19 = 1.995 ≈ table_open_cache 2.000
```

**19 bảng nóng.** Nhưng `install-node.sh` lại dùng **tổng số bảng** — và comment trong file
còn ghi nhầm là *"Spike #002 measured 50 hot tables per store"*. Spike #002 đo **19**; số
50 là **tổng** bảng, một đại lượng khác.

Hai phép đo hoàn toàn nhất quán khi dùng đúng biến:

| | `table_open_cache` | bảng nóng | trần lý thuyết | quan sát |
|---|---|---|---|---|
| Spike #002 | 2.000 | 19 | ~105 | thrash giữa 105–120 ✅ |
| Spike #010 | 4.000 | 14 | **~285** | 125 store không thrash ✅ |

### Tôi đã làm cho nó tệ hơn trước khi phát hiện

Sáng cùng ngày, ở bước B4a, tôi sửa hệ số **50 → 65** sau khi đo bộ plugin chuẩn thêm 5
bảng/store. Phép đo đó **đúng** — nhưng nó đo *tổng* bảng, tức đại lượng đằng nào cũng
không nên nằm trong công thức. Kết quả là tôi **tăng mức cấp dư** thay vì sửa lỗi.

Nó cũng chính là thứ đẩy `open_files_limit` lên **78.000** ở mật độ 500 store và làm tôi
tưởng `fs.file-max = 100.000` của WSL là ràng buộc. Sửa đúng biến thì áp lực đó biến mất.

### Công thức sau khi sửa

`OOIO_HOT_TABLES_PER_STORE = 25` (19 đo được + dự phòng cho bảng plugin render mỗi trang,
ví dụ Yoast indexables):

| Mật độ | trước (65 tổng) | **sau (25 nóng)** |
|---|---|---|
| 200 store | 15.600 | **6.000** |
| 300 store | 23.400 | **9.000** |
| 500 store | 39.000 | **15.000** |

Giảm **2,6×**, và `open_files_limit` ở 500 store xuống còn **30.000** — thoải mái dưới mọi
trần kernel hợp lý.

## Ý nghĩa cho ADR-005

**`table_open_cache` không phải ràng buộc ở mật độ 200–500 store.** Nó có thật, có công
thức, và cấu hình được — nhưng ở dải mật độ nền tảng nhắm tới, nó **rẻ**: 9.000 mục cache
cho 300 store, vài chục MB bộ nhớ.

Vì vậy trần store mỗi cluster **do thứ khác quyết định** — CPU, RAM, PHP worker, IO — chứ
không phải `table_open_cache`. Ba thứ đầu chưa đo trên phần cứng thật.

Con số "300–500 store/cluster" trong `DEPLOYMENT-PLAN` **vẫn cần điều kiện cấu hình**, chỉ
là điều kiện đó nhẹ hơn nhiều so với ghi trước đây.

## Giới hạn phải đọc kèm

- **Chỉ đo lưu lượng DUYỆT WEB.** Trang chủ, `/shop/`, `/cart/`. Store xử lý đơn hàng thật
  sẽ chạm `wc_orders`, `wc_order_stats`, `actionscheduler_*`, `wc_sessions` — tập nóng sẽ
  **lớn hơn 14**. Con số 25 trong công thức là dự phòng cho việc đó, **không phải phép đo
  của lưu lượng thương mại**.
- **Không đo đồng thời thật.** Các store được gọi **tuần tự**, không phải song song. Tải
  song song có thể giữ nhiều bảng mở cùng lúc hơn.
- **Store fixture giản đơn**: 20 sản phẩm, không đơn hàng, không biến thể, database gần
  rỗng. Spike #002 đã cảnh báo đúng điểm này: *"bài đo chạy trên database rỗng"*.
- **WSL2**, số tuyệt đối không dùng cho sizing.
- **125 store, không phải 300–500.** Kết luận "không phải ràng buộc" được suy ra từ số học
  đã khớp hai lần, không phải từ việc đã chạy 500 store thật.

## Phụ lục — một phép đo hỏng và cách phát hiện

Lần đầu định đếm bảng nóng bằng `FLUSH TABLES` rồi đo `Open_tables`:

```
sau FLUSH TABLES:      Open_tables = 4000
sau 1 request:         Open_tables = 4000
sau thêm /shop/:       Open_tables = 4000
```

Ba dòng giống hệt nhau — dấu hiệu lệnh **không có tác dụng**, không phải dấu hiệu "một
request mở 4000 bảng". `FLUSH TABLES` cần quyền `RELOAD` toàn cục, mà user `ooio` chỉ có
`ALL PRIVILEGES ON ooio_wp.*`. Lệnh trả về im lặng và không làm gì.

Nếu đọc thẳng kết quả đó thì kết luận sẽ là *"mỗi store dùng 4000 bảng nóng"* — sai hoàn
toàn và theo hướng nguy hiểm. `SHOW OPEN TABLES ... LIKE` cho câu trả lời thật: **14**.
