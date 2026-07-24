# Phase 2 — Tổng kết

**Giai đoạn: 2026-07-22 → 2026-07-23.** Từ "Runtime chưa chốt kiến trúc" tới "Runtime
Freeze + SaaS S1–S3 đã cứng hoá bảo mật".

Phase 2 chia hai nửa: **đóng băng Runtime** (dựa trên đo lường), rồi **cứng hoá SaaS** (dựa
trên audit thực tế của codebase, không phải roadmap giả định).

---

## 1. Runtime — Freeze v1.0

`RUNTIME-FREEZE.md`. Bảy ADR Accepted, 13 spike report, và một **danh sách nợ đo lường**
tường minh để "frozen" không bị đọc thành "đã đo hết".

### Quyết định kiến trúc, và số liệu đứng sau

| Quyết định | Bằng chứng |
|---|---|
| **Multisite, một cluster một database** | ADR-005; Spike #004 đo cả hai topology trên cùng MySQL 8.4 |
| **Không Router (HyperDB/LudicrousDB)** | HyperDB fatal WP 7.0; một database ⇒ `wpdb` đủ |
| **Trần store do CPU/PHP worker, KHÔNG do `table_open_cache`** | Spike #010: 125 store / 6.709 bảng / cache 4.000 → **0 thrash** |
| **Bảng NÓNG = 25, không phải tổng 50** | Spike #002 (19) + #010 (14); sửa công thức, giảm 2,6× |
| **Cache là hệ số nhân năng lực** | Spike #011: PHP 127 req/s vs tĩnh 1.774 (14×); #013: cache HIT 1.606 |
| **Bảo vệ ở vành đai, không plugin per-store** | Spike #009: Wordfence network-active làm mọi request chậm 250× |

### Đảo chiều lớn nhất: trần cache

Spike #008 kết luận cache 15–40%, "phải tách store notice". Spike #012 **gỡ bỏ** kết luận
đó: page cache **bypass** khách giữ giỏ theo cookie, và ba phiên ẩn danh trên `/shop/` khác
**0 dòng** — trang cache được sẵn. SA48 hiện thực đúng hướng đó (cache + cookie bypass +
invalidation), không phải hướng sai của #008.

### Còn nợ trước production (ghi trong Freeze mục 4)

IO thật · phần cứng đích · tỉ lệ lưu lượng mang cookie · khách đăng nhập · nối SA48 vào
`install-node.sh`. Và ba giới hạn cấu trúc **Multisite không làm được**: restore riêng
store, hạn ngạch connection theo store, chuyển store giữa cluster (28 tham chiếu `user_id`).

---

## 2. SaaS — audit thực tế, không dựng lại

`SAAS-PHASE2-GAP.md` phát hiện điều quyết định cả nửa sau: **roadmap S1–S9 viết như
greenfield, nhưng 20 module + 22 bảng đã tồn tại và chạy thật.** Việc là *hoàn thiện + cứng
hoá*, không phải *dựng mới*. Ba tài liệu cũ (`18-SaaS-Plan`) mô tả hệ thống không còn tồn
tại ("chỉ có Mock", hai repo, một dashboard).

### Năm lỗ hổng bảo mật — mỗi cái TÁI HIỆN trước khi sửa, KIỂM SỐNG sau khi sửa

| # | Lỗ hổng | Trước | Sau | Task |
|---|---|---|---|---|
| 1 | `JWT_SECRET` fail-open | token giả → mạo danh **200** | fail-closed, **401** | SA50 |
| 2 | Refresh token không thu hồi | dùng lại 3 lần **200/200/200** | xoay vòng **200/401/401** + logout | SA51 |
| 3 | Login không giới hạn | vô hạn | **429** sau 5 lần | SA52 |
| 4 | **API key vượt authorization** | key `read` đổi gói cước **201** | permission hạt mịn **403** | SA53→55→56 |
| 5 | Quota TOCTOU | 2 create đua → **used 3/2** | advisory lock, **402** | SA57 |

Lỗ hổng #4 là lỗ hổng **kiến trúc**, không phải thiếu tính năng: JWT và API key có hai
luồng phân quyền khác nhau. SA55 hợp nhất thành một catalogue permission, guard hỏi một
câu; SA56 tách org context ra resolver (fail-closed).

### Tính năng đóng khoảng trống audit

- **SA54** — Invitation + team: một tổ chức trước đây chỉ có **một người**, giờ có team
  thật, với ràng buộc "không gỡ owner cuối cùng".
- **SA43** — DAS đổi mô hình sang Cluster Allocation, khớp ADR-005.

### Audit S3 — dừng đúng lúc

