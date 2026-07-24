# ADR-005: Runtime Topology — WordPress Multisite vs Isolated Single-sites

## Status

**Accepted (2026-07-22) · FROZEN (2026-07-23)** — WordPress Multisite, **một Network = một
Database = một Cluster**.

> Runtime đã đóng băng. Đổi topology cần một ADR mới, và điều kiện để mở nó ghi ở
> `Blueprint/RUNTIME-FREEZE.md` mục 6.

### Vì sao chốt khi Exit Criteria chưa hoàn thành

ADR này ban đầu quy định chỉ `Accepted` khi xong **toàn bộ** Exit Criteria. Điều đó **không
được thoả**, và phải ghi rõ thay vì lặng lẽ bỏ qua:

| Exit Criteria | Trạng thái |
|---|---|
| 1. Runtime Spike | **một phần** — Spike #003, #004 |
| 2. Isolation Benchmark (noisy neighbor) | ✅ **đã đo** — Spike #005 (tầng PHP) + #006 (tầng MySQL) |
| 3. Restore per-store | **không thể trọn vẹn** — `wp_users` global (xem bên dưới) |
| 4. Plugin Compatibility Matrix | ✅ **đã đo** — Spike #007; 14/14 chạy được, không plugin nào phủ định Multisite |

**Cơ sở quyết định đã đổi.** Exit Criteria được viết để trả lời *"Multisite có đủ tốt
không?"*. Số liệu thu được lại trả lời một câu khác — *"database-per-store có hợp với
Multisite không?"* — và câu trả lời là **không**. Quyết định hiện tại dựa trên: giữ
Multisite (đã xây xong MU Plugin, luồng 3-plane đã chạy thật) và **chấp nhận các giới hạn
đã biết**, thay vì viết lại site lifecycle cho Isolated.

Tiêu chí **2 và 4 không biến mất** — chúng chuyển từ *điều kiện quyết định* thành **rủi ro
vận hành bắt buộc đo trước khi lên production**. Tiêu chí 3 chuyển từ *chưa đo* thành **giới
hạn đã biết**: nó không thể đạt được dưới Multisite, không phải vì chưa thử — khách hàng
cần restore riêng store phải ở **tier Enterprise/Isolated** (xem *Đường thoát cho
Enterprise*).

Lưu ý về nguồn: toàn bộ `idea/` (idea0 → plan-12) đều mặc định dùng Multisite nhưng
chưa từng so sánh với phương án thay thế — Multisite là *giả định thừa kế*, ADR này
tồn tại để việc cân nhắc diễn ra tường minh và có bằng chứng.

## ⚠️ Cập nhật 2026-07-21 (Blueprint v1.1) — database topology làm lệch cán cân

`ADR-006` (Database Platform) chốt **database-per-store**, và `ADR-007` (Platform Identity)
chốt **`wp_users` là projection per-store**. Hệ quả: **store database trở nên gần như tự
chứa** — bảng riêng, user riêng, migration/restore là dump/restore một database.

Điều đó **làm giảm giá trị còn lại của Multisite**: lợi ích chung codebase/plugin đã có sẵn
từ Distribution + shared filesystem; chỉ còn `wp_blogs`/`wp_site` global và tốc độ
provisioning qua `wpmu_create_blog`. Trong khi đó Multisite vẫn buộc phải giữ hai bảng
global đó — đúng thứ làm hỏng tính tự chứa (xem `ADR-006` §9: global không được nằm trên
hot path).

**Vì vậy ADR-005 KHÔNG được chốt độc lập.** Khi chạy Gate 1 spike:
- Phải đo **database-per-store ở quy mô** (thời gian `CREATE DATABASE`;
  `innodb_file_per_table`, `table_open_cache`, `open_files_limit`), **không chỉ** đo subsite
  prefix `wp_N_*` như harness A1 hiện tại. **Số liệu nền đã đo thật 2026-07-21: 48 bảng và
  5.0 MB cho MỘT store WooCommerce rỗng** ⇒ 10.000 store = **480.000 bảng, ~50 GB** (ước
  lượng cũ "~12 bảng ≈ 120k bảng" chỉ đếm WordPress core, thiếu 4 lần — xem `ADR-006`,
  mục "Cơ sở quy mô").
- **ĐÃ ĐO — Spike Report #002 (2026-07-22)**: bức tường `table_open_cache` là **có thật và
  dự đoán được chính xác**:

  ```
  Số store tối đa ≈ table_open_cache ÷ số bảng nóng mỗi store
  ```

  Đo thật: với `table_open_cache=2000` mặc định, 105 store vừa khít (`Open_tables=1998`),
  **120 store bắt đầu thrash** (`Opened_tables` tăng 2.280 mỗi lượt, mãi mãi). Một store
  WooCommerce có **50 bảng**, nên nếu toàn bộ bảng đều nóng thì trần là **~40 store**.

  **Mật độ ~200 store/cluster cho Basic đề xuất ở mục NFR bên dưới nằm TRÊN bức tường này**
  ở mọi kịch bản đo được. Nhưng đây **không phải lý do loại Multisite hay loại
  database-per-store** — nó là **yêu cầu cấu hình Runtime**: 200 store × 50 bảng đòi
  `table_open_cache ≥ 10.000` và `open_files_limit` tương ứng. Vì vậy hai tham số này phải
  được **suy ra từ mật độ store dự kiến**, không được để mặc định. Xem
  `scripts/spike/REPORT-002-table-cache.md`.

  Còn thiếu (cần VPS): đo với kết nối **đồng thời**, phần cứng thật, và dữ liệu thật.
