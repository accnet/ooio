# Workflow Engine

## Nguyên tắc: Operation, không phải Job đơn giản

Mọi thao tác dài (tạo store, backup, restore, SSL, deploy plugin/theme, clone, xoá
store) đều được mô hình hoá thành một **Operation/Workflow** gồm nhiều **Step**, chạy
qua Redis + BullMQ, có:

```
Operation
├── ID
├── Steps (tuần tự)
├── Progress
├── Status (pending/running/success/failed)
├── Retry
├── Rollback
├── Logs
├── Cancel
└── Audit
```

Không có request HTTP nào chạy đồng bộ hàng chục giây — request chỉ tạo Operation,
worker/Agent xử lý bất đồng bộ, client theo dõi qua polling hoặc realtime update.

## Job Flow (Scheduler → Agent, mô hình pull)

```
Scheduler → BullMQ → Job Table (pending) → Agent poll → Execute → Complete
```

Scheduler **không gọi Agent trực tiếp** — nó chỉ tạo Job ở trạng thái pending; Agent tự
lấy job về thực thi (job polling, không push). Điều này giữ nguyên tắc Agent luôn
outbound, Control Plane không cần biết địa chỉ mạng của từng Agent.

## Ví dụ Workflow: Create Site

```
Check Plan
  ↓
Allocate Cluster (Scheduler)
  ↓
Allocate Database (HyperDB mapping)
  ↓
Create Site (Agent → MU Plugin → wpmu_create_blog)
  ↓
Activate Theme
  ↓
Activate Plugins
  ↓
Create Admin User
  ↓
Add Domain
  ↓
Issue SSL
  ↓
Verify
  ↓
Done
```

Nếu một bước lỗi (ví dụ activate plugin thất bại), Workflow tự **retry** theo chính
sách đã định nghĩa; nếu vẫn thất bại, có thể **rollback** (ví dụ xoá blog vừa tạo,
giải phóng database) thay vì để hệ thống ở trạng thái nửa vời. Không rollback thủ công.

## Event Bus (bổ sung song song Workflow)

Các module không gọi trực tiếp nhau mà subscribe event phát ra sau khi Operation hoàn
tất:

```
StoreCreated → Analytics, Billing, Notification, Audit, AI (đều độc lập subscribe)
PlanChanged  → Plugin Service (disable plugin không còn trong plan)
```

## Audit

Mọi Operation, dù thành công hay thất bại, đều ghi Audit Log: ai thực hiện, khi nào,
Operation nào, kết quả gì — phục vụ truy vết vận hành và compliance.