`SAAS-S3-BILLING-AUDIT.md` phát hiện billing **chưa thu tiền** (`changeSubscription` chỉ đổi
bản ghi DB). Chỉ tạo task cho quota (SA57 — kỹ thuật thuần); **không** tạo task payment
provider vì nó cần quyết định sản phẩm trước. Không dựng cái chưa quyết.

---

## 3. Bài học phương pháp — thứ đáng giữ hơn cả code

### Bộ test không thay được kiểm sống

Bốn bug nghiêm trọng nhất **chỉ lộ khi chạy thật**, test đều xanh — vì test dùng fake DB
hoặc khởi tạo bằng tay:

| Bug | Test không bắt vì |
|---|---|
| `P2021` — migration tạo mà chưa áp (SA51, SA54) | test fake database |
| `P2002` — thiếu `jti`, hai token cùng giây trùng hash (SA51) | test không tạo token thật |
| DI error — resolver không export, API không boot (SA56) | test khởi tạo guard bằng tay |
| Race TOCTOU (SA57) | `Promise.all` không tái hiện; cần interleave production |

### Kiểm đột biến bắt thứ test xanh bỏ sót — 5 lần

`revokedAt:null` chống đua (SA51) · đường rẽ nhanh API key (SA53) · `admin.apikey.create`
(SA55) · last-owner guard (SA54) · advisory lock (SA57). Mỗi lần test đều "xanh nhờ may".

### Đo lại lật ngược chính mình

Spike #012 gỡ trần cache của #008. Và ba lỗi phương pháp trong đúng buổi đo cache, mỗi cái
cho kết quả **trông hợp lý**: đo trên store hỏng (blog 1 mất template), dùng sản phẩm sai
store (giỏ rỗng → hai khách cùng ẩn danh), OPcache `revalidate_freq=60` che bản sửa (xuất
hiện **3 lần**: #012, SA51, #014).

### Tái hiện trước khi sửa

Audit ghi rõ mọi kết luận đọc-code là "chưa tái hiện". SA53 và SA57 đều tái hiện thành công
trước khi sửa. SA57 suýt bỏ sót — lần thử đầu "không thấy race" vì `Promise.all` bị Prisma
serialize; chỉ interleave đúng production mới lộ `used 3/2`.

### Codex + kiểm độc lập

Codex làm phần lớn code SaaS, nhưng **mọi task đều được kiểm sống + đột biến độc lập** ở
main agent. Codex báo trung thực khi bế tắc (SA57: sandbox chặn Postgres → dừng, không sửa
nửa vời; SA54: báo migration chưa áp). Phân công theo giới hạn sandbox: codex sửa repo, tôi
làm mọi thứ chạm devenv/Postgres.

---

## 4. Trạng thái cuối

```
ai-kit:  88 done · 0 todo · 2 retired
verify:  build 5/5 · test (39 api + agent + plugin-set + installer) · typecheck  — tất cả xanh
Runtime: FROZEN v1.0
SaaS:    S1 (auth) · S2 (org/RBAC) · S3 (billing quota) — cứng hoá bảo mật xong
```

### Việc mở, không chặn

- **SA48 nối installer** — Caddy `@cached` + `OOIO_STATIC_CACHE_ROOT` vào `install-node.sh`
- **Payment provider** (billing 2.2) — cần quyết định sản phẩm
- **Invoice lifecycle + Credit** (billing 2.3, roadmap S3)
- **UI Phase 1b** — email service (forgot/reset/verify) chặn 3 màn hình auth
- **Nợ đo lường Runtime** — mục 1, phần "còn nợ"

### Dọn môi trường (không chặn)

`~/ooio-devenv/cache_root` sót · migration `auth_hardening` + `invitation_membership` áp thủ
công (CI `migrate deploy` sẽ tự khớp) · `apps/api/.env` có JWT_SECRET mạnh (bắt buộc) ·
`~/ooio-devenv/Caddyfile` ở bản không cache.

---

## 5. Nguyên tắc cho Phase 3

Rút từ những gì hiệu quả:

1. **Audit trước, code sau** — chạy thử cái đã có trước khi kết luận thiếu.
2. **Tái hiện trước khi sửa** — kết luận đọc-code chưa phải sự thật.
3. **Kiểm sống + đột biến** — test xanh không đủ; migration phải áp, guard phải boot.
4. **Không dựng cái chưa quyết** — payment provider chờ quyết định sản phẩm.
5. **Không dựng UI cho backend chưa cưỡng chế** — scopes từng là trường chết; UI sẽ nói dối.
6. **Reload php-fpm sau mỗi sửa PHP** — OPcache che thay đổi 60 giây.
