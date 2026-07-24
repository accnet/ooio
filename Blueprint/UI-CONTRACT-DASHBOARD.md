# UI Contract — User Dashboard (Phase UI-1 & UI-2)

**Ngày: 2026-07-23.** Chốt kiến trúc UI cho MVP theo mô hình **Dashboard-trước,
Marketing-sau** và **một hành trình chính**.

> **Đọc trước khi code:** phần lớn UI-1 và UI-2 **đã tồn tại**. Và **Trial — trung tâm của
> đề xuất — CHƯA CÓ backend nào.** Hai điều này quyết định thứ tự làm. Xem mục 0.

---

## 0. Ba điều phải giải quyết trước

### 0.1 🔴 Trial 30 ngày KHÔNG tồn tại trong backend

Đề xuất xoay quanh Trial: "27 days remaining", reminder, grace, **read-only khi hết trial**,
resume sau thanh toán. Kiểm backend:

```
grep trial|readonly|grace|expired  trong apps/api  →  KHÔNG có model, KHÔNG có trạng thái
plans.seed.ts  →  gói mặc định là 'free' (maxStores:1), KHÔNG phải 'trial 30 ngày'
enforcement    →  chỉ có quota maxStores → 402; KHÔNG có chế độ read-only
```

**Dựng UI Trial trước khi backend Trial tồn tại là dựng UI nói dối** — đúng lỗi `scopes` ở
audit S2 (UI hiển thị "read-only" trong khi backend cho toàn quyền). Banner "27 days
remaining" mà không có `trialEndsAt` thật là số bịa; "read-only mode" mà backend vẫn cho
ghi là bảo mật giả.

**Bắt buộc: một task BACKEND Trial trước UI Trial.** Tối thiểu cần:
- `Organization.trialEndsAt` (hoặc trên Subscription)
- Một trạng thái `read-only` mà **API cưỡng chế** (chặn create/update store, cho đọc)
- Endpoint trả trạng thái trial cho dashboard

Cho tới khi có: dashboard hiển thị **gói hiện tại + giới hạn store thật** (đã có
`GET /usage`), không hiển thị đếm ngược trial.

### 0.2 Phần lớn UI-1 / UI-2 đã có

| Đề xuất | Đã tồn tại |
|---|---|
| Login · Register | ✅ `Login.tsx` · `Register.tsx` |
| Create Store · Provision Progress | ✅ `CreateStore.tsx` (dùng `operations.progress`) |
| Overview | ✅ `Overview.tsx` |
| Stores · Store Ready | ✅ `Stores.tsx` · `StoreDetail.tsx` |
| Subscription | ⚠️ nằm trong `Billing.tsx`, chưa tách |
| Account | ⚠️ nằm trong `Settings.tsx` (có API Keys) |

Sidebar hiện tại: `overview · stores · billing · settings`. Đề xuất muốn:
`Overview · Stores · Subscription · Account`. **Khác biệt là đổi nhãn + tách, không phải
dựng mới.**

### 0.3 Forgot Password chặn bởi email service

`POST /auth/forgot-password` **không tồn tại** (cần email service — ghi ở
`UI-CONTRACT-PHASE-1.md`). Không mock nút này. Chuyển sang UI-1b khi có email.

---

## 0.4 ✅ Flow "đăng ký KHÔNG tạo store" — backend ĐÃ đúng

Đề xuất 2026-07-23: đăng ký chỉ tạo account, store tạo khi bấm "Create Store" (như Vercel/
Railway/GitHub). **Kiểm code: kiến trúc đã đúng như vậy.**

```
register (auth.service.ts) tạo:  user + organization + membership(owner)
                           KHÔNG tạo store
store tạo riêng qua:             POST /stores → operation → Agent → WordPress
```

Nên "1.000 đăng ký → 1.000 database" **không xảy ra**. Postgres chỉ giữ users/orgs/subs
(vài KB/user) cho tới khi có người thật bấm Create Store — đúng lúc đó Agent mới cấp
MySQL/Redis/SSL. Không cần đổi gì ở flow.

Trial cũng bắt đầu từ **register** (SA58), không phải lúc tạo store — khớp đề xuất.

### Dashboard trống → onboarding checklist (điều chỉnh UI thật sự mới)

Thay dashboard đầy widget rỗng bằng một checklist dẫn dắt:

```
Welcome · Trial 29 days
  ○ Step 1  Create your first Store   → POST /stores
  ○ Step 2  Connect your Domain       → (kiểm backend domain có chưa)
  ○ Step 3  Launch
```

Khi đủ Store → dashboard **tự chuyển** sang giao diện vận hành (Store card, Open, Manage).
Một luồng, không phải hai sản phẩm.

⚠️ **"Connect Domain" và "Launch/Publish" cần kiểm backend trước khi vẽ bước.** Domain có
model `domains` nhưng luồng connect/verify cần rà. "Publish" là khái niệm **WordPress
(Runtime)**, không phải Control Plane — xem 0.5.

