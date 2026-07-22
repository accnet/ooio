# @ooio/shared

Mã trình duyệt dùng chung cho `apps/web`, `apps/ops` và `apps/admin`.

## Vì sao tồn tại

Ba app từng có **ba bản sao** của cùng ~60 dòng xử lý request và token. Logic token
lệch nhau giữa các app là cách sinh ra lỗi phiên đăng nhập: một app sửa một trường hợp
biên của 401, hai app kia âm thầm giữ hành vi cũ.

Điểm kích hoạt trích xuất đã được ghi trước trong `apps/ops/README.md`: *khi xuất hiện
consumer thứ ba, hoặc khi các bản sao bắt đầu lệch nhau*. `apps/admin` chính là consumer
thứ ba.

## Vì sao là factory chứ không phải module tĩnh

```ts
const client = createApiClient({
  accessTokenKey: 'ooio.support.accessToken',
  refreshTokenKey: 'ooio.support.refreshToken',
});
```

**Ba app KHÔNG được dùng chung khoá `localStorage`.** Nếu chúng từng được phục vụ cùng
origin, khoá chung sẽ khiến phiên khách hàng, phiên vận hành và phiên hỗ trợ **đè lên
nhau**. Mỗi app truyền khoá riêng, nên việc gộp code **không xoá mất** sự tách biệt đó.

| App | Khoá |
|---|---|
| `apps/web` | `woocloud.*` |
| `apps/ops` | `ooio.ops.*` |
| `apps/admin` | `ooio.support.*` |

`createApiClient` ném lỗi nếu hai khoá trùng nhau.

## Cách được tiêu thụ

Dưới dạng **mã nguồn TypeScript qua path alias**, không phải package đã build. Repo chưa
có npm workspaces, và dựng workspaces là thay đổi rủi ro hơn nhiều so với mục tiêu cần
đạt. Mỗi app khai báo hai chỗ:

```ts
// vite.config.ts
resolve: { alias: { '@ooio/shared': fileURLToPath(new URL('../../packages/shared/src', import.meta.url)) } },
server:  { fs: { allow: ['..', '../../packages'] } },   // nằm ngoài root của app
```
```json
// tsconfig.json
"paths":   { "@ooio/shared": ["../../packages/shared/src/index.ts"] },
"include": ["src", "../../packages/shared/src"]
```

Nếu sau này dựng npm workspaces thì thay hai khai báo trên bằng một dependency
`"@ooio/shared": "*"` — phần mã nguồn không đổi.

## Ranh giới

Chỉ chứa thứ **cả ba app** đều cần: `ApiError`, lưu/xoá token, đọc claim JWT, và hàm
`request`. **Không** chứa endpoint của từng app, và **không** chứa quyết định phân quyền.

> `claimFromToken` chỉ là tiện ích giao diện. Thẩm quyền thật nằm ở `PlatformRoleGuard`
> phía API. Ẩn một cái nút không phải là một quyền.
