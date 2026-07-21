# MU Platform Plugin

## Vai trò: REST server nội bộ, không phải business logic SaaS

MU Platform Plugin là "SDK của WordPress" — một must-use plugin expose REST API chỉ
lắng nghe trên `127.0.0.1` (localhost), được Go Agent gọi tới. Không có UI. Không có
Billing. Không có Dashboard. Không biết Subscription, Credit, User SaaS.

```
Go Agent
   │  POST http://127.0.0.1/platform/v1/sites
   ▼
MU Plugin (REST Controller → Application Service → WordPress Adapter)
   │
   ▼
WordPress Core API (wpmu_create_blog, switch_to_blog, activate_plugin, wp_insert_user...)
```

## Ranh giới business logic WordPress

MU Plugin chỉ xử lý nghiệp vụ **thuộc phạm vi WordPress**:

```
POST /sites             → wpmu_create_blog()
POST /plugins/activate  → activate_plugin()
POST /themes/switch     → switch_theme()
POST /users             → wp_insert_user()
POST /options            → update_option()
GET  /health
```

Agent **không bao giờ** tự làm những việc này bằng cách ghi thẳng database — mọi thay
đổi dữ liệu WordPress phải đi qua WordPress Core API để đảm bảo hook (`do_action`,
`apply_filters`) chạy đúng, cache được cập nhật, và tương thích plugin khác (xem ADR-003).

## Kiến trúc phân lớp bên trong

```
REST Controller
   ↓
Application Service (SiteService, UserService, PluginService...)
   ↓
WordPress Adapter (interface: create/delete/suspend...)
   ↓
WordPress Core API
```

`WordPressAdapter` là lớp quan trọng để cô lập thay đổi: nếu sau này WordPress đổi
cách tạo blog hay đổi API, chỉ cần sửa Adapter, không phải sửa toàn bộ luồng gọi từ
Agent xuống.

## Module trong MU Plugin

```
REST API · Site Service · User Service · Plugin Service · Theme Service
Media Service · Settings Service · Health Service · Adapters · Hooks · Events
```

Adapter còn dùng để ánh xạ "Capability" trừu tượng sang plugin cụ thể, để Control
Plane không cần biết plugin nào đang chạy:

```
Capability "SEO" → RankMath Adapter → RankMath
Capability "SEO" → Yoast Adapter → Yoast
```

## Những gì MU Plugin KHÔNG làm

- Không billing, không subscription, không plan logic.
- Không giao tiếp trực tiếp với Control Plane (SaaS) — chỉ nói chuyện với Go Agent
  đang chạy cùng máy.
- Không public ra Internet — chỉ bind localhost, Agent là client duy nhất.
