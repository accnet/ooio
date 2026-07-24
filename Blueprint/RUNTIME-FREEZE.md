# Runtime Freeze — v1.0 Stable

**Ngày đóng băng: 2026-07-23.** Từ thời điểm này, Runtime chỉ nhận thay đổi thuộc **bug**,
**security**, hoặc **performance regression**. Không đổi topology.

Mục đích của tài liệu này không phải tuyên bố Runtime hoàn hảo. Nó ghi lại **cái gì đã
chốt, cái gì chưa đo, và cái gì bị cấm đổi** — để "freeze" không bị đọc nhầm thành "mọi câu
hỏi đã có đáp án".

---

## 1. Bảy ADR — tên đúng và trạng thái thật

Cả bảy **đã `Accepted` từ trước ngày đóng băng**, không cần đổi trạng thái. Bảng này ghi
đúng tiêu đề của từng ADR, vì một bản freeze gọi sai tên sẽ khiến người sau tìm nhầm chỗ.

| ADR | Tiêu đề thật | Trạng thái |
|---|---|---|
| **ADR-001** | Xây Runtime trước, SaaS sau (Runtime-First) | Accepted |
| **ADR-002** | Go Agent chạy **Native (systemd), không container** | Accepted |
| **ADR-003** | **Không SSH, không ghi thẳng Database WordPress** | Accepted — transport chốt 2026-07-23 |
| **ADR-004** | Distribution là **Artifact có version** | Accepted — giả định Shared Runtime đã đo |
| **ADR-005** | Runtime Topology — Multisite vs Isolated | **Accepted (Frozen)** |
| **ADR-006** | **Database Platform** — Allocation, Topology, Migration | Accepted |
| **ADR-007** | **Platform Identity** — Platform sở hữu user | Accepted |

Hai mục con còn treo đã được đóng cùng ngày, **bằng bằng chứng đã có sẵn**:

- **ADR-003 — transport Agent ↔ MU Plugin.** Chốt **REST/HTTP localhost**. Không phải lựa
  chọn mới: MU Plugin đăng ký `register_rest_route('platform/v1', …)`
  (`src/Rest/Controller.php:23`), Agent gọi qua `wpclient.NewHTTPClientWithClient`
  (`internal/wpclient/client.go:47`). Toàn bộ Spike #003–#012 chạy trên đường này. Unix
  Domain Socket vẫn là đường nâng cấp hợp lệ, không bị loại vĩnh viễn.
