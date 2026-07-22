# Spike Report #003 — Provisioning ở quy mô: nền tảng vs Runtime

**Ngày:** 2026-07-22 · **Môi trường:** dev env native (WSL2), MariaDB 11.8 `:3307`,
WordPress 7.0.2 Multisite, `table_open_cache=4000`
**Bằng chứng:** `platform-provisioning.csv` (99 store) · `wpcli-to-500.csv` +
`wpcli-to-1000.csv` (634 site)

## Câu hỏi

Spike #001 và #002 đo **database-per-store** ở tầng MariaDB. Báo cáo này đo **topology
đang chạy thật** — WordPress Multisite với tiền tố `wp_N_*` — theo hai đường khác nhau,
vì chúng trả lời hai câu hỏi khác nhau:

| Đường | Đo cái gì |
|---|---|
| **Toàn nền tảng**: Control Plane → Operation/BullMQ → Go Agent → MU Plugin → WordPress | khách hàng thật chờ bao lâu |
| **wp-cli trực tiếp** | WordPress Multisite chịu được tới đâu |

Harness: `measure-platform-provisioning.sh` (mới) và `create-sites.sh` (có sẵn).
**Hai bài chạy tuần tự, không song song** — chúng dùng chung CPU và đĩa.

## Kết quả 1 — Nền tảng không suy giảm qua 100 store

| Mốc | create (API) | provision (đầu-cuối) | tổng |
|---|---|---|---|
| store 1–25 | 47 ms | 6.074 ms | 6.158 ms |
| store 26–50 | 47 ms | 6.077 ms | 6.165 ms |
| store 51–75 | 48 ms | 6.079 ms | 6.166 ms |
| store 76–100 | 48 ms | 6.078 ms | 6.163 ms |

p50 = 6.163 ms · p95 = 6.177 ms · max = 8.191 ms

**Đường cong phẳng tuyệt đối.** Trái ngược Spike #001 (database-per-store) nơi thời gian
tăng 1,0 s → 2,8 s qua 250 store. Multisite `wp_N_*` giữ nguyên hiệu năng tạo store.

Store thứ 100 bị chặn đúng bằng `402 store quota exceeded: 100/100 on plan enterprise` —
hạn mức cưỡng chế chính xác, không phải lỗi.

## Kết quả 2 — 94% thời gian khách chờ là Agent đang ngủ

Đây là phát hiện có giá trị hành động nhất của báo cáo này.

```
MU Plugin tạo site trực tiếp (REST)     382 ms
Nền tảng đầu-cuối                     6.074 ms
PLATFORM_AGENT_POLL_INTERVAL              5 s
```

Công việc thật chiếm **6%** thời gian chờ. Phần còn lại là Agent **chờ đến chu kỳ hỏi
việc**. Con số "6 giây tạo một store" không phải chi phí của kiến trúc mà là **chi phí tự
đặt ra bằng một dòng cấu hình**.

**Chỉ nhìn thấy được khi đo đầu-cuối.** Đo MU Plugin riêng cho 382 ms, đo Agent riêng cho
độ trễ poll — không đo nào một mình lộ ra rằng phần lớn trải nghiệm khách hàng là thời
gian chết.

Hai hướng xử lý, đánh đổi khác nhau:
- **Đánh thức Agent** (long-poll hoặc webhook khi có job) — bỏ hẳn thời gian chết, nhưng
  thêm một đường liên lạc ngược từ Control Plane xuống node, đụng `ADR-003` (outbound-only).
- **Hạ poll interval** — đơn giản, nhưng tải lên API tăng **tuyến tính theo số node**.

Chưa chốt; cần cân nhắc cùng `ADR-003`.

## Kết quả 3 — Cache bảng bão hoà ở 500 site

| Mốc | blog | bảng | dung lượng | `Open_tables` | `Opened_tables` |
|---|---|---|---|---|---|
| 500 | 500 | 5.046 | 270 MB | **4.000 (đầy)** | 7.430 |

`Open_tables` chạm **đúng** `table_open_cache=4000`. Khớp công thức Spike #002:

```
Trần store mỗi node ≈ table_open_cache ÷ số bảng nóng mỗi store
```

## Kết quả 4 — Thời gian tạo KHÔNG chậm đi khi cache đã bão hoà

634 site tạo bằng wp-cli, xuyên qua điểm bão hoà cache:

| Site | p50 | p95 |
|---|---|---|
| 1–150 | 1.419 ms | 1.522 ms |
| 151–300 | 1.421 ms | 1.508 ms |
| 301–450 | 1.277 ms | 1.374 ms |
| 451–600 | 1.279 ms | 1.519 ms |
| 601–634 | 1.505 ms | 1.577 ms |

Không có xu hướng xấu đi. Củng cố kết luận Spike #002: **thrash cache ảnh hưởng việc
PHỤC VỤ, không ảnh hưởng việc TẠO**. Hai bài đo khác nhau.

## ⚠️ Giới hạn phải đọc kèm — phép đo này đánh giá thấp áp lực bảng 5 lần

`create-sites.sh` tạo **site WordPress core trần, KHÔNG có WooCommerce**:

```
5.046 bảng ÷ 500 site ≈ 10 bảng/site       (đo được)
store WooCommerce thật                       50 bảng   (Spike #002)
```

Nên **không được đọc "634 site chạy tốt" thành "634 store thật chạy tốt"**. Với store
thật, cùng số bảng đó đạt được ở khoảng **100 store**, và trần theo công thức là:

```
4.000 ÷ 50 = 80 store/node   (ở cấu hình devenv hiện tại)
```

Đây đúng loại sai lệch đã sửa ở Spike #002, khi phát hiện ước lượng "~12 bảng/store" thực
ra là 48. Ghi lại ở đây để không lặp lại lần thứ ba.

## Còn thiếu

- **Bài đo PHỤC VỤ ở quy mô** — 634 site đã tạo nhưng chưa ai đo latency khi nhiều site
  cùng được truy cập. Đây là chỗ thrash cache thật sự cắn.
- **Site có WooCommerce** ở quy mô — cần harness tạo store thật, không phải core trần.
- **Phần cứng đích** — WSL2 không đại diện I/O của VPS.

Hai mục đầu **làm được bằng Docker ở máy này** (`infra/docker/`); chỉ mục cuối cần VPS.
