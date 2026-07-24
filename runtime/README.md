# Runtime — WordPress Data Plane

WordPress distribution và các component Data Plane. Runtime không chứa logic SaaS,
không biết Billing/Subscription/User SaaS — chỉ biết WordPress Core API. Ranh giới
này được giữ nghiêm ngặt để hai phía có vòng đời phát hành độc lập.

> Runtime không phụ thuộc ngược lại `platform/` dưới bất kỳ hình thức nào.

## Trạng thái

| Component | Thư mục | Trạng thái |
|---|---|---|
| **Distribution** | `distribution/` | ✅ Có code — manifest, config profiles (default/perf/security), core plugin set |
| **MU Plugin** | `mu-plugin/` | ✅ Có code — 8 endpoint live, PHP tests |
| **WordPress** | `wordpress/` | Rỗng — WordPress core cài bằng `install-node.sh` |
| **Theme** | `theme/` | Rỗng — reserved |
| **Plugins** | `plugins/` | Rỗng — core plugin set khai báo trong `distribution/core-plugin-set.json` |
| **Installer** | `installer/` | Rỗng — logic cài đặt nằm trong `apps/agent/deploy/install-node.sh` |
| **Migrations** | `migrations/` | Rỗng — reserved cho database migrations |

## Distribution

Bundle version hoá: WordPress + WooCommerce + Theme + Plugin + `manifest.json`.
Immutable artifact (xem [ADR-004](../Blueprint/ADR/ADR-004-Distribution-Versioned-Artifact.md)).

```
distribution/
├── manifest.json            # distribution metadata + version
├── manifest.schema.json     # JSON Schema cho manifest
├── core-plugin-set.json     # danh sách plugin bắt buộc
├── config/                  # config profiles
│   ├── default.php
│   ├── performance.php
│   └── security.php
└── tests/
    └── config-profiles-test.php
```

## MU Plugin

Platform Core MU Plugin — REST API nội bộ cho Agent. Chạy trên WordPress Multisite,
cung cấp 8 endpoint (xem [API Contract](../docs/api/CONTRACT.md)):

```
POST   /platform/v1/sites          Create store
DELETE /platform/v1/sites/{siteId}  Delete store
POST   /platform/v1/plugins/activate
POST   /platform/v1/themes/switch
POST   /platform/v1/users
POST   /platform/v1/options
GET    /platform/v1/health
```

Authentication: Bearer token (shared secret giữa Agent và MU Plugin).

## Liên quan

- [Blueprint/04-Runtime.md](../Blueprint/04-Runtime.md) — kiến trúc Runtime
- [Blueprint/19-Runtime-Implementation.md](../Blueprint/19-Runtime-Implementation.md) — implementation plan
- [docs/api/agent-mu-plugin.openapi.yaml](../docs/api/agent-mu-plugin.openapi.yaml) — OpenAPI spec