- Kết quả spike phải được đọc **cùng với** `ADR-006`: nếu database-per-store chạy tốt,
  cán cân nghiêng về **Isolated Single-sites** hơn trước.

Exit Criteria bên dưới vẫn giữ nguyên, **bổ sung** tiêu chí database-per-store ở quy mô.

## ⚠️ Bằng chứng độc lập 2026-07-22 — database-per-store không tương thích trọn vẹn với Multisite

BA đã phát hiện độc lập ba điểm xung đột dưới đây; đây là khung bằng chứng để chốt ADR,
không phải quyết định mới. Nguồn kiểm chứng là WordPress core và **Spike Report #002**:

1. Trong Multisite, `wp_users` và `wp_usermeta` là **GLOBAL**. `wp-includes/class-wpdb.php:324`
   định nghĩa các bảng này dùng chung và không có cấu hình để đổi thành bảng per-store.
2. Vì vậy khuôn schema trích từ các bảng `wp_2_*` bị thiếu `wp_users`/`wp_usermeta` — đúng
   như đã ghi nhận trong **Spike Report #002**. Hai bảng này không nằm trong phần schema
   có tiền tố site của Multisite.
3. Khi bảng của Store 245 nằm trong database `store_245`, tên bảng vẫn là
   `wp_245_posts`. `get_blog_prefix()` tại `wp-includes/class-wpdb.php:1084` luôn trả
   `wp_N_`, và WordPress core gọi nó ở 20 chỗ. **LudicrousDB chỉ định tuyến kết nối;
   nó không đổi tên bảng.**

Hệ quả kiến trúc là database-per-store + Multisite buộc database của store và database
global phải ở **cùng một MySQL server**, vì JOIN vượt database chỉ chạy được khi các
database ở cùng server (ràng buộc AP-001). Do đó pool thực tế suy biến thành **một pool
mỗi server**: store có thể **movable** giữa các pool bằng cách đổi mapping (blog ID không
đổi), nhưng không **portable** sang server độc lập. Việc clone/export vẫn phải đổi tên
khoảng 50 bảng, tạo lại capabilities và ánh xạ user ID.

Đây cũng là vấn đề PII, không chỉ là chi tiết kỹ thuật: khách hàng WooCommerce chính là
các bản ghi trong `wp_users`, nên khách của mọi store Multisite nằm chung một bảng. Xóa
store không xóa được khách hàng; bán hoặc chuyển nhượng store không tách được dữ liệu;
yêu cầu xóa theo GDPR phải lọc trong bảng dùng chung; và lộ bảng này làm lộ khách hàng
của **toàn bộ tenant**.

Đã cân nhắc phương án trung gian kiểu WordPress.com: giữ Multisite và nhân bản read-only
database global xuống từng pool để JOIN chạy cùng server. Cách này giải quyết bài toán
JOIN nhưng không giải quyết bài toán PII, nên là giải pháp sai cho nền tảng thương mại.

## ✅ Đã đo 2026-07-22 — Spike Report #004 (cùng nền MySQL 8.4)

Lần đầu đo **cả hai topology trên cùng một engine**. Xem
`scripts/spike/REPORT-004-topology-lifecycle.md`.

| Phép đo | Multisite | Isolated | |
|---|---|---|---|
| Provisioning (wp-cli) | **1.461 ms** (n=50) | **2.306 ms** (n=100) | Isolated chậm 1,6× |
| Clone | **1.856 ms** (n=1) | **1.166 ms** (n=13) | Multisite chậm 1,6× |
| **Delete** | **962 ms** (n=6) | **306 ms** (n=9) | **Multisite chậm 3,8×** |
| **Upgrade Distribution** | *(một codebase)* | **symlink 21 ms · 0 MB** | hai bên **bằng nhau** |

**Ba điều số liệu này nói ra:**

1. **Đổi engine không phải đánh đổi hiệu năng** — Multisite trên MariaDB 1.400 ms, trên
   MySQL 8.4 là 1.461 ms (+4%). Việc chuyển sang MySQL thuần tuý phục vụ đường nâng cấp
   H2–H4 của `ADR-006`.
2. **Isolated không chậm hơn về bản chất.** 87% chi phí nằm ở `wp core install` (1.998 ms
   trên 2.306 ms) — bước thay được bằng import database mẫu. Multisite thì `wpmu_create_blog`
   đã là đường ngắn nhất, **không còn gì để tối ưu**. Con số 1,6× là khoảng cách giữa bản
   chưa tối ưu và bản đã tối ưu hết.
3. **Chênh lệch thật của Clone không nằm ở thời gian mà ở SỐ BƯỚC:** Isolated là một lệnh
   `mysqldump | mysql`; Multisite cần copy từng bảng → viết lại tiền tố → cập nhật
   `wp_blogs` → tạo lại `wp_N_capabilities` trong `wp_usermeta` **global** → `search-replace`.
   **Một bước so với năm.**

