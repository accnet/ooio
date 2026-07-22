# admin — Console vận hành

Console cho **operator nền tảng**. Tách khỏi `apps/web` không phải vì bố cục khác,
mà vì đây là **ranh giới phân quyền**.

```bash
npm install
npm run dev     # http://localhost:5176
```

Cần API chạy ở `127.0.0.1:3100` (vite proxy `/api` → API).

## Đăng nhập

Chỉ tài khoản có `platformRole = 'operator'`. Bootstrap bằng biến môi trường của API:

```bash
PLATFORM_OPERATOR_EMAILS=ops@ooio.test npm run start --prefix ../api
```

Email nằm trong danh sách đó sẽ được gán `operator` khi đăng ký/đăng nhập.
**`platformRole` không thể cấp qua payload đăng ký** — nếu cấp được thì lớp phân
quyền này vô nghĩa.

## Điều quan trọng nhất về bảo mật ở đây

UI **không phải** nơi ra quyết định phân quyền. `isOperator()` chỉ đọc claim trong
JWT để khỏi hiển thị màn hình mà mọi request sẽ trả 403. Thẩm quyền thật là
`PlatformRoleGuard` ở API (`apps/api/src/auth/platform-role.guard.ts`).

> Ẩn một cái nút không phải là một quyền.

Lịch sử vì sao có tầng này: trước đây `PATCH /pools/:id/status` chỉ được bảo vệ bằng
`JwtAuthGuard`, nên **bất kỳ khách hàng nào đăng nhập cũng đặt được pool sang
`draining` và chặn cấp phát store toàn nền tảng**. Xem task `SA10`.

## Màn hình

| Trang | API | Ghi chú |
|---|---|---|
| Pools | `GET /pools`, `PATCH /pools/:id/status` | vòng đời theo `ADR-006` mục 8; API từ chối chuyển trạng thái sai (ví dụ `retiring` khi `used > 0`) |
| Distributions | `GET /distributions`, `POST /distributions/:id/publish` | publish là một chiều — `ADR-004` bất biến |
| Feature flags | `GET /flags`, `PUT /flags/:key` | nút bật/tắt chỉ đặt **mặc định global**; thứ tự áp dụng org > plan > cluster > global |
| Events | `GET /events` | operator xem mọi tổ chức; event không có `publishedAt` mà `attempts` tăng dần là đang kẹt |

## Nợ kỹ thuật đã biết

`src/api.ts` **lặp lại** ~60 dòng request/token của `apps/web/src/api.ts`. Chưa trích
xuất vì repo chưa có npm workspaces — dựng package dùng chung sẽ là thay đổi lớn hơn
chính việc tách app. **Trích xuất sang `packages/shared` khi xuất hiện consumer thứ ba,
hoặc ngay khi hai bản bắt đầu lệch nhau** — cái nào đến trước. Logic token lệch nhau
giữa hai app là cách sinh ra lỗi phiên đăng nhập.

Khoá `localStorage` cố tình khác `apps/web` (`ooio.admin.*`): nếu hai app từng được
phục vụ cùng origin, dùng chung khoá sẽ khiến phiên khách hàng và phiên operator đè
lên nhau.
