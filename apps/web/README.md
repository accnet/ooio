# web — Portal khách hàng

React + Vite SPA cho **khách hàng**: đăng nhập, tạo và theo dõi store, tiến trình
operation, hạn mức và gói cước.

Trước đây là `apps/dashboard`, đổi tên bằng `git mv` khi tách console vận hành ra
`apps/admin`. Trang `Cluster health` đã được **gỡ khỏi app này** — đó là việc vận hành,
và nó từng nằm chung với màn hình khách hàng dưới cùng một lớp xác thực.

## Development

```bash
npm run dev
```

The Vite dev server proxies `/api` to `http://127.0.0.1:3100`. The dashboard never
accesses the database directly; all data flows through `src/api.ts` with the current
Bearer token.

## Build

```bash
npm run build
```
