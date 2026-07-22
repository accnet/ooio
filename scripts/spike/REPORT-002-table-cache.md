# Spike Report #002 — Table cache và mật độ store

**Ngày:** 2026-07-22 · **Harness:** `measure-table-cache.sh` · **Dữ liệu:** `table-cache.csv`
**Môi trường:** MariaDB 11.8 riêng biệt (`:3309`, datadir `~/ooio-spike/db`), 1.169 database
store, `table_open_cache=2000` (mặc định), `open_files_limit=32198`, WSL2.

## Câu hỏi

Spike #001 đo **provisioning** — tạo database rồi bỏ đó. Nó không trả lời câu hỏi thật:
**bao nhiêu store có thể HOẠT ĐỘNG đồng thời trước khi MariaDB phải liên tục đóng/mở lại
bảng?**

## Phương pháp

Thrash cache đơn giản là *tập làm việc lớn hơn cache*, nên không cần đồng thời để lộ ra.
Quay vòng K store, mỗi store chạm 19 bảng, lặp 3 lượt. Sau `FLUSH TABLES`:

- `K × bảng ≤ table_open_cache` → `Opened_tables` **ngừng tăng** từ lượt 2.
- `K × bảng > table_open_cache` → `Opened_tables` tăng **mỗi lượt** — mỗi lượt đuổi đúng
  những bảng lượt sau cần.

## Kết quả

| Store | `Open_tables` | `Opened_tables` tăng ở lượt 2–3 | ms/lượt | Kết luận |
|---|---|---|---|---|
| 40 | 763 | 0 | 806 | vừa |
| 80 | 1.523 | 0 | 1.498 | vừa |
| **105** | **1.998** | **0** | 2.030 | **vừa khít** |
| **120** | 2.000 (đầy) | **2.280** | 2.524 | **THRASH** |
| 160 | 2.000 (đầy) | 3.040 | 3.674 | THRASH |
| 200 | 2.000 (đầy) | 3.800 | 4.288 | THRASH |

Ngưỡng nằm giữa 105 và 120 store, và khớp số học: `105 × 19 = 1.995 ≈ 2.000`.

```
Số store tối đa ≈ table_open_cache ÷ số bảng nóng mỗi store
```

## Ý nghĩa cho ADR-005 (mật độ Cluster Tier)

Bài đo chạm **19 bảng/store**. Một store WooCommerce thật có **50 bảng** (48 + `wp_users`
+ `wp_usermeta`). Nên với `table_open_cache=2000` mặc định:

| Tập bảng nóng | Trần store |
|---|---|
| 19 bảng (đo được) | ~105 |
| 50 bảng (toàn bộ store) | **~40** |

`ADR-005` đề xuất **~200 store/cluster cho gói Basic**. Con số đó **nằm trên bức tường ở cả
hai kịch bản**.

**Nhưng đây KHÔNG phải lỗi kiến trúc — là yêu cầu cấu hình.** Để phục vụ 200 store × 50
bảng cần `table_open_cache ≥ 10.000` cộng `open_files_limit` tương ứng. Vì vậy:

> `table_open_cache` và `open_files_limit` là **tham số cấu hình bắt buộc của Runtime**,
> phải suy ra từ mật độ store dự kiến — không được để mặc định.

## Chi phí khi thrash, và giới hạn của phép đo này

Thời gian mỗi store: 105 store → 19,3 ms; 200 store → 21,4 ms. Chỉ chậm ~10%.

**Đừng đọc con số 10% đó như "thrash không sao".** Bài đo này chạy trên **database rỗng,
một luồng, file system cache còn nóng** — điều kiện thuận lợi nhất có thể cho việc mở lại
bảng. Trên hệ thống thật có dữ liệu, có I/O và nhiều kết nối đồng thời, chi phí sẽ cao hơn.
Tín hiệu đáng lo không phải 10%, mà là **`Opened_tables` tăng vô hạn** — đó là áp lực liên
tục lên tầng file descriptor và là thứ sẽ gãy trước.

## Việc chưa làm

- Chưa đo với **kết nối đồng thời** (bài này tuần tự) — cần cho con số latency thật.
- Chưa đo trên **phần cứng thật** (WSL2 không đại diện cho I/O của VPS).
- Chưa đo với **dữ liệu thật** trong bảng.

Ba việc này cần VPS, và giờ đã biết cần đo gì.

## Phát hiện phụ, quan trọng cho AP-002

Khuôn schema ban đầu trích từ tiền tố `wp_2_*` của Multisite chỉ có **48 bảng, thiếu
`wp_users`/`wp_usermeta`** — vì ở Multisite hai bảng đó là **global, không có tiền tố
subsite**.

Đây là bằng chứng thực nghiệm cho đúng điều `AP-002` khẳng định: Multisite đặt user ở bảng
chung, và **đó chính là thứ phá tính tự chứa của store database**. `store-schema.sql` đã
được sửa thành **50 bảng**; các database đã spike trước đó vẫn thiếu hai bảng này.
