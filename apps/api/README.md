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

## Operator recovery

Platform roles are assigned only from environment configuration; registration
input cannot grant an operator role. On startup, the API logs an error if
`PLATFORM_OPERATOR_EMAILS` is empty or does not match an existing user. In that
state there is no operator account, and no operator can be created through the
API.

If all operator access is lost, set `PLATFORM_OPERATOR_EMAILS` to the email of
an existing user and restart the API. The alternative recovery path is a
controlled direct database update of that user's `platform_roles` column. Do
not add an HTTP role-granting endpoint.
