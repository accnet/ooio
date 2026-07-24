# Platform — SaaS Bounded Contexts

Các bounded context nghiệp vụ của Control Plane (NestJS). Contexts giao tiếp qua
Event Bus và Application Service, không gọi trực tiếp lẫn nhau. Không context nào
biết chi tiết WordPress — chỉ gọi qua `AgentClient`.

> Ranh giới bounded context dưới đây là **Proposed / Draft** — xem
> [Blueprint/03-DDD.md](../Blueprint/03-DDD.md).

## Trạng thái

Các thư mục trong `platform/` hiện là **placeholder READMEs**, chưa có code.
Logic nghiệp vụ thật đang nằm trong `apps/api/src/` (NestJS modules):

| Bounded Context | Thư mục placeholder | Module thật trong `apps/api/src/` |
|---|---|---|
| **Identity & Auth** | `identity-auth/` | `auth/`, `api-keys/` ✅ |
| **Organization** | `organization/` | `orgs/` ✅ |
| **Billing & Plans** | `billing-plans/` | `billing/` ✅ |
| **Store Lifecycle** | `store-lifecycle/` | `stores/` ✅ |
| **Workflow & Operations** | `workflow-operations/` | `workflow/`, `operations/` ✅ |
| **Infrastructure (Cluster)** | `infrastructure-cluster/` | `agents/`, `scheduler/`, `das/` ✅ |
| **Marketplace** | `marketplace/` | `marketplace/` ✅ |
| **Analytics & Audit** | `analytics-audit/` | `analytics/`, `audit/` ✅ |
| **Notifications** | `notifications/` | `notifications/` ✅ |
| **Commerce Platform** | `commerce-platform/` | — (ranh giới chưa rõ, Open) |
| **AI & Integrations** | `ai-integrations/` | — (giai đoạn sau Production) |

## Khi nào dùng `platform/`

Các thư mục này sẽ chứa **domain logic thuần** khi dự án tách rõ giữa domain layer
và application layer. Hiện tại, code nằm tập trung trong `apps/api/src/` dưới dạng
NestJS modules — đây là lựa chọn có chủ đích cho giai đoạn đầu (xem
[Blueprint/13-Roadmap.md](../Blueprint/13-Roadmap.md): "module hoá trong NestJS monolith
là đủ").

## Nguyên tắc

- Mỗi context sở hữu dữ liệu riêng (schema logic riêng trong PostgreSQL)
- Không context nào trong `platform/` được phép biết chi tiết WordPress
- `runtime/` không phụ thuộc ngược lại `platform/`

Xem [Blueprint/03-DDD.md](../Blueprint/03-DDD.md) cho chi tiết.
