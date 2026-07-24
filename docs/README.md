# Bản đồ tài liệu (Documentation Map)

Tài liệu dự án nằm ở hai vị trí, phân chia rõ theo mục đích:

- **`Blueprint/`** — Nguồn thẩm quyền về kiến trúc, quyết định, và kế hoạch triển khai.
  Viết bằng tiếng Việt, có hệ thống phân loại trạng thái (Accepted/Proposed/Open — xem
  [DOC-STATUS.md](../Blueprint/DOC-STATUS.md)).
- **`docs/`** — API contracts, developer guides, spike reports — tài liệu hỗ trợ phát
  triển và vận hành.

---

## Blueprint — Kiến trúc & Quyết định

> Đọc `Blueprint/` khi cần hiểu *vì sao* hệ thống được thiết kế như vậy.

### Kiến trúc nền (Blueprint v1.0 — Frozen)

| File | Nội dung |
|---|---|
| [00-Executive-Summary](../Blueprint/00-Executive-Summary.md) | Tổng quan 1 trang — bắt đầu ở đây |
| [01-Product-Vision](../Blueprint/01-Product-Vision.md) | Sản phẩm là gì, WordPress-as-Runtime |
| [02-Architecture-Overview](../Blueprint/02-Architecture-Overview.md) | Mô hình 3 Plane, sơ đồ luồng |
| [03-DDD](../Blueprint/03-DDD.md) | Bounded contexts, tổ chức mã nguồn |
| [04-Runtime](../Blueprint/04-Runtime.md) | WordPress Multisite, Distribution, vòng đời Runtime |
| [05-HyperDB](../Blueprint/05-HyperDB.md) | Routing, MySQL pools |
| [06-Go-Agent](../Blueprint/06-Go-Agent.md) | Management Plane, module Agent |
| [07-MU-Plugin](../Blueprint/07-MU-Plugin.md) | Data Plane SDK, REST API nội bộ |
| [08-SaaS](../Blueprint/08-SaaS.md) | Control Plane, NestJS |
| [09-Workflow](../Blueprint/09-Workflow.md) | Operation, retry/rollback/audit |
| [10-Provisioning](../Blueprint/10-Provisioning.md) | Tạo store end-to-end |
| [11-Deployment](../Blueprint/11-Deployment.md) | Triển khai, rolling update |
| [12-Monitoring](../Blueprint/12-Monitoring.md) | Observability stack |
| [13-Roadmap](../Blueprint/13-Roadmap.md) | 11 phase, thứ tự, ước tính thời gian |
| [14-Production](../Blueprint/14-Production.md) | Production readiness |

### Kế hoạch triển khai (Implementation Plans)

| File | Phạm vi |
|---|---|
| [15-Execution-Plan](../Blueprint/15-Execution-Plan.md) | Thứ tự thi công, 3 Gate, đường găng |
| [16-Work-Breakdown](../Blueprint/16-Work-Breakdown.md) | Phân rã công việc |
| [17-Remaining-Work](../Blueprint/17-Remaining-Work.md) | Living checklist — việc đã xong và còn lại |
| [18-SaaS-Implementation-Plan](../Blueprint/18-SaaS-Implementation-Plan.md) | Control Plane 100% |
| [19-Runtime-Implementation](../Blueprint/19-Runtime-Implementation.md) | Runtime Plane 100% |
| [20-Platform-Services](../Blueprint/20-Platform-Services.md) | Agent + Distribution 100% |

### Architecture Decisions (ADR) & Principles (AP)

Đọc AP trước ADR. Đọc ADR trước code (xem [DECISION-FLOW](../Blueprint/DECISION-FLOW.md)).

