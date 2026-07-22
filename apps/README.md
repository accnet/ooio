# Apps

Các điểm khởi chạy triển khai được.

| App | Trạng thái | Ghi chú |
|---|---|---|
| `api/` | **có code** | NestJS Control Plane — chứa cả scheduler, DAS, workflow, events |
| `agent/` | **có code** | Go Runtime Agent (`ADR-002`: native/systemd, không Docker) |
| `web/` | **có code, còn sơ khai** | Portal khách hàng (Vite :5173). Nguyên là `dashboard/`, đã đổi tên bằng `git mv` |
| `admin/` | **có code, còn sơ khai** | Console vận hành (Vite :5176) — Pools · Distributions · Flags · Events |
| `cli/` | **có code, còn sơ khai** | |
| `worker/` | **rỗng — đã lên kế hoạch** | processor hiện chạy trong `api/`, xem README của nó |
| `scheduler/` | **rỗng — sẽ không thành app** | placement là module trong `api/`, xem README của nó |

## Vì sao `web` và `admin` là hai app, không phải hai route

Đây **không phải** lựa chọn bố cục giao diện. Route vận hành là một **ranh giới phân
quyền**: `PATCH /pools/:id/status` đặt pool sang `draining` sẽ chặn cấp phát store trên
toàn nền tảng. Trước 2026-07-21 mọi tài khoản đăng nhập đều gọi được — nay API cưỡng chế
bằng `PlatformRoleGuard` (`User.platformRole = 'operator'`).

Hai hệ quả trong code, cả hai đều cố ý:

- **Khoá localStorage khác nhau** (`ooio.admin.*` với `woocloud.*`). Nếu hai app từng được
  phục vụ cùng origin, dùng chung khoá sẽ khiến phiên khách hàng và phiên vận hành ghi đè
  lẫn nhau.
- **`isOperator()` ở UI chỉ để tránh render màn hình sẽ 403** — nó đọc `platformRole` từ
  JWT. Đó **không phải** quyết định phân quyền; nút bị ẩn không phải là quyền bị chặn.
  Thẩm quyền nằm ở API.

Phần trùng lặp hiện tại: ~60 dòng `request()`/token trong `web/src/api.ts` và
`admin/src/api.ts`. Repo chưa có npm workspaces nên tách package sẽ lớn hơn chính việc
tách app. **Trích xuất sang `packages/shared` khi có consumer thứ ba, hoặc ngay khi hai
bản bắt đầu lệch nhau** — logic token lệch giữa hai app là cách sinh ra lỗi phiên đăng nhập.

## Lưu ý về `packages/`

`packages/` hiện là **8 thư mục chỉ có README, chưa có code**. Contract dùng thật đang
nằm ở `docs/api/*.openapi.yaml` (Contract v1, đã đóng băng), không phải ở
`packages/contracts`. Chỉ tạo package khi có code thật cần dùng chung ở hai nơi trở
lên — thư mục rỗng làm người đọc tưởng hệ thống đã được xây nhiều hơn thực tế.
