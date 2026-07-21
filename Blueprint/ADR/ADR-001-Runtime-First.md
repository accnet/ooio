# ADR-001: Xây Runtime trước, SaaS sau (Runtime-First)

## Status

**Accepted** — nguồn thẩm quyền: `idea/plan-10.md`, `idea/plan-11.md`,
`idea/plan-12.md`. Xem `Blueprint/DOC-STATUS.md` để hiểu quy ước phân loại.

## Bối cảnh

Cách tiếp cận thông thường khi xây một nền tảng SaaS là bắt đầu từ Control Plane
(NestJS, Auth, Billing, Dashboard) rồi mới tích hợp phần vận hành hạ tầng (ở đây là
WordPress Runtime) sau. Các bản kế hoạch đầu (`idea/plan.md`, `plan-5` đến `plan-9`)
đều đi theo trình tự này, với roadmap 4–13 phase bắt đầu từ "SaaS Core".

Tuy nhiên, khi phân tích kỹ, rủi ro kỹ thuật lớn nhất của nền tảng này không nằm ở
Control Plane (NestJS là công nghệ quen thuộc, nghiệp vụ billing/auth đã có nhiều
tham chiếu) mà nằm ở khả năng vận hành **WordPress Multisite + WooCommerce + HyperDB**
ở quy mô hàng trăm đến hàng nghìn store: giới hạn PHP-FPM, hiệu năng HyperDB routing,
Action Scheduler của WooCommerce dưới tải, chiến lược database pool, backup ở quy mô
lớn... Đây đều là những ẩn số chưa được kiểm chứng.

## Quyết định

Đảo ngược thứ tự roadmap: xây và kiểm chứng **Runtime trước** (WordPress Distribution
+ một Cluster + Go Agent + MU Plugin + luồng Provisioning hoàn chỉnh), stress-test ở
quy mô thật (100 → 1000 site), **đóng băng API Contract** giữa Agent và Control Plane,
rồi **mới xây SaaS (NestJS)** như một lớp điều phối mỏng gọi vào API đã kiểm chứng.

Trong giai đoạn Runtime-first, hệ thống phải vận hành được độc lập — tạo/xoá/backup
store bằng CLI hoặc gọi thẳng REST của Agent (Postman/script), hoàn toàn chưa cần
Control Plane tồn tại.

## Lý do

1. **90% rủi ro kỹ thuật nằm ở Runtime, không phải ở NestJS.** Nếu WordPress Runtime
   không chịu được tải, toàn bộ giả định kiến trúc phía trên (Scheduler, Workflow,
   Billing...) đều phải thiết kế lại — tốt hơn nên phát hiện sớm.
2. Runtime kiểm chứng độc lập cho phép **stress test thật** (Phase 5 trong roadmap)
   trước khi đầu tư công sức vào Control Plane — tránh xây một SaaS đẹp gọi vào một
   Runtime chưa từng chịu tải thật.
3. **API Contract đóng băng sớm** giúp SaaS và Runtime phát triển song song về sau mà
   không phá vỡ lẫn nhau.
4. Runtime hoạt động độc lập nghĩa là dễ mở rộng sang runtime khác (Magento, OpenCart)
   sau này chỉ bằng cách viết thêm Adapter + Agent, không phải thiết kế lại Control
   Plane.
5. MVP ra mắt nhanh hơn: một Runtime ổn định (dù thô) đã có thể bán/cho early adopter
   dùng qua thao tác tay/CLI, trong khi SaaS còn đang được xây song song.

## Hệ quả

- Roadmap chính thức chỉ có **một phiên bản 11 phase** (xem `13-Roadmap.md`); mọi
  roadmap khác trong `idea/` (4/7/10/13 phase, thứ tự "SaaS trước") không còn hiệu lực
  tham chiếu triển khai, chỉ giữ làm lịch sử.
- Trong 4–6 tháng đầu, đội ngũ tập trung gần như hoàn toàn vào Runtime/Agent/MU Plugin
  trước khi chạm tới NestJS.
- Rủi ro đánh đổi: Control Plane (Billing, Dashboard) ra đời muộn hơn, nên không thể
  "bán được" theo nghĩa SaaS thương mại đầy đủ cho tới khi qua Phase 7 (SaaS Core).
