# Blueprint — Version & Freeze Record

## Blueprint v1.1 — CURRENT (2026-07-21)

v1.1 bổ sung **tầng nguyên lý (Architecture Principles)** và hai ADR về database/identity.
Đây là thay đổi **kiến trúc thật** (đụng mô hình dữ liệu + `ADR-005` Accepted-pending), nên
theo chính sách freeze phải **tăng version**, không cập nhật lén trong v1.0.

### Mới trong v1.1
- **`AP/` — Architecture Principles** (namespace riêng, vòng đời khác ADR: nguyên lý *luôn
  đúng*, không bị superseded; ADR là *quyết định tại một thời điểm*):
  - **AP-002 Platform Data Ownership** — ba lớp dữ liệu (Platform/Runtime Global/Store),
    bảng ownership và hai chiều projection; nguyên lý này không tự quyết định vị trí
    `wp_users`/`wp_usermeta`.
  - **AP-001 No Cross-Store Database Join** — cấm JOIN vượt store; aggregate qua
    event/projection; **ràng buộc lộ trình Marketplace**.
- **ADR-006 Database Platform** — `Pool → Database → Dataset → Store`; **database-per-store**;
  DAS là thẩm quyền duy nhất; mapping **epoch + ACK-ALL**; migration **RPO=0** với freeze
  cưỡng chế tầng DB; failover manual→H4; Router chỉ là adapter; Global không nằm hot path.
- **ADR-007 Platform Identity** — Platform sở hữu user, store chỉ nhận projection.
- **ADR-005 được cập nhật** — database topology làm lệch cán cân Multisite vs Isolated;
  không được chốt độc lập; A1 spike phải đo thêm database-per-store ở quy mô.

### Quan hệ với v1.0
Toàn bộ v1.0 vẫn hiệu lực: mô hình 3-plane, ADR-001…004, API Contract v1.0.0.
`ADR-005` vẫn `Open` (Preferred: Multisite) — nay phụ thuộc thêm dữ liệu database-per-store.

### Thứ tự đọc (theo phụ thuộc)
```
AP-002 (ownership)  →  AP-001 (no cross-store join)  →  ADR-006 (database)  →  ADR-007 (identity)
```

---

## Blueprint v1.0 — FROZEN (2026-07-21) — nền tảng, vẫn hiệu lực

Kiến trúc đã đủ ổn định qua toàn bộ quá trình thảo luận và được **kiểm chứng chạy thật**
(Gate 2 functional live). Bản Blueprint này được **đóng băng ở v1.0** làm cơ sở triển khai.

### Những gì đóng băng ở v1.0
- **Mô hình 3-plane**: Control Plane (SaaS) / Management Plane (Go Agent) / Runtime Plane
  (WordPress Multisite). Triết lý: WordPress là *Runtime Engine*, SaaS là *Platform*.
- **5 ADR (Accepted)**:
  - ADR-001 Runtime-First
  - ADR-002 Agent Native (systemd, không Docker)
  - ADR-003 Không SSH / không Direct DB — mọi thứ qua Agent → MU Plugin
  - ADR-004 Distribution là artifact có version (immutable)
  - ADR-005 Runtime Topology = WordPress Multisite (Open → Preferred, đóng sau Gate 1 spike)
- **API Contract v1.0.0 Stable** (`docs/api/agent-saas.openapi.yaml`,
  `agent-mu-plugin.openapi.yaml`) — nguồn sự thật, sinh SDK.
- **Roadmap 11 phase** (`13-Roadmap.md`) và thứ tự thi công (`15-Execution-Plan.md`).

### Chính sách freeze
- **Triển khai** tiếp tục trên nền v1.0 mà không cần sửa Blueprint.
- **Thay đổi kiến trúc** (đụng 3-plane, một ADR Accepted, hoặc breaking API Contract) →
  phải mở một **ADR mới** + tăng **Blueprint version** (v1.1 / v2.0), không sửa lén v1.0.
- **Thay đổi additive** (thêm endpoint không phá vỡ, thêm module) → cập nhật trong v1.0.
- ADR-005 sẽ được chốt (Accepted/Superseded) bằng số liệu **Gate 1 spike** — đây là mục
  Open duy nhất còn lại của v1.0.

### Bản đồ tài liệu v1.0
```
00–14   Kiến trúc nền (executive, vision, 3-plane, DDD, runtime, database-router, agent,
        mu-plugin, saas, workflow, provisioning, deployment, monitoring, roadmap, production)
15      Execution Plan (3 gate, đường găng)
16      Work Breakdown
17      Remaining Work (living)
18      SaaS Control Plane — Implementation Plan  (Control Plane, 100%)
19      Runtime Implementation                    (Runtime Plane, 100%)
20      Platform Services (Agent + Distribution)   (Management Plane, 100%)
ADR/    001–005
AP/     001–002 (nguyên lý — đọc trước ADR)
DECISION-FLOW.md  Yêu cầu → AP → ADR → DDD → Module → Impl; AP hay ADR?; khi nào tăng version
DOC-STATUS.md   VERSION.md (this)
```

### Trạng thái thực thi tại thời điểm freeze
- Runtime + Agent: **xây xong, có test, chạy thật** (30 task, full 3-plane live với mock SaaS).
- API Contract v1: đóng băng.
- Còn lại: SaaS Control Plane (18), hardening, và **Gate 1 spike trên VPS** để chốt ADR-005.

