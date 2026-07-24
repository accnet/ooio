# S3 Billing — rà soát độ phủ

**Ngày: 2026-07-23.** Rà bằng đọc code + kiểm sống trên API chạy thật (`:3100`). Chỗ nào
kiểm được bằng chạy thì ghi mã HTTP; chỗ nào không (thiếu cluster đăng ký) thì ghi rõ là
**đọc code, chưa tái hiện**.

---

## 1. Đã có

| | Bằng chứng |
|---|---|
| Bảng `plans` · `subscriptions` · `invoices` | `schema.prisma` |
| `GET /plans` · `GET/POST /orgs/:id/subscription` · `GET /orgs/:id/usage` | `billing.controller.ts` |
| Phân quyền đúng SA55 | `@RequirePermission('billing.manage')` cho đổi gói, `'billing.read'` cho đọc |
| Đổi gói: huỷ sub cũ, tạo sub mới, sinh invoice `draft` | `billing.service.ts:43` |
| Quota store theo gói | `quota.service.ts`, chặn ở `stores.service.ts:72` |
| Seed gói mặc định | `plans.seed.ts` — gói `free` limit 1 store (kiểm sống: `GET /usage` → `plan: free, limit: 1`) |

Phân quyền billing đã **thừa hưởng SA55** đúng — kiểm sống trong audit S2: API key
`billing.read` đọc được usage nhưng không đổi được gói.

---

## 2. Vấn đề

### 🟠 2.1 Quota check là TOCTOU — kiểm ngoài transaction

```
stores.service.ts:72   await this.quota.assertStoreCreationAllowed(organizationId);  // đọc count
stores.service.ts:73   const placement = await this.scheduler.placeStore();
stores.service.ts:74   const store = await this.prisma.$transaction(...)              // tạo store
```

`assertStoreCreationAllowed` đọc `store.count()` **ngoài** transaction tạo store, và count
**không có khoá**. Hai request đồng thời đều thấy `used < limit`, cả hai qua cửa, cả hai
tạo → **vượt quota**.

Cùng hình thái với lỗi outbox SA6 đã sửa: kiểm và ghi tách rời thì có cửa sổ đua.

⚠️ **Chưa tái hiện qua HTTP.** Môi trường API-only này **không có cluster đăng ký**, nên
`scheduler.placeStore()` trả **409** trước khi chạm quota — store không tạo được vì lý do
khác. Kết luận này dựa trên **đọc code**, giống audit S2 mục 2.1 lúc đầu. Phải tái hiện
trên môi trường có cluster (hoặc bằng test tích hợp) trước khi coi là đã xác nhận.

### 🔴 2.2 Không có provider thanh toán — "đổi gói" không thu tiền

```
grep -n "stripe|payment|charge|webhook" billing.service.ts  →  rỗng
```

`changeSubscription` chỉ **đổi bản ghi DB**: huỷ sub cũ, tạo sub mới `status: 'active'`,
sinh invoice `status: 'draft'`. Không gọi provider nào.

Schema có `provider_customer_id` và `provider_subscription_id` (`subscriptions`) — **không
code nào ghi vào chúng**. Đây là chỗ dành sẵn cho Stripe, chưa nối.

Hệ quả: **khách "nâng lên Pro" là được Pro ngay, không trả đồng nào.** Đây không phải bug
logic — đây là **billing chưa có billing**. Với một SaaS, đó là hạng mục chặn doanh thu,
không phải tính năng nice-to-have.

### 🟠 2.3 Invoice không có vòng đời

Invoice tạo ở `status: 'draft'` và **ở nguyên đó**. Không có:
- phát hành (`draft → open`)
- đánh dấu đã trả (`open → paid`)
- endpoint liệt kê invoice cho khách
- webhook cập nhật từ provider

`GET /orgs/:id/invoices` **không tồn tại** — khách không xem được hoá đơn của mình.

---

## 3. So với roadmap S3

| Roadmap | Trạng thái |
|---|---|
| Plan | ✅ |
| Subscription | ⚠️ đổi được bản ghi, **không thu tiền** (2.2) |
| **Credit** | ❌ không có bảng, không có model, không có endpoint |
| Invoice | ⚠️ tạo `draft`, **không vòng đời, không xem được** (2.3) |
| Usage | ⚠️ **chỉ đếm store**; roadmap có Storage/Bandwidth/AI/Worker/Backup — **không đo cái nào** |

`GET /usage` trả đúng một chiều: `stores.used / stores.limit`. Năm loại usage còn lại trong
roadmap (storage, bandwidth, AI, worker, backup) **chưa có gì** — cả đo lẫn lưu.

---

## 4. Thứ tự đề nghị

| Ưu tiên | Việc | Vì sao |
|---|---|---|
| **1** | Sửa TOCTOU quota (2.1) — kiểm trong transaction, hoặc unique/count có khoá | Bug thật, rẻ, nhưng **tái hiện trước** trên môi trường có cluster |
| **2** | Nối provider thanh toán (2.2) | Không có nó thì không có doanh thu — chặn go-live thương mại |
| **3** | Invoice lifecycle + `GET /invoices` (2.3) | Điều kiện pháp lý/kế toán cơ bản |
| **4** | Credit + usage metering đa chiều | Tính năng, làm khi có nhu cầu định giá theo dùng |

Việc **1** là kỹ thuật thuần, làm được ngay. Việc **2** cần quyết định sản phẩm (provider
nào, mô hình giá) trước khi code — **không phải việc giao codex ngay**.

---

## 5. Giới hạn của lần rà soát này

- **Quota race (2.1) chưa tái hiện** — môi trường thiếu cluster nên store creation dừng ở
  409 trước khi chạm quota. Đây là điểm phải chạy trên môi trường đầy đủ trước khi sửa.
- **Chưa kiểm** luồng đổi gói end-to-end (cùng lý do: không tạo được store để chạm limit).
- **Chưa rà** `plans.seed.ts` xem các gói và limit có khớp `DEPLOYMENT-PLAN` tier không.
- Kiểm sống xác nhận: `GET /usage` trả đúng plan/limit; phân quyền billing đúng SA55.
