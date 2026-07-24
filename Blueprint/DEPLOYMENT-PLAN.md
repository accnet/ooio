# Phương án triển khai — BASELINE PRODUCTION v1

> **Trạng thái: Baseline Production v1, đóng băng 2026-07-23.**
> Runtime đã Freeze — xem `RUNTIME-FREEZE.md` để biết cái gì bị cấm đổi và **nợ đo lường
> nào còn treo**. Tài liệu này là mặt bằng tham chiếu; sửa nó nghĩa là sửa baseline.

Nguồn quyết định: `ADR-001` … `ADR-007`, đặc biệt **`ADR-005` (Accepted)**.
Tài liệu này chốt **triển khai cái gì, theo thứ tự nào, và cái gì KHÔNG triển khai**.
Luồng CI/CD chi tiết ở `11-Deployment.md`; tài liệu này không lặp lại.

---

## 1. Hình thái vật lý — chốt

```
┌─ Control Plane (Docker) ────────────────────────────────┐
│  api (NestJS) · worker · scheduler · postgres · redis   │
│  web · ops · admin  (3 SPA, tách theo ranh giới uỷ quyền)│
└──────────────────────┬──────────────────────────────────┘
                       │  HTTPS, job queue (poll)
┌──────────────────────▼──────────────────────────────────┐
│  Cluster  (native, systemd — KHÔNG Docker, ADR-002)     │
│                                                          │
│   1 WordPress Multisite Network                          │
│   1 MySQL Server (+ replica ở H2)   ← MỘT database       │
│   Redis · PHP-FPM · Caddy                                │
│   1 Go Agent                                             │
│                                                          │
│   N web node dùng chung 1 MySQL  (scale tầng PHP)        │
└──────────────────────────────────────────────────────────┘
```

**Mở rộng = thêm Cluster.** Scheduler chọn **Cluster**, không chọn pool/database.

**Trong một Cluster mở rộng bằng cách thêm web node** — `Node.clusterId` đã hỗ trợ. MySQL
là điểm không mở rộng ngang được ở v1; đó là trần của một cluster.

---

## 2. KHÔNG triển khai — danh sách đóng

Mỗi dòng dưới đây từng nằm trong thiết kế và **bị loại có chủ ý**. Ghi ra để không ai
"khôi phục" chúng vì tưởng là thiếu sót.

| Không triển khai | Vì sao |
|---|---|
| **Database Router** (LudicrousDB / HyperDB) | Một cluster một database ⇒ `wpdb` chuẩn là đủ. HyperDB còn fatal trên WP 7.0 + WooCommerce |
| **Mapping `blog_id → pool`, epoch, ACK, chữ ký mapping** | Không có gì để map |
| **Cấp phát *database* per-store** | ADR-005: đơn vị cấp phát là **Cluster** |
| **Chuyển store giữa hai Cluster như thao tác thường ngày** | Là export/import đầy đủ, có bước cần người can thiệp |
| **Tính năng đọc dữ liệu xuyên store trong cùng network** | Cấm tường minh — khoá cửa lại phía sau (ADR-005) |
| **Restore riêng một store** | Không khả thi dưới Multisite; thuộc tier Enterprise/Isolated |

---

## 3. Sizing một Cluster — công thức, không phải con số

```
table_open_cache  =  số store × 25 bảng NÓNG × 1,2
open_files_limit  =  table_open_cache × 2
```

**Biến là bảng NÓNG — bảng mà một request thật sự mở — không phải tổng bảng store sở hữu.**

| | `table_open_cache` | bảng nóng | trần lý thuyết | quan sát |
|---|---|---|---|---|
| Spike #002 | 2.000 | 19 | ~105 | thrash giữa 105–120 ✅ |
| Spike #010 | 4.000 | 14 | ~285 | **125 store không thrash** ✅ |

Spike #010: store blog 3 **sở hữu 61 bảng** nhưng `SHOW OPEN TABLES` chỉ giữ **14**. Bảng
của store không có lưu lượng nằm ngoài cache và không tốn gì. `25 = 19 đo được + dự phòng`
cho bảng plugin render mỗi trang.

| Mật độ mục tiêu | `table_open_cache` | `open_files_limit` |
|---|---|---|
| 200 store | 6.000 | 12.000 |
| 300 store | 9.000 | 18.000 |
| 500 store | 15.000 | 30.000 |

⚠️ **`table_open_cache` KHÔNG phải ràng buộc ở dải mật độ này.** 9.000 mục cache cho 300
store chỉ tốn vài chục MB. Trần store mỗi cluster do **CPU, RAM, PHP worker, IO** quyết
định.

Vẫn giữ hành vi `install-node.sh` đọc lại giá trị thật rồi `die()` nếu MySQL tự hạ xuống.