| Document | Status | Tóm tắt |
|---|---|---|
| [AP-001 No Cross-Store DB Join](../Blueprint/AP/AP-001-No-Cross-Store-Database-Join.md) | **Principle** | Cấm JOIN vượt store — giới hạn MySQL, không phải lựa chọn |
| [AP-002 Platform Data Ownership](../Blueprint/AP/AP-002-Platform-Data-Ownership.md) | **Principle** | 3 lớp dữ liệu: Platform / Runtime Global / Store |
| [ADR-001 Runtime-First](../Blueprint/ADR/ADR-001-Runtime-First.md) | Accepted | Xây Runtime trước, SaaS sau |
| [ADR-002 Agent Native](../Blueprint/ADR/ADR-002-Agent-Native-No-Docker.md) | Accepted | Go Agent chạy systemd, không Docker |
| [ADR-003 No SSH, No Direct DB](../Blueprint/ADR/ADR-003-No-Direct-DB-No-SSH.md) | Accepted | Mọi thứ qua Agent → MU Plugin |
| [ADR-004 Distribution Versioned](../Blueprint/ADR/ADR-004-Distribution-Versioned-Artifact.md) | Accepted | Distribution là artifact có version, bất biến |
| [ADR-005 Multisite vs Isolated](../Blueprint/ADR/ADR-005-Multisite-vs-Isolated-Sites.md) | Open (Preferred: Multisite) | Chờ Exit Criteria từ Gate 1 spike |
| [ADR-006 Database Platform](../Blueprint/ADR/ADR-006-Database-Platform.md) | Accepted | Pool → Database → Dataset → Store |
| [ADR-007 Platform Identity](../Blueprint/ADR/ADR-007-Platform-Identity.md) | Accepted | Platform sở hữu user, store chỉ nhận projection |

### Tài liệu quản trị Blueprint

| File | Mục đích |
|---|---|
| [DOC-STATUS](../Blueprint/DOC-STATUS.md) | 3 mức trạng thái: Accepted / Proposed / Open |
| [VERSION](../Blueprint/VERSION.md) | Lịch sử version, đính chính, chính sách freeze |
| [DECISION-FLOW](../Blueprint/DECISION-FLOW.md) | Quyết định đi từ đâu đến đâu, AP hay ADR? |

---

## docs/ — Developer & Operations

> Đọc `docs/` khi cần *làm việc* với hệ thống.

### Getting Started

| Document | Đối tượng |
|---|---|
| [getting-started.md](getting-started.md) | Dev mới vào dự án — tổng quan + setup |
| [architecture-diagrams.md](architecture-diagrams.md) | 7 diagram Mermaid: 3-plane, components, CreateStore flow, Agent lifecycle, request flow, security boundaries, data ownership |

### Guides

| Document | Nội dung |
|---|---|
| [guides/local-development.md](guides/local-development.md) | Setup local dev, chạy từng app |
| [guides/deployment.md](guides/deployment.md) | Deploy Runtime node lên VPS |

### API Contracts (Source of Truth)

| Document | Nội dung |
|---|---|
| [api/CONTRACT.md](api/CONTRACT.md) | API Contract v1 — chính sách versioning |
| [api/agent-saas.openapi.yaml](api/agent-saas.openapi.yaml) | Agent ↔ SaaS Control Plane |
| [api/agent-mu-plugin.openapi.yaml](api/agent-mu-plugin.openapi.yaml) | Agent ↔ MU Plugin |

### Spike Reports

| Document | ADR liên quan |
|---|---|
| [spikes/SPIKE-001-multisite-scale.md](spikes/SPIKE-001-multisite-scale.md) | ADR-005 Gate 1 |
| [scripts/spike/REPORT-002-table-cache.md](../scripts/spike/REPORT-002-table-cache.md) | ADR-005/ADR-006 |
| [scripts/spike/REPORT-003-provisioning-at-scale.md](../scripts/spike/REPORT-003-provisioning-at-scale.md) | ADR-005/ADR-003 |

---

## Trong từng thư mục

Mỗi thư mục chính có README riêng giải thích trạng thái và cách dùng:

| README | Nội dung |
|---|---|
| [apps/README.md](../apps/README.md) | Danh sách apps, trạng thái, vì sao tách web/ops/admin |
| [packages/README.md](../packages/README.md) | Shared packages, trạng thái code |
| [platform/README.md](../platform/README.md) | 11 bounded contexts, trạng thái triển khai |
| [runtime/README.md](../runtime/README.md) | Distribution, MU Plugin, config profiles |
| [infra/README.md](../infra/README.md) | Docker, Terraform, Ansible, monitoring |
| [scripts/README.md](../scripts/README.md) | Spike harness, provisioning scripts |
| [packages/shared/README.md](../packages/shared/README.md) | @ooio/shared — API client factory |