**Phát hiện nghiêm trọng nhất — rủi ro trộn dữ liệu giữa tenant.** Cần ba lần sửa lỗi mới
làm Multisite clone chạy đúng, và một trong ba là:

```
LIKE 'wp\_2\_%'   →   10 bảng   (đúng: chỉ blog 2)
LIKE 'wp_2_%'     →  110 bảng   (sai: kéo cả wp_20_*, wp_21_*, …)
```

Trong SQL `_` là ký tự đại diện. **Bất kỳ code nào lọc bảng theo `wp_N_` mà quên escape sẽ
trộn dữ liệu giữa các store — và im lặng cho tới khi network có blog hai chữ số.** Với
Multisite, ranh giới giữa các store là **một quy ước đặt tên**, mà quy ước thì có thể viết
sai. Với Isolated, ranh giới là database.

Hai lỗi còn lại cũng đáng ghi: MySQL 8.4 từ chối `CREATE TABLE ... LIKE` chính bảng
WordPress vừa tạo (`Invalid default value for 'comment_date'` — WordPress tự nới `sql_mode`
khi tạo, phiên clone thì không), và `wp search-replace` không có cờ `--tables` nên clone
hỏng **sau khi đã copy xong toàn bộ bảng**.

**4. Delete là chỗ Multisite thua nặng nhất — 3,8×.** `wpmu_delete_blog` xoá 10 bảng trong
database dùng chung; Isolated `DROP DATABASE` một phát. Khoảng cách sẽ giãn thêm với store
WooCommerce thật (~50 bảng). Đây là thao tác **lặp lại nhiều hơn tạo** trong vòng đời.

**5. Phép đo lẽ ra bênh Multisite lại cho kết quả ngược.** `Upgrade Distribution` được đưa
vào bộ đo *vì* nó là phép đo duy nhất có thể nghiêng về Multisite — lợi thế "một codebase".
Nhưng Isolated dùng **symlink** đạt đúng điều đó:

| Cách của Isolated | Thời gian/store | Đĩa thêm |
|---|---|---|
| **symlink tới codebase chung** | **21 ms** | **0 MB** |
| copy riêng mỗi store | 1.351 ms | 145 MB |

Với 1.000 store: symlink **0 GB**, copy riêng **145 GB**. "Copy riêng" không phải phương án
nghiêm túc, nên **so sánh công bằng là Multisite vs Isolated-symlink — hai bên bằng nhau**.
Cập nhật Distribution = thay bản gốc một lần, cả N store thấy ngay, ở **cả hai** topology.

> Luận điểm mạnh nhất còn lại của Multisite — "một codebase, cập nhật một lần" — **không
> còn là lợi thế riêng của nó**.

**Vẫn còn thiếu để chốt:**
- **Portability** (export sang network khác): harness sẵn sàng nhưng chặn ở việc bật HPOS
  của WooCommerce. Kết luận cấu trúc đã chắc (Isolated cần **0** lần ánh xạ user id;
  Multisite phải ánh xạ `post_author`, `comment_user_id`, `customer_id`, `wp_N_capabilities`),
  nhưng **chưa có số đo**.
- Site đo **chưa có WooCommerce đầy đủ** (12 bảng thay vì ~50), và **WSL2 không phải phần
  cứng đích**.
Vì vậy ADR này tiếp tục để Open/Preferred Direction hiện hành; không thể chốt ADR nền
tảng bằng niềm tin, đúng mục đích ban đầu của ADR-005.

## ⚠️ Hiệu chỉnh 2026-07-23 — số provisioning trong ADR này đo trên site TRẦN

Spike #009 (`scripts/spike/REPORT-009-provisioning-real-store.md`):

| | Tổng/store |
|---|---|
| WordPress core trần — **con số ADR này đang dùng** | 1.461 ms |
| Store thật (WooCommerce + bộ plugin chuẩn) | **7.740 ms** |

**Chậm 5,3×.** 78% chi phí nằm ở `WC_Install::install()` (6.004 ms); phần tạo site vẫn
1.736 ms, khớp Spike #003.

Lợi thế **1,6×** so với Isolated ghi ở mục *Đã đo Spike #004* đo **cả hai** trên site trần.
Tỉ lệ có thể vẫn giữ vì bước đắt nhất giống nhau ở hai topology — nhưng **chưa đo Isolated
với cùng bộ plugin**, nên không được khẳng định. Không dùng cụm "provisioning vài giây" cho
đến khi có số đó.

## Decision

**Cluster có định nghĩa vật lý:**

```
Cluster  =  1 WordPress Multisite Network
          + 1 MySQL Server (+ replica)
          + Redis + PHP-FPM
          + 1 Go Agent
```

**Một Cluster có MỘT database**, chứa cả bảng global (`wp_users`, `wp_usermeta`, `wp_blogs`,
`wp_site`, `wp_sitemeta`…) và toàn bộ bảng `wp_N_*` của mọi store trong network.

**Mở rộng bằng cách thêm Cluster, không phải chia nhỏ một network:**