## 0.5 ⚠️ "Khóa Publish khi hết trial" nằm ở Runtime, không phải SaaS

Đề xuất: hết trial thì khóa Publish + provision thêm store, giữ store cũ. Nhưng hai thứ này
ở **hai plane khác nhau**:

| Khóa gì | Plane | Trạng thái |
|---|---|---|
| Provision thêm store, thao tác store | Control Plane | ✅ SA58 read-only chặn được (402) |
| **Publish nội dung WordPress** | **Runtime** | ❌ Control Plane không kiểm soát; cần Agent → MU Plugin |

SA58 read-only chặn `POST /stores` và `POST /stores/:id/operations` — đúng và đủ cho MVP.
**"Khóa publish nội dung" là cơ chế Runtime chưa có** (Agent phải bảo MU Plugin đặt store
sang read-only mode). Nếu muốn, đó là task riêng ở Runtime — đừng hứa trong UI trước khi
Runtime cưỡng chế được, nếu không lại là read-only giả như 0.1.

**Khuyến nghị MVP:** hết trial khóa **provisioning/quản lý qua SaaS** (SA58 đã làm). Store
đang chạy vẫn phục vụ traffic bình thường — không khóa publish. Đơn giản, đúng plane, và
"store vẫn còn" như đề xuất muốn.

## 0.6 🔴 "Choose Plan trước Create Store" — mâu thuẫn với SA58 nếu dùng sai endpoint

Đề xuất 2026-07-23 (v2): chọn plan trong trial, hết 30 ngày chỉ cần thanh toán. Đúng UX,
nhưng chạm hai chỗ backend.

### Store KHÔNG có plan — plan ở Organization

`Store` chỉ có `tier`, không có plan. Plan ở `org.planId` / Subscription. Với Multisite
(một org nhiều store cùng cluster), **plan-per-store mâu thuẫn** — hai store cùng org không
thể hai plan khi chia hạ tầng. MVP một org một store nên "store dùng Pro" hiển thị đúng dù
lưu ở org.

### changeSubscription tạo `active` → vô hiệu trial

`isReadOnly` (SA58) đọc `subscriptions.some(status==='active')`. `changeSubscription` tạo
subscription **`active`** ngay (và **không thu tiền** — audit S3 2.2). Nếu "Choose Plan"
gọi nó:

```
subscription active → isReadOnly = false VĨNH VIỄN → read-only sau 30 ngày KHÔNG kích hoạt
```

**Trial chết.** Đúng loại lỗi "một tính năng làm hỏng lặng lẽ tính năng khác".

### Đường đúng: tách "chọn plan" khỏi "kích hoạt subscription"

```
Chọn plan (trial):  set org.planId = pro          → quota fallback dùng Pro limit (10)
                    giữ org.trialEndsAt            → trial vẫn đếm ngược
                    KHÔNG tạo active subscription  → hết trial vẫn read-only (SA58 đúng)
Thanh toán:         tạo subscription active        → cần payment provider (billing 2.2)
```

`quota.getUsage:33` đã fallback `organization.plan` khi không có active sub — nên set
`org.planId` cho Pro-limit ngay trong trial, **không đổi SA58**. "Hết 30 ngày chỉ thanh
toán, không chuyển gói" đạt được: plan đã ở org, thanh toán chỉ thêm active subscription.

**Cần task backend SA59: `POST /orgs/:id/plan` set `org.planId`, KHÔNG tạo active
subscription.** Đây là điều kiện để onboarding "Choose Plan → Start Trial" chạy đúng.

### Luồng onboarding (sau khi có SA59)

```
Register → Dashboard (trial activated)
  → Choose Plan  (Basic $19 / Pro $49 / Business $99 · "Free trial 30 days, no card")
       ↓ POST /orgs/:id/plan   (KHÔNG phải changeSubscription)
  → Create Store  (store name + url)
       ↓ POST /stores
  → Provisioning → Store Ready → Dashboard vận hành
```

Dashboard sau đó hiển thị: `Trial N days left · Current Plan Pro $49 · Status Trial Active`
— tất cả đọc từ `GET /usage.trial` + `org.plan`, không bịa.

## 1. Nguyên tắc chốt (đồng ý với đề xuất)

1. **Dashboard trước, Marketing sau** — Landing chỉ đủ để vào Register. Đã có.
2. **Một hành trình chính** — `Register → Dashboard → Create Store → Provision → Open
   WordPress → Manage → Upgrade`.
3. **Không lộ Organization** — UI nói `Account` + `Stores`; backend giữ Workspace/Membership.
   Team (SA54 đã có backend) **ẩn khỏi UI MVP**, chỉ hiện khi cần mời người.
4. **Trial là một phần dashboard** — *sau khi backend Trial tồn tại* (0.1).

---

## 2. Screen Inventory — đã có / đổi / thiếu

