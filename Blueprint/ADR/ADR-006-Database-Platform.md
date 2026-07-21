# ADR-006: Database Platform — Allocation, Topology, Migration, Failover

## Status

**Accepted** (Blueprint v1.1, 2026-07-21). Dẫn xuất từ `AP-002` (Platform Data Ownership)
và `AP-001` (No Cross-Store Database Join). Thay thế mô hình cũ "HyperDB là trung tâm".

## Bối cảnh

Mục tiêu không phải *"một MySQL phục vụ nhiều website"* mà là *"một Platform quản lý rất
nhiều Database Pool; database chỉ là **resource**"* — giống cách Kubernetes quản lý Node.

Sự cố 2026-07-21 (HyperDB fatal trên WP 7.0, thay bằng LudicrousDB với chi phí kiến trúc
**bằng không**) là bằng chứng thực nghiệm: thư viện routing **không phải** trung tâm thiết kế.

## Quyết định

### 1. Phân tầng topology
```
Pool  →  Database  →  Dataset  →  Store
```
**`database-per-store` là mặc định.** Dữ liệu store KHÔNG dùng prefix `wp_N_*` trong một
database dùng chung.
```
Pool A:  store_245 · store_246 · store_247      (mỗi store một database, tự chứa)
Global:  wp_site · wp_blogs · network metadata  (Runtime Global — KHÔNG chứa wp_users)
```
`wp_users`/`wp_usermeta` là **projection per-store**, nằm trong chính database của store
(`AP-002`, `ADR-007`). Nhờ vậy store database tự chứa → migration là dump/restore **một**
database, và restore-per-store không phải loại trừ bảng dùng chung.

### 2. Database Allocation Service (DAS) là thẩm quyền DUY NHẤT
DAS thuộc Control Plane. **Scheduler không tự chọn database — Scheduler hỏi DAS.**
```
DAS
├── Pool Registry          pool, primary/replica, capacity, used, status
├── Topology Registry      primary→replica, lag, region, version   (nuôi bằng heartbeat Agent)
├── Placement Policy       chấm điểm tài nguyên → chọn pool
├── Capacity Manager       ngưỡng cảnh báo / read-only / ngừng cấp
├── Health Checker         cập nhật từ heartbeat, KHÔNG query Agent trực tiếp
├── Migration Planner      lập kế hoạch di chuyển store giữa pool
├── Failover Planner       đề xuất promote replica
└── Placement History      lịch sử store ↔ pool (bảng riêng, không nhét vào audit_log)
```
Mọi quyết định *chọn pool nào / còn tài nguyên không / có cần pool mới / có cần move /
khi nào failover / khi nào rebalance* đều thuộc DAS. **Runtime chỉ routing.**

### 3. Database Router chỉ là adapter
Runtime chỉ làm đúng một việc: `blog_id → pool → connect`. Implementation có thể là
`wpdb`, **LudicrousDB (hiện tại)**, HyperDB, ProxySQL, Vitess hoặc router riêng — **đổi
implementation KHÔNG ảnh hưởng Control Plane**.

### 4. Mapping có epoch + ACK (invariant an toàn dữ liệu)
Mapping `blog_id → pool` tồn tại ở hai nơi (Control Plane là nguồn sự thật; node có bản
sync). Mapping lệch = **WordPress ghi nhầm database** = mất/nhân đôi đơn hàng **âm thầm**.
```json
{ "epoch": 82, "generatedAt": "2026-07-21T10:20:00Z", "mappings": { "245": "pool-b" } }
```
**Bất biến:**
- Router **từ chối phục vụ** nếu mapping cũ hơn epoch hiện hành hoặc quá TTL.
- Agent ACK theo **epoch cụ thể**: `ACK(node, epoch)` — idempotent, so sánh được (KHÔNG
  ACK kiểu "đã reload", vì node có thể reload đúng lúc epoch mới vừa phát hành).
- Workflow migration chỉ được `Delete Old` **sau khi ACK-ALL** từ mọi node liên quan.

### 5. Migration: RPO = 0
```
Restore → READ-ONLY FREEZE → Binlog catch-up → Verify → Switch Mapping (epoch+ACK) → Open
```
- **Freeze phải cưỡng chế ở tầng database** (`SET GLOBAL read_only` / thu hồi quyền ghi)
  hoặc tại router. **KHÔNG** dựa vào hằng số PHP: WooCommerce **Action Scheduler ghi liên
  tục** (chính nó đã làm lộ bug HyperDB), WP-Cron và background job cũng vậy. Freeze ở
  tầng ứng dụng ⇒ RPO=0 chỉ là nguyện vọng.