---
_Đính chính (không tăng version — sửa số liệu, không đổi quyết định nào)_
- **2026-07-22 — Sửa phân loại AP-002:** Khẳng định **"`wp_users` không nằm ở Runtime
  Global"** là hệ quả cụ thể của ADR-005/topology, không phải nguyên lý của AP-002.
  AP-002 vẫn giữ nguyên nguyên lý Platform sở hữu dữ liệu nghiệp vụ, không tầng nào đọc
  trực tiếp database tầng khác, và projection hai chiều cho mọi topology. Chi tiết
  `wp_users`/`wp_usermeta` được chuyển sang ADR-007: Runtime Identity per-store khi
  Isolated và GLOBAL khi Multisite. **AP-002 không bị Superseded**; đây là sửa phân loại,
  phù hợp `DECISION-FLOW.md`.
- **2026-07-21** — `ADR-006` và `ADR-005`: ước lượng "~12 bảng/store ≈ 120k bảng" là **chỉ
  đếm WordPress core**. Đo thật trên dev env: **48 bảng và 5.0 MB / store WooCommerce rỗng**
  ⇒ 10.000 store = **480.000 bảng, ~50 GB**. (Con số bảng/store sau đó được sửa tiếp thành
  **50** ở đính chính 2026-07-22; ước lượng `table_open_cache` "~83 store" nêu trong lần
  đính chính này là **suy luận chưa đo** và đã được thay bằng số đo thật của Spike #002.)

- **2026-07-22** — `ADR-005` và `ADR-006`: bổ sung kết quả **Spike Report #002 (table
  cache)**. Trần store mỗi node = `table_open_cache ÷ số bảng nóng mỗi store` (đo: 105 vừa,
  120 thrash ở cache mặc định 2000). Số bảng/store sửa **48 → 50** (`wp_users`/`wp_usermeta`
  là global trong Multisite nên không nằm trong tiền tố `wp_N_*`). Không đổi quyết định nào:
  đây là ràng buộc **cấu hình Runtime**, không phải giới hạn kiến trúc.
- **2026-07-22** — Agent job result mở rộng additive: job `create-store` báo về
  `{"blogId": <positive integer>}` trong trường `result` sau khi MU Plugin tạo blog thành công;
  các job khác không bịa payload kết quả.

- **2026-07-22** — Đính chính tài liệu: đổi tên `05-HyperDB.md` thành
  `05-Database-Router.md` và chuẩn hoá tên gọi theo interface Database Router; LudicrousDB
  vẫn chỉ là một implementation. **Không đổi quyết định kiến trúc nào.**

- **2026-07-22** — `ADR-005` (Exit Criteria #1) và `ADR-003`: bổ sung **Spike Report #003
  (provisioning ở quy mô)**. Tạo store trên Multisite **không suy giảm** — 100 store qua
  toàn nền tảng cho đường cong phẳng (6.158→6.163 ms), 634 site qua wp-cli giữ p50
  ~1,3–1,4 s xuyên qua điểm bão hoà cache. Cache bảng đầy ở 500 site core; quy đổi store
  WooCommerce thật (50 bảng) thì trần là ~80 store/node ở `table_open_cache=4000`.
  `ADR-003` nhận thêm một **câu hỏi mở đo được**: 94% thời gian khách chờ là Agent ngủ
  giữa hai chu kỳ poll (công việc thật 382 ms / tổng 6.074 ms) — và **long-poll không vi
  phạm outbound-only**, khác với webhook. Không đổi quyết định nào.

- **2026-07-22** — `ADR-005` ghi nhận ba bằng chứng độc lập về xung đột giữa database-per-store
  và Multisite: `wp_users`/`wp_usermeta` là GLOBAL; schema `wp_2_*` thiếu hai bảng đó;
  và LudicrousDB định tuyến nhưng không đổi tên `wp_N_*`. Bổ sung hệ quả cùng-server/JOIN,
  PII, movable-vs-portable và phương án nhân bản global read-only bị loại. Chi phí
  provisioning của Isolated vẫn chưa đo (harness có, chưa chạy); **không đổi Status hoặc
  Preferred Direction của ADR-005**.

- **2026-07-22** — `ADR-005`: bổ sung **Spike Report #004**, lần đầu đo **cả hai topology
  trên cùng engine (MySQL 8.4)**. Provisioning: Multisite 1.461 ms / Isolated 2.306 ms —
  nhưng 87% chi phí Isolated nằm ở `wp core install`, bước thay được bằng import database
  mẫu. Clone: Multisite 1.856 ms / Isolated 1.166 ms — chênh lệch thật là **1 bước so với
  5 bước**. Phát hiện nghiêm trọng: `LIKE 'wp_2_%'` không escape kéo **110 bảng thay vì 10**
  (`_` là ký tự đại diện trong SQL) — với Multisite ranh giới giữa store là một **quy ước
  đặt tên**, có thể viết sai. Status ADR-005 **không đổi**: còn thiếu portability, delete,
  upgrade distribution.

_Lịch sử version_
- **v1.1** — 2026-07-21 — Current. + AP-001/AP-002 (principles), ADR-006 Database Platform,
  ADR-007 Platform Identity; ADR-005 cập nhật tham chiếu database topology.
- **v1.0** — 2026-07-21 — Frozen. Kiến trúc 3-plane + 5 ADR + Contract v1.
