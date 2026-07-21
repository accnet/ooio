# Execution Plan — Thứ tự thi công thực tế

> **Trạng thái: Proposed (xem DOC-STATUS.md).** File này là phân tích thi công dựa trên
> roadmap 11 phase đã chốt (`13-Roadmap.md`, Accepted) và các ADR, KHÔNG thay thế
> roadmap đó. Roadmap trả lời "làm gì, theo thứ tự nào"; file này trả lời "bắt tay vào
> đâu, cái gì chặn cái gì, đo bằng cổng nào". Các ước lượng thời gian và đề xuất gối
> đầu/hoãn phase là suy luận của người viết tài liệu, cần đội thực thi hiệu chỉnh.

## 1. Đường găng (Critical Path)

11 phase được trình bày tuần tự, nhưng chuỗi việc mà chậm một mắt là chậm cả dự án chỉ
gồm:

```
Distribution build được
  → 1 site chạy
  → 500–1000 site chạy (stress)
  → API Contract đóng băng
  → SaaS gọi vào contract đã kiểm chứng
```

Mọi thứ ngoài chuỗi này (Billing, Dashboard, Marketplace, Multi-cluster) là **nhánh
phụ** — làm song song hoặc hoãn được. Hệ quả nhân sự: dồn người mạnh nhất vào
Runtime/Agent, không phải NestJS.

## 2. Ba Gate quyết định (đơn vị quản lý thật, thay cho đếm 11 phase)

| Gate | Vị trí | Câu hỏi phải trả lời | Bằng chứng |
|---|---|---|---|
| **Gate 1 — Multisite scale** | Cuối spike Phase 1 (kéo lên tuần 1) | Tạo 500–1000 site có gãy không? Provisioning bao lâu? `wp_blogs`/HyperDB nghẽn ở đâu? | Spike Report #001 (ADR-005) |
| **Gate 2 — Runtime tự vận hành** | Cuối Phase 4 | Tạo/xoá/backup/**restore**/SSL một store hoàn chỉnh bằng Postman gọi thẳng Agent, không cần SaaS? | Provisioning demo + Restore Test Report |
| **Gate 3 — API Contract freeze** | Sau Phase 5 (Stress Test) | Contract phản ánh đúng cái Runtime *thật sự* làm được sau khi chịu tải? | OpenAPI v1 + Stress Test Report |

Gate 1 rẻ nhất và không thể đảo — nếu đỏ, ADR-005 xoay sang Isolated, tiết kiệm ~3
tháng đi nhầm. Gate 3 đắt nhất khi sai — một khi NestJS code theo contract, đổi contract
là đổi cả hai phía, nên nó phải đứng **sau** stress test.

## 3. Ba điều chỉnh thứ tự thi công so với roadmap

Roadmap là thứ tự *trình bày*; thứ tự *thi công* nên khác ở ba điểm (Proposed):

1. **Spike Multisite chạy trong tuần 1, song song Phase 0.** Thiết kế Domain Model/ERD
   và script tạo 1000 site rỗng là hai việc độc lập — Gate 1 nên xanh/đỏ trước khi vẽ
   xong ERD.
2. **Restore-per-store làm ở Phase 4, không để tới Production (Phase 10).** Đây là rủi
   ro lớn nhất của mô hình database chung (ADR-005) và nó *định hình* API Contract: nếu
   restore chọn lọc không khả thi trên DB chung, cách backup + mô hình DB phải đổi —
   không thể phát hiện sau khi contract đã đóng băng.
3. **MU Plugin (Phase 2) và Go Agent (Phase 3) gối đầu, không tuần tự.** Chúng gắn nhau
   qua đúng một mặt cắt REST localhost. Định nghĩa mặt cắt (`/platform/v1/` OpenAPI)
   trước, hai nhánh làm song song, ráp qua contract giả lập. Đây cũng là nơi chốt câu
   hỏi mở REST-vs-UDS (ADR-003) bằng đo đạc thật.

## 4. Bước đi thực tế nếu bắt đầu tuần này (theo phụ thuộc, không theo số phase)

```
1. git init + skeleton monorepo (runtime/ platform/ apps/agent infra/)   ~0.5 ngày
2. Script spike Multisite — WP-CLI tạo N site trên 1 VPS, đo → Gate 1
3. Distribution builder tối thiểu — bundle WP+Woo+theme+plugin+manifest.json (ADR-004)
4. OpenAPI nháp cho 2 mặt cắt: Agent↔SaaS và Agent↔MU Plugin (deliverable Phase 0 đang thiếu)
5. MU Plugin → Go Agent → Provisioning end-to-end → Gate 2
```

Bước 2, 3, 4 độc lập nhau, chạy song song được. Bước 5 phụ thuộc cả ba.

## 5. Ước lượng & rủi ro tiến độ

- **7–9 tháng (plan-11) là lạc quan.** Đề xuất hoạch định **10–14 tháng** tới Production
  thật (hệ số 1.4–1.6×) *(Proposed — kinh nghiệm chung, không có trong nguồn)*.
- **Hai chỗ dễ trượt nhất, bị đánh giá thấp:** Stress Test Phase 5 (mỗi bottleneck tìm
  ra là một vòng sửa-đo lại) và backup/restore ở quy mô (khó thật, không thành phase
  riêng).
- **Hai chỗ cắt được để bù:** Multi-cluster Phase 6 giai đoạn đầu chỉ cần file config
  thay registry đầy đủ; Workflow Engine Phase 8 chỉ cần 3 operation chạy chắc
  (CreateStore/Backup/IssueSSL) trước khi trừu tượng hoá tổng quát.

## 6. Bất biến phải giữ suốt quá trình (checklist review mọi PR)

Bắt nguồn từ các ADR Accepted — vi phạm là nợ kiến trúc:

- Không code nào phía SaaS/Agent rò rỉ giả định Multisite ra ngoài `WordPress Adapter`
  (ADR-005) — để đổi topology mà không đụng Control Plane.
- Control Plane không SSH, không gọi MySQL/WordPress trực tiếp; mọi thứ qua Agent
  (ADR-003).
- Mọi thao tác dài là Operation có retry/rollback/audit, không request đồng bộ
  (`09-Workflow.md`).
- Agent không ghi thẳng DB WordPress; mọi thay đổi dữ liệu qua MU Plugin → Core API
  (ADR-003).
