# Database Router

> **Cập nhật 2026-07-22 — đổi tên tài liệu để khớp ADR-006, không đổi quyết định.**
> Database Router là **interface/seam** trong Runtime. LudicrousDB chỉ là một
> implementation của interface đó, không phải tên của kiến trúc.

## Interface: route, không quyết định

Runtime chỉ cần thực hiện một hợp đồng nhỏ:

```
blog_id → pool đã được chọn → kết nối tới database của pool đó
```

Có hai tầng phải phân biệt rõ:

1. **DAS (Database Allocation Service) là tầng quyết định.** DAS xác định store thuộc
   pool nào, tạo/cấp phát database khi cần, và công bố mapping để Agent đồng bộ.
2. **Database Router là tầng thực thi.** Router nhận mapping đã được chọn và mở kết nối
   tới pool đó khi WordPress truy vấn. Router không chọn pool, không tạo database, không
   quản lý replication, không tự sharding, và không quản lý migration.

Migration thuộc Workflow + Agent: workflow đóng băng/điều phối thay đổi, Agent thực thi
việc hạ tầng và cập nhật mapping theo quy trình đã được chấp thuận.

```
DAS: store → pool
  │
  ▼
Agent: đồng bộ mapping
  │
  ▼
Database Router: blog_id → pool → connection
  │
  ▼
MySQL database
```

## Implementation hiện tại: KHÔNG triển khai

> **Cập nhật 2026-07-23 sau `ADR-005` (Accepted).** Một Cluster là một Multisite network
> trên **một** database, nên `wpdb` chuẩn định tuyến được tất cả. Router không thêm khả
> năng nào, chỉ thêm một drop-in và một bề mặt lỗi.

Trạng thái thật, không tô hồng:

- `LUDICROUSDB_ENABLED` mặc định **`false`** trong `install-node.sh` và trong cả hai file
  `node-config.env.*`. Node mới **không** nhận `db.php` drop-in.
- Cờ được **giữ lại**, không xoá — một cluster nhiều pool trong tương lai sẽ cần bật lại.
  `test-install-node.sh` có một lần chạy `LUDICROUSDB_ENABLED=true` để đảm bảo đường đó
  chưa mục.
- Trước ngày này, LudicrousDB **có** được cài nhưng **chưa từng định tuyến gì**:
  `db-config.php` chỉ có **một** `add_database()` trỏ tới một database duy nhất, không có
  `add_callback`. Nghĩa là việc gỡ nó **không mất khả năng nào đang dùng**.

Tài liệu này vẫn tồn tại vì **interface vẫn còn giá trị**: nếu sau này một Cluster cần
nhiều pool, đây là chỗ mô tả seam đó. Nhưng không được đọc nó như mô tả hệ thống đang
chạy.

## LudicrousDB và bằng chứng lịch sử của HyperDB

LudicrousDB là fork được bảo trì, dùng API `add_database()` tương thích. Nó đã được
kiểm chứng trong Runtime: `db_server_info()` trả `11.8.8-MariaDB`, Action Scheduler OK,
và wp-admin OK.

HyperDB vẫn được ghi lại vì đây là bằng chứng sự cố có thật, không phải implementation
hiện tại: HyperDB không còn được bảo trì và **fatal trên WordPress 6.4+/7.0 + WooCommerce**.
`db.php` require `wp-includes/wp-db.php` đã deprecated, gây `Call to undefined function
wp_kses()` lúc bootstrap sớm; sau đó `$wpdb->dbh` null khiến WooCommerce Action Scheduler
chết khi gọi `db_server_info()`, làm wp-admin trắng. Xoá cảnh báo này sẽ khiến người sau
thử lại đúng failure mode đã mất thời gian điều tra.

## Provisioning boundary

Khi provisioning cần database mới, Workflow + Agent thực hiện theo thứ tự:

```
Workflow + Agent
  ├── DAS quyết định pool/database
  ├── Create database và cấp quyền
  └── Đồng bộ mapping cho Database Router
       │
       ▼
MU Plugin
  ├── wpmu_create_blog()
  ├── Khởi tạo site
  └── Kích hoạt plugin/theme mặc định (Distribution)
```

Agent tạo database và cập nhật mapping trước; MU Plugin/WordPress Core tạo blog và ghi
dữ liệu sau, qua WordPress Core API. Database Router chỉ thực thi kết nối theo mapping.

## Hướng mở rộng

Multi-pool là công việc tương lai của H1: thêm các implementation/configuration cần thiết
cho nhiều pool sau khi có quyết định của DAS. Điều đó không thay đổi interface của Router
hay biến Router thành nơi quản lý migration.