- **ADR-004 — giả định Shared Runtime.** Đã đo (Spike #004 Phát hiện 5): symlink **21 ms /
  0 byte** mỗi store so với copy riêng **1.351 ms / 145 MB**. Chênh 64×. Không còn là
  *Proposed*.

---

## 2. Runtime chốt cái gì

```
1 Cluster  =  1 WordPress Multisite Network
            + 1 MySQL Server (một database dùng chung)
            + Redis + PHP-FPM + Caddy
            + 1 Go Agent
            + N web node dùng chung MySQL
```

Mở rộng bằng **thêm Cluster**. Scheduler chọn Cluster, không chọn pool/database.

### Cấm đổi

| Không được | Vì sao |
|---|---|
| Đổi sang Isolated single-site | Trừ tier Enterprise — xem ADR-005 *Đường thoát cho Enterprise* |
| Thêm HyperDB | Fatal trên WP 7.0 + WooCommerce, đã đo |
| Thêm LudicrousDB | Một cluster một database ⇒ `wpdb` chuẩn là đủ; `LUDICROUSDB_ENABLED=false` |
| Đổi database topology | ADR-005 |
| Tính năng đọc **xuyên store** trong cùng network | Khoá cửa lại phía sau — ADR-005 *Cấm tường minh* |
| Plugin ghi drop-in do khách tự cài | Drop-in là **toàn network** — Spike #007 |
| Thêm plugin vào bộ chuẩn mà chưa đo chi phí mỗi request | Wordfence làm mọi request chậm **250×** — Spike #009 |

---

## 3. Mười một Spike — cái gì đã trả lời

| Spike | Trả lời |
|---|---|
| #002 | Trần store = `table_open_cache ÷ bảng NÓNG` (19, không phải 50) |
| #003 | Provisioning không suy giảm qua 634 site |
| #004 | Multisite vs Isolated trên cùng nền MySQL 8.4; Shared Runtime symlink 21 ms |
| #005 | Noisy neighbor tầng PHP: 12,9× chung pool, **1,0×** pool riêng |
| #006 | Tầng MySQL: CPU nhẹ (1,7×), cạn connection **không với tới được** qua HTTP |
| #007 | Plugin Compatibility: **14/14 chạy được**, không plugin nào phủ định Multisite |
| #008 | Phân loại route mang trạng thái; cache hit/miss 98 vs 158 ms — ⚠️ **kết luận chính đã bị #012 đính chính** |
| #009 | Provisioning thật **7,7 s/store**; Wordfence chậm **250×** |
| #010 | `table_open_cache` **không phải ràng buộc**: 125 store / 6.709 bảng / cache 4.000 → 0 thrash |
| #011 | Trần node **127 req/s** (PHP) vs **1.774 req/s** (tĩnh); PSS 105 MB/worker; 4 MB/store |
| #012 | Cache **bypass theo cookie**, không trung hoà HTML; `/shop/` cache được sẵn |

---

## 4. Nợ đã biết — freeze KHÔNG có nghĩa là đã đo hết

Đây là phần quan trọng nhất của tài liệu này.

### Chưa đo, và cần đo trước khi nhận khách trả tiền

| Hạng mục | Vì sao chưa đo |
|---|---|
| **IO** | Database 503 MB nằm gọn trong buffer pool 2 GB nên không có lần đọc đĩa để đo |
| **Phần cứng thật** | Mọi số tuyệt đối đo trên WSL2 chia CPU với Windows |
| **Tỉ lệ lưu lượng mang cookie giỏ hàng** | Biến quyết định hit rate thật (Spike #012). Cần lưu lượng thật |
| **Khách đã đăng nhập** | Mang `wordpress_logged_in_*`, gần như chắc chắn phải bypass cache |
| **Cache bypass** | Chưa hiện thực (`SA48`); mới chứng minh điều kiện cho nó là đủ |

### Giới hạn cấu trúc — không phải nợ, mà là thứ Multisite không làm được

| | |
|---|---|
| **Restore riêng một store** | Không khả thi dưới Multisite. Khách cần nó phải ở tier Enterprise/Isolated |
| **Hạn ngạch connection theo store** | Mọi store dùng **chung một MySQL user**; `max_user_connections` giới hạn cả network |
| **Cô lập dữ liệu khách hàng** | `wp_users` là **global** trong network |
| **Chuyển store giữa hai Cluster** | Export/import đầy đủ, **28 tham chiếu `user_id`** phải ánh xạ lại cho một store chưa có đơn hàng — và bước xử lý trùng login/email **không tự động hoá được** |

### Đo trên môi trường có khiếm khuyết

- **Blog 1 của devenv mất template WooCommerce** (`wc-block-store-notices` vắng, 3 block
  thay vì 54). Các phép đo về **worker/CPU/connection** không bị ảnh hưởng; mọi phép đo về
  **nội dung trang** chạy trên blog 1 đều phải nghi ngờ. Harness `measure-cacheability.sh`
  đã đổi mặc định sang `/noisy/`.
- **OPcache `revalidate_freq = 60`**: thay đổi MU Plugin đo lại trong vòng 60 giây có thể
  là số của bản cũ.

---

## 5. Việc Runtime còn mở

| Task | Nội dung |
|---|---|
| `SA48` | Page cache + bypass theo cookie giỏ hàng |
| `SA49` | `realpath_cache_size` 64 MB — đã hiện thực, chờ đo hiệu quả |

Hai việc này **thuộc nhóm performance**, tức nằm trong phạm vi freeze cho phép. Chúng không
đổi topology.

---

## 6. Freeze cho phép gì

**Được:**
- Sửa bug
- Vá security
- Sửa performance regression
- Đo nốt các hạng mục ở mục 4
- Hiện thực `SA48`, `SA49`

**Không được, nếu không có ADR mới:**
- Đổi topology (mục 2)
- Thêm thành phần vào bộ plugin chuẩn mà chưa đo chi phí mỗi request
- Xây tính năng dựa trên việc các store dùng chung `wp_users`

**Điều kiện mở ADR Runtime mới:** một trong các hạng mục ở mục 4 đo ra kết quả **phủ định**
một quyết định ở mục 2. Ví dụ: đo IO trên phần cứng thật cho thấy trần store thấp hơn hẳn
dự kiến, hoặc tỉ lệ bypass cache cao tới mức Protection layer 1 không gánh nổi.

---

## 7. Chuyển trọng tâm

`DEPLOYMENT-PLAN.md` → **Baseline Production v1**
`18-SaaS-Implementation-Plan.md` → tài liệu chính giai đoạn tiếp theo
`21-Performance-Baseline.md` → ngưỡng tham chiếu cho Agent và Ops dashboard

Từ đây SaaS chỉ biết **Store → Agent → Provision**. Mọi thứ WordPress nằm sau Agent.
