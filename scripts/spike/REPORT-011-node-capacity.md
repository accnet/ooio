# Spike Report #011 — Trần thật của một node: CPU, RAM, PHP worker

**Ngày:** 2026-07-23 · **Thuộc:** `DEPLOYMENT-PLAN` B4
**Nền:** WSL2, 16 vCPU, 15 GB RAM · MariaDB 11.8.8 (`innodb_buffer_pool_size = 2 GB`) ·
PHP 8.3 · Caddy 2.6.4 · **125 store WooCommerce thật**, 6.709 bảng, 503 MB database

Spike #010 kết luận `table_open_cache` **không phải** ràng buộc, và trần store do CPU, RAM,
PHP worker và IO quyết định — **cả bốn chưa đo**. Báo cáo này đo chúng.

## Kết quả — trần là PHP worker, rồi tới CPU

| `pm.max_children` | Concurrency | Thông lượng | p50 | CPU |
|---|---|---|---|---|
| **10** | 20 | 42,9 req/s | 251 ms | 21% |
| **10** | 80 | **98,4 req/s** | 436 ms | 55% |
| **10** | 160 | 99,7 req/s | **787 ms** | 59% |
| **40** | 80 | 111,1 req/s | 377 ms | 76% |
| **40** | 160 | **127,0 req/s** | 681 ms | **93%** |

Ở `max_children = 10`, thông lượng chững tại **~100 req/s** trong khi CPU mới **59%**. Tăng
concurrency 80 → 160 làm **độ trễ gấp đôi mà thông lượng không đổi** — dấu hiệu bão hoà
kinh điển.

Khớp số học: 10 worker ÷ ~100 ms mỗi request = **100 req/s**. Trần đúng bằng
`pm.max_children ÷ thời gian phục vụ`.

Nâng worker **4×** (10 → 40) chỉ thêm **27%** thông lượng (100 → 127 req/s), và CPU nhảy
lên **93%**. Nút cổ chai chuyển từ worker sang CPU.

> **Trần của node này ≈ 127 req/s cho trang WooCommerce không cache — khoảng 8 req/s mỗi
> vCPU.**

## Phát hiện 1 — Đường không chạm PHP nhanh hơn 14×

| Đường | Thông lượng | CPU |
|---|---|---|
| PHP (WooCommerce) | **127 req/s** | 93% |
| Tĩnh (Caddy `file_server`) | **1.774 req/s** | 92% |

Cùng mức CPU bão hoà, đường không qua PHP phục vụ **gấp 14 lần**.

Đây là cùng một kết luận với Spike #005 (nạn nhân tĩnh 1,0× trong khi PHP chậm 12,9×)
nhưng nhìn từ phía **năng lực** thay vì phía **cô lập**: cache không chỉ bảo vệ hàng xóm,
nó **nhân năng lực của cả node lên một bậc độ lớn**.

Ghép với Spike #008 (mục tiêu ~90% request không chạm PHP): nếu đạt được, năng lực hiệu
dụng của node đi từ ~127 lên **hàng nghìn** req/s. Nếu không đạt — và Spike #008 nói trần
thực tế là 15–40% nếu không tách store notice — thì node dừng ở ~127 req/s.

**Cache không phải tối ưu hoá. Nó là hệ số nhân năng lực.**

## Phát hiện 2 — RAM: RSS đếm trùng 2,5 lần

| Đo bằng | Mỗi php-fpm worker |
|---|---|
| **RSS** | ~262 MB |
| **PSS** | **~105 MB** |

RSS đếm cả trang bộ nhớ **dùng chung** (opcache, thư viện) vào từng tiến trình. Với worker
fork từ một master, con số đó phóng đại chi phí biên **2,5×**.

Dùng RSS để tính sizing sẽ ra `40 worker × 262 MB = 10,5 GB` và kết luận sai rằng máy 15 GB
không chạy nổi. Thực đo khi chạy 40 worker: **php-fpm tổng 2,5 GB**, toàn hệ thống dùng
5/15 GB, **còn trống 9 GB**.

Công thức RAM cho một node:

```
RAM ≈ innodb_buffer_pool + (105 MB × pm.max_children) + ~50 MB (Caddy)
```

