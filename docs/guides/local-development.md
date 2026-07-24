# Local Development

Hướng dẫn cấu hình môi trường phát triển local cho dự án.

## Tổng quan kiến trúc local

```
Browser
  ├── web (Vite :5173)       → proxy /api → API :3100
  ├── ops (Vite :5176)       → proxy /api → API :3100
  └── admin (Vite :5177)     → proxy /api → API :3100

NestJS API (:3100)
  ├── PostgreSQL (:5432)
  ├── Redis (:6379)
  └── BullMQ (Redis)

Go Agent (optional — chỉ khi phát triển Runtime)
  └── WordPress Multisite + MU Plugin + HyperDB + MySQL
```

Phát triển Control Plane (API + frontend) **không cần** WordPress/Agent chạy. Agent
poll jobs từ API; khi Agent không kết nối, API vẫn hoạt động bình thường.

## 1. Database (PostgreSQL + Redis)

```bash
# Option A: Docker
docker run -d --name ooio-pg -p 5432:5432 \
  -e POSTGRES_USER=ooio -e POSTGRES_PASSWORD=ooio -e POSTGRES_DB=ooio \
  postgres:16

docker run -d --name ooio-redis -p 6379:6379 redis:7-alpine

# Option B: local install
sudo apt install postgresql redis-server
sudo -u postgres createuser -s ooio
sudo -u postgres createdb ooio -O ooio
```

## 2. NestJS API

```bash
cd apps/api

# Cấu hình
cp .env.example .env
# Sửa các biến chính:
#   DATABASE_URL=postgresql://ooio:ooio@localhost:5432/ooio
#   JWT_SECRET=<random-string>
#   REDIS_URL=redis://localhost:6379

# Cài đặt và setup DB
npm install
npx prisma migrate dev

# Chạy
npm run start:dev          # watch mode, hot reload
```

API chạy ở `http://127.0.0.1:3100`. Health check: `GET /health`.

### Prisma workflow

```bash
npx prisma migrate dev           # apply migrations + generate client
npx prisma studio                # visual DB browser (:5555)
npx prisma migrate reset         # reset DB (xóa dữ liệu!)
```

### Seed data

```bash
npm run seed                     # tạo plans, test user, test org
```

## 3. Frontend apps

Ba app dùng chung setup pattern. Mỗi app có Vite proxy `/api` → API.

```bash
# Customer Portal
cd apps/web && npm install && npm run dev    # :5173

# Ops Console (operator)
cd apps/ops && npm install && npm run dev    # :5176

# Support Console (support)
cd apps/admin && npm install && npm run dev  # :5177
```

### Operator / Support accounts

Frontend apps kiểm tra `platformRole` trong JWT để quyết định hiển thị. Thẩm quyền
thật nằm ở `PlatformRoleGuard` phía API.

```bash
# Bootstrap operator account:
PLATFORM_OPERATOR_EMAILS=ops@ooio.test npm run start:dev --prefix apps/api

# Hoặc sửa trực tiếp trong DB:
UPDATE "User" SET "platformRole" = 'operator' WHERE email = 'ops@ooio.test';
```

### Shared package (@ooio/shared)

Ba app import `@ooio/shared` qua **path alias** (không phải npm package). Khai báo
trong `vite.config.ts` và `tsconfig.json` của mỗi app. Xem
[packages/shared/README.md](../../packages/shared/README.md).

## 4. Go Agent (optional)

Chỉ cần khi phát triển Runtime/Agent. Yêu cầu WordPress Multisite đang chạy.

```bash
cd apps/agent

# Cấu hình
cp deploy/agent.env.example .env
# Sửa: SAAS_BASE_URL, WP_BASE_URL, MU_PLUGIN_SECRET

# Build và chạy
go build -o ./platform-agent .
./platform-agent
```

Agent sẽ register với API, gửi heartbeat, và poll jobs.

## 5. Tests

```bash
# NestJS API
cd apps/api && npm test

# Go Agent
cd apps/agent && go test ./...

# MU Plugin (yêu cầu WordPress)
cd runtime/mu-plugin && php tests/run.php
```

## 6. Cấu trúc NestJS modules

API tổ chức theo bounded context. Mỗi module là một thư mục trong `apps/api/src/`:

```
auth/           Authentication + JWT + RBAC + PlatformRoleGuard
orgs/           Organizations
api-keys/       API key management
billing/        Plans + subscriptions + quotas
agents/         Agent registration + heartbeat
stores/         Store lifecycle
operations/     Operation status/progress
workflow/       Workflow engine + BullMQ processor
scheduler/      Placement + capacity scoring
das/            Database Allocation Service (ADR-006)
events/         Event bus + dispatcher
marketplace/    Distribution registry
flags/          Feature flags
analytics/      Analytics + metrics
notifications/  Email/webhook notifications
migrations/     Store migration state machine
audit/          Audit log
admin/          Admin/operator endpoints
health/         Health check
prisma/         Prisma service
```

## Troubleshooting

| Vấn đề | Giải pháp |
|---|---|
| `prisma migrate dev` lỗi | Kiểm tra `DATABASE_URL` trong `.env` |
| Frontend 401 liên tục | Xóa `localStorage` (mỗi app dùng key riêng) |
| Agent không kết nối | Kiểm tra `SAAS_BASE_URL` trỏ đúng API |
| Redis connection refused | `redis-cli ping` — nếu không pong thì Redis chưa chạy |
