# Work Breakdown — Chia công việc theo track

> **Trạng thái: Proposed (xem DOC-STATUS.md).** Chia nhỏ từ `13-Roadmap.md` (roadmap
> Accepted) và `15-Execution-Plan.md`. Mã task để tham chiếu; cột "Xong khi" là định
> nghĩa Done. Ước lượng và cách gom track là suy luận thi công, đội hiệu chỉnh khi chạy.

## Cách đọc

Chia theo **track** (luồng chạy song song được) thay vì theo phase tuần tự. Một task
chỉ bắt đầu khi các task ở cột "Phụ thuộc" xong. Cột "Gate" cho biết task đó góp phần
đóng cổng kiểm soát nào (xem `15-Execution-Plan.md`).

Tracks: **P0** nền tảng · **A** Runtime/Distribution · **B** MU Plugin · **C** Go Agent
· **D** Provisioning · **E** Stress Test · **F** API Contract · **G** SaaS · **H**
Production.

---

## P0 — Nền tảng (tuần 1, chặn hầu hết mọi thứ)

| Mã | Việc | Phụ thuộc | Xong khi |
|---|---|---|---|
| P0-1 | `git init` + skeleton monorepo (`runtime/ platform/ apps/agent infra/ docs/`) | — | Repo có cấu trúc, CI lint tối thiểu chạy |
| P0-2 | Domain Model + ERD (SaaS-side) | — | Sơ đồ thực thể + quan hệ được review |
| P0-3 | Coding standards + folder convention + ADR template | — | Tài liệu chuẩn hoá, áp cho mọi track |
| P0-4 | Distribution Manifest schema (`manifest.json`) | — | Schema chốt (fields: distribution, version, wp, woo, plugins, checksum) |
| F0 | **OpenAPI nháp** 2 mặt cắt: Agent↔SaaS, Agent↔MU Plugin | P0-3 | Contract nháp đủ để B/C/G làm song song với mock |

## A — Runtime / Distribution (đường găng, người mạnh nhất)

| Mã | Việc | Phụ thuộc | Gate | Xong khi |
|---|---|---|---|---|
| A1 | **Spike script** WP-CLI tạo N site rỗng trên 1 VPS | P0-1 | **G1** | Tạo được 1000 site, có log số liệu |
| A2 | **Spike Report #001** — đo provisioning time, `wp_blogs`, Database Router routing | A1 | **G1** | Báo cáo có số liệu → quyết ADR-005 |
| A3 | Distribution builder (bundle WP+Woo+theme+plugin+config+manifest, checksum, push Object Storage) | P0-4 | — | Build ra 1 artifact versioned, tải về được |
| A4 | Chốt Core Plugin Set + **plugin compatibility matrix** trên Multisite | A3 | G3 | Ma trận v1: mọi plugin network-activate OK |
| A5 | Database Router config + chiến lược cấp phát DB pool (DB-before-site) | A1 | — | Routing + mapping store→pool chạy |
| A6 | Base config (default/performance/security) | A3 | — | 3 profile config áp được lên site |

## B — MU Plugin (Data Plane SDK)

| Mã | Việc | Phụ thuộc | Gate | Xong khi |
|---|---|---|---|---|
| B1 | MU plugin skeleton + REST server bind `127.0.0.1` | P0-1, F0 | — | `GET /health` trả 200 trên localhost |
| B2 | Site lifecycle: create/delete/suspend (`wpmu_create_blog`...) | B1, A5 | G2 | Tạo/xoá site qua REST |
| B3 | Endpoints: plugin/theme/user/options | B1 | G2 | CRUD cơ bản qua REST |
| B4 | WordPress Adapter + Capability→plugin mapping | B2, B3 | — | Đổi plugin không đổi caller |
| B5 | Auth Agent↔MU (shared secret/bearer localhost) | B1 | — | Chặn client lạ, chỉ Agent gọi được |
| B6 | **Benchmark & chốt transport** REST vs UDS → đóng open question ADR-003 | B2, C4 | — | ADR mới chốt transport, có số liệu |

## C — Go Agent (Management Plane, gối đầu với B)