| Màn hình | Trạng thái | Việc |
|---|---|---|
| Login / Register | ✅ | giữ |
| Forgot Password | ❌ chặn email | UI-1b |
| Welcome (sau register) | ⚠️ | register đã tự tạo org → dẫn thẳng vào Overview trống |
| Create Store + Progress | ✅ | giữ; xác nhận progress dùng `GET /operations/:id` thật |
| Store Ready → Open WordPress | ⚠️ | cần nút "Open" trỏ tới domain store — kiểm đã có chưa |
| **Overview** | ⚠️ | thêm: store đang chạy, domain, health, gói+giới hạn. **KHÔNG** đếm ngược trial (0.1) |
| **Stores** | ✅ | giữ; empty state "Create your first Store" đã có |
| **Subscription** | ⚠️ tách khỏi Billing | `Current Plan · (Trial khi có backend) · Upgrade` |
| **Account** | ⚠️ đổi tên từ Settings | `Profile · Password · API Keys · Logout` |
| Store Detail | ✅ | `Overview · Domain · SSL · Backup · Logs · Danger Zone` — kiểm cái nào có backend |

---

## 3. State Matrix — hạ tầng đã có

`LoadingState` + `EmptyState` (bắt buộc `kind`: empty/forbidden/error) đã dùng ở Overview ·
Stores · Billing · Settings · Pricing. Còn thiếu:

| Trạng thái | Cần backend |
|---|---|
| provisioning | ✅ `operations.progress` có |
| **read-only (hết trial)** | ❌ **backend chưa cưỡng chế** (0.1) — không vẽ UI trước |
| suspended | ❌ backend chưa có trạng thái này |

> Read-only là ví dụ điển hình của mục 5 nguyên tắc: nếu UI hiển thị "read-only" nhưng API
> vẫn cho ghi, đó không phải trạng thái — đó là lời nói dối. Vẽ nó **sau** khi API chặn.

---

## 4. API Contract — thật / thiếu

**Thật, đã nối:**
```
POST /auth/register · /auth/login · /auth/refresh · /auth/logout
GET  /orgs · GET /usage · GET/POST /orgs/:id/subscription
GET/POST /stores · GET /stores/:id · GET /operations/:id
GET|POST|DELETE /orgs/:id/api-keys
```

**Chưa có — không được gọi/mock:**
```
POST /auth/forgot-password · /reset-password · /verify-email   (email service)
GET  trial status / read-only state                            (backend Trial, 0.1)
PATCH profile / password                                       (kiểm có chưa)
```

---

## 5. Thứ tự làm (đã điều chỉnh theo thực tế)

| Bước | Việc | Chặn bởi |
|---|---|---|
| **UI-1** | Đổi nhãn sidebar + tách Subscription/Account khỏi Billing/Settings | — (đã có phần lớn) |
| **UI-1** | Overview: store/domain/health/gói+giới hạn thật | — |
| **BE-Trial** | Backend Trial: `trialEndsAt` + read-only cưỡng chế + endpoint | **phải trước UI Trial** |
| **UI-2** | Trial banner + read-only state | BE-Trial |
| **UI-1b** | Forgot/Reset/Verify | email service |
| **UI-P3** | Billing đầy đủ (invoices, payment) | payment provider (billing audit 2.2) |

---

## 6. Exit Criteria

**Phase UI-1 (Dashboard MVP):**
1. `Register → Login → Overview` chạy trên API thật. ✅ (đã kiểm ở audit S1)
2. Sidebar 4 nhóm `Overview · Stores · Subscription · Account`, mỗi nhóm route riêng.
3. `Create Store → Provision progress → Store Ready → Open WordPress` đầu-cuối.
4. Ba trạng thái empty/forbidden/error phân biệt ở mọi trang có dữ liệu. ✅ (đã có)
5. **Không màn hình nào gọi endpoint chưa tồn tại** — kiểm mọi hàm `api.ts` có route.
6. **Không đếm ngược trial nếu chưa có `trialEndsAt` thật.**

**Phase UI-2 (Trial):** chỉ bắt đầu **sau BE-Trial**. Banner đếm ngược đọc `trialEndsAt`
thật; read-only state kích hoạt khi API trả trạng thái đó; hết trial **không khoá tài
khoản, không xoá store** (đúng đề xuất) — nhưng điều đó phải do **API cưỡng chế**, không
phải UI tự ẩn nút.

---

## 7. Nhất quán với các quyết định đã chốt

- **Admin/Ops tách hẳn** — `apps/ops` (operator) và `apps/admin` (support) đã tồn tại,
  token key riêng. **Không gộp vào User Dashboard** (đúng đề xuất, và là ranh giới bảo mật
  SA55/56).
- **Không làm ở MVP** (đồng ý): Organization UI · Team · RBAC UI · Marketplace · Analytics ·
  AI · Credits. Backend một phần đã có (SA54 team, SA55 RBAC) nhưng **UI ẩn** — đúng
  nguyên tắc "backend có thể hỗ trợ, UI chưa cần".
- **Vai trò**: nếu sau này lộ Team UI, dùng `owner/admin/member` (SA54/55), **không**
  `developer/viewer` như roadmap cũ nhắc.
