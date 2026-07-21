# Blueprint — Version & Freeze Record

## Blueprint v1.1 — CURRENT (2026-07-21)

v1.1 bổ sung **tầng nguyên lý (Architecture Principles)** và hai ADR về database/identity.
Đây là thay đổi **kiến trúc thật** (đụng mô hình dữ liệu + `ADR-005` Accepted-pending), nên
theo chính sách freeze phải **tăng version**, không cập nhật lén trong v1.0.

### Mới trong v1.1
- **`AP/` — Architecture Principles** (namespace riêng, vòng đời khác ADR: nguyên lý *luôn
  đúng*, không bị superseded; ADR là *quyết định tại một thời điểm*):
  - **AP-002 Platform Data Ownership** — ba lớp dữ liệu (Platform/Runtime Global/Store),
    bảng ownership, **`wp_users` là projection per-store**, hai chiều projection.
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
00–14   Kiến trúc nền (executive, vision, 3-plane, DDD, runtime, hyperdb, agent,
        mu-plugin, saas, workflow, provisioning, deployment, monitoring, roadmap, production)
15      Execution Plan (3 gate, đường găng)
16      Work Breakdown
17      Remaining Work (living)
18      SaaS Control Plane — Implementation Plan  (Control Plane, 100%)
19      Runtime Implementation                    (Runtime Plane, 100%)
20      Platform Services (Agent + Distribution)   (Management Plane, 100%)
ADR/    001–005
DOC-STATUS.md   VERSION.md (this)
```

### Trạng thái thực thi tại thời điểm freeze
- Runtime + Agent: **xây xong, có test, chạy thật** (30 task, full 3-plane live với mock SaaS).
- API Contract v1: đóng băng.
- Còn lại: SaaS Control Plane (18), hardening, và **Gate 1 spike trên VPS** để chốt ADR-005.

---
_Lịch sử version_
- **v1.1** — 2026-07-21 — Current. + AP-001/AP-002 (principles), ADR-006 Database Platform,
  ADR-007 Platform Identity; ADR-005 cập nhật tham chiếu database topology.
- **v1.0** — 2026-07-21 — Frozen. Kiến trúc 3-plane + 5 ADR + Contract v1.
