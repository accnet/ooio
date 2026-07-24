# Getting Started

Hướng dẫn cho developer mới tham gia dự án WooCommerce Cloud Platform.

## Dự án này là gì

Một nền tảng SaaS quản lý vòng đời WooCommerce Store — tạo store, domain, SSL,
billing, marketplace — dùng WordPress làm **Runtime Engine** bên dưới một Control Plane
tự xây. Không phải WordPress hosting.

Kiến trúc 3 plane:

```
Control Plane (NestJS)         → Business logic: auth, billing, workflow
Management Plane (Go Agent)    → Infrastructure: provision, backup, SSL
Runtime Plane (WordPress)      → Store execution: serve traffic, commerce
```

Control Plane không SSH vào server, không ghi database WordPress trực tiếp. Mọi thứ đi
qua Agent → MU Plugin → WordPress Core API.

> Đọc chi tiết: [Blueprint/00-Executive-Summary.md](../Blueprint/00-Executive-Summary.md)

## Trạng thái hiện tại

- ✅ **Runtime + Go Agent**: xây xong, có test, chạy thật (full 3-plane với mock SaaS)
- ✅ **API Contract v1**: đóng băng
- ✅ **MU Plugin**: 8 endpoint live
- 🔧 **NestJS Control Plane**: đang xây (19 module trong `apps/api/src/`)
- 🔧 **Frontend apps**: `web/`, `ops/`, `admin/` có code, đang phát triển

> Xem [Blueprint/17-Remaining-Work.md](../Blueprint/17-Remaining-Work.md) cho danh sách
> đầy đủ.

## Prerequisites

| Tool | Version | Dùng cho |
|---|---|---|
| **Node.js** | 20+ | NestJS API, React apps |
| **Go** | 1.22+ | Go Agent |
| **PHP** | 8.3+ | MU Plugin (chỉ khi phát triển Runtime) |
| **MySQL / MariaDB** | 8.0+ / 11+ | Database |
| **Redis** | 7+ | Cache, BullMQ |
| **WP-CLI** | latest | WordPress management (chỉ khi phát triển Runtime) |

## Cấu trúc repository

```
apps/
├── api/           NestJS Control Plane (:3100)         ← có code, đang phát triển
├── agent/         Go Runtime Agent (systemd binary)    ← có code, hoàn thiện
├── web/           Customer Portal (:5173)              ← có code, đang phát triển
├── ops/           Ops Console - operator (:5176)       ← có code, đang phát triển
├── admin/         Support Console - support (:5177)    ← có code, đang phát triển
├── cli/           Runtime CLI (Go)                     ← có code, sơ khai
├── worker/        BullMQ processor                     ← rỗng, planned
└── scheduler/     (sẽ không thành app — module trong api/)

packages/
├── shared/        @ooio/shared — API client factory    ← có code
└── (7 thư mục)   Stubs — chưa có code

platform/          11 bounded contexts — placeholder READMEs
runtime/           WordPress distribution + MU Plugin   ← có code, hoàn thiện
infra/             Docker, Terraform, Ansible stubs
scripts/           Spike test harness                    ← có code
Blueprint/         Architecture docs (source of truth)
docs/              API contracts, guides, spikes
```

> Chi tiết: [apps/README.md](../apps/README.md) | [docs/README.md](README.md) (doc map)

## Quick start — NestJS API + Frontend

### 1. Clone repository

```bash
git clone <repo-url> ooio
cd ooio
```

### 2. Chạy NestJS API

```bash
cd apps/api
cp .env.example .env      # sửa DATABASE_URL, JWT_SECRET, REDIS_URL
npm install
npx prisma migrate dev     # setup database schema
npm run start:dev          # http://127.0.0.1:3100
```

### 3. Chạy Customer Portal (web)

```bash
cd apps/web
npm install
npm run dev                # http://localhost:5173
```

Vite proxy `/api` → `127.0.0.1:3100` tự động.

### 4. Chạy Ops Console (ops)

```bash
cd apps/ops
npm install
npm run dev                # http://localhost:5176
```

Yêu cầu tài khoản `platformRole = 'operator'`. Bootstrap bằng biến môi trường API:

```bash
PLATFORM_OPERATOR_EMAILS=ops@ooio.test npm run start --prefix ../api
```

### 5. Chạy Support Console (admin)

```bash
cd apps/admin
npm install
npm run dev                # http://localhost:5177
```

Yêu cầu tài khoản `platformRole = 'support'`.

## Quick start — Go Agent + Runtime

Đây là nhánh phức tạp hơn, yêu cầu WordPress Multisite đang chạy.

### 1. Setup Runtime node

Xem [guides/deployment.md](guides/deployment.md) cho hướng dẫn đầy đủ (consolidate từ
[DEPLOY.md](../apps/agent/deploy/DEPLOY.md)).

### 2. Build và chạy Agent

```bash
cd apps/agent
go build -o /tmp/platform-agent .
/tmp/platform-agent        # hoặc install via systemd
```

### 3. Verify

```bash
curl http://localhost/wp-json/platform/v1/health
# → {"status":"ok",...}
```

## Ba app frontend — vì sao tách riêng

| App | Port | Đối tượng | Phân quyền |
|---|---|---|---|
| `web/` | :5173 | Khách hàng | JWT thường |
| `ops/` | :5176 | Operator nền tảng | `platformRole = 'operator'` |
| `admin/` | :5177 | Support | `platformRole = 'support'` |

Đây là **ranh giới phân quyền**, không phải bố cục giao diện. Mỗi app dùng khoá
`localStorage` riêng để phiên đăng nhập không đè nhau. Chi tiết:
[apps/README.md](../apps/README.md).

## Đọc tiếp

- **Kiến trúc chi tiết**: [Blueprint/02-Architecture-Overview.md](../Blueprint/02-Architecture-Overview.md)
- **Quyết định kiến trúc (ADR/AP)**: [Blueprint/DECISION-FLOW.md](../Blueprint/DECISION-FLOW.md)
- **API Contract**: [docs/api/CONTRACT.md](api/CONTRACT.md)
- **Roadmap 11 phase**: [Blueprint/13-Roadmap.md](../Blueprint/13-Roadmap.md)
- **Bản đồ toàn bộ tài liệu**: [docs/README.md](README.md)
