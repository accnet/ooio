# 20 · Platform Services — Go Agent & Distribution

> **Phạm vi: 100% Management Plane** — Go Agent (thực thi hạ tầng) + Distribution (đóng gói
> Runtime). Đồng cấp `18` (Control Plane) và `19` (Runtime Plane). Agent là cầu nối giữa hai
> plane: nhận **Operation** từ SaaS (Contract v1) → thao tác trên node → gọi MU Plugin.
> Agent **không chứa business logic** (không biết billing/user/dashboard).
>
> Đã build + test (Go, `go test` xanh) + chạy daemon thật. Gom chi tiết từ `06-Go-Agent`,
> `10-Provisioning`, `11-Deployment`, ADR-002/004.

## 1. Go Agent — nguyên tắc
- **Native/systemd**, không Docker (ADR-002); out-of-band khỏi đường request.
- **Outbound-only**: Agent tự `register` → heartbeat → **poll job** (không inbound port,
  không SSH vào node từ SaaS).
- Chỉ biết **Operations**; "làm gì/khi nào" là của SaaS, Agent quyết "làm thế nào" trên máy.
- Mọi thay đổi WordPress qua **MU Plugin** (localhost REST); thao tác hạ tầng (mysqldump,
  systemctl, Caddy admin) trực tiếp trên node.

## 2. Cấu trúc (apps/agent/internal/*) — đã build
```
register    Đăng ký + Node Manifest (capabilities/versions) → POST /v1/agents/register (201)
heartbeat   Trạng thái + Capacity + metrics → POST .../heartbeat
jobsource   Poll GET .../jobs ({jobs:[]}) · report POST .../result (202)
jobrunner   Vòng lặp poll→Handle(job)→report; ctx-cancellable; Handler = seam
provision   Handler dispatch job type; CreateStore orchestration (createstore.go) + rollback
wpclient    HTTP impl WordPressClient → MU Plugin /platform/v1 (bearer, /wp-json base)
wpadapter   Interface Execute(Operation) — transport/topology-neutral (ADR-003/005)
database    Cấp DB (DB-before-site) + sinh Database Router config (Allocator interface)
ssl         Issue/Renew qua Issuer(ACME)+Reloader(Caddy admin :2019) interface
backup      Dump + Storage interface, sha256
restore     Full + restore-per-store (prefix wp_{id}_, bỏ shared users — ADR-005)
domain      Add/remove domain + Caddy config (Store + Reloader interface)
metrics     Node (/proc) + per-store/hostname → heartbeat
promexport  /metrics Prometheus text
config      Load từ env/file (SaaS URL, MU base /wp-json, token, intervals)
```

## 3. Operation model
SaaS gửi **Operation** (opaque job): `{id, type, payload, leasedUntil}`. Agent dispatch theo
`type`, thực thi, báo `{status, result?, error?}`. Loại đã hỗ trợ:
```
create-store · delete-store · activate-plugin · switch-theme · create-user
set-option   · backup-store · restore-store  · issue-ssl
```
`CreateStore` là orchestration nhiều Step **có rollback từng bước** (allocate DB → create
site → activate distribution → configure → admin → add domain → verify); lỗi giữa chừng →
rollback ngược, không để trạng thái nửa vời.

## 4. Node bring-up — install-node.sh (one-shot)
`--system` (VPS, root) hoặc `--prefix` (không sudo). Dựng: deps + MariaDB + WordPress
multisite + MU Plugin + **Redis** (object cache) + **LudicrousDB** (Database Router
drop-in + db-config ở ABSPATH) + **Core Plugin Set/WooCommerce** (install-plugins.sh) + php-fpm + Caddy + Agent
(systemd). Idempotent, có `--dry-run`. Config qua `node-config.env` (mẫu + `DEPLOY.md`).
> Chưa chạy `--system` thật trên VPS lần nào — cần một lần để đóng dry-run→real.

## 5. Distribution — immutable artifact (ADR-004)
Không deploy source git. Đóng gói **bundle có version**:
```
Distribution vX.Y.Z = WordPress + WooCommerce + Theme + Core Plugin Set + MU Plugin + Config + manifest.json
```
- **manifest.schema.json** (JSON Schema) + example — đã có.
- **Builder** (`tools/distribution-builder`, `runtime/distribution`): đóng gói + sha256 +
  đẩy Artifact Repo (dir/MinIO/S3). Đã có + self-test.
- **Rollout**: Operation `DeployDistribution` → Agent **pull artifact** (không từ GitHub trực
  tiếp) → Backup → Maintenance → Update → Verify → Done/Rollback. Mỗi store lưu **một version**
  → rollout theo lô (canary/staged) + rollback per-store.

## 6. CI/CD (Runtime repo)
```
GitHub → build Distribution (version+checksum) → Artifact Repo → Agent pull → deploy
GitHub → build Agent binary (theo arch) → Artifact Repo / scp
```
Agent tự cập nhật binary (Updater) + restart service; không phụ thuộc GitHub lúc deploy.

## 7. Runtime CLI
`apps/cli` — vận hành store (create/delete/list/health) qua MU Plugin REST **không cần
SaaS** (ADR-001). Là giao diện điều khiển standalone của node.

## 8. Xác thực & bảo mật
- Agent ↔ SaaS: registration token → JWT → heartbeat/refresh (Contract v1).
- Agent ↔ MU Plugin (cùng máy): Bearer/shared-secret, MU Plugin chỉ bind localhost.
- Transport Agent↔MU Plugin (REST vs Unix socket): **Open** (ADR-003) — REST localhost là
  mặc định hiện tại; đổi được nhờ `WordPressClient` trừu tượng.

## 9. Trạng thái
Đã build + test: 15 package Go `go test` xanh; chạy daemon thật, full 3-plane live. Còn
lại: Distribution bundle v1 thật + rollout end-to-end; `install-node.sh --system` chạy thật
trên VPS; Agent binary đa-arch.
