# Packages — Shared Libraries

Shared libraries, types, clients, events, and configuration contracts dùng chung
giữa các apps.

## Trạng thái

| Package | Trạng thái | Ghi chú |
|---|---|---|
| `shared/` | **có code** | `@ooio/shared` — API client factory cho 3 frontend apps. Xem [README](shared/README.md) |
| `config/` | **rỗng** | Reserved — config contracts |
| `events/` | **rỗng** | Reserved — event types & dispatcher |
| `logger/` | **rỗng** | Reserved — structured logging |
| `sdk/` | **rỗng** | Reserved — SDK sinh từ OpenAPI |
| `types/` | **rỗng** | Reserved — shared TypeScript types |
| `ui/` | **rỗng** | Reserved — shared UI components |
| `workflow/` | **rỗng** | Reserved — workflow types |

> **Lưu ý:** Contract thật đang dùng nằm ở `docs/api/*.openapi.yaml` (Contract v1, đã
> đóng băng), không phải ở `packages/`. Chỉ tạo package khi có code thật cần dùng chung
> ở hai nơi trở lên — thư mục rỗng để đánh dấu ý định, không phải code đã có.

## Cách tiêu thụ

`@ooio/shared` được import qua **path alias** (không phải npm package). Repo chưa có
npm workspaces. Xem [shared/README.md](shared/README.md) cho chi tiết kỹ thuật.