- **Verify = so row count + checksum các bảng đơn hàng**; mismatch ⇒ **abort**, không switch.
- Mục tiêu: **RPO 0**, downtime **10–20s**.

### 6. Failover: manual-assisted trước, auto sau
```
Planner → Proposal → Admin Approve → Promote
```
- **H2: bắt buộc có người duyệt.** Async replication ⇒ promote sẽ mất phần lag; primary
  cũ sống lại ⇒ **split-brain, hai primary**.
- **Auto chỉ từ H4**, và chỉ khi có đủ: **fencing/STONITH**, semi-sync replication, đo lag
  thực tế, và RPO được chốt tường minh.

### 7. Capacity: điểm tài nguyên là thẩm quyền
Store count **không** phải đơn vị chính (một store chết ≠ Nike 5.000 orders/phút).
```
Score = CPU · Memory · IOPS · Storage · Connections · Replication Lag · QPS · TPS · Latency
```
Trọng số **cấu hình được** (`PLACEMENT_*`), số thật nạp sau **Gate 1 spike**.
Store count chỉ là **soft limit**. Dùng **metrics theo từng store** (Agent N3 đã thu thập)
để placement biết store nào "nặng".

Ngưỡng Capacity Manager (cấu hình được): **~88% cảnh báo → ~95% read-only → 100% ngừng cấp**.

### 8. Pool lifecycle + invariant
```
Provisioning → Healthy → Draining → Maintenance → Retiring → Deleted
```
- `Draining` **chặn allocation mới**.
- Không được `Healthy → Retiring` khi còn store; phải Drain (migrate hết) trước.
- `Retiring` chỉ hợp lệ khi `used == 0`.
- **Pool lifecycle là thủ công + alert ở H1**; tự động provisioning để **H3**. Không ai
  được giả định có autoscaling.

### 9. Runtime Global KHÔNG nằm trên hot path
`wp_site`/`wp_blogs` cần cho mọi request ⇒ nếu global DB chết thì **mọi store chết**, phá
hỏng chính lợi ích isolation. **Bắt buộc:** mapping đã sync xuống node **mang luôn site
registry** (blog_id → domain/path/pool, kèm epoch) để node phục vụ được **không cần global
DB trên đường request nóng**. Global chỉ là nguồn sự thật để phát hành mapping.

### 10. Contract của DAS — chốt từ H0, không đổi về sau
```json
{ "poolId": "pool-a", "dataset": "store245",
  "connectionRef": "secret://pool-a", "epoch": 82 }
```
**`connectionRef` là tham chiếu, KHÔNG phải credential.** Agent tự giải mã từ secret store
cục bộ. **Credential không bao giờ xuất hiện trong payload của Operation** — job đi qua
hàng đợi và log.

## Lộ trình

| Phase | Nội dung |
|---|---|
| **H0** (MVP) | 1 cluster, 1 pool, `wpdb` chuẩn. **DAS đã tồn tại** nhưng luôn trả `Pool A` — đúng contract §10 |
| **H1** | Nhiều pool/cluster; Router định tuyến theo `blog_id`; DAS cân bằng store mới; pool lifecycle thủ công + alert |
| **H2** | Replica, health check, **migration RPO=0**, failover **manual-assisted** |
| **H3** | Đa cluster/region; DAS thành dịch vụ phân phối toàn cục (region, latency, chi phí) |
| **H4** | Cân nhắc auto-failover khi đủ fencing + semi-sync |

## Hệ quả

- **Ảnh hưởng ADR-005**: `database-per-store` + identity per-store làm store gần như tự
  chứa, **giảm giá trị còn lại của Multisite**. Hai quyết định phải cân nhắc cùng nhau;
  `ADR-005` được cập nhật để tham chiếu mục này.
- **A1 spike phải đổi**: hiện đo subsite prefix `wp_N_*`; phải đo **database-per-store ở
  quy mô** — thời gian `CREATE DATABASE`, 10.000 database × ~12 bảng ≈ 120k bảng
  (`innodb_file_per_table`, `table_open_cache`, `open_files_limit`). Đây là số liệu
  **quyết định tính khả thi** của topology và hiện **chưa có**.
- Backup/restore phải **pool-aware**; đổi lại blast radius nhỏ hơn nhiều.
- "Hot Store → Enterprise Pool" **dùng chung cơ chế** với Store Migration (S-7), không xây
  hai hệ thống song song.

## Open question

Chưa chốt: có replicate `Runtime Global` (read-only) xuống từng pool hay chỉ dựa vào
mapping đã sync (§9). Quyết định khi triển khai H1, dựa trên đo đạc thực tế.