**PHP-FPM tỉ lệ với ĐỒNG THỜI, không tỉ lệ với số store.** Chỉ database mới tỉ lệ với số
store.

## Phát hiện 3 — Đĩa: 4 MB mỗi store

```
125 store · 6.709 bảng · 503 MB database   ⇒   ~4,0 MB/store
bảng global dùng chung cả network          ⇒   0,4 MB
```

Store fixture có 20 sản phẩm, không đơn hàng. Với 300 store: **~1,2 GB** database. Không
đáng kể so với đĩa, và **vừa trong `innodb_buffer_pool = 2 GB`** — nghĩa là toàn bộ dữ liệu
nóng nằm trong RAM.

Mã nguồn WordPress **dùng chung một bản** cho cả network, nên không nhân theo store (Spike
#004 Phát hiện 5).

## Ý nghĩa cho `DEPLOYMENT-PLAN`

Trần store mỗi node **không phải một con số** — nó là hàm của lưu lượng trung bình mỗi
store và tỉ lệ cache:

```
số store  =  (127 req/s ÷ (1 − tỉ_lệ_cache)⁻¹) ÷ req/s trung bình mỗi store
```

Ba kịch bản, **tỉ lệ cache và lưu lượng là giả định**, chỉ 127 req/s là đo được:

| Lưu lượng TB mỗi store | Không cache | Cache 50% | Cache 90% |
|---|---|---|---|
| 0,1 req/s (~8.600 lượt/ngày) | ~1.270 store | ~2.540 | ~12.700 |
| 0,5 req/s (~43.000 lượt/ngày) | ~254 store | ~508 | ~2.540 |
| 2,0 req/s (~172.000 lượt/ngày) | ~64 store | ~127 | ~635 |

**Con số 300–500 store/cluster trong `DEPLOYMENT-PLAN` là hợp lý** cho cửa hàng nhỏ và
vừa — nhưng nó nói về **lưu lượng**, không nói về số store. Một cluster 50 cửa hàng đông
khách sẽ chạm trần trước một cluster 400 cửa hàng vắng.

Và RAM **không phải ràng buộc** ở dải này: 300 store cần ~1,2 GB database + buffer pool;
PHP worker mới là khoản tốn, mà nó tỉ lệ với đồng thời chứ không với số store.

## Giới hạn phải đọc kèm

- **WSL2, chia CPU với Windows.** Con số 127 req/s và 8 req/s/vCPU **không** chuyển thẳng
  sang VPS. Quan hệ giữa chúng (worker → CPU → tĩnh nhanh hơn 14×) thì chuyển được.
- **Client chạy cùng máy.** `curl` tranh CPU với server, nên thông lượng thật của server
  **cao hơn** con số đo được. Sai lệch theo hướng bảo thủ.
- **Store fixture giản đơn**: 20 sản phẩm, không đơn hàng, không biến thể, database gần
  rỗng. Cửa hàng thật nặng hơn ⇒ req/s mỗi vCPU thấp hơn.
- **Chỉ đo trang chủ.** Không đo checkout — đường tốn nhất và **không cache được**
  (Spike #008).
- **Chưa đo IO.** ext4 trên VHDX; và với database 503 MB nằm gọn trong buffer pool 2 GB thì
  gần như không có IO đọc để đo. Trên node thật với dữ liệu vượt buffer pool, IO có thể
  thành ràng buộc mới — **chưa biết**.
- **Không đo `pm.max_children` giữa 10 và 40.** Điểm CPU bão hoà nằm đâu đó trong khoảng
  đó; 40 đã là quá mức cho 16 vCPU.

## Phụ lục — hai lỗi phép đo

| # | Lỗi | Hậu quả |
|---|---|---|
| 1 | Đọc RSS thay vì PSS cho tiến trình fork | Phóng đại chi phí bộ nhớ mỗi worker **2,5×**; đủ để kết luận sai rằng máy không đủ RAM |
| 2 | Vòng lặp `curl ... &` không tắt job control | 800 dòng `[n] Done` lấn át kết quả; phải `set +m` trong script riêng |

Lỗi 1 nguy hiểm hơn: nó **cho ra con số trông hợp lý** và sai theo hướng làm người đọc mua
thừa phần cứng.
