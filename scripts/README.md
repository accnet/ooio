# Scripts

Scripts phục vụ kiểm chứng scale và vận hành.

## Spike Test Harness (`spike/`)

Non-production harness cho ADR-005 (Gate 1) và ADR-006/AP-002. Shell-only, không tự
cài môi trường — yêu cầu WordPress Multisite + MySQL/MariaDB đang chạy.

| Script | Mục đích |
|---|---|
| `create-sites.sh` | Tạo N WordPress Multisite subsites |
| `measure.sh` | Đo provisioning time, `wp_blogs` size, HyperDB latency |
| `create-databases.sh` | Tạo N databases (database-per-store feasibility) |
| `measure-databases.sh` | Đo database metrics, table cache, file descriptors |
| `measure-table-cache.sh` | Spike #002 — table cache pressure test |
| `measure-platform-provisioning.sh` | Đo provisioning qua MU Plugin REST |
| `measure-isolated-provisioning.sh` | So sánh Multisite vs Isolated provisioning |
| `teardown.sh` | Dọn spike sites (yêu cầu confirm) |
| `teardown-databases.sh` | Dọn spike databases (yêu cầu confirm) |

### Spike Reports

| Report | ADR | Kết quả chính |
|---|---|---|
| [REPORT-002-table-cache.md](spike/REPORT-002-table-cache.md) | ADR-005/006 | 50 bảng/store, trần ~80-120 store/node ở cache mặc định |
| [REPORT-003-provisioning-at-scale.md](spike/REPORT-003-provisioning-at-scale.md) | ADR-005/003 | Provisioning không suy giảm, 94% thời gian là Agent poll sleep |

### Chạy spike test

```bash
export WP_PATH=/var/www/wordpress
export SPIKE_SITES=500
export SPIKE_PREFIX=spike001
export SPIKE_LOG_DIR=/var/tmp/spike-001-500

scripts/spike/create-sites.sh
scripts/spike/measure.sh
```

Xem [spike/README.md](spike/README.md) cho chi tiết đầy đủ.
