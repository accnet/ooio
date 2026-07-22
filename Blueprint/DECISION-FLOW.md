# Architecture Decision Flow — một quyết định đi từ đâu đến đâu

Repo này có nhiều loại tài liệu (AP, ADR, Blueprint 00–20, DOC-STATUS, VERSION) và câu
hỏi thường gặp là *"thứ này viết ở đâu?"*. Tài liệu này trả lời đúng câu đó.

## Dòng chảy

```
Yêu cầu / Ràng buộc thực tế
        │
        ▼
   ┌─────────┐   Nguyên lý LUÔN ĐÚNG, không bị superseded
   │   AP    │   "Không JOIN vượt store"  ·  "Platform sở hữu identity"
   └─────────┘
        │  ràng buộc
        ▼
   ┌─────────┐   Quyết định TẠI MỘT THỜI ĐIỂM, có thể bị superseded
   │   ADR   │   "database-per-store"  ·  "Agent native, không Docker"
   └─────────┘
        │  định hình
        ▼
   ┌─────────┐   Bounded context, ranh giới, tên gọi
   │   DDD   │   Blueprint/03-DDD.md
   └─────────┘
        │  chia thành
        ▼
   ┌─────────┐   Module cụ thể trong một app
   │ Module  │   apps/api/src/das/  ·  apps/api/src/events/
   └─────────┘
        │  hiện thực bằng
        ▼
   ┌─────────┐   Code + test + bằng chứng chạy thật
   │  Impl   │
   └─────────┘
        │
        └──── nếu thực tế mâu thuẫn ──► quay lại ADR (KHÔNG lặng lẽ sửa code)
```

**Mũi tên quay ngược là phần quan trọng nhất.** Khi hiện thực va vào sự thật khác với
giả định của ADR, đường đi hợp lệ là *mở lại ADR*, không phải viết code lách qua rồi để
tài liệu nói một đằng, hệ thống chạy một nẻo.

## AP hay ADR?

Đây là chỗ hay nhầm nhất.

| | AP (Architecture Principle) | ADR (Decision Record) |
|---|---|---|
| Bản chất | Ràng buộc **luôn đúng** | Lựa chọn **tại một thời điểm** |
| Vòng đời | Không superseded; muốn bỏ = đổi bản chất nền tảng | Có thể `Superseded` bằng ADR mới |
| Câu hỏi kiểm tra | "Nếu vi phạm, hệ thống có còn đúng về bản chất không?" | "Nếu chọn khác, hệ thống vẫn đúng nhưng đánh đổi khác?" |
| Ví dụ | `AP-001` không JOIN vượt store | `ADR-005` Multisite hay Isolated |

`AP-001` là AP vì cross-store JOIN **không thể đúng** khi store nằm khác server — đó là
giới hạn của MySQL, không phải lựa chọn. `ADR-005` là ADR vì cả Multisite lẫn Isolated
đều chạy được; ta chọn dựa trên đánh đổi và **số liệu**.

## Ba trạng thái của một ADR

Xem `DOC-STATUS.md`. Điều cần nhớ:

- **`Open (Preferred Direction: X)`** không phải là "đã chốt X". Nó nghĩa là *đang làm
  theo X, và đây là bằng chứng cần có để chốt*. `ADR-005` đang ở trạng thái này.
- Một ADR nền tảng **chỉ được chuyển sang `Accepted` bằng số liệu**, không bằng kinh
  nghiệm hay sự tự tin. Mỗi ADR như vậy phải có mục **Exit Criteria** liệt kê báo cáo
  cần có.

## Khi nào phải tăng version Blueprint

Theo `VERSION.md`:

| Thay đổi | Xử lý |
|---|---|
| Đụng mô hình 3-plane, một ADR `Accepted`, hoặc phá vỡ API Contract | **ADR mới + tăng version** |
| Thêm endpoint/module không phá vỡ gì | Cập nhật tại chỗ |
| Sửa số liệu sai, không đổi quyết định nào | **Đính chính**, ghi vào `VERSION.md`, không tăng version |

Dòng cuối có tiền lệ thật: ngày 2026-07-21, ước lượng "~12 bảng/store" bị phát hiện chỉ
đếm WordPress core (thật: **48 bảng**). Không quyết định nào thay đổi, nên đây là đính
chính — nhưng nó vẫn phải để lại dấu vết, vì mọi phép ngoại suy quy mô đều dựa trên nó.

## Thứ tự đọc khi mới vào

```
AP-002 (ai sở hữu dữ liệu)
  → AP-001 (hệ quả: không JOIN vượt store)
    → ADR-006 (database platform)
      → ADR-007 (identity)
        → 18/19/20 (kế hoạch hiện thực từng plane)
```

Đọc `AP` trước `ADR`. Đọc `ADR` trước code. Bất kỳ thay đổi nào chạm tới database,
identity, event, analytics, billing, migration, backup hay failover đều phải nhất quán
với `AP-002` trước đã.

## Nơi ở của từng loại nội dung

| Nội dung | Thuộc về |
|---|---|
| Nguyên lý luôn đúng | `Blueprint/AP/` |
| Quyết định + đánh đổi + Exit Criteria | `Blueprint/ADR/` |
| Tầm nhìn, phạm vi, lộ trình | `Blueprint/00–17` |
| Kế hoạch hiện thực từng plane | `Blueprint/18` (Control) · `19` (Runtime) · `20` (Platform Services) |
| Contract giữa các plane | `docs/api/*.openapi.yaml` — **nguồn sự thật**, sinh SDK |
| Trạng thái Accepted/Proposed/Open | `Blueprint/DOC-STATUS.md` |
| Lịch sử version + đính chính | `Blueprint/VERSION.md` |

Không có tầng tài liệu "Architecture" riêng: `18/19/20` **chính là** technical design.
Thêm một tầng nữa chỉ tạo ra nội dung chồng lấn không ai sở hữu, rồi phân kỳ.