| Mã | Việc | Phụ thuộc | Gate | Xong khi |
|---|---|---|---|---|
| C1 | Agent skeleton + `systemd` unit + `install-node.sh` | P0-1 | — | `systemctl start` chạy, `journalctl` có log |
| C2 | Heartbeat + self-registration + Node Manifest | C1, F0 | — | Agent tự đăng ký, gửi capability/version |
| C3 | Job Runner (poll job table/BullMQ, pull model) | C1, F0 | — | Nhận & thực thi job pending |
| C4 | WordPress Adapter client (gọi MU Plugin localhost) | C1, B1 | G2 | Agent gọi được `/platform/v1/*` |
| C5 | Database module (CREATE DB, Database Router mapping) — DB-before-site | C1, A5 | G2 | Cấp DB + mapping trước khi tạo site |
| C6 | SSL module (ACME/Let's Encrypt + reload Caddy) | C1 | G2 | Cấp + cài SSL cho 1 domain |
| C7 | Backup module (DB + file → Object Storage) | C1, A3 | G2 | Backup 1 store, restore lại được |
| C8 | **Restore-per-store** từ DB chung (lọc prefix + xử lý users) | C7 | **G2** | **Restore Test Report** — không ảnh hưởng store khác |
| C9 | Metrics theo store/hostname (noisy neighbor detect) — ADR-005 | C2 | — | Đẩy CPU/PHP/req theo hostname về SaaS |
| C10 | Updater/Deploy (self-update binary từ Artifact Repo) | C1, A3 | — | Rolling update 1 node, rollback được |

## D — Provisioning tích hợp (ráp A+B+C → Gate 2)

| Mã | Việc | Phụ thuộc | Gate | Xong khi |
|---|---|---|---|---|
| D1 | Workflow CreateStore end-to-end qua Postman/CLI | C4, C5, B2, A3 | **G2** | 1 lệnh → store WooCommerce chạy |
| D2 | Domain + SSL flow (verify DNS → issue → reload) | D1, C6 | G2 | Store có domain riêng + HTTPS |
| D3 | Delete/suspend store + giải phóng DB | D1, C5 | G2 | Xoá sạch, không rác DB |
| D4 | Verify/health orchestration + rollback khi lỗi bước | D1 | G2 | Bước lỗi → tự rollback, không nửa vời |

## E — Stress Test (Phase 5, chuẩn bị Gate 3)

| Mã | Việc | Phụ thuộc | Gate | Xong khi |
|---|---|---|---|---|
| E1 | Load harness 100→500→1000→3000 site | D1 | G3 | Sinh tải lặp lại được |
| E2 | **Isolation benchmark** noisy-neighbor, 2 chế độ (baseline vs 4 lớp bảo vệ) — ADR-005 | E1, C9 | G3 | Chứng minh chiến lược giảm thiểu bằng số liệu |
| E3 | Vòng lặp tìm & sửa bottleneck (PHP worker, Database Router, Redis, Action Scheduler, cron) | E1 | G3 | Biết giới hạn thật 1 cluster |
| E4 | **Stress Test Report** + chốt ADR-005 (Accepted/Superseded) | E2, E3, A4, C8 | **G3** | Đủ Evidence đóng ADR-005 |

## F — API Contract freeze (Gate 3, sau E)

| Mã | Việc | Phụ thuộc | Gate | Xong khi |
|---|---|---|---|---|
| F1 | Đóng băng **OpenAPI v1** phản ánh Runtime đã stress-test | E4 | **G3** | Contract versioned, SaaS code theo được |

## G — SaaS Core (Phase 7+, sau Gate 3; skeleton làm sớm song song, tích hợp sau)

| Mã | Việc | Phụ thuộc | Xong khi |
|---|---|---|---|
| G1 | NestJS skeleton + module structure | P0-2 | Modules `auth/billing/sites/workflows...` dựng khung |
| G2s | Auth / Users / Organizations / Roles | G1 | Đăng nhập, RBAC cơ bản |
| G3s | Billing / Plans / Subscriptions | G1 | Gắn plan → quota |
| G4s | Cluster Registry + Scheduler/Placement (capacity score) | G1, F1 | Đặt store theo điểm số, không random |
| G5s | Workflow Engine (Operation status/progress/retry/rollback) — bắt đầu 3 op chắc | G1, F1 | CreateStore/Backup/IssueSSL qua Operation |
| G6s | `AgentClient` / `WordPressClient` SDK (cô lập contract) | F1 | Mọi lời gọi Runtime qua 2 client này |
| G7s | Dashboard React (chỉ gọi NestJS) | G2s | Tạo store từ UI, theo dõi realtime |
| G8s | **Store Migration** operation (noisy neighbor escalation) — ADR-005 | G4s, G5s, C9 | Vượt ngưỡng → MigrateStore sang tier/cluster |

## H — Production (Phase 10)

| Mã | Việc | Phụ thuộc | Xong khi |
|---|---|---|---|
| H1 | Monitoring stack (Prometheus/Grafana/Loki/OTel) | C9 | Dashboard vận hành nội bộ live |
| H2 | Centralized logs (WordPress→Agent→OTel→Loki) | H1 | Trace được 1 request/operation xuyên hệ |
| H3 | Alerting rules | H1 | Cảnh báo ngưỡng CPU/SSL/backup fail |
| H4 | Artifact Repository hardening + versioning | A3 | Checksum, retention, rollback list |
| H5 | Rolling update / Distribution rollout (canary — Proposed) | C10, F1 | Update theo lô, rollback độc lập/store |
| H6 | Disaster Recovery runbooks | C8, H1 | Kịch bản khôi phục cluster có kiểm thử |

---

## Sơ đồ phụ thuộc rút gọn

```
P0 ─┬─► A1 ─► A2 ═══► [Gate 1: Multisite scale]
    ├─► A3 ─► A4/A6
    ├─► F0(nháp) ─┬─► B1..B5 ─┐
    │             └─► C1..C7   ├─► D1..D4 ═══► [Gate 2: Runtime tự vận hành]
    └─► A5 ───────────────────┘        (gồm C8 Restore-per-store)
                                         │
                                         ▼
                              E1..E4 ═══► [Gate 3: đóng ADR-005 + F1 freeze contract]
                                         │
                                         ▼
                              G1..G8 (SaaS) ──► H1..H6 (Production)
```

## Song song hoá & phân người (Proposed)

- **Tuần 1:** P0-1..P0-4 + A1 chạy ngay. A1→A2 là việc quan trọng nhất (Gate 1) — 1
  người mạnh về WordPress/hạ tầng.
- **Sau F0 nháp:** track B (MU Plugin) và track C (Agent) chạy song song, ráp ở C4/D1.
- **G1 (NestJS skeleton) làm sớm song song** để không nhàn rỗi, nhưng **không tích hợp
  Runtime** cho tới khi F1 đóng băng — tránh code theo contract chưa kiểm chứng.
- **Việc rủi ro nhất kéo lên sớm:** A2 (Gate 1) tuần 1–3; C8 Restore-per-store trong
  Phase 4, không để tới Production.

## Không làm trong giai đoạn này (giảm phạm vi)

Theo `13-Roadmap.md`: Marketplace mở cho user upload, AI Services, Multi-region,
Kubernetes, Event-driven Kafka/NATS, microservices hoá. Multi-cluster (track G4s) giai
đoạn đầu chỉ cần file config thay cho registry đầy đủ.
