# UI Contract — Phase UI-1: Public & Onboarding

**Ngày: 2026-07-23.** Hợp đồng cho phase đầu theo mô hình **User Journey**.

> **Đọc trước:** `apps/web` **đã có 12 trang và 12 route hoạt động**. Phase này phần lớn là
> **hoàn thiện và nối đúng**, không phải dựng mới. Mục 1 liệt kê chính xác cái gì đã có.

---

## 0. Bốn chỗ đề xuất lệch với code — phải giải quyết trước khi code

### 0.1 UI-1 **không** chỉ phụ thuộc S1

Bảng timeline ghi `UI-1 → S1`. Nhưng danh sách màn hình UI-1 có **Forgot password**,
**Reset password**, **Verify email** — mà rà soát S1 (`SAAS-S1-AUTH-AUDIT.md`) ghi rõ:

> **Email** ❌ không có — kể cả xác minh email lẫn đặt lại mật khẩu.

Ba màn hình đó **không thể hoàn thành** ở phase này. Hai lựa chọn:

- **(a)** Đưa chúng sang UI-1b, làm sau khi có email service — *khuyến nghị*
- **(b)** Thêm email service vào phạm vi S1 và mở rộng UI-1

Không được dựng UI rồi để nút bấm không làm gì.

### 0.2 "Create Organization" đã xảy ra tự động

Đề xuất mô tả luồng lần đầu đăng nhập:

```
Welcome → Create Organization → Done
```

Nhưng `auth.service.ts:171` **đã tạo tổ chức và gán `owner`** ngay trong `register`. Người
dùng mới **luôn có sẵn một tổ chức**.

Nên luồng đúng là:

```
Register  →  (tổ chức tạo tự động)  →  Dashboard trống
```

Màn hình "Create Organization" vẫn cần, nhưng cho trường hợp **tạo tổ chức thứ hai**
(`POST /orgs` đã có), không phải cho onboarding.

### 0.3 Bốn vai trò trong đề xuất, ba vai trò trong code

| Đề xuất UI-6 | Code |
|---|---|
| Owner · Admin · **Developer** · **Viewer** | `owner` · `admin` · `member` |

Chọn một bộ **trước** khi vẽ UI. Đổi tên vai trò sau khi có khách hàng là việc rất đắt —
nó nằm trong `memberships.role`, trong `@Roles(...)` của mọi controller, và sẽ nằm trong
mô hình permission của **SA55**.

**Khuyến nghị:** quyết ở SA55, vì SA55 định nghĩa `role → permission`.

### 0.4 UI "API Keys → Scopes" sẽ nói dối người dùng

UI-6 liệt kê `Scopes` cho API key. Nhưng rà soát S2 đo được: **`scopes` là trường chết** —
nhận vào, lưu xuống, đọc ra, **không guard nào cưỡng chế**.

Dựng UI cho scopes trước khi SA55 xong nghĩa là giao diện hiển thị *"khoá chỉ đọc"* trong
khi khoá đó **có toàn quyền ghi**. Đó không phải thiếu tính năng — đó là **giao diện nói
sai về bảo mật**.

**Bắt buộc: UI-6 phần API Key needs SA55.**

---

## 1. Screen Inventory — đã có gì, thiếu gì

### Marketing

| Màn hình | Trạng thái |
|---|---|
| Landing | ✅ `Landing.tsx`, route `/` |
| Pricing | ✅ `Pricing.tsx` — đọc `getPlans()` **thật** |
| Features | ✅ `Features.tsx` |
| Contact | ✅ `Contact.tsx` |
| **FAQ** | ❌ chưa có |
| **Docs** | ❌ chưa có |
| **Blog** | ❌ chưa có |

Cả bốn trang đã có `PublicHeader`/`PublicFooter` dùng chung và `usePageMeta` (title +
description riêng). Footer **chỉ liên kết tới route có thật** — thêm FAQ/Docs/Blog phải
thêm cả trang lẫn liên kết, không thêm liên kết trước.

### Authentication

| Màn hình | Trạng thái |
|---|---|
| Login | ✅ `Login.tsx` → `POST /auth/login` |
| Register | ✅ `Register.tsx` → `POST /auth/register` |
| **Forgot password** | ❌ **chặn bởi thiếu email service** (0.1) |
| **Reset password** | ❌ **chặn bởi thiếu email service** (0.1) |
| **Verify email** | ❌ **chặn bởi thiếu email service** (0.1) |
| OAuth | ❌ chặn bởi S1 |
| **Logout** | ❌ `POST /auth/logout` → 404, đang làm ở **SA51** |

### Workspace / Dashboard trống

| Màn hình | Trạng thái |
|---|---|
| Overview | ✅ `Overview.tsx` — đã có empty state riêng khi `storeCount === 0` |
| Stores (rỗng) | ✅ `Stores.tsx` — dùng `EmptyState kind="empty"` + CTA tạo store |
| Create Organization | ⚠️ `POST /orgs` có API, **chưa có màn hình** |

---

## 2. User Journey

```
Guest
  └─ Landing / Pricing / Features / Contact          [đã có]
       └─ Register                                   [đã có]
            └─ (tổ chức tạo TỰ ĐỘNG, vai trò owner)  [đã có, xem 0.2]
                 └─ Overview — trạng thái trống      [đã có]
                      └─ CTA "Create your first store" → UI-2
```

