# API Contracts — Source of Truth

OpenAPI contracts cho hai mặt cắt Agent-facing. **Đã đóng băng ở v1.0.0** sau Gate 2
live verification (2026-07-21).

## Files

| File | Mặt cắt |
|---|---|
| [CONTRACT.md](CONTRACT.md) | Chính sách versioning, chứng chỉ evidence |
| [agent-saas.openapi.yaml](agent-saas.openapi.yaml) | Agent ↔ SaaS Control Plane |
| [agent-mu-plugin.openapi.yaml](agent-mu-plugin.openapi.yaml) | Agent ↔ MU Plugin |

## Chính sách thay đổi

- **Additive** (thêm endpoint/field không phá vỡ) → cập nhật tại chỗ
- **Breaking** (xóa/đổi field, đổi type, đổi ý nghĩa) → tăng major version

Xem [CONTRACT.md](CONTRACT.md) cho chi tiết.
