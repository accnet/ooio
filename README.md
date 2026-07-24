# ooio — WooCommerce Cloud Platform

A SaaS platform that manages the full lifecycle of WooCommerce stores — provisioning,
domains, SSL, billing, marketplace, and operations — using WordPress as a **Runtime
Engine** underneath a self-built Control Plane. Not WordPress hosting; WordPress is
the engine, the Platform is the product.

## Architecture — Three Planes

```
Users → React Dashboard (SPA)
              │  JWT/HTTPS
         NestJS API ── PostgreSQL · Redis · BullMQ
              │        (Workflow / Events)
        Cluster Registry
              │
        Operations Queue
  ══════════════════════════════════════  ◄ API Contract v1 (frozen)
           Go Agent (Node)
              │  WordPress Adapter → MU Platform Plugin
     WordPress Multisite → MySQL  (1 cluster = 1 network = 1 database)
```

| Plane | Technology | Responsibility |
|---|---|---|
| **Control Plane** | NestJS + Prisma + PostgreSQL | Business logic: auth, billing, workflow, scheduler, marketplace |
| **Management Plane** | Go Agent (systemd, no Docker) | Infrastructure execution: provision, backup, SSL, deploy, metrics |
| **Runtime Plane** | WordPress Multisite + WooCommerce | Store execution: serve customer traffic, commerce logic |

The Control Plane never SSH-es into servers or writes to WordPress databases directly.
Everything goes through the Agent → MU Plugin → WordPress Core API chain (see
[ADR-003](Blueprint/ADR/ADR-003-No-Direct-DB-No-SSH.md)).

## Current Status

**Runtime + Agent: built, tested, running live** (30 tasks, full 3-plane with mock SaaS).
API Contract v1 frozen. SaaS Control Plane under active development.

See [Blueprint/17-Remaining-Work.md](Blueprint/17-Remaining-Work.md) for the living
checklist.

## Repository Layout

```
platform/          SaaS bounded contexts — NestJS modules (identity, billing, stores, workflow, …)
runtime/           WordPress distribution, MU Plugin, config profiles, installer
packages/          Shared libraries (@ooio/shared, types, SDK stubs)
infra/             Docker, Terraform, Ansible, monitoring
tools/             Distribution builder tooling
scripts/           Spike test harness, provisioning scripts
docs/              API contracts (OpenAPI), developer guides, spike reports
Blueprint/         Architecture source of truth — vision, ADR, AP, roadmap, plans
```

Thư mục `platform/` chứa placeholder README cho từng bounded context; code NestJS thật
hiện nằm trong `apps/api/src/`. Khi refactor xong, code sẽ chuyển vào `platform/`.

> Xem [platform/README.md](platform/README.md), [runtime/README.md](runtime/README.md),
> [packages/README.md](packages/README.md) để biết trạng thái chi tiết từng tầng.

## Documentation

**Start here** depending on your role:

| You are… | Read first |
|---|---|
| New to the project | [docs/getting-started.md](docs/getting-started.md) |
| Understanding architecture | [Blueprint/00-Executive-Summary.md](Blueprint/00-Executive-Summary.md) |
| Making architecture decisions | [Blueprint/DECISION-FLOW.md](Blueprint/DECISION-FLOW.md) |
| Reading the full Blueprint | [Blueprint/VERSION.md](Blueprint/VERSION.md) (reading order) |
| Working with the API | [docs/api/CONTRACT.md](docs/api/CONTRACT.md) |
| Deploying a Runtime node | [docs/guides/deployment.md](docs/guides/deployment.md) |
| Full documentation map | [docs/README.md](docs/README.md) |

### Recommended reading order (from [DECISION-FLOW.md](Blueprint/DECISION-FLOW.md))

```
AP-002 (data ownership)
  → AP-001 (no cross-store join)
    → ADR-006 (database platform)
      → ADR-007 (identity)
        → Blueprint/18 (SaaS plan) → 19 (Runtime plan) → 20 (Platform Services plan)
```

## Tech Stack

| Component | Stack |
|---|---|
| Control Plane API | NestJS · TypeScript · Prisma · PostgreSQL · Redis · BullMQ |
| Customer Portal | React + Vite (SPA) |
| Ops Console | React + Vite (SPA) — operator role required |
| Support Console | React + Vite (SPA) — support role required |
| Go Agent | Go 1.22+ · systemd · native binary |
| MU Plugin | PHP 8.3 · WordPress REST API |
| Runtime | WordPress 7.0 · WooCommerce · MySQL 8.4 |
| Web Server | Caddy (auto-TLS) |
| Cache | Redis (object cache + BullMQ) |

## License

Private — all rights reserved.