Nhánh phụ: `Login` → nếu đã có store thì vào thẳng `Overview` có dữ liệu.

---

## 3. Navigation

- `/` chuyển hướng sang `/overview` **nếu đã có token** (`App.tsx` đã làm)
- Mọi route `/overview`, `/stores`, `/billing`, `/settings` nằm sau `JwtAuthGuard` phía API
  và sau kiểm token phía client
- `*` → `/overview` nếu có token, ngược lại `/`

---

## 4. State Matrix

Component đã có: `LoadingState` (skeleton, tôn trọng `prefers-reduced-motion`) và
`EmptyState` (**bắt buộc chọn** `kind`).

| Trạng thái | Xử lý | Đã áp dụng ở |
|---|---|---|
| loading | `LoadingState` | Overview · Stores · StoreDetail · Billing · Pricing |
| empty | `EmptyState kind="empty"` + CTA | Stores · Billing · Settings |
| **forbidden** | `EmptyState kind="forbidden"` — nói rõ **thiếu vai trò gì** | Settings (API key) |
| error | `EmptyState kind="error"` + nút thử lại | Stores · Billing · Pricing |
| provisioning | ⚠️ **chưa có** — thuộc UI-2 |
| suspended / expired | ❌ chưa có; backend chưa có trạng thái này |

> **Quy tắc:** `EmptyState` **bắt buộc** khai `kind`, không có mặc định — người viết phải
> quyết định đang ở tình huống nào. Gộp *"không có dữ liệu"* với *"không có quyền"* và
> *"tải lỗi"* làm một là biến một sự cố thành một khoảng trống im lặng.

---

## 5. API Contract — thật hay mock

**Thật, đã nối:**

```
POST /auth/login · /auth/register · /auth/refresh
GET  /orgs        POST /orgs
GET  /plans       GET /usage       GET /subscription
GET  /stores      GET /stores/:id  POST /stores
GET  /operations/:id
GET  /analytics/overview
GET|POST|DELETE /orgs/:id/api-keys
```

**Chưa có endpoint — không được gọi:**

```
POST /auth/logout          (SA51 đang làm)
POST /auth/forgot-password (chưa có email service)
POST /auth/reset-password  (chưa có email service)
POST /auth/verify-email    (chưa có email service)
```

> **Không mock các endpoint này ở client.** Một nút "Quên mật khẩu" gọi endpoint giả rồi
> hiện "đã gửi email" là **nói dối người dùng về một luồng bảo mật**. Thà không có nút.

---

## 6. Exit Criteria — Phase UI-1

1. Bốn trang marketing (`/`, `/pricing`, `/features`, `/contact`) trả **200**, dùng chung
   `PublicHeader`/`PublicFooter`, mỗi trang có title + description riêng. **✅ đã đạt.**
2. `Register` → `Login` → `Overview` chạy được đầu-cuối trên API thật. **✅ đã đạt** (kiểm
   trong rà soát S1: register 201, login 200).
3. `Overview` và `Stores` hiển thị đúng trạng thái **trống** với CTA tạo store. **✅ đã đạt.**
4. Ba trạng thái `empty` / `forbidden` / `error` **phân biệt được** ở mọi trang có dữ liệu.
   **✅ đã đạt** ở Overview · Stores · Billing · Settings · Pricing.
5. **Logout hoạt động** — chờ `SA51`. ❌
6. **FAQ / Docs / Blog** — quyết định làm hay hoãn. ❌ chưa quyết
7. **Không màn hình nào gọi endpoint chưa tồn tại.** Kiểm bằng: mọi hàm trong
   `apps/web/src/api.ts` có route tương ứng trong `apps/api`.

> **Phase UI-1 đã đạt 4/7.** Việc còn lại là `logout` (chặn bởi SA51) và quyết định về
> FAQ/Docs/Blog. Ba màn hình email chuyển sang **UI-1b**.

---

## 7. Điều chỉnh timeline đề xuất

| Phase | Phụ thuộc *(đề xuất)* | Phụ thuộc **thật** |
|---|---|---|
| UI-1 | S1 | S1 **trừ email**; `logout` cần SA51 |
| **UI-1b** *(mới)* | — | **Email service** — forgot/reset/verify |
| UI-2 | S4 | S4 ✅ đã có; cần **luồng tiến độ provisioning** (`operations.progress` đã có trong schema) |
| UI-3 | S4, S5 | phần lớn **đã có** |
| UI-6 | S2 | **SA55** (permission) trước khi làm API Key + Scopes |

---

## 8. Nguyên tắc chung cho mọi UI Contract sau

Rút từ những gì đã xảy ra trong Phase 2:

1. **Kiểm cái đã có trước khi lên kế hoạch.** Hai lần trong phiên này (`18-SaaS-Plan` nói
   "chỉ có bản Mock", roadmap S1–S9 viết như greenfield), kế hoạch mô tả một hệ thống
   không còn tồn tại.
2. **Không dựng UI cho backend chưa cưỡng chế.** Scopes là ví dụ: có schema, không có
   guard. UI sẽ nói dối.
3. **Không mock endpoint bảo mật ở client.** Thà không có nút.
4. **Mỗi trạng thái phải phân biệt được** — empty ≠ forbidden ≠ error.
5. **Chỉ liên kết tới trang có thật.** Link chết tệ hơn không có link.
