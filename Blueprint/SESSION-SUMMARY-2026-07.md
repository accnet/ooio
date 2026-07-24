# Session Summary — Runtime Freeze → MVP Backend

**Giai đoạn: 2026-07-22 → 2026-07-24.** Từ "Runtime chưa chốt kiến trúc" tới "Runtime
Frozen + toàn bộ backend MVP code-được đã xong". Điểm dừng: mọi thứ làm được trên WSL2 đã
xong; phần còn lại cần **VPS thật (Phase 0)**.

Đây là tài liệu mang sang Phase 0. Ba tài liệu chi tiết: `PHASE-2-SUMMARY.md` (Runtime +
S1-S3 security), `MVP-PRODUCTION-PLAN.md` (checklist mở đăng ký), `RUNTIME-FREEZE.md` (nợ
đo lường).

---

## 1. Đã chốt và đóng băng

### Runtime — FROZEN v1.0 (`RUNTIME-FREEZE.md`)

7 ADR Accepted · 13 spike report · 4 migration. Multisite, một cluster một database, không
Router. Quyết định lớn dựa trên đo, không phải niềm tin:

- `table_open_cache` **không** phải ràng buộc (Spike #010: 125 store, 0 thrash)
- Cache là **hệ số nhân năng lực** — 127 req/s (PHP) → 1.606 (cache HIT), 14× tĩnh vs PHP
- Bảo vệ ở vành đai, không plugin per-store (Wordfence 250× — Spike #009)

### SaaS backend — 19 task (SA43–SA61), tất cả done

| Nhóm | Task | Nội dung |
|---|---|---|
| Runtime cleanup | SA43–49 | DAS→Cluster · devenv fix · plugin matrix · cache đo + hiện thực |
| **Bảo mật S1** | SA50–52 | JWT fail-closed · refresh rotation · rate limit |
| **Bảo mật S2** | SA53–56 | API key authz · invitation · unified permission · org resolver |
| **Trial S3** | SA57–59 | quota TOCTOU · trial read-only · select-plan trial-safe |
| **MVP** | SA60–61 | backup scheduler · cache-in-installer |

---

## 2. Năm lỗ hổng bảo mật đóng — mỗi cái tái hiện + kiểm sống + đột biến

| Lỗ hổng | Trước | Sau |
|---|---|---|
| `JWT_SECRET` fail-open | token giả → 200 | 401 |
| Refresh không thu hồi | dùng lại 200/200/200 | 200/401/401 + logout |
| Login không giới hạn | vô hạn | 429 |
| **API key vượt authz** | key `read` đổi gói 201 | permission 403 |
| Quota TOCTOU | 2 create đua → 3/2 | advisory lock 402 |

---

## 3. Bài học phương pháp — phần giữ được lâu hơn code

### Kiểm sống bắt thứ test xanh bỏ sót

Sáu bug nghiêm trọng **chỉ lộ khi chạy thật**, test đều xanh:

| Bug | Test không bắt vì |
|---|---|
| P2021 migration chưa áp (SA51, SA54, SA58) | test fake DB |
| P2002 thiếu jti (SA51) | test không tạo token thật |
| DI resolver không export (SA56) | test khởi tạo guard tay |
| Race TOCTOU (SA57) | Promise.all không tái hiện; cần interleave |

→ **Mọi migration áp thủ công + kiểm sống HTTP/logic sau mỗi codex.** Đây là lý do
checklist MVP phải là "đã kiểm sống", không "code đã viết".

### Kiểm đột biến — 7 lần bắt thứ test xanh bỏ sót

`revokedAt:null` · API-key fast-path · `admin.apikey.create` · last-owner · advisory-lock ·
read-only gate · idempotency-key. Mỗi lần test "xanh nhờ may".

### Đo lại lật ngược chính mình

- Spike #012 gỡ trần cache 15-40% của #008 (câu hỏi sai: "hai khách giống nhau?" thay vì
  "trang ẩn danh ổn định?")
- 3 lỗi phương pháp trong đúng buổi đo cache, mỗi cái cho kết quả **trông hợp lý**: store
  hỏng, sản phẩm sai store, OPcache che bản sửa (xuất hiện 3 lần)
- SA60: đột biến "không bị bắt" hoá ra **đột biến sai file** — không phải test gap

### Không dựng cái chưa quyết / chưa cưỡng chế

- Không tạo task payment provider (cần quyết định sản phẩm)
- `scopes` từng là trường chết → chặn vẽ UI "read-only" trước khi API chặn
- Read-only ≠ suspend ≠ publish-lock: ba plane khác nhau, không gộp trong UI

### Codex + kiểm độc lập

Codex viết phần lớn code; **mọi task kiểm sống + đột biến độc lập** ở main agent. Codex báo
trung thực khi bế tắc (SA57/SA58: sandbox chặn Postgres → dừng; SA54/SA60: migration chưa
áp). Phân công theo sandbox: codex sửa repo, tôi làm mọi thứ chạm devenv/Postgres.

---

## 4. Kiến trúc UI đã chốt (chưa code)

`UI-CONTRACT-DASHBOARD.md` + `UI-CONTRACT-PHASE-1.md`:

- **Đăng ký KHÔNG tạo store** — backend đã đúng (register chỉ tạo user+org)
- **Choose Plan → Start Trial → Create Store** — SA59 làm select-plan trial-safe
- **Onboarding checklist** thay dashboard trống (component đã viết, `OnboardingChecklist.tsx`)
- Dashboard 4 menu: Overview · Stores · Subscription · Account
- Ẩn Organization/Team khỏi UI MVP (backend SA54/55 có, UI chưa cần)

**3 điểm UI chặn bởi backend chưa có:** Forgot Password (email service) · Trial UI HTTP
chưa kiểm · "Suspend" (Runtime, không phải read-only).

---

## 5. Còn lại — TẤT CẢ cần VPS thật (Phase 0)

Không code nào trên WSL2 thay được:

| Việc | Vì sao cần VPS |
|---|---|
| `install-node --system` trên VPS-2 | chưa chạy lần nào (`DEPLOY.md:9`) |
| Provision + SSL + Login-WP end-to-end | proven devenv, chưa phần cứng thật |
| Kiểm SA58/59/60 **qua HTTP** | API server nền bị harness kill trên WSL2 |
| Nợ đo lường Runtime: IO, RAM/mật độ, throughput thật | số WSL2 không dùng được |
| Backup: xoá file thật phía Agent | SA60 TODO |
| Backup scheduler chạy thật với Redis | test tách logic thuần; repeatable cần Redis |

**Điều kiện mở đăng ký** (`MVP-PRODUCTION-PLAN.md`): Phase 0 xong + kiểm sống trên VPS.
Checklist "✅ bắt buộc" hiện chỉ 2/10 thật xanh; phần lớn là "◑ code có, chưa VPS".

---

## 6. Trạng thái môi trường (bàn giao)

- **`apps/api/.env`**: `JWT_SECRET` mạnh (bắt buộc — không có, API không boot)
- **4 migration áp thủ công** vào Postgres: auth_hardening, invitation, trial,
  backup_idempotency. CI `migrate deploy` sẽ tự khớp
- **`~/ooio-devenv`**: WooCommerce store (blog 1 mất template WooCommerce — cần rebuild
  nếu đo nội dung); `wp-config.php` có `OOIO_STATIC_CACHE_ROOT`; Caddyfile ở bản không cache
- **`~/ooio-devenv/cache_root`**: thư mục proof còn sót (rỗng, vô hại)
- **92 task done · 0 todo**; `verify.sh all` xanh (build 5/5 · 62 api test + agent + plugin
  + installer · typecheck)

---

## 7. Sau MVP (thứ tự đã chốt)

Stripe tự động → Custom Domain → Invitation/RBAC UI (backend đã có) → Cluster-02 → AI Kit.
Payment provider là hạng mục lớn nhất, chờ quyết định sản phẩm.

---

## Một câu

Backend MVP đã đủ và đã cứng hoá bảo mật; mọi thứ code-được trên WSL2 đã xong và kiểm sống.
Bước kế tiếp không phải viết thêm code mà là **dựng VPS và kiểm chứng trên phần cứng thật** —
đó là nơi các "◑" thành "✅" hoặc lộ vấn đề, và là nơi trả nợ đo lường Runtime.
