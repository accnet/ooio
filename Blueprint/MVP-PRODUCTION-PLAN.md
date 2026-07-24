# MVP Production Plan — đối chiếu checklist với thực tế

**Ngày: 2026-07-23.** Đồng ý cách **MVP-trước, mở rộng sau**. Tài liệu này chốt phạm vi,
nhưng **phân loại lại checklist** vì "✅ bắt buộc" của đề xuất trộn ba thứ khác nhau:

- **đã kiểm sống** (chạy thật, có bằng chứng)
- **code có, chưa kiểm trên VPS** (chạy trong devenv/API-only, chưa phần cứng thật)
- **chưa có backend** (checklist đánh ✅ nhưng grep rỗng)

Mở đăng ký trên một checklist tưởng xanh là rủi ro lớn nhất của MVP.

---

## Checklist mở đăng ký — phân loại thật

| Hạng mục | Đề xuất | THỰC TẾ | Bằng chứng |
|---|---|---|---|
| Register / Login | ✅ | ✅ **kiểm sống** | Audit S1: register 201, login 200 |
| Trial 30 ngày | ✅ | ◑ **logic kiểm, HTTP chưa** | SA58: logic 8/8 + đột biến; API server chưa chạy bền để test HTTP |
| Create Store | ✅ | ◑ **code có, cần cluster** | API-only trả 409 (chưa có cluster đăng ký); cần VPS-2 |
| Provision thành công | ✅ | ◑ **proven devenv, chưa VPS** | 3-plane chạy trong `~/ooio-devenv`; `install-node --system` **chưa chạy VPS lần nào** |
| SSL tự động | ✅ | ⚠️ **chưa kiểm domain thật** | Caddy auto-TLS cấu hình; chưa test trên domain công khai |
| Login WordPress | ✅ | ◑ **proven devenv** | Storefront browsable trong devenv; chưa qua `store.ooio.app` thật |
| **Suspend khi hết Trial** | ✅ | ❌ **KHÔNG có backend** | grep suspend = rỗng. SA58 read-only chặn *tạo* store, **KHÔNG suspend store đang chạy** |
| **Backup hằng ngày** | ✅ | ❌ **không có scheduler** | Agent có backup on-demand; **không có nightly cron/retention** |
| Health Check | ✅ | ◑ **heartbeat có** | Agent heartbeat + metrics; chưa kiểm alert khi offline trên VPS |
| Log Operation | ✅ | ✅ **có** | `operations.progress`, kiểm trong CreateStore flow |

**Chỉ 2/10 thật sự ✅. Ba cái ❌/⚠️ cần làm mới. Năm cái ◑ cần kiểm trên VPS.**

---

## Ba hạng mục checklist chưa có backend — phải làm trước khi đánh ✅

### ❌ 1. "Suspend khi hết Trial" — read-only ≠ suspend

Đây là lỗi hiểu lầm hai plane, lần thứ ba trong dự án (xem `UI-CONTRACT-DASHBOARD.md` 0.5):

| Hành động | Plane | Trạng thái |
|---|---|---|
| Chặn tạo store / thao tác store | Control Plane | ✅ SA58 read-only (402) |
| **Suspend store đang chạy** (dừng serve traffic) | **Runtime** | ❌ chưa có |

SA58 read-only nghĩa: hết trial thì **không tạo store mới, không thao tác store**. Store cũ
**vẫn chạy, vẫn serve traffic**. Đó KHÔNG phải "suspend".

"Suspend" đúng nghĩa (store ngừng phục vụ) cần **Agent → MU Plugin** đặt store offline — cơ
chế **chưa có**. **Task backend mới nếu MVP thật sự cần suspend.**

**Khuyến nghị MVP:** hết trial = read-only (SA58 đã đủ). Store vẫn chạy — đúng đề xuất
trước của bạn ("không xoá store, store vẫn còn"). **Bỏ "Suspend" khỏi checklist bắt buộc**,
hoặc định nghĩa lại "suspend" = read-only.

### ❌ 2. "Backup hằng ngày" — có backup, không có lịch

Agent có backup **on-demand** (`internal/backup`), nhưng **không có**: nightly scheduler,
retention policy, xác minh restore. Checklist "backup hằng ngày ✅" cần một task:
scheduler chạy nightly + retention. **Không có nó, "backup ✅" là bịa.**