### Trần thật của một node — Spike #011

Đo trên 125 store WooCommerce thật (WSL2, 16 vCPU, 15 GB):

| Ràng buộc | Kết quả |
|---|---|
| **PHP worker** | trần = `pm.max_children ÷ thời gian phục vụ`. 10 worker ⇒ **~100 req/s** khi CPU mới 59% |
| **CPU** | nâng worker 4× chỉ thêm **27%** thông lượng (→ **127 req/s**), CPU lên 93% |
| **Đường tĩnh** | **1.774 req/s** — nhanh hơn **14×** ở cùng mức CPU bão hoà |
| **RAM** | **105 MB PSS** mỗi worker (RSS 262 MB đếm trùng 2,5×). Tỉ lệ với **đồng thời**, không với số store |
| **Đĩa** | **~4 MB/store**; 300 store ≈ 1,2 GB — vừa trong buffer pool 2 GB |
| **IO** | **chưa đo** — database nằm gọn trong buffer pool nên không có IO đọc để đo |

**Trần store không phải một con số mà là hàm của lưu lượng và tỉ lệ cache:**

| Lưu lượng TB mỗi store *(giả định)* | Không cache | Cache 90% |
|---|---|---|
| 0,1 req/s | ~1.270 store | ~12.700 |
| 0,5 req/s | ~254 store | ~2.540 |
| 2,0 req/s | ~64 store | ~635 |

⚠️ **"300–500 store/cluster" nói về LƯU LƯỢNG, không nói về số store.** Một cluster 50 cửa
hàng đông khách chạm trần trước một cluster 400 cửa hàng vắng.

⚠️ Và nó phụ thuộc **cache**. ~~Spike #008: trần 15–40% nếu không tách store notice.~~
**Đính chính bởi Spike #012:** trang ẩn danh đã cache được sẵn (3 phiên độc lập, 0 dòng
khác). Trần thật do **tỉ lệ lưu lượng mang cookie giỏ hàng** quyết định — chưa đo, cần lưu
lượng thật.

**Số tuyệt đối đo trên WSL2** nên không chuyển thẳng sang VPS; quan hệ giữa chúng thì
chuyển được.

---

## 4. Phân tier — chốt

```
Basic / Pro   →  Multisite Cluster, PHP-FPM pool CHUNG
                 sống nhờ lớp cache  (Spike #005: cache = lớp gánh chính)

Store nặng    →  Multisite Cluster, PHP-FPM pool RIÊNG
                 đo được: hàng xóm 1,0× · chính nó 30,5×

Enterprise    →  Isolated single-site, database riêng
                 TẠO RA đã là Isolated — không di chuyển từ Multisite sang
```

Enterprise **chỉ xây khi có khách Enterprise đầu tiên**. Công việc khi đó: đường site
lifecycle thứ hai trong MU Plugin (không dùng `wpmu_*`). Control Plane, API, Agent,
Workflow **không đổi**.

---

## 5. Thứ tự triển khai

### Giai đoạn A — Sửa cho khớp quyết định *(chặn mọi thứ sau)*

Ba chỗ code đang mâu thuẫn với ADR-005/006 đã Accepted:

| # | Chỗ | Vấn đề | Việc |
|---|---|---|---|
| **A1** ✅ | `install-node.sh` | `LUDICROUSDB_ENABLED` mặc định **`true`** → `main()` gọi `ensure_ludicrousdb` → cài `db.php` drop-in **mà thiết kế đã bỏ** | **Xong 2026-07-22** — mặc định `false`, cờ giữ để bật lại. `test-install-node.sh` cũng đang khẳng định ngược (assert router PHẢI được cài) và fail từ trước; đã sửa thành `assert_absent` + một lần chạy opt-in |
| **A2** | `apps/api/src/das/` | Còn ngữ nghĩa `db_pools` / `Store.dataset`. **Không phải bug** — `switchStorePool` là code không tới được (đòi state `verifying`, mà `verifyChecksum()` ném `NotImplementedException`) | **Đã giao codex — task `SA43`**, prompt `.ai-work/prompts/08-das-cluster-allocation.md` |
| **A3** ✅ | `apps/dashboard/` | Thư mục rỗng còn sót sau khi tách `web`/`ops`/`admin` | **Xong 2026-07-22** |

A1 là ưu tiên cao nhất: nó **cài thêm một drop-in vào mọi node mới** — thứ duy nhất trong
danh sách gây hậu quả thật lên runtime.

### Giai đoạn B — Đóng nợ đo lường *(chặn production)*

