# Performance Baseline

> **Mọi con số trong tài liệu này là ĐO ĐƯỢC, không phải mục tiêu ước lượng.** Mỗi dòng có
> nguồn. Con số nào chưa đo thì ghi **chưa đo** — không điền giá trị "hợp lý".
>
> Nền đo: WSL2, 16 vCPU, 15 GB RAM · MariaDB 11.8.8 (`innodb_buffer_pool_size = 2 GB`) ·
> PHP 8.3 · Caddy 2.6.4 · WordPress 7.0.2 Multisite · WooCommerce 10.9.4 ·
> **125 store thật**, mỗi store 20 sản phẩm, không đơn hàng.
>
> **Số tuyệt đối không chuyển thẳng sang phần cứng khác.** Quan hệ giữa chúng thì chuyển
> được. Xem mục *Cách dùng tài liệu này*.

---

## Bảng baseline

| Thành phần | Baseline đo được | Ngưỡng cảnh báo | Nguồn |
|---|---|---|---|
| **PHP worker — PSS** | **105 MB** | — | Spike #011 |
| PHP worker — RSS *(đừng dùng cho sizing)* | 262 MB | — | Spike #011 |
| **Thông lượng — đường PHP** | **127 req/s** @ CPU 93% | — | Spike #011 |
| **Thông lượng — đường tĩnh** | **1.774 req/s** @ CPU 92% | — | Spike #011 |
| **OPcache hit rate (nóng)** | **98,76%** | < 95% | đo 2026-07-23 |
| **OPcache hit rate (ngay sau restart)** | **49,30%** | — *(xem Preload)* | đo 2026-07-23 |
| OPcache file đã cache | 2.136 / 40.000 | > 80% trần | đo 2026-07-23 |
| OPcache bộ nhớ | 77 / 256 MB | > 80% trần | đo 2026-07-23 |
| **OPcache OOM restart** | **0** | > 0 | đo 2026-07-23 |
| `realpath_cache_size` | **4 MB** *(mặc định)* | — | đo 2026-07-23 |
| **Database mỗi store** | **~4,0 MB** | — | Spike #011 |
| Bảng mỗi store — tổng | 53 *(WooCommerce + bộ plugin chuẩn)* | — | Spike B4a |
| **Bảng mỗi store — NÓNG** | **14–19** | — | Spike #002, #010 |
| **Provisioning một store** | **7,7 s** | — | Spike #009 |
| **Cô lập — hàng xóm, pool chung** | 12,9× suy giảm @ 100 client | — | Spike #005 |
| **Cô lập — hàng xóm, pool riêng** | **1,0×** | > 1,5× | Spike #005 |
| **Cô lập — tầng MySQL, CPU** | 1,7× @ 32 luồng | — | Spike #006 |
| Connection MySQL mỗi store qua HTTP | đỉnh **3** @ 60 client | — | Spike #006 |

`install-node.sh` đặt target quản lý cho PHP-FPM là `realpath_cache_size = 64M` và
`realpath_cache_ttl = 600`, tại file `60-ooio-realpath.ini`. Đây là giả thuyết vận hành
cho workload WordPress nhiều đường dẫn lặp lại, **chưa đo hiệu quả trên nền tảng này**;
phép đo cùng một trang trước/sau phải ghi rõ **không đo được cải thiện** nếu kết quả không
cho thấy thay đổi.

### Chưa đo — không được điền số

