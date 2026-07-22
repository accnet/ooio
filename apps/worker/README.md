# Worker — đã lên kế hoạch, CHƯA tồn tại

**Thư mục này rỗng.** Đây là app có thật trong kế hoạch
(`Blueprint/18-SaaS-Implementation-Plan.md` mục 20), khác với `apps/scheduler/` vốn
sẽ không bao giờ thành app.

## Hiện tại các BullMQ processor chạy Ở ĐÂU

Trong chính tiến trình API:

| Processor | Vị trí hiện tại |
|---|---|
| Event outbox dispatcher | `apps/api/src/events/events.dispatcher.ts` |
| Operation dispatch | `apps/api/src/workflow/` |

## Khi nào nên tách ra

Chưa tách vì cùng một tiến trình thì đơn giản hơn và hiện chưa đau. Tách khi gặp một
trong các dấu hiệu sau:

- Job nền làm chậm request đồng bộ (đo được, không phải phỏng đoán).
- Cần scale worker độc lập với API, hoặc cần restart worker mà không rớt API.
- Cần tách quyền: worker chạm secret mà API không cần.

Khi tách, phần cần chuyển là các `@Processor`, còn `EventService.record` **phải ở lại
trong API** — nó ghi event trong cùng transaction với thay đổi trạng thái, đó là điều
kiện của transactional outbox (xem `apps/api/src/events/events.service.ts`).