| # | Việc | Vì sao chặn |
|---|---|---|
| **B1** ✅ | **Khả năng cache của store WooCommerce** | **Xong 2026-07-23 — Spike #008, ĐÍNH CHÍNH bởi Spike #012.** Trần 15–40% của #008 **không còn hiệu lực**: nó hỏi *"hai khách có nhận HTML giống nhau không"*, nhưng page cache **bypass** khách giữ giỏ theo cookie. Ba phiên ẩn danh trên `/shop/` khác **0 dòng** ⇒ **cache được sẵn**. Việc tách store notice **không phải điều kiện** |
| **B2** ✅ | **Cô lập tầng MySQL** | **Xong 2026-07-22 — Spike #006.** Tranh CPU nhẹ và có trần (1,7×); cạn connection **không với tới được** qua HTTP vì `pm.max_children` chặn sẵn (60 client → đỉnh 3 connection). Còn giới hạn cấu trúc: không đặt hạn ngạch theo store được vì mọi store chung một MySQL user |
| **B3** ✅ | **Plugin Compatibility Matrix** (Exit Criteria #4) | **Xong 2026-07-23 — Spike #007.** 14/14 chạy được, **không phủ định** Multisite. Nhưng sinh một ràng buộc sản phẩm: plugin ghi drop-in (`advanced-cache.php`…) là **toàn network**, nên khách hàng không được tự cài plugin cache |
| **B4** ◑ | Đo trần node | **Một phần xong 2026-07-23.** Spike #010: `table_open_cache` **không phải ràng buộc** (125 store, 6.709 bảng, cache 4.000 → 0 thrash); công thức sửa sang **bảng NÓNG = 25**, giảm 2,6×. Spike #009 phát hiện **Wordfence trong `core-plugin-set.json` làm mọi request chậm ~250×** và provisioning thật là **7,7 s/store** chứ không phải 1,4 s. Spike #011 đo xong **CPU/RAM/PHP worker**: trần **127 req/s**, worker rồi CPU là ràng buộc, RAM thì không. **Còn nợ: IO** (chưa đo được vì DB vừa buffer pool) và **xác nhận trên phần cứng thật** |
| **B5** ✅ | **Wordfence** trong bộ plugin chuẩn | **Chốt 2026-07-23: bỏ khỏi `core-plugin-set.json`.** Thay bằng bảo vệ vành đai — rate limit ở Caddy + WAF ở CDN (Protection layer 1–2). Bảo mật chuyển sang lớp **không nhân theo số store**. Lý do đo được ghi trong khoá `excluded` của manifest; `test-plugin-set.sh` chặn việc thêm lại âm thầm |
| **B0** → `SA44` | Sửa devenv (WooCommerce nửa vời, blog 404, `db.php` drop-in thừa) | **Chặn cả B1 và B3** — không có store WooCommerce thật thì hai phép đo kia vô nghĩa |

**B3 phải xong trước khi mở đăng ký tự do.** ~~Tách store notice là điều kiện~~ — **bỏ theo
Spike #012**: rào cản đó không tồn tại. Thay bằng: **hiện thực cache bypass theo cookie
giỏ hàng** (`woocommerce_items_in_cart`, `woocommerce_cart_hash`, `wordpress_logged_in_*`). Không phải "nên có" — chúng là điều kiện ADR-005 tự đặt ra khi Accept sớm.

### Giai đoạn C — Node production đầu tiên

1. `install-node.sh` trên Ubuntu 24.04 thật, `--dry-run` trước, đọc kỹ plan
2. Đặt `OOIO_EXPECTED_STORES_PER_NODE` theo mật độ mục tiêu — **không dùng mặc định 200 mà không cân nhắc**
3. Xác minh `table_open_cache` sau khi MySQL khởi động (installer tự làm, đọc kết quả)
4. Agent đăng ký với Control Plane, nhận cluster id
5. Tạo store thật qua `POST /stores` → storefront browsable
6. Chạy `measure-isolation.sh` trên node thật — số của Spike #005 là WSL2, cần đối chiếu

### Giai đoạn D — Cluster thứ hai

Chỉ có ý nghĩa khi Scheduler chọn giữa **nhiều** cluster. Đây là phép thử thật cho quyết
định "mở rộng bằng cách thêm Cluster" — trước đó nó mới là thiết kế.

---

## 6. Điều gì lật lại phương án này

Ghi ra để quyết định có đường lùi tường minh:

- Tỉ lệ lưu lượng mang cookie giỏ hàng cao hơn dự kiến ⇒ bypass nhiều, cache ít tác dụng (chưa đo — cần lưu lượng thật)
- Khách hàng đầu tiên là **Enterprise**, không phải Basic ⇒ xây Isolated trước lại rẻ hơn

**Chi phí lật lại tăng theo số store đang chạy** — mỗi store hiện hữu là một lần
export/import. Đây là lý do mục *Cấm tường minh* của ADR-005 tồn tại, và lý do B1–B3 nên
làm **sớm**, không phải "trước production" theo nghĩa sát ngày.
