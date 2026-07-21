# SaaS API

NestJS 11 skeleton for the WooCommerce Cloud control plane.

## Local development

1. Copy `.env.example` to `.env` and set a local `JWT_SECRET` and PostgreSQL password.
2. Start PostgreSQL with `docker compose up -d postgres`.
3. Install dependencies and run `npm run start:dev` from this directory.

The initial endpoint is `GET /health`. It returns `status: "ok"` and reports
`db` and `redis` as `not_checked`; those checks remain lazy until their adapters
are added.

The Prisma schema defines the control-plane persistence boundary. Prisma client
generation and migrations are intentionally deferred to a later task.
