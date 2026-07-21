# Product Vision

## Sản phẩm là gì

Một nền tảng SaaS quản lý **vòng đời WooCommerce Store** — từ tạo store, domain, SSL,
theme/plugin, backup, đến billing và marketplace — chứ **không phải WordPress hosting**
truyền thống. Khách hàng không tự cài WordPress; họ nhận một cửa hàng WooCommerce đã
được tối ưu sẵn (Distribution) chỉ sau vài phút bấm "Create Store".

## So sánh tham chiếu

Nền tảng kết hợp đặc điểm của bốn mô hình đã tồn tại, nhưng không sao chép hoàn toàn
mô hình nào:

- **Shopify** — trải nghiệm SaaS, tự phục vụ (self-service), billing/plan theo subscription.
- **WordPress.com** — vận hành WordPress ở quy mô multisite.
- **Kinsta / WP Engine** — quản lý hạ tầng chuyên biệt cho WordPress (nhưng ở đây quản
  lý bằng Go Agent tự viết, không dựa vào managed hosting bên thứ ba).
- **Cloudflare** — tự động hoá domain/SSL/reverse proxy.

Khác biệt cốt lõi so với Shopify: dùng WooCommerce làm Commerce Engine thay vì tự viết
commerce logic. Khác biệt so với WordPress.com/Kinsta: WordPress không phải là nền
tảng cấp cao nhất mà chỉ là một Runtime nằm bên dưới một Control Plane tự xây.

## WordPress-as-Runtime — nguyên tắc trung tâm

> "Xây một Cloud Platform có khả năng quản lý WordPress, thay vì xây một WordPress có
> thêm tính năng SaaS."

WordPress/WooCommerce chỉ chịu trách nhiệm:

- Chạy website, xử lý request khách truy cập.
- Commerce logic (giỏ hàng, checkout, đơn hàng, sản phẩm) — dữ liệu này ở lại trong
  WooCommerce, không đẩy sang Control Plane trừ khi bật đồng bộ tường minh.

WordPress **không bao giờ** chứa: billing, subscription, user SaaS, plan logic, domain
logic, marketplace logic. Toàn bộ nằm ở Control Plane.

Hệ quả kiến trúc: vì Control Plane không phụ thuộc chi tiết triển khai của WordPress,
về sau có thể mở rộng hỗ trợ runtime khác (ví dụ Magento, OpenCart) chỉ bằng cách viết
thêm Adapter + Agent tương ứng, không phải thiết kế lại Control Plane.

## Đối tượng khách hàng mục tiêu *(Proposed — xem `DOC-STATUS.md`)*

Danh sách persona dưới đây là suy luận hợp lý của người viết tài liệu để cụ thể hoá tầm
nhìn sản phẩm; `idea/` không mô tả tường minh chân dung khách hàng, chỉ mô tả kiến trúc
và roadmap kỹ thuật:

- Người bán muốn có cửa hàng WooCommerce vận hành sẵn, không cần biết vận hành server.
- Agency/reseller cần tạo nhiều store nhanh, đồng nhất, dễ bảo trì hàng loạt.
- Ở quy mô lớn hơn: doanh nghiệp cần dedicated cluster, SSO, RBAC nâng cao (giai đoạn
  Enterprise, sau Production — mục Enterprise này thì có nêu trong `idea/plan-7.md`).

## Định vị quy mô

Kiến trúc được thiết kế để phục vụ từ vài trăm đến hàng chục nghìn (thậm chí hướng tới
100.000) store mà không cần thiết kế lại nền tảng cốt lõi — bằng cách mở rộng theo
chiều ngang (thêm Cluster/Node) chứ không phải scale dọc một hệ thống nguyên khối.
