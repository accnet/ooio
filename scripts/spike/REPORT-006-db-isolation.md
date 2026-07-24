# Spike Report #006 — Cô lập ở tầng MySQL

**Ngày:** 2026-07-22 · **Đóng nốt:** `ADR-005` Exit Criteria **#2** (phần còn nợ sau Spike #005)
**Nền:** WSL2, 16 vCPU · MariaDB 11.8.8 · `max_connections = 120` · `pm.max_children = 10`
**Bằng chứng:** `results/db-isolation.csv` · harness `measure-db-isolation.sh`

Spike #005 chứng minh **PHP-FPM pool riêng cô lập hoàn toàn** (hàng xóm 1,0×). Nhưng pool
chỉ chia phần worker PHP. Mọi store trong một Cluster vẫn dùng **chung một MySQL server**.
Câu hỏi mà kết quả tầng PHP không trả lời được:

> **Một store có thể làm hại hàng xóm QUA database không, sau khi đã cô lập ở tầng PHP?**

Tải được sinh bằng **SQL client, không phải HTTP**, nên nó đi vòng qua PHP hoàn toàn. Mọi
suy giảm quan sát được đều quy về MySQL.

## Kết quả

| Cơ chế | Tải | Nạn nhân | Suy giảm | Lỗi |
|---|---|---|---|---|
| baseline | — | 77 ms | — | 0 |
| **CPU contention** | 8 luồng | 102 ms | 1,3× | 0 |
| **CPU contention** | 16 luồng | 120 ms | 1,6× | 0 |
| **CPU contention** | 32 luồng | 129 ms | **1,7×** | 0 |
| **Cạn connection** | 118/120 slot bị giữ | 80 ms | 1,0× | **0** |
| **Trần connection qua HTTP** | 60 client đồng thời | — | — | **đỉnh 3 connection** |

## Phát hiện 1 — Tranh CPU qua MySQL nhẹ hơn nhiều so với tầng PHP

```
Bão hoà PHP worker  (Spike #005, 100 client):  12,9×
Bão hoà CPU MySQL   (báo cáo này, 32 luồng):    1,7×
```

Và nó **bão hoà**: 8 → 16 → 32 luồng chỉ đưa suy giảm từ 1,3× lên 1,7×. Lý do là MySQL
trải công việc trên 16 vCPU trong khi truy vấn của nạn nhân rất ngắn, nên nạn nhân luôn
giành được lượt.

Trái ngược hoàn toàn với PHP: ở đó mỗi worker phục vụ **đúng một** request nên hàng đợi
tăng tuyến tính không có trần.

**Ý nghĩa: MySQL không phải đường tấn công chính.** Bốn lớp Protection của ADR-005 nhắm
đúng chỗ.

## Phát hiện 2 — `pm.max_children` chặn luôn cạn connection, một cách gián tiếp

Đây là phát hiện quan trọng nhất của báo cáo, và nó **ngược với dự đoán ban đầu**.

Đo trực tiếp: **60 client HTTP đồng thời** đập vào một store, `pm.max_children = 10`.

```
đỉnh Threads_connected  =  3
```

Ba. Không phải 60, không phải 10.

Lý do có cấu trúc: **một store không thể mở nhiều connection MySQL hơn số PHP worker đang
giữ request của nó.** Worker là nút cổ chai đứng trước database. Con số 3 thấp hơn cả 10 vì
Redis object cache hấp thụ phần lớn truy vấn và mỗi request giữ connection rất ngắn.

Hệ quả:

> **Cạn connection KHÔNG với tới được bằng lưu lượng HTTP thông thường.** Muốn giữ 120
> connection cần hoặc một worker budget khổng lồ, hoặc truy cập database trực tiếp — mà
> `ADR-003` đã cấm (No SSH / No Direct DB).

Kiểm chứng ngược: khi giữ **118/120** slot bằng SQL client (đi vòng qua PHP), nạn nhân vẫn
**15/15 request thành công, 0 lỗi**. Chỉ khi ép quá 120 mới thấy MySQL từ chối —
`Connection_errors_max_connections = 11`, `Max_used_connections = 121`.