```
Cluster HK-01 → ~300 store      Scheduler chọn CLUSTER,
Cluster HK-02 → ~300 store      không chọn pool/database
Cluster HK-03 → ~300 store
```

**Không triển khai Database Router (LudicrousDB) ở H1.** Runtime dùng `wpdb` chuẩn:
`blog_id → wpdb` là đủ. Không cần mapping, epoch, ACK hay chữ ký mapping.

**`database-per-store` KHÔNG bị loại bỏ** — nó chuyển thành khả năng mở rộng tương lai,
kích hoạt bởi **yêu cầu kinh doanh**, không phải ngưỡng kỹ thuật. Ví dụ: hợp đồng Enterprise
đòi backup/restore/clone/export store độc lập, hoặc yêu cầu chuyển store sang region khác.
Ngưỡng kỹ thuật kiểu *"backup quá lâu"* **không** phải tiêu chí — vấn đề đó giải được bằng
cách khác rẻ hơn nhiều.

Kiến trúc SaaS và Go Agent vẫn phải **độc lập với Runtime topology** qua `WordPress Adapter`
— nếu sau này đổi, thiệt hại giới hạn ở tầng Runtime.

## Đường thoát cho Enterprise: Isolated theo TIER, không phải "chuyển Cluster"

`ADR-005` mục NFR bên dưới mô tả chuỗi **Detect → Throttle → Move → Dedicated**, trong đó
bước `Move` giả định mapping `blog_id → pool` làm việc di chuyển rẻ. **Giả định đó không còn
đúng** sau khi bỏ Database Router.

**Chuyển store giữa hai Multisite network là export/import đầy đủ:**

| | Thiết kế cũ (có Router) | Hiện hành |
|---|---|---|
| Chuyển store | đổi một dòng mapping + ACK | **export/import sang network khác** |
| Việc phải làm | — | đổi tên ~50 bảng · tạo lại `wp_blogs` · tạo lại `wp_N_capabilities` · **ánh xạ lại mọi `user_id`** · search-replace |
| Tự động hoá được? | có | **không hoàn toàn** — trùng `user_id` giữa hai network cần người quyết |
| Đã đo? | — | **một phần** (xem dưới) |

**Con số quyết định không phải thời gian mà là số tham chiếu `user_id` phải ánh xạ lại.**
Thời gian tối ưu được; số này thì không — nó là hệ quả cấu trúc của việc `wp_users` thuộc
về network chứ không thuộc về store.

| Topology | Tham chiếu phải ánh xạ lại |
|---|---|
| **Isolated** | **0** — user đi theo database |
| **Multisite** | `post_author` + `comments.user_id` + `wc_orders.customer_id` + khoá `wp_N_capabilities` trong `wp_usermeta` **global** |

Đo trên network dev 2026-07-23, store 20 sản phẩm **chưa có đơn hàng nào**:

```
27 post_author + 0 comments + 0 customer_id + 1 capabilities = 28 tham chiếu
```

**Đây là sàn, không phải giá trị điển hình.** Số hạng thứ nhất và thứ ba tăng theo lịch sử
giao dịch thật của cửa hàng.

Và khi login/email của user nguồn **đã tồn tại** ở network đích thì ánh xạ là mơ hồ —
harness ghi `manual_intervention_required / identity_collision` thay vì đoán. **Đó chính là
bước không tự động hoá được**, và là lý do mục này gọi việc chuyển store là thao tác nặng.

### Quyết định

**Không dùng "chuyển sang Enterprise Cluster" làm đường thoát.** Thay bằng **hybrid theo
tier**:

```
Basic / Pro   →  Multisite Cluster      (một network, một database)
Enterprise    →  Isolated single-site   (một cài đặt, một database riêng)
```

Lý do:

- **Yêu cầu kinh doanh xuất hiện đúng ở tier Enterprise** — backup/restore/clone/export độc
  lập, cô lập dữ liệu khách hàng, chuyển nhượng store. Đó chính là điều kiện kích hoạt
  `database-per-store` đã định nghĩa ở mục Decision.
- **Control Plane không đổi** — cùng API, cùng Agent, cùng Workflow; chỉ khác *runtime
  profile* lúc provisioning.
- **Store Enterprise được tạo ra đã là Isolated**, nên **không cần "chuyển"** — bỏ hẳn thao
  tác đắt nhất và là thao tác duy nhất cần người can thiệp.
- Chỉ xây khi có khách Enterprise đầu tiên. Không phải bây giờ.

Cái giá: MU Plugin cần đường site lifecycle thứ hai (không dùng `wpmu_*`). Công việc có biên
giới rõ ràng, và **chỉ làm khi cần**.

## 🚫 Cấm tường minh — những thứ khoá cửa lại phía sau

Chi phí đổi hướng sang Isolated **tăng theo số store đang chạy**. Hai ràng buộc dưới đây giữ
cho chi phí đó không phình:

**1. Không xây tính năng đọc dữ liệu XUYÊN STORE trong cùng network.**

Ví dụ bị cấm: *"khách hàng này đã mua ở 3 store của bạn"*, báo cáo gộp khách hàng nhiều
store, đăng nhập một lần dùng chung cho nhiều store.

