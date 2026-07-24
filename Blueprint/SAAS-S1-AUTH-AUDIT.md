# S1 Authentication — rà soát độ phủ

**Ngày: 2026-07-23.** Rà soát bằng cách **chạy thật** API (`:3100`, PostgreSQL Docker),
không phải đọc code. Mỗi kết luận kèm mã HTTP quan sát được.

---

## 1. Đã có và chạy đúng

| | Bằng chứng |
|---|---|
| `POST /auth/register` | 201, trả `accessToken` + `refreshToken` |
| `POST /auth/login` | 200 |
| `POST /auth/refresh` | 200 |
| Băm mật khẩu | `bcrypt` cost **12** (`auth.service.ts:150`) |
| Access token TTL | **900 s** (15 phút) |
| Refresh token TTL | **604.800 s** (7 ngày) |
| RBAC | `rbac.guard.ts` (vai trò trong tổ chức) + `platform-role.guard.ts` (vai trò nền tảng) |
| API key | `validateApiKey`, băm SHA-256, tiền tố `wk_` |
| Bootstrap vai trò | operator/support gán theo email qua cấu hình |

Payload access token quan sát được:

```json
{"sub":"cmrwmjj46…","email":"…","organizationId":"cmrwmjj49…",
 "platformRoles":[],"platformRole":null,"tokenType":"access","iat":…,"exp":…}
```

### Một quyết định thiết kế đúng, nên giữ

`jwt.strategy.ts:validate()` **vứt bỏ mọi claim trong token** và đọc lại ngữ cảnh từ
database qua `contextForUserId(payload.sub)`. Token chỉ dùng để biết *ai*, không dùng để
biết *được làm gì*.

Kiểm chứng: token giả mạo tự phong `"platformRoles":["operator"]` gọi `GET /pools` → **403**.
**Leo thang quyền bị chặn.** Đây là thứ khiến lỗ hổng dưới đây có giới hạn thay vì thảm hoạ.

---

## 2. Ba lỗ hổng, xếp theo mức nghiêm trọng

### 🔴 2.1 `JWT_SECRET` fail-open — mạo danh được bất kỳ user nào

Ba chỗ cùng một mẫu:

```
auth.module.ts:20    config.get('JWT_SECRET') || 'development-only-change-me'
auth.service.ts:96   config.get('JWT_SECRET') || 'development-only-change-me'
jwt.strategy.ts:16   config.get('JWT_SECRET') || 'development-only-change-me'
```

Và `ConfigModule.forRoot()` **không có `validationSchema`** — không có kiểm tra nào lúc
khởi động. Thiếu biến môi trường ⇒ API **vẫn chạy** với một secret công khai trong mã
nguồn.

Tệ hơn: `apps/api/.env` **và** `.env.example` đều ship `JWT_SECRET=change-me`.

**Đã khai thác thành công:**

```
token ký bằng 'change-me' + user id có thật
  GET /stores  → 200      ← mạo danh THÀNH CÔNG
  GET /pools   → 403      ← leo thang quyền bị chặn
```

Phạm vi thiệt hại: **mạo danh bất kỳ user nào biết id**, đọc/ghi mọi thứ user đó làm được.
Không leo thang lên operator/support.

**Sửa:** từ chối khởi động nếu `JWT_SECRET` thiếu hoặc bằng giá trị mẫu, ở môi trường không
phải development. Fail-closed, không fail-open.

### 🟠 2.2 Refresh token không thu hồi được, không xoay vòng

Đo trực tiếp — dùng **cùng một** refresh token ba lần:

```
lần 1 → 200
lần 2 → 200
lần 3 → 200
```

Refresh token là **JWT thuần, không lưu ở đâu cả**. Hệ quả:

- Token bị lộ **có hiệu lực đủ 7 ngày** và **không cách nào thu hồi**
- Không xoay vòng ⇒ không phát hiện được token bị đánh cắp qua dấu hiệu dùng lại
- Đổi mật khẩu **không** vô hiệu hoá phiên đang mở
- Không có khái niệm "đăng xuất khỏi mọi thiết bị"

### 🟠 2.3 Không có endpoint đăng xuất

```
POST /auth/logout   → 404
POST /auth/revoke   → 404
POST /auth/signout  → 404
```

Người dùng **không có cách nào** kết thúc phiên. Kết hợp với 2.2: một lần đăng nhập trên
máy công cộng là bảy ngày không rút lại được.

---

## 3. Thiếu so với roadmap S1

| Roadmap | Trạng thái |
|---|---|
| JWT | ✅ |
| Refresh Token | ⚠️ có, nhưng không thu hồi được (2.2) |
| **OAuth** | ❌ không có |
| **Magic Link** | ❌ không có |
| **Email** | ❌ không có — kể cả xác minh email lẫn đặt lại mật khẩu |
| Account | ⚠️ có `register`, không có đổi mật khẩu / xoá tài khoản |

Ngoài roadmap nhưng cần cho một SaaS thật:

- **Rate limit / brute-force protection** trên `login` — chưa có
- **Xác minh email** — hiện đăng ký bằng email bất kỳ là dùng được ngay
- **Khoá tài khoản** sau N lần sai

---

## 4. Thứ tự đề nghị

| Ưu tiên | Việc | Vì sao |
|---|---|---|
| **1** | `JWT_SECRET` fail-closed + `validationSchema` | Đang mạo danh được. Sửa trong một lần chạy |
| **2** | Refresh token lưu DB + xoay vòng + `POST /auth/logout` | Không có nó thì không có cách xử lý sự cố lộ token |
| **3** | Rate limit `login` | Rẻ, chặn brute-force |
| **4** | Email: xác minh + đặt lại mật khẩu | Điều kiện để mở đăng ký tự do |
| **5** | OAuth / Magic Link | Tiện lợi, không phải điều kiện an toàn |

Ba việc đầu **là điều kiện để nhận khách thật**. Hai việc sau là tính năng.

---

## 5. Giới hạn của lần rà soát này

- Chạy trên **môi trường dev**, `JWT_SECRET=change-me`. Trên môi trường có secret mạnh,
  lỗ hổng 2.1 không khai thác được — **nhưng không có gì đảm bảo secret mạnh**, vì không có
  kiểm tra lúc khởi động. Đó chính là lỗ hổng.
- **Chưa rà** `rbac.guard.ts` theo từng route — mới xác nhận `platform-role.guard` chặn leo
  thang.
- **Chưa kiểm** API key lifecycle (tạo/thu hồi/hết hạn) — nằm ở `api-keys/`, thuộc phạm vi
  rà soát riêng.
- **Chưa kiểm** luồng đăng ký nhiều tổ chức và `memberships`, thuộc **S2**.