**Nghĩa là Protection layer 3 (PHP worker budget) làm hai việc, không phải một:** nó cô lập
worker PHP *và* chặn trần connection MySQL của từng store.

## Phát hiện 3 — Giới hạn cấu trúc: không thể đặt hạn ngạch connection theo store

```
max_user_connections = 0   (không giới hạn)
GRANT ALL PRIVILEGES ON `ooio_wp`.* TO `ooio`@`127.0.0.1`
```

**Mọi store trong network kết nối bằng CÙNG MỘT user MySQL** — WordPress chỉ có một bộ
`DB_USER`/`DB_PASSWORD` cho toàn bộ cài đặt. Vì vậy `max_user_connections` — công cụ chuẩn
của MySQL để giới hạn theo tenant — **không dùng được**: đặt nó sẽ giới hạn *toàn bộ
network*, không phải một store.

Dưới Isolated (mỗi store một database và một user riêng), `max_user_connections` sẽ hoạt
động đúng như thiết kế.

Đây là cùng một hình thái đã ghi ở `ADR-005`: **ranh giới giữa các store là quy ước đặt
tên, không phải ranh giới mà hệ điều hành hay database cưỡng chế.** Ở đây nó xuất hiện dưới
dạng "không có chỗ nào để gắn hạn ngạch".

## Ý nghĩa cho ADR-005

**Exit Criteria #2 đóng lại được** ở phạm vi đã đo, và kết luận **thuận lợi hơn** dự đoán:

| | Trạng thái |
|---|---|
| Noisy neighbor tầng PHP | ✅ đo — nghiêm trọng (12,9×), **chặn được hoàn toàn** bằng pool riêng |
| Noisy neighbor tầng MySQL — CPU | ✅ đo — **nhẹ và có trần** (1,7×) |
| Noisy neighbor tầng MySQL — connection | ✅ đo — **không với tới được** qua HTTP; `pm.max_children` chặn sẵn |
| Hạn ngạch connection theo store | ❌ **không khả thi** — mọi store dùng chung một MySQL user |

## Giới hạn phải đọc kèm

Báo cáo này **không** đo ba cơ chế sau. Chúng vẫn là rủi ro mở:

- **Tranh khoá dòng (row lock).** Một store chạy giao dịch dài giữ khoá có thể chặn hàng
  xóm theo cách mà đo CPU không thấy. `BENCHMARK()` không giữ khoá nào.
- **Ô nhiễm InnoDB buffer pool.** Một store quét bảng lớn có thể đẩy dữ liệu nóng của hàng
  xóm ra khỏi buffer pool dùng chung (2 GB ở môi trường này).
- **Thrash `table_open_cache`.** Đã đo riêng ở Spike #002 — đó là cơ chế quyết định trần
  store mỗi node.
- **Truy vấn chậm.** Một store có plugin viết truy vấn tồi làm bão hoà IO, không phải CPU.

Ngoài ra: **WSL2, 16 vCPU, MariaDB 11.8** (không phải MySQL 8.4 như production sẽ dùng);
store là WordPress core, không phải WooCommerce đầy đủ; `max_connections = 120` là giá trị
dev, production sẽ cao hơn — nhưng Phát hiện 2 là **tỉ lệ** giữa worker và connection nên
kết luận không đổi.

## Phụ lục — hai lỗi harness lộ ra khi chạy thật

| # | Lỗi | Hậu quả |
|---|---|---|
| 1 | `pkill -f "SELECT SLEEP(600)"` — `-f` nhận **ERE**, nên `(600)` là nhóm bắt và pattern không khớp gì | 117 client sleep không bị dọn; `wait` treo 600 giây, phép đo trông như bị đơ |
| 2 | `load_conn` chừa sẵn 3 slot | Che mất chính cái vách cần đo; phải thêm `HOLDERS_OVERSHOOT` để ép vượt trần |

Lỗi 2 thuộc loại nguy hiểm: nó **không làm gì hỏng**, chỉ lặng lẽ đo sai câu hỏi. Nếu dừng
ở đó, báo cáo sẽ kết luận "giữ 117 connection vẫn không sao" mà không biết trần ở đâu.