Những thứ này **chạy được dưới Multisite** (vì `wp_users` dùng chung) và **không thể chạy**
dưới Isolated. Xây chúng là tự khoá vào Multisite vĩnh viễn — và làm hỏng luôn tier
Enterprise ở trên.

**2. Plugin trong bộ chuẩn phải đo chi phí mỗi request trước khi ship.**

Bộ plugin chuẩn được **network-activate**, nên chi phí mỗi request **nhân với số store** và
sự cố của nó là sự cố **toàn cluster**. Spike #009: Wordfence làm trang chủ chậm từ
**0,08 s → 20,1 s** (~250×) và đã bị bỏ khỏi `core-plugin-set.json`.

Quy tắc rút ra: **bảo vệ nên đặt ở vành đai** (Caddy rate limit, CDN WAF) thay vì ở plugin
theo store — cùng lý do với Protection layer 1: thứ gì không nhân theo store thì không
nhân theo store.

**3. Plugin ghi drop-in phải do nền tảng quản lý — khách hàng không tự cài.**

Spike #007: `advanced-cache.php`, `object-cache.php`, `db.php` nằm trong `wp-content/` nên
**thuộc về network, không thuộc về store**. Một store bật W3TC là cả cluster đi qua drop-in
đó. Vì vậy "khách hàng tự chọn plugin cache" là điều **không thể thực hiện đúng** dưới
Multisite — phải chặn ở marketplace/tầng cài đặt, và nền tảng cung cấp một lớp cache thống
nhất.

**4. Không để giả định "dùng chung `wp_users`" rò lên Control Plane.**

Platform Identity trong PostgreSQL vẫn là nguồn sự thật. Ranh giới `WordPress Adapter` phải
giữ nghiêm để nếu đổi topology, thiệt hại chỉ ở tầng Runtime.

## Mật độ store mỗi Cluster — luôn kèm điều kiện

Con số store/cluster **không phải hằng số**. Spike #002 đo được:

```
Trần store mỗi node ≈ table_open_cache ÷ số bảng NÓNG mỗi store
```

**Bảng nóng, không phải tổng bảng.** Store WooCommerce *sở hữu* ~50–61 bảng nhưng một
request chỉ *mở* 14–19. Hai phép đo độc lập khớp nhau khi dùng đúng biến:

| | `table_open_cache` | bảng nóng | trần lý thuyết | quan sát |
|---|---|---|---|---|
| Spike #002 | 2.000 | 19 | ~105 | thrash giữa 105–120 |
| Spike #010 | 4.000 | 14 | ~285 | **125 store, 0 thrash** |

| Mật độ mục tiêu | `table_open_cache` (25 bảng nóng × 1,2) |
|---|---|
| 200 store | 6.000 |
| 300 store | 9.000 |
| 500 store | 15.000 |