| Thành phần | Vì sao chưa đo |
|---|---|
| **FastCGI / page cache hit rate** | **Chưa có page cache.** `caddy list-modules` không có module cache nào |
| Tỉ lệ lưu lượng mang cookie giỏ hàng | Cần lưu lượng thật. Đây là biến quyết định hit rate (Spike #012), không phải khả năng cache của route |
| Redis object cache hit rate | Chưa đo tách bạch; mới chỉ đo chênh lệch hit/miss (98 ms vs 158 ms, Spike #008) |
| InnoDB buffer pool hit | Database 503 MB nằm gọn trong pool 2 GB nên gần như không có lần đọc đĩa để đo |
| Worker queue depth | Chưa thu thập; `pm.status_path` chưa bật |
| **IO** | Cùng lý do buffer pool; và ext4 trên VHDX không đại diện cho VPS |

---

## Ba con số quan trọng nhất, và vì sao

> **Đính chính 2026-07-23 (Spike #012):** trần cache 15–40% từng ghi ở đây theo Spike #008
> **đã bị gỡ bỏ**. Trang ẩn danh cache được sẵn — ba phiên độc lập trên `/shop/` khác 0
> dòng. Page cache bypass khách giữ giỏ theo cookie; nó không phục vụ một bản cho tất cả.

### 1. Đường tĩnh nhanh hơn đường PHP **14×**

```
PHP  :   127 req/s   @ CPU 93%
Tĩnh : 1.774 req/s   @ CPU 92%
```

Đây là con số quyết định năng lực của một node. Mọi tối ưu bên trong PHP đều tranh nhau
trong khoảng 127 → ~165 req/s. Đưa tỉ lệ cache từ 20% lên 90% đáng giá **~7×**.

**Hệ quả cho thứ tự ưu tiên:** cache không phải một mục tối ưu ngang hàng với OPcache hay
preload. Nó là **hệ số nhân** đứng trước tất cả.

### 2. OPcache **không** phải nút thắt — nhưng khởi động nguội thì có

```
2.136 / 40.000 file   ·   77 / 256 MB   ·   0 OOM restart
```

Dư **20× số file** và **3× bộ nhớ**. Mọi khuyến nghị kiểu *"tăng `max_accelerated_files`"*
đang giải một vấn đề chưa tồn tại.

Vấn đề thật là **49,30% ngay sau restart**. Và điều đó quan trọng vì **mỗi lần cập nhật
Distribution là một lần restart worker trên toàn network** — hình phạt cold start nhân với
số store, không phải chia cho số store.

**Đó là lý do đúng để đầu tư PHP Preload.** Không phải để steady state nhanh hơn — 98,76%
đã gần trần.

### 3. PHP-FPM tỉ lệ với **đồng thời**, không tỉ lệ với số store

```
RAM ≈ innodb_buffer_pool + (105 MB PSS × pm.max_children) + ~50 MB (Caddy)
đĩa ≈ 4 MB × số store        (mã nguồn dùng chung, không nhân)
```

Chỉ database mới tỉ lệ với số store, và ở mức **4 MB/store** thì 300 store ≈ 1,2 GB —
**không phải ràng buộc**.

⚠️ **Dùng RSS thay PSS sẽ phóng đại chi phí worker 2,5×** và dẫn tới mua thừa phần cứng.

---

## Công thức sizing

### Số PHP worker

```
workers = min( RAM_budget / 105 MB , CPU_capacity / thời_gian_phục_vụ )
```

**Vế thứ hai không tính được, phải đo.** Bằng chứng: trên máy 15 GB, công thức chỉ theo RAM
đề xuất 40 worker; đo thật cho thấy 40 worker chỉ thêm **27%** thông lượng và đẩy CPU lên
**93%** — tức CPU cạn trước RAM rất xa.

### Số store mỗi cluster

```
số store  =  (thông_lượng_node ÷ (1 − tỉ_lệ_cache)) ÷ req/s trung bình mỗi store
```

| Lưu lượng TB mỗi store *(giả định)* | Không cache | Cache 90% |
|---|---|---|
| 0,1 req/s | ~1.270 | ~12.700 |
| 0,5 req/s | ~254 | ~2.540 |
| 2,0 req/s | ~64 | ~635 |

> **"300–500 store/cluster" nói về LƯU LƯỢNG, không nói về số store.** Một cluster 50 cửa
> hàng đông khách chạm trần trước một cluster 400 cửa hàng vắng.

### `table_open_cache`

```
table_open_cache = số store × 25 bảng NÓNG × 1,2
```

Bảng **nóng**, không phải tổng bảng. Store *sở hữu* 53 bảng nhưng một request chỉ *mở*
14–19. Spike #010: 125 store / 6.709 bảng trên cache 4.000 cho **0 thrash**.

---

## Cách dùng tài liệu này

**Dùng được ở phần cứng khác:** mọi **tỉ lệ** — tĩnh/PHP 14×, RSS/PSS 2,5×, suy giảm
`client ÷ max_children`, bảng nóng/tổng bảng.

**Không dùng được:** mọi **số tuyệt đối** — 127 req/s, 1.774 req/s, 7,7 s provisioning.
Chúng đo trên WSL2 chia CPU với Windows, client chạy cùng máy.

**Khi dựng node production đầu tiên** (`DEPLOYMENT-PLAN` giai đoạn C): chạy lại
`measure-isolation.sh` và phép đo thông lượng, rồi thay số tuyệt đối trong bảng trên. Các
tỉ lệ dùng để **kiểm tra chéo** — nếu tỉ lệ tĩnh/PHP trên node thật khác **14×** nhiều thì
có gì đó khác về cấu hình, cần tìm hiểu trước khi tin số mới.

---

## Nguồn

| Spike | Nội dung |
|---|---|
| `REPORT-002-table-cache.md` | bảng nóng 19, ngưỡng thrash |
| `REPORT-004-topology-lifecycle.md` | provisioning/clone/delete/upgrade, MySQL 8.4 |
| `REPORT-005-isolation.md` | noisy neighbor tầng PHP |
| `REPORT-006-db-isolation.md` | noisy neighbor tầng MySQL |
| `REPORT-008-cache.md` | phân loại route cache được, cache hit/miss |
| `REPORT-009-provisioning-real-store.md` | provisioning thật 7,7 s, Wordfence 250× |
| `REPORT-010-table-cache-breakpoint.md` | `table_open_cache` không phải ràng buộc |
| `REPORT-011-node-capacity.md` | thông lượng, PSS, đĩa, trần worker/CPU |
