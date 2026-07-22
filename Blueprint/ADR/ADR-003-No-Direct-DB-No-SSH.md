# ADR-003: Không SSH, không ghi thẳng Database WordPress — mọi thứ qua MU Plugin hoặc HTTPS/JWT

## Status

**Accepted** (nguyên tắc chính) + **Open** (transport cụ thể Agent↔MU Plugin) — nguồn
thẩm quyền: `idea/plan-3.md`, `idea/plan-4.md`, củng cố bởi `idea/plan-12.md`. Xem
`Blueprint/DOC-STATUS.md` để hiểu quy ước phân loại.

## Bối cảnh

Cần xác định cách Control Plane (SaaS), Go Agent, và MU Plugin giao tiếp với nhau và
với dữ liệu WordPress. Có hai cám dỗ thường gặp cần loại bỏ: (1) để Control Plane SSH
thẳng vào server để chạy lệnh khi cần "nhanh gọn"; (2) để Agent hoặc bất kỳ thành phần
nào ghi thẳng vào bảng WordPress (`wp_blogs`, `wp_options`...) bằng SQL trực tiếp thay
vì qua WordPress Core API, vì "nhanh hơn viết REST".

## Quyết định

**Accepted:**

- Control Plane không bao giờ SSH vào server, không gọi MySQL trực tiếp, không gọi
  WordPress REST trực tiếp. Control Plane chỉ giao tiếp với Go Agent qua HTTPS + JWT
  (Agent luôn là bên khởi tạo kết nối outbound cho heartbeat/poll job).
- Go Agent không ghi thẳng vào database WordPress. Agent được phép `CREATE DATABASE` /
  cấp quyền user DB (hạ tầng), nhưng mọi thay đổi dữ liệu nghiệp vụ WordPress (tạo blog,
  tạo user, activate plugin, đổi option...) phải đi qua **MU Platform Plugin** (qua
  WordPress Adapter) trên `127.0.0.1`, để WordPress Core API xử lý (`wpmu_create_blog()`,
  `wp_insert_user()`, `activate_plugin()`...).
- MU Plugin chỉ bind localhost, không public ra Internet; Agent là client duy nhất được
  phép gọi.

**Open (chưa chốt):**

- Giao thức cụ thể giữa Agent và MU Plugin: REST hay Unix Domain Socket — xem mục
  "Alternatives Considered" bên dưới. Nguyên tắc "không ghi thẳng DB, phải qua MU Plugin"
  đã chốt; **cách gọi MU Plugin (giao thức tầng vận chuyển) thì chưa**.

## Alternatives Considered

Phương án cho giao thức Agent ↔ MU Plugin (chưa kết luận, sẽ chốt ở một ADR riêng sau
khi triển khai Phase 2/3 của roadmap):

- **REST qua HTTP trên `127.0.0.1`**
  - Ưu điểm: dễ debug bằng `curl`/Postman, dễ version hoá API (`/platform/v1/...`), công
    cụ và thư viện HTTP client sẵn có, dễ log/trace theo request.
  - Nhược điểm: vẫn phải mở một cổng HTTP nội bộ (dù chỉ bind localhost), overhead
    serialize/deserialize HTTP cao hơn IPC thuần.
- **RPC qua Unix Domain Socket (UDS) hoặc FastCGI bridge**
  - Ưu điểm: không cần mở cổng HTTP nội bộ, giảm bề mặt tấn công, hiệu năng tốt hơn, chỉ
    tiến trình cùng máy mới truy cập được (quyền truy cập theo file permission thay vì
    network).
  - Nhược điểm: khó debug hơn REST (không dùng `curl` trực tiếp được), cần tự định nghĩa
    framing/serialization, ít quen thuộc hơn với đội phát triển.

Quyết định cuối cùng nên đưa ra khi triển khai Phase 2 (MU Plugin) / Phase 3 (Go Agent)
của roadmap, dựa trên đo đạc thực tế (độ trễ, mức độ cần debug, rủi ro bảo mật thực sự
ở quy mô triển khai). Bất kể chọn phương án nào, cần giữ lớp `WordPressClient` đủ trừu
tượng trong Agent để đổi giao thức không ảnh hưởng phần còn lại của hệ thống.

## Lý do

- Ghi thẳng SQL vào bảng WordPress bỏ qua hook (`do_action`, `apply_filters`), khiến
  cache không được invalidate đúng, plugin khác không hay biết thay đổi, dữ liệu dễ
  lệch pha với logic nghiệp vụ của WordPress/WooCommerce.
- SSH trực tiếp từ Control Plane phá vỡ mô hình outbound-only, buộc phải mở inbound
  port/quản lý SSH key ở quy mô hàng trăm/nghìn server — rủi ro bảo mật và vận hành
  lớn, khó audit ai đã làm gì.
- Bắt buộc đi qua một API tường minh của MU Plugin (bất kể transport cụ thể là gì) giúp
  version hoá được API, dễ kiểm thử, dễ audit, và tách rời được vòng đời phát triển của
  WordPress khỏi Agent/Control Plane.

## Hệ quả

- Mọi request thay đổi dữ liệu WordPress đều có một đường đi kiểm chứng được:
  Control Plane → Agent (poll job) → MU Plugin (localhost) → WordPress Core API.
- Cần duy trì `WordPressAdapter` (interface) trong MU Plugin và `AgentClient` /
  `WordPressClient` trong Control Plane để cô lập thay đổi API/transport về sau.
- Thao tác quản trị không có API phù hợp (`wp core update`, `wp search-replace`,
  `wp cron event run`) vẫn được phép chạy qua WP-CLI **do chính Agent thực thi cục
  bộ**, không phải ngoại lệ cho quy tắc "không SSH từ Control Plane" — Agent chạy
  ngay trên máy đó, không phải SSH từ xa.

## Câu hỏi mở phát sinh từ đo đạc (2026-07-22)

Mô hình outbound-only khiến Agent **hỏi việc theo chu kỳ** thay vì được đánh thức.
Spike Report #003 đo được cái giá của điều đó:

```
MU Plugin tạo site thật                   382 ms
Khách hàng chờ đầu-cuối                 6.074 ms
PLATFORM_AGENT_POLL_INTERVAL                5 s
```

**94% thời gian khách hàng chờ là Agent đang ngủ**, không phải hệ thống đang làm việc.
Đây không phải chi phí của kiến trúc mà là chi phí của **một dòng cấu hình** — nhưng
cách khắc phục lại đụng chính ADR này:

| Hướng | Đánh đổi |
|---|---|
| **Hạ `POLL_INTERVAL`** | Giữ nguyên outbound-only. Tải lên Control Plane tăng **tuyến tính theo số node** — 1.000 node × poll 1 s = 1.000 req/s chỉ để hỏi "có việc không". |
| **Long-poll** (Agent giữ kết nối chờ) | **Vẫn là outbound-only** — Agent khởi tạo kết nối. Không vi phạm ADR này. Đổi lại Control Plane phải giữ nhiều kết nối mở. |
| **Webhook / push xuống node** | **VI PHẠM ADR này** — cần đường vào từ Control Plane tới node. |

**Chưa chốt.** Ghi nhận rằng **long-poll không vi phạm ADR-003** là điểm quan trọng: nó
xoá gần hết thời gian chết mà vẫn giữ nguyên nguyên tắc outbound-only. Quyết định khi
triển khai, dựa trên số node dự kiến và chi phí giữ kết nối.
