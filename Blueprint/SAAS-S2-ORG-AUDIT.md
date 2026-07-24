# S2 User / Organization / RBAC — rà soát độ phủ

**Ngày: 2026-07-23.** Rà bằng đọc mã nguồn có đối chiếu schema và route thật. API đang tắt
trong lúc codex sửa `apps/api/src/auth/` (SA50–52), nên phần khai thác thực tế của mục 2.1
**chưa chạy** — đã ghi rõ ở mục 5.

---

## 1. Đã có

| | Bằng chứng |
|---|---|
| Bảng `users` · `organizations` · `memberships` | `schema.prisma` |
| Membership khoá kép `(organizationId, userId)` + cột `role` | `@@id([organizationId, userId])` |
| Người đăng ký thành **`owner`** của tổ chức đầu tiên | `auth.service.ts:171` |
| `GET /orgs` · `POST /orgs` | `orgs.controller.ts` |
| Hai lớp phân quyền tách bạch | `rbac.guard` (vai trò trong tổ chức) · `platform-role.guard` (vai trò nền tảng) |
| API key có `expiresAt` **và được kiểm** | `auth.service.ts:251` |

Việc tách **vai trò tổ chức** khỏi **vai trò nền tảng** là đúng, và `platform_roles` là
`String[]` chứ không phải một chuỗi phân cấp — nên `operator` và `support` tách được nhiệm
vụ thật sự.

---

## 2. Ba vấn đề

### 🔴 2.1 API key bỏ qua toàn bộ kiểm tra vai trò — ✅ ĐÃ SỬA (SA53)

`rbac.guard.ts`:

```ts
if (user.authType === 'api-key') {
  if (user.organizationId !== organizationId) {
    throw new ForbiddenException('API key is not valid for this organization');
  }
  return true;          // ← thoát TRƯỚC khi kiểm @Roles
}
```

Guard trả `true` ngay khi tổ chức khớp, **không hề đọc `@Roles(...)`**. Hệ quả cụ thể trên
các route đang có:

| Route | Yêu cầu | API key làm được? |
|---|---|---|
| `POST /orgs/:id/billing/subscription` | `@Roles('owner','admin')` | **có** — đổi gói cước |
| `POST /orgs/:id/api-keys` | `@Roles('owner','admin')` | **có** — tự nhân bản |
| `DELETE /orgs/:id/api-keys/:keyId` | `@Roles('owner','admin')` | **có** — thu hồi khoá của owner |

Nghĩa là **mọi API key đều có quyền ngang owner** trong tổ chức của nó. Một khoá cấp cho
pipeline triển khai cũng đổi được gói cước và thu hồi được khoá của người khác.

### 🟠 2.2 `scopes` là trường chết

`api_keys.scopes` tồn tại trong schema, nhận được lúc tạo
(`api-keys.service.ts:30`), đọc ra lúc xác thực và gắn vào ngữ cảnh
(`auth.service.ts:255-264`) — **nhưng không guard nào đọc nó**:

```
grep -rn "scopes" apps/api/src/auth/*.guard.ts jwt.strategy.ts
  → KHÔNG guard nào đọc scopes
```

Một khoá tạo với `scopes: ['read']` có **toàn quyền ghi**. Trường này nguy hiểm hơn là
không có: nó tạo cảm giác đã giới hạn quyền, trong khi không.

### 🟠 2.3 Không có cách thêm thành viên vào tổ chức

`orgs.controller.ts` chỉ có `@Get()` và `@Post()`. Không controller nào đụng `membership`.

Nghĩa là bảng `memberships` **chỉ có thể chứa đúng một dòng cho mỗi tổ chức** — dòng
`owner` tạo lúc đăng ký. Không có:

- mời thành viên
- chấp nhận lời mời
- đổi vai trò của thành viên
- gỡ thành viên
- chuyển quyền sở hữu

`@Roles('owner','admin','member')` ở `billing.controller.ts` vì vậy đang phân biệt ba vai
trò mà **hai trong ba không thể tồn tại**.

---

## 3. Một chi tiết cần biết trước khi mở rộng route

`rbac.guard` lấy tổ chức từ **đúng một chỗ**:

```ts
const organizationId = request.params.id;
```

Nên guard chỉ hoạt động với route dạng `/…/:id/…`. Route nào lấy tổ chức từ **body**,
**query**, hoặc param tên khác (`:orgId`, `:organizationId`) sẽ **ném `ForbiddenException`
vì thiếu ngữ cảnh** — fail-closed, nên an toàn, nhưng sẽ làm route mới hỏng một cách khó
hiểu.

Hiện các route dùng `@Roles` đều là `orgs/:id/…` nên đúng. Cần ghi lại để người thêm route
sau không mất thời gian.

---

## 4. So với roadmap S2

| Roadmap | Trạng thái |
|---|---|
| Profile | ❌ không có endpoint xem/sửa hồ sơ |
| Organization | ⚠️ tạo và liệt kê được; **không sửa, không xoá, không chuyển quyền** |
| Team | ❌ không có |
| **Invitation** | ❌ không có (2.3) |
| RBAC | ⚠️ có cơ chế, nhưng **API key vượt qua được** (2.1) |
| Permission | ⚠️ `scopes` có schema, **không cưỡng chế** (2.2) |

---

## 5. Giới hạn của lần rà soát này

- ~~Chưa khai thác thực tế mục 2.1.~~ **ĐÃ TÁI HIỆN 2026-07-23** trên API chạy thật, với
  khoá tạo bằng `scopes: ["read"]`:

  ```
  POST /orgs/:id/api-keys      → 201   khoá tự nhân bản chính nó
  POST /orgs/:id/subscription  → 201   khoá đổi gói cước đang trả tiền
  GET  /orgs/:id/api-keys      → 200
  ```

  **Đã sửa (SA53, fail-closed):** cả ba nay trả **403**, JWT owner vẫn **201**.
- **Chưa rà** `admin/` và `agents/` — chúng dùng `platform-role.guard`, thuộc phạm vi khác.
- **Chưa rà** vòng đời API key (tạo/thu hồi/hết hạn) ở mức hành vi, mới đọc code.
- API đang tắt vì codex sửa `apps/api/src/auth/` cùng lúc; rà lại sau khi SA50–52 xong.

---

## 6. Thứ tự đề nghị

| Ưu tiên | Việc |
|---|---|
| **1** | API key phải chịu kiểm tra quyền — hoặc mang vai trò, hoặc cưỡng chế `scopes` (gộp 2.1 + 2.2) |
| **2** | Invitation + quản lý thành viên + đổi vai trò (2.3) |
| **3** | Chuyển quyền sở hữu, xoá tổ chức |
| **4** | Profile |

Việc **1** là an toàn, làm trước. Việc **2** là điều kiện để bán cho khách có nhiều người
dùng — hiện một tổ chức chỉ có thể có một người.
