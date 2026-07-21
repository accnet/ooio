# HyperDB

## Vai trò duy nhất: Routing

HyperDB **chỉ định tuyến** truy vấn WordPress tới đúng database vật lý. Không làm gì
khác:

```
Store
  │
  ▼
HyperDB
  │
  ▼
Database Pool
  │
  ▼
Database cụ thể
```

Không tạo database. Không quản lý replication. Không tự sharding. Đây là những việc
do Go Agent (tạo DB khi provision) và Scheduler (chọn database khi phân bổ store) đảm
nhiệm — HyperDB chỉ là lớp routing thuần tuý bên trong WordPress.

## Mô hình nhiều Site / một Database

Nguyên tắc bắt buộc: **không phải 1 store = 1 database**. Một database chứa nhiều
store theo dải:

```
MySQL-A → Database A → Store 1–300
MySQL-B → Database B → Store 301–600
MySQL-C → Database C → Store 601–900
```

Khi một database đầy (theo ngưỡng vận hành, ví dụ ~300–500 store), Agent tạo database
mới và HyperDB Mapping được cập nhật. Ngưỡng này là *ngưỡng vận hành*, không phải giới
hạn kỹ thuật cứng.

## Database Pool

Mỗi Cluster sở hữu một Database Pool riêng gồm nhiều MySQL instance (MySQL-A, B, C...).
Go Agent chịu trách nhiệm `CREATE DATABASE`, cấp quyền user DB; MU Plugin/WordPress
Core chịu trách nhiệm ghi dữ liệu thực tế (không bao giờ Agent tự `INSERT`/`UPDATE`
trực tiếp vào bảng WordPress — xem ADR-003).

## Thứ tự tạo Site liên quan tới Database

```
Go Agent
  ├── Create database
  ├── Cấp quyền DB user
  └── Cập nhật HyperDB Mapping/Registry
       │
       ▼
MU Plugin
  ├── wpmu_create_blog()
  ├── Khởi tạo site (dùng đúng database vừa tạo)
  └── Kích hoạt plugin/theme mặc định (Distribution)
```

Agent luôn tạo database trước; MU Plugin/WordPress Core tạo blog và ghi bảng dữ liệu
sau, thông qua HyperDB đã được cập nhật mapping.

## Scheduler chọn Database

Khi tạo store mới, Scheduler không chọn ngẫu nhiên mà tính điểm theo capacity của từng
database/cluster (CPU, RAM, disk, PHP workers, số site hiện có, region, plan, cost) —
xem chi tiết cách tính điểm ở `08-SaaS.md` và `10-Provisioning.md`.
