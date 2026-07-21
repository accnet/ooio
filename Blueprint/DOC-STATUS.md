# Trạng thái tài liệu (Doc Status)

Toàn bộ Blueprint được tổng hợp từ `idea/` (chuỗi hội thoại thiết kế), với `plan-12.md`
là nguồn thẩm quyền chính. Trong quá trình biên tập, người viết tài liệu phải điền vào
chỗ nguồn nói ngắn gọn hoặc bỏ ngỏ — những chỗ điền thêm đó **không có cùng mức độ chắc
chắn** với phần nguồn đã thống nhất. Để người đọc không nhầm đề xuất thành quyết định,
mọi nội dung trong Blueprint được gắn một trong ba mức trạng thái sau.

## Ba mức trạng thái

| Trạng thái | Ý nghĩa | Ví dụ |
|---|---|---|
| **Accepted** | Đã thống nhất trong `idea/` (xuất hiện nhất quán qua nhiều bản, đặc biệt được `plan-12.md`/`plan-11.md` xác nhận) và là cơ sở triển khai | Runtime-first (ADR-001), mô hình 3 Plane, HyperDB chỉ routing (không tạo DB/không replication), Không SSH/Không ghi thẳng DB WordPress (ADR-003, phần nguyên tắc), Distribution là artifact versioned (ADR-004, phần đóng gói+version), Agent native/systemd (ADR-002), Workflow/Operation có retry-rollback-audit |
| **Proposed** | Đề xuất kiến trúc hợp lý của người viết tài liệu để hoàn thiện chi tiết còn thiếu, **chưa được nguồn xác nhận là quyết định cuối** — có thể đúng, nhưng cần người có thẩm quyền duyệt lại trước khi coi là chốt | REST vs Unix Socket giữa Agent↔MU Plugin (nghiêng REST cho giai đoạn đầu), CQRS/Command Bus cụ thể trong NestJS, gRPC thay REST sau này, Canary/staged rollout cho Distribution, Shared Runtime storage (symlink dùng chung) |
| **Open Question** | Nguồn `idea/` chưa nói tới hoặc chỉ nêu tên chưa bàn sâu, cần thảo luận/benchmark thêm trước khi quyết định | Transport cuối cùng Agent↔MU Plugin (REST hay UDS), cơ chế lưu trữ Distribution ở cấp filesystem (clone-per-store vs shared), ranh giới bounded context Marketplace vs Commerce Platform, Multisite vs Isolated Single-sites (ADR-005 — Open với Preferred Direction: Multisite, chỉ đóng khi đạt Exit Criteria) |

## Quy ước áp dụng trong Blueprint

- **Mỗi ADR** (`Blueprint/ADR/*.md`) bắt buộc có trường `Status` ngay dưới heading, nhận
  một trong bốn giá trị: `Accepted` / `Proposed` / `Open` / `Superseded`. Nếu một ADR có
  phần nội dung hỗn hợp (vừa có phần đã chốt vừa có phần chưa), ADR đó phải tách rõ trong
  mục "Quyết định" thành hai khối `Accepted:` và `Open (chưa chốt):`, kèm mục
  **"Alternatives Considered"** liệt kê các phương án đang cân nhắc mà không kết luận.
- **Các file mô tả kiến trúc** (00 → 14, không phải ADR) mặc định trình bày nội dung đã
  chốt. Bất kỳ đoạn nào là suy luận/đề xuất riêng của người viết tài liệu (không do nguồn
  `idea/` khẳng định trực tiếp) phải gắn nhãn inline ngay tại chỗ:
  - `(Proposed — xem DOC-STATUS.md)` cho đề xuất hợp lý nhưng chưa chốt.
  - `(Open — xem DOC-STATUS.md)` cho câu hỏi còn bỏ ngỏ, cần benchmark/thảo luận.
- Nhãn `Superseded` dùng khi một ADR/quyết định trước đó bị một ADR mới thay thế —
  hiện chưa có trường hợp nào trong Blueprint.
- Một ADR `Open` có thể khai báo **Preferred Direction** (ví dụ ADR-005): đội phát
  triển được phép triển khai theo hướng ưu tiên đó ngay, nhưng ADR chỉ chuyển sang
  `Accepted` khi hoàn thành **Exit Criteria** ghi trong chính ADR (benchmark/test có
  báo cáo số liệu làm Evidence). Cách này cho phép tiến độ không bị chặn mà vẫn giữ
  kỷ luật: quyết định nền tảng chỉ được "đóng" bằng bằng chứng, không bằng niềm tin.

## Vì sao cần phân loại này

Tài liệu `idea/` là một chuỗi hội thoại brainstorm, không phải spec đã được ký duyệt.
Khi tổng hợp thành Blueprint, ranh giới giữa "nguồn đã nói" và "người viết tài liệu suy
luận thêm để lấp khoảng trống" rất dễ bị xoá nhoà nếu trình bày với cùng một giọng văn
chắc chắn. Việc phân loại 3 mức giúp:

- Người đọc Blueprint 2 năm sau không hiểu nhầm một đề xuất là quyết định đã được team
  duyệt.
- Khi triển khai thực tế và phát hiện một "Proposed" không khả thi, có thể thay đổi mà
  không phá vỡ cảm giác "đã có ADR nói vậy rồi".
- Các "Open Question" được liệt kê tường minh thay vì âm thầm bị coi là đã giải quyết —
  tránh nợ kỹ thuật ẩn.