### ⚠️ 3. Provision/SSL/Login-WP — proven devenv, chưa VPS

`install-node.sh --system` **chưa chạy trên VPS thật lần nào** (`DEPLOY.md:9`). Mọi thứ
proven trong `~/ooio-devenv` (WSL2). Runtime Freeze mục 4 ghi rõ: **số tuyệt đối không dùng
được, cần phần cứng thật.** Phase 0 (VPS) là lúc trả nợ này — và là lúc "◑" thành "✅" hoặc
lộ vấn đề.

---

## Phase 0 — VPS là GATE, không phải bước đầu tuỳ chọn

Đề xuất 3 VPS đúng và khớp ADR. Nhưng nhấn: **cho tới khi `install-node --system` chạy
thành công trên VPS-2, mọi "✅ provision" chỉ là dự đoán.** Phase 0 vừa dựng hạ tầng vừa
**trả nợ đo lường Runtime** (IO, RAM/mật độ thật, thời gian provisioning tuyệt đối).

Việc cụ thể của Phase 0:
1. `install-node.sh --system` trên Ubuntu 24.04 (VPS-2) — `--dry-run` trước, vá 1–2 chỗ
   distro (tên php-fpm service, quyền)
2. **Nối SA48 vào installer** — Caddy `@cached` + `OOIO_STATIC_CACHE_ROOT` (còn nợ)
3. Đo trên phần cứng thật: `measure-isolation.sh`, throughput, IO — thay số WSL2
4. Provision một store thật qua `POST /stores` → storefront qua `store.ooio.app`
5. SSL thật (Let's Encrypt qua Caddy) trên domain công khai

---

## Phạm vi MVP — đồng ý với đề xuất, kèm hai điều chỉnh

**Đồng ý KHÔNG làm** (đề xuất đã đúng): OAuth · Magic Link · Team UI · Analytics · AI ·
Marketplace · Stripe tự động · Custom Domain · Enterprise · Multi-cluster · Auto-failover ·
Cross-cluster migration · Support · Restore UI · Queue UI.

**Hai điều chỉnh:**

1. **Billing MVP "Admin đổi trạng thái bằng tay"** — hợp lý, nhưng "đổi trạng thái" nghĩa
   là tạo subscription `active` cho org (đường đã có: `changeSubscription`). SA59 (đang
   làm) tách "chọn plan" khỏi "active" — admin action = kích hoạt subscription. Cần một
   endpoint/admin action, không phải sửa trạng thái tự do.

2. **"Suspend" bỏ khỏi bắt buộc** (mục ❌ 1) — read-only là đủ cho MVP.

---

## Thứ tự làm — điều kiện để mở đăng ký

| # | Việc | Loại | Trạng thái |
|---|---|---|---|
| 1 | SA59 select-plan trial-safe | backend | đang làm |
| 2 | Kiểm SA58 trial **qua HTTP** trên môi trường chạy bền | test | chờ VPS/CI |
| 3 | **Backup scheduler + retention** | backend/agent | ❌ chưa có |
| 4 | Nối SA48 cache vào `install-node.sh` | devops | ❌ còn nợ |
| 5 | Phase 0: `install-node --system` trên VPS-2 | devops | ❌ chưa chạy |
| 6 | Provision + SSL + Login-WP end-to-end trên VPS | kiểm | ❌ chờ 5 |
| 7 | (nếu cần) Suspend store đang chạy — Runtime | backend | ❌ hoặc bỏ |

**Điều kiện mở đăng ký:** 1–6 xong và kiểm sống trên VPS. Số 7 chỉ nếu định nghĩa suspend
≠ read-only.

---

## Sau MVP (đồng ý thứ tự đề xuất)

Stripe tự động → Custom Domain → Invitation/RBAC UI (backend SA54/55 đã có) → Cluster-02 →
AI Kit. Payment provider (billing 2.2) là hạng mục lớn nhất, chờ quyết định sản phẩm.

---

## Nguyên tắc giữ nguyên từ Phase 2

Đừng đánh ✅ cho hạng mục chỉ có code chưa chạy. Bốn bug nghiêm trọng nhất Phase 2 (P2021,
P2002, DI, race) **chỉ lộ khi chạy thật**, test đều xanh. Checklist MVP phải là **"đã kiểm
sống trên VPS"**, không phải "code đã viết".
