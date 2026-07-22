# Môi trường Runtime dựng lại được (Docker)

```bash
docker compose -f infra/docker/compose.yaml up -d
docker compose -f infra/docker/compose.yaml down -v    # -v xoá sạch dữ liệu
```

## Docker ở đây thay được VPS tới đâu

Đây là câu hỏi quyết định giá trị của thư mục này, nên trả lời thẳng.

| Hạng mục | Docker ở máy này | Vì sao |
|---|---|---|
| Bức tường `table_open_cache` / `open_files_limit` | **Được** | giới hạn cấu trúc của MariaDB, không phụ thuộc phần cứng |
| Restore-per-store (Exit Criteria ADR-005) | **Được** | đúng/sai, không phải nhanh/chậm |
| Plugin Compatibility Matrix | **Được** | tương thích, không phải hiệu năng |
| Isolation benchmark (noisy neighbor) | **Được, thậm chí tốt hơn VPS** | cgroups ghim CPU/RAM chính xác nên lặp lại được; thứ cần đo là **tác động tương đối** |
| Latency/IOPS để đặt trọng số `PLACEMENT_*` | **Không** | |
| Hành vi ở quy mô trên phần cứng đích | **Không** | |

Hai dòng cuối không phải vì Docker yếu. Câu hỏi thật không phải *"Docker hay VPS"* mà là
*"máy này hay phần cứng khác"*. Container chạy trên **cùng đĩa, cùng CPU, cùng băng thông
bộ nhớ** với mọi thứ khác. Docker cho **tính lặp lại**, không cho **sự thật phần cứng mới**.

> **2 trong 4 Exit Criteria của `ADR-005` không cần VPS chút nào** — Restore Test và Plugin
> Compatibility Matrix làm được ngay ở đây.

## Hai quyết định cấu hình có chủ đích

**`table_open_cache` để mặc định 2000.** Spike #002 đo được trần store mỗi node ≈
`table_open_cache ÷ số bảng nóng mỗi store`. Nâng sẵn ở đây sẽ **che mất chính bức tường mà
spike sinh ra để tìm**. Muốn thử node đã tinh chỉnh thì ghi đè lúc chạy:

```bash
MARIADB_TABLE_OPEN_CACHE=12000 MARIADB_OPEN_FILES_LIMIT=65536 \
  docker compose -f infra/docker/compose.yaml up -d
```

**`nofile` đặt 1.048.576.** Nâng `table_open_cache` mà không nâng giới hạn file descriptor
của tiến trình thì chỉ dời bức tường từ MariaDB sang **hệ điều hành** — đo ra giới hạn của
OS chứ không phải của database.

## Vì sao php-fpm + Caddy chứ không phải PHP built-in server

Máy chủ PHP tích hợp **không phục vụ được subdirectory multisite** — mọi đường dẫn subsite
trả 404. WordPress tự viết lại `/<slug>/` về `index.php`, và built-in server không làm được
điều đó. Đây là lỗi đã tốn thời gian ở môi trường native trước khi tìm ra nguyên nhân.

## Cổng (tách khỏi môi trường native)

| Dịch vụ | Docker | Native devenv |
|---|---|---|
| HTTP | 8090 | 8088 |
| MariaDB | 3310 | 3307 |
| Redis | 6380 | 6379 |

Tách cổng để hai môi trường tồn tại song song. **Nhưng đừng chạy hai bài đo cùng lúc** —
chúng dùng chung CPU và đĩa, số liệu sẽ nhiễu lẫn nhau.
