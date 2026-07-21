# ADR-004: Distribution là một Artifact có version, không phải thư mục cấu hình rời rạc

## Status

**Accepted** (Distribution là artifact có version) + **Proposed** (giả định lưu trữ
shared vs clone-per-store, xem mục "Current Assumption" bên dưới) — nguồn thẩm quyền:
`idea/plan-8.md`, củng cố bởi `idea/plan-9.md`, `idea/plan-11.md`, `idea/plan-12.md`.
Xem `Blueprint/DOC-STATUS.md` để hiểu quy ước phân loại.

## Bối cảnh

Ban đầu, các bản kế hoạch sớm (idea0–idea4, plan.md) hình dung việc tạo store là cài
đặt tuần tự: tạo blog → cài theme → cài từng plugin cần thiết, có thể tải trực tiếp từ
WordPress.org khi provisioning. Cách này có vấn đề: chậm (phụ thuộc mạng ngoài khi tạo
store), không đảm bảo mọi store giống hệt nhau (dễ lệch version giữa các lần cài), khó
rollback khi một plugin/theme mới có lỗi, và buộc Control Plane phải biết chi tiết
plugin nào đang được dùng.

## Quyết định

Đóng gói toàn bộ WordPress + WooCommerce + Theme + Core Plugin Set + MU Platform Plugin
+ Config thành một **Distribution** — một artifact có version rõ ràng (semver), có
`manifest.json` mô tả, được build bởi CI/CD và lưu trong Artifact Repository (Object
Storage), tương tự cách một Docker image hay một bản ISO "Ubuntu Server" được đóng gói.
Khi tạo store, Agent chỉ cần **clone/activate đúng version Distribution** đã kiểm thử,
không cài đặt từng phần tử rời rạc và không tải từ nguồn bên ngoài (WordPress.org) tại
thời điểm provisioning.

## Current Assumption (Proposed, chưa được nguồn xác nhận)

Giả định đang dùng: **Shared Runtime** — nhiều store cùng version Distribution dùng
chung một bản mã nguồn/asset trên Node (qua symlink hoặc mount chung), không clone toàn
bộ source code riêng cho từng store.

Lý do: mục tiêu vận hành hàng trăm–hàng nghìn store trên một Node; clone riêng từng
store sẽ tốn dung lượng và I/O không cần thiết khi phần lớn store dùng chung version.
Đây là suy luận hợp lý của người viết tài liệu để lấp khoảng trống kỹ thuật, **không
phải điều `idea/` đã bàn và thống nhất** — cần review và benchmark thực tế trước khi
coi là quyết định cuối.

## Alternatives Considered

- **Shared Runtime (đang giả định dùng)** — nhiều store trỏ tới cùng một bản mã nguồn
  Distribution qua symlink/mount chung.
  - Ưu điểm: tiết kiệm dung lượng và I/O ở quy mô lớn; update Distribution một lần ảnh
    hưởng toàn bộ store dùng chung version đó (dễ rollout theo lô).
  - Nhược điểm: cần cơ chế cô lập cấu hình riêng của từng store (uploads, cache, config
    override) khỏi phần mã nguồn dùng chung; lỗi ở bản dùng chung ảnh hưởng nhiều store
    cùng lúc.
- **Clone toàn bộ mã nguồn riêng cho mỗi store**
  - Ưu điểm: cô lập hoàn toàn giữa các store, đơn giản hơn về mặt tư duy (mỗi store là
    một thư mục độc lập), dễ debug riêng lẻ.
  - Nhược điểm (tạm coi là lý do "Rejected" cho giả định hiện tại): tốn dung lượng và
    I/O đáng kể ở quy mô hàng trăm/nghìn store cùng version.

Nguồn `idea/` không đề cập trực tiếp câu hỏi này — cả hai phương án đều là suy luận kỹ
thuật hợp lý cần được benchmark thực tế ở Phase 1 (Runtime Distribution) của roadmap
trước khi xác nhận, không phải kết luận đã có sẵn.

## Lý do

1. **Tốc độ và ổn định khi provisioning**: không phụ thuộc mạng ngoài, không rủi ro
   version plugin bị đổi giữa chừng giữa hai lần tạo store khác nhau.
2. **Tái lập được (reproducible)**: mọi store tạo từ cùng version Distribution có hành
   vi giống hệt nhau — dễ debug, dễ hỗ trợ khách hàng.
3. **Rollback dễ dàng**: nếu Distribution version mới có lỗi, chỉ cần trỏ lại version
   cũ đã biết là ổn định (xem quy trình ở `11-Deployment.md`), không phải gỡ từng
   plugin thủ công.
4. **Tách Control Plane khỏi chi tiết plugin**: SaaS chỉ cần biết "Store A đang chạy
   Distribution 1.2.0", không cần biết bên trong dùng RankMath hay Yoast — việc ánh xạ
   Capability → Plugin cụ thể là việc của MU Plugin/WordPress Adapter (`07-MU-Plugin.md`).
5. Cho phép về sau có **nhiều Distribution khác nhau** (Commerce Basic, Fashion,
   Electronics, Wholesale...) mà không phải thiết kế lại kiến trúc nền tảng — mỗi
   Distribution chỉ là một artifact khác trong cùng Artifact Repository.

## Hệ quả

- Cần một quy trình build Distribution trong CI/CD (`tools/distribution-builder` theo
  `idea/plan-9.md`) — đóng gói WordPress/WooCommerce/Theme/Plugin/Config/manifest.json
  thành một bundle, tính checksum, đẩy lên Object Storage.
- Store chỉ lưu **một con số version Distribution** đang chạy — không cho phép "tự ý
  cài thêm plugin ngoài Distribution" trong giai đoạn MVP (điều này chỉ mở ra sau khi
  có Marketplace, xem `13-Roadmap.md`, giai đoạn sau Production).
- Update Distribution là một Operation có Backup → Maintenance → Update → Verify →
  Done/Rollback (`11-Deployment.md`), không phải thao tác tay.

## Open Question

Không có open question về nguyên tắc đóng gói — nguồn khẳng định dứt khoát Distribution
là artifact versioned. Điểm còn mở là **cơ chế lưu trữ cụ thể** (đã trình bày ở mục
"Current Assumption" và "Alternatives Considered" phía trên): nguồn `idea/` không đặc tả
chi tiết, giả định Shared Runtime hiện chỉ là Proposed, cần benchmark ở Phase 1 trước khi
xác nhận chính thức.
