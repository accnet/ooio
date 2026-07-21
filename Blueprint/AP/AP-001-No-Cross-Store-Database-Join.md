# AP-001 · No Cross-Store Database Join

> **Loại: Architecture Principle.** Ban hành 2026-07-21 (Blueprint v1.1).
> Hệ quả trực tiếp của `AP-002` (Platform Data Ownership) và là điều kiện sống còn của
> mô hình **database-per-store** (`ADR-006`).

## Nguyên lý

**Không bao giờ JOIN dữ liệu vượt ranh giới store, và không bao giờ JOIN từ Platform
vào database của store.**

```
❌ SELECT * FROM store_245.wp_posts p JOIN platform.users u ON …
❌ SELECT … FROM store_245.orders UNION SELECT … FROM store_999.orders
❌ SELECT SUM(order_total) FROM  <100 databases>
```

## Vì sao đây là ràng buộc kỹ thuật, không chỉ là quy ước

Với `database-per-store`, mỗi store nằm ở một database — và các database có thể ở **pool
khác nhau, trên server khác nhau**. MySQL **chỉ JOIN được cross-database khi hai database
nằm trên CÙNG một server**. Query vượt server **fail ở tầng SQL**, không fail đẹp đẽ ở
tầng ứng dụng.

Đây chính là bài toán buộc WordPress.com phải loại bỏ cross-database JOIN khỏi toàn bộ
codebase của họ. Ta tránh được phần lớn chi phí đó nhờ `AP-002`: **`wp_users` là projection
per-store**, nên các JOIN phổ biến nhất (nội dung ↔ user) diễn ra **trong cùng một
database** và vẫn chạy bình thường.

## Cách làm đúng: aggregate qua event/projection

```
WooCommerce → Order Completed → outbox (MU Plugin) → Agent → Event Bus
                                                              ↓
                                            Analytics projection (PostgreSQL)
                                                              ↓
                                              Dashboard · Billing · Reports
```

Dashboard/Billing **đọc projection**, không đọc store. Điều này cũng khiến Platform độc
lập với schema WordPress (`AP-002` hệ quả 1).

## Cưỡng chế — và ràng buộc lên Marketplace

Nguyên lý này là **chính sách**; chính sách không tự chặn được code của bên thứ ba. Một
plugin gọi `switch_to_blog()` rồi query chéo sẽ **fail** khi hai store ở khác server.

**Hiện tại AP-001 cưỡng chế được, và lý do rất cụ thể: Distribution chỉ chứa Core Plugin
Set đã kiểm duyệt, người dùng KHÔNG được tự upload plugin** (`14-Marketplace`, giai đoạn MVP).

> ⚠️ **Ràng buộc lộ trình:** ngày nào Marketplace mở cho plugin tuỳ ý (S-6/S-8 trong
> `18-SaaS-Implementation-Plan.md`), AP-001 **mất khả năng cưỡng chế**. Khi đó bắt buộc
> phải có một trong các biện pháp:
> - **Kiểm duyệt tương thích topology** trước khi cho vào Marketplace (quét cross-blog query), hoặc
> - Cho plugin loại đó chạy trên **store nằm cùng một pool** (giới hạn placement), hoặc
> - Từ chối plugin vi phạm.
>
> Đây là coupling thật giữa `AP-001` và roadmap Marketplace — hai tài liệu khác nhau nên
> rất dễ bị bỏ sót.

## Kiểm tra khi review

- [ ] Có query nào chứa hai tên database khác nhau không?
- [ ] Có code nào `switch_to_blog()` rồi tổng hợp qua nhiều blog không?
- [ ] Báo cáo/analytics mới có đọc thẳng store database thay vì projection không?
- [ ] Plugin mới thêm vào Core Plugin Set đã được rà cross-blog query chưa?

Liên quan: `AP-002` · `ADR-006` · `14-Marketplace` · `18-SaaS-Implementation-Plan.md` (§10 Event Bus, §16 Analytics).
