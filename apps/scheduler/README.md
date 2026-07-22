# Scheduler — KHÔNG phải một app

**Thư mục này rỗng và sẽ không được lấp đầy.** Giữ lại chỉ để trả lời câu hỏi
"scheduler đâu?" cho người đọc cây thư mục.

Placement là **một module bên trong Control Plane**, không phải deployable app:

```
apps/api/src/scheduler/     ← code thật nằm ở đây
```

Lý do: scheduler chọn cluster/node, còn `apps/api/src/das/` (Database Allocation
Service) chọn pool — cả hai đọc cùng transaction với việc tạo store. Tách ra thành
process riêng sẽ biến một transaction thành một lời gọi mạng, và mất tính nguyên tử
mà `ADR-006` yêu cầu.

Xem `Blueprint/18-SaaS-Implementation-Plan.md` mục 9 (Scheduler) và `ADR-006` mục 2.