⚠️ **Hiệu chỉnh 2026-07-23 (Spike #010): `table_open_cache` KHÔNG phải ràng buộc ở dải mật
độ nền tảng nhắm tới.** 125 store với 6.709 bảng chạy trên cache 4.000 cho **0 thrash** và
độ trễ phẳng. 9.000 mục cache cho 300 store chỉ tốn vài chục MB.

Vì vậy **trần store mỗi cluster do CPU, RAM, PHP worker và IO quyết định** — cả bốn **chưa
đo trên phần cứng thật**. Vẫn không được viết "300–500 store/cluster" như một con số trần,
nhưng lý do đã đổi: không phải vì cache, mà vì **chưa biết ràng buộc thật nằm ở đâu**.

## Restore theo Cluster — hệ quả phải nói trước với khách hàng

Một Cluster có một database, nên backup/restore là của **cả cluster**:

> **Restore một cluster sẽ lùi trạng thái của MỌI store trong đó.**

Không thể restore riêng store 27 mà không đụng 299 store còn lại. Restore riêng một store
đòi lọc bảng theo tiền tố, và **vẫn không tách được `wp_users`** (xem mục giới hạn cô lập
tenant bên dưới).

Với nền tảng thương mại, đây là điều phải nói với khách hàng **trước**, không phải lúc sự cố.

## ⚠️ Giới hạn cô lập tenant — phải đọc trước khi hứa với khách hàng

Quyết định này chấp nhận một giới hạn **không khắc phục được bằng cấu hình**:

**Khách hàng WooCommerce chính là bản ghi trong `wp_users`, và `wp_users` là bảng dùng chung
của cả network.** Hệ quả thực tế:

| Tình huống | Hệ quả |
|---|---|
| Xoá một store | dữ liệu khách hàng của store đó **vẫn nằm lại** trong bảng chung |
| Bán / chuyển nhượng store | **không tách được** khách hàng ra để giao |
| Yêu cầu xoá dữ liệu (GDPR) | phải lọc thủ công trong bảng chung của mọi tenant |
| Rò rỉ `wp_users` | lộ khách hàng của **toàn bộ** tenant trong cluster, không phải một |
| Restore một store | **vẫn phải loại trừ** `wp_users`/`wp_usermeta` |

Thêm một rủi ro vận hành đã đo được (Spike #004): ranh giới giữa các store là **một quy ước
đặt tên**, và quy ước có thể viết sai —

```
LIKE 'wp\_2\_%'   →   10 bảng   (đúng)
LIKE 'wp_2_%'     →  110 bảng   (sai: `_` là ký tự đại diện trong SQL)
```

**Bắt buộc:** mọi code lọc bảng theo `wp_N_` phải escape `_`. Đây không phải khuyến nghị
phong cách — quên nó sẽ **trộn dữ liệu giữa các tenant** và im lặng cho tới khi network có
blog hai chữ số.

Phần này nên tách thành ADR riêng nếu cô lập tenant trở thành cam kết hợp đồng.

## Vì sao ưu tiên Multisite

*Lập luận gốc lúc Proposed, kèm hiệu chỉnh sau khi đo (2026-07-22). Giữ nguyên phần
sai để thấy điều gì đã thay đổi.*

- Provisioning rất nhanh (`wpmu_create_blog()` — vài giây, không cài WordPress mới).
  ✅ **Đo được**: 1.461 ms, đường cong phẳng qua 634 site (Spike #003, #004).
- Một codebase duy nhất — khớp tự nhiên với mô hình Distribution (ADR-004). ✅
- MU Plugin viết một lần quản lý toàn Runtime. ✅
- ~~HyperDB hoạt động tự nhiên với Multisite.~~ ❌ **SAI** — HyperDB fatal trên
  WP 7.0 + WooCommerce, và không có router nào tách được `wp_users` (dòng 88).
  Router đã bị bỏ khỏi thiết kế.
- ~~Update Distribution một lần cho cả network.~~ ⚠️ **Không phải lợi thế riêng** —
  Isolated dùng symlink đạt cùng kết quả: 21 ms/store, 0 byte thêm (Spike #004,
  Phát hiện 5). Hai bên bằng nhau ở khâu này.
- Phù hợp tinh thần Runtime-first (ADR-001): đường ngắn nhất tới một Runtime chạy
  thật để stress test. ✅

**Lợi thế thật còn lại sau khi đo: provisioning nhanh hơn 1,6× và vận hành đơn giản
hơn.** Đổi lại: delete chậm 3,8×, clone nhiều hơn 4 điểm có thể sai, không cô lập
được dữ liệu khách hàng, không restore riêng store. Đó là đánh đổi được chấp nhận
một cách có ý thức — không phải Multisite thắng ở mọi mặt.

## Bốn câu hỏi từng chặn Accepted (lịch sử)

1. **Isolation**: Store A chiếm 100% CPU/PHP worker → latency của Store B bị ảnh
   hưởng bao nhiêu? Chưa benchmark. Lưu ý: noisy neighbor được xử lý như một **NFR
   với chiến lược giảm thiểu nhiều lớp** (xem mục riêng bên dưới), không phải lý do
   loại Multisite — câu hỏi mở là các lớp đó có đạt mục tiêu cô lập trong thực tế
   hay không.
2. **Restore per store** (rủi ro lớn nhất): khôi phục riêng Store 153 từ database
   chung — lọc bảng `wp_N_` được, nhưng `wp_users`/`wp_usermeta` dùng chung chưa có
   workflow tách sạch được chứng minh.
3. **Plugin compatibility**: WooCommerce + plugin thương mại trong Core Plugin Set —
   có plugin hoạt động không tốt với Multisite. Phải test từng cái.
4. **Scale**: 100 → 500 → 1000 → 3000 store trên một network — kích thước `wp_blogs`,
   upgrade time. *(Bỏ "HyperDB routing": ADR-005 đã bỏ Router. Đã có số liệu một phần —
   Spike #003 634 site, Spike #010 125 store WooCommerce thật, cả hai không suy giảm.)*

## Noisy Neighbor là NFR, không phải lý do loại Multisite

Nhận định nền tảng: nếu một store chiếm 100% CPU thì trên Single Site CPU vẫn 100% —
khác biệt chỉ là bán kính ảnh hưởng (Multisite: lan sang láng giềng; Single Site: tự
chịu). Vì vậy giải pháp không phải "bỏ Multisite" mà là chuỗi vận hành:

```
Detect → Throttle → Move → Dedicated
```

Đây là cách WordPress.com/Shopify vận hành mô hình chia sẻ hạ tầng: không phải cài
xong để đó, mà thêm các lớp điều khiển. Runtime phải đáp ứng NFR này qua 4 lớp:

1. **Protection — CDN + Cache**: `Cloudflare → Caddy → FastCGI Cache → Redis → PHP`.
   Mục tiêu: phần lớn request (hướng tới ~90%) không chạm PHP — noisy neighbor chỉ
   nguy hiểm khi request đổ vào PHP worker.
2. **Protection — Rate Limit theo hostname**: Agent cấu hình Caddy giới hạn rps trên
   từng domain, không để một cơn đột biến (hoặc tấn công) đập thẳng vào PHP pool.
3. **Protection — PHP Worker Budget**: không để một site chiếm toàn bộ
   `pm.max_children`. Giai đoạn đầu giới hạn ở tầng reverse proxy/ứng dụng; các gói
   cao cấp có thể tách PHP-FPM pool riêng hoặc giới hạn theo hostname
   *(Proposed — cơ chế cụ thể chốt khi triển khai, cần benchmark)*.
4. **Escalation — Scheduler + Store Migration**: Agent thu thập metrics theo từng
   store/hostname (CPU, RAM, PHP worker, Redis, MySQL, orders, traffic). Khi một
   store vượt ngưỡng đủ lâu (ví dụ CPU > 70% trong 30 phút — *ngưỡng Proposed, tinh
   chỉnh qua vận hành*), Scheduler tạo `Operation: MigrateStore`.

   ⚠️ **Bước `Move` KHÔNG còn rẻ.** Mô tả gốc dựa trên mapping `Store → Pool` của
   Database Router — thứ đã bị bỏ ở mục Decision. Không có Router, `Move` là
   **export/import đầy đủ** và có bước cần người can thiệp (xem mục *Đường thoát cho
   Enterprise*). Vì vậy `Move` là **biện pháp cuối**, không phải công cụ vận hành
   thường ngày; ba lớp Protection ở trên phải gánh phần lớn tải.

Kéo theo khái niệm **Cluster Tier** (mật độ store theo gói — con số minh hoạ,
Proposed): Basic ~200 store/cluster, Pro ~80. Mọi mật độ nêu ở đây **chỉ đạt được
khi `table_open_cache` được cấu hình tương ứng** — xem mục *Mật độ store mỗi Cluster*.

**Enterprise không phải một Cluster Multisite mật độ thấp, mà là Isolated
single-site** — xem mục *Đường thoát cho Enterprise*. Store lớn không ở mãi cluster
chia sẻ, nhưng cách đưa nó ra riêng là **tạo mới ở tier Isolated**, không phải di
chuyển giữa hai network.

### ✅ Đã đo 2026-07-22 — Spike Report #005

`scripts/spike/REPORT-005-isolation.md`. Chiến lược trên được số liệu ủng hộ, nhưng **thứ
tự ưu tiên giữa bốn lớp phải sửa**:

| Tải lên store gây ồn | Nạn nhân, pool dùng chung | Nạn nhân, không chạm PHP | Nạn nhân, pool riêng |
|---|---|---|---|
| 30 client | **4,0×** | — | **1,0×** |
| 100 client | **12,9×** (p95 24,1×) | **1,0×** | **1,0×** |

- **Thiệt hại không có trần** — tuyến tính theo `client ÷ pm.max_children`. Store gây ồn
  **không cần tấn công**, chỉ cần đông khách.
- **Lớp 1 (CDN + Cache) là lớp gánh chính**, không phải một trong bốn lớp ngang hàng: ở
  mức tải làm PHP chậm 12,9×, đường không chạm PHP giữ **1,0×**.
- **Lớp 3 (pool riêng) cô lập hoàn toàn** — 1,0× cho hàng xóm, **30,5×** cho chính store
  gây ồn. Thiệt hại bị nhốt đúng chỗ. Nhưng **không mở rộng tới mọi store**: không chạy
  được 300 pool trên một node, nên lớp 3 là công cụ **theo tier**.
- ✅ **Cô lập tầng MySQL — đã đo (Spike #006)**, kết quả **thuận lợi hơn dự đoán**:
  - Tranh CPU qua MySQL **nhẹ và có trần**: 1,7× ở 32 luồng (so với 12,9× ở tầng PHP).
  - **Cạn connection không với tới được qua HTTP.** Đo trực tiếp: 60 client đồng thời với
    `pm.max_children=10` chỉ sinh **đỉnh 3 connection MySQL**. Một store không thể mở
    nhiều connection hơn số PHP worker đang giữ request của nó — nên **layer 3 làm hai
    việc**: cô lập worker PHP *và* chặn trần connection MySQL.
  - ❌ **Giới hạn cấu trúc:** không đặt được hạn ngạch connection theo store, vì mọi store
    dùng **chung một MySQL user**. `max_user_connections` sẽ giới hạn cả network. Dưới
    Isolated (mỗi store một user) thì công cụ này hoạt động đúng.
  - Chưa đo: tranh khoá dòng, ô nhiễm InnoDB buffer pool, truy vấn chậm bão hoà IO.

```
Basic / Pro   →  pool chung  →  sống nhờ lớp 1 (cache)
Store nặng    →  pool riêng  →  cô lập 1,0×, tự chịu 30,5×
```

Tóm lại: Detection + Protection + Escalation + Enterprise Tier là **chiến lược vận
hành** giữ được lợi thế provisioning/quản lý tập trung của Multisite. Isolation
benchmark trong Exit Criteria dùng để kiểm chứng chiến lược này bằng số liệu, không
phải để phủ quyết Multisite ngay từ đầu.

## Exit Criteria — điều kiện chuyển sang Accepted

Hoàn thành tối thiểu cả bốn hạng mục, mỗi hạng mục ra một báo cáo có số liệu:

1. **Runtime Spike** (Phase 1, tuần đầu): tạo 500–1000 site bằng WP-CLI/script; đo
   thời gian provisioning mỗi site, kích thước và hiệu năng các bảng multisite
   (`wp_blogs`, `wp_site`...), routing latency. → *Spike Report #001*.

   **MỘT PHẦN ĐÃ ĐO — Spike Report #003 (2026-07-22)**, xem
   `scripts/spike/REPORT-003-provisioning-at-scale.md`:
   - **Tạo store không suy giảm**: 634 site qua wp-cli, p50 giữ ~1,3–1,4 s xuyên qua
     điểm bão hoà cache; và 100 store qua **toàn bộ nền tảng** cho đường cong **phẳng
     tuyệt đối** (6.158 ms ở store 1–25 → 6.163 ms ở store 76–100). Trái ngược
     database-per-store (Spike #001) nơi thời gian tăng 1,0 → 2,8 s.
   - **Cache bảng bão hoà ở 500 site**: `Open_tables` chạm đúng `table_open_cache=4000`.
   - ⚠️ **Số liệu này đánh giá thấp áp lực bảng 5 lần**: harness tạo site WordPress core
     trần (~10 bảng/site), store WooCommerce thật có **50 bảng**. Quy đổi ra store thật,
     trần ở cấu hình devenv là **80 store/node**. KHÔNG được đọc "634 site chạy tốt"
     thành "634 store chạy tốt".
   - **Vẫn thiếu**: đo **phục vụ** ở quy mô (thrash cache cắn ở đây, không phải lúc tạo),
     site có WooCommerce ở quy mô, và phần cứng đích.
2. **Isolation Benchmark** (Phase 5): kịch bản noisy-neighbor, đo CPU, PHP Worker,
   Redis, MySQL lock, Object Cache, Upload IO của store lân cận khi một store quá
   tải — đo **hai chế độ**: baseline (không có lớp bảo vệ) và có đủ 4 lớp
   Protection/Escalation ở mục NFR trên, để chứng minh chiến lược giảm thiểu đạt
   mục tiêu chứ không chỉ đo mức độ tệ. → *Stress Test Report*.
3. **Restore Test**: thực hiện thành công Backup → chọn một store (ví dụ Store 321)
   → Restore → Verify, **không ảnh hưởng các store khác** trong cùng database.
   → *Restore Test Report*.
4. **Plugin Compatibility Matrix**: toàn bộ Core Plugin Set của Distribution
   (WooCommerce, Redis Cache, SEO, SMTP, Backup Client, Image Optimization...) chạy
   đúng trên Multisite (network-activate, per-site settings). → *Compatibility
   Matrix v1*.

Khi đạt cả bốn, cập nhật ADR này thành:

```yaml
Status: Accepted
Decision: Each Runtime Cluster SHALL use a single WordPress Multisite network.
Rationale: Fast provisioning · Shared runtime · Distribution compatibility ·
           HyperDB compatibility · Operational simplicity
Evidence:  Spike Report #001 · Stress Test Report · Restore Test Report ·
           Plugin Compatibility Matrix v1
```

Nếu một tiêu chí thất bại không khắc phục được (đặc biệt Restore hoặc Isolation),
ADR này chuyển sang phương án thay thế bên dưới bằng một ADR mới (Superseded).

## Alternatives Considered

- **Isolated Single-sites** (mỗi store một WordPress install, shared codebase qua
  symlink kiểu Bedrock): cô lập rõ theo store (PHP-FPM pool riêng, DB riêng),
  restore per-store tầm thường hoá (một DB = một store); đổi lại provisioning nặng
  hơn, quản lý N site độc lập, MU Plugin phải viết lại site lifecycle (không còn
  `wpmu_*`), bỏ HyperDB và tự xây lớp cấp phát DB.
- **Hybrid — nhiều Multisite network nhỏ trên một node** (mỗi network 50–100 store
  hoặc theo plan/tier): giới hạn bán kính sự cố và kích thước bảng chung, giữ tốc độ
  provisioning; thêm một tầng điều phối (store thuộc network nào) cho Scheduler. Là
  phương án dự phòng tự nhiên nếu Multisite đạt Isolation/Restore nhưng gãy ở Scale.

## Hệ quả

- Đội phát triển triển khai Phase 1–4 theo Multisite mà không chờ ADR đóng — nhưng
  mọi code phụ thuộc topology phải nằm sau `WordPress Adapter`, không rò rỉ giả định
  Multisite lên SaaS/Agent core.
- Đã giữ Multisite: còn nợ **giới hạn tài nguyên theo site**, **hardening**, và
  **identity model** giữa SaaS user và `wp_users` dùng chung (`ADR-007`).
  **Restore-per-store không nằm trong danh sách** — nó không khả thi dưới Multisite;
  khách hàng cần nó phải ở tier Enterprise/Isolated.
- Nếu chuyển topology: thiệt hại giới hạn ở tầng Runtime (MU Plugin site lifecycle);
  ADR-001/002/003, Workflow/Operation và API Contract phía SaaS không đổi. **Nhưng chi
  phí đó tăng theo số store đang chạy** — mỗi store hiện hữu là một lần export/import.
  Đây là lý do có mục *Cấm tường minh* ở trên.
- **Reverse proxy giữ nguyên Caddy.** `install-node.sh` và hai Caddyfile đang dùng
  Caddy; đổi sang Nginx sẽ mất TLS tự động — thứ có giá trị thật khi phải cấp chứng
  chỉ cho hàng trăm custom domain. Không có lý do kỹ thuật nào trong quyết định
  Multisite đòi đổi web server.
