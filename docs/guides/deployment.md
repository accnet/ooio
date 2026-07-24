# Deployment — Runtime Node trên VPS

Hướng dẫn deploy một node WooCommerce Cloud Runtime trên VPS. Node bao gồm toàn bộ
Runtime Plane (WordPress Multisite + WooCommerce + MU Plugin + HyperDB + Redis) và
Management Plane (Go Agent) — có thể vận hành **độc lập, không cần Control Plane**.

> Tài liệu gốc: [apps/agent/deploy/DEPLOY.md](../../apps/agent/deploy/DEPLOY.md).
> File này consolidate và bổ sung context từ Blueprint.

## Yêu cầu VPS

- Ubuntu 22.04/24.04 (hoặc Debian), quyền `root`/`sudo`
- ≥ 4 GB RAM, ≥ 2 vCPU cho ~500 store; ≥ 8 GB / 4 vCPU cho ~1000
- Mở port 80 (HTTP). Port 443 khi có domain
- Go 1.22+ trên VPS (hoặc build binary từ máy khác rồi scp)

## Quy trình deploy

### 1. Đưa mã nguồn lên VPS

```bash
sudo mkdir -p /opt/ooio && sudo chown "$USER" /opt/ooio
rsync -a --exclude '.ai-work' --exclude '.git' /path/to/ooio/ /opt/ooio/
```

### 2. Build Agent binary

```bash
cd /opt/ooio/apps/agent
go build -o /tmp/platform-agent .
```

Nếu không có Go trên VPS: build ở máy khác cùng arch, scp tới `/tmp/platform-agent`,
và đặt `AGENT_BINARY=/tmp/platform-agent` trong config.

### 3. Cấu hình node

```bash
cd /opt/ooio/apps/agent/deploy
cp node-config.env.sample node-config.env
openssl rand -hex 32        # dùng cho PLATFORM_CORE_SHARED_SECRET
nano node-config.env         # sửa các dòng đánh dấu EDIT
```

**Bắt buộc sửa:** `WP_URL`, `WP_ADMIN_PASSWORD`, `WP_ADMIN_EMAIL`, `MARIADB_PASSWORD`,
`PLATFORM_CORE_SHARED_SECRET`, và `MU_PLUGIN_SOURCE` / `DISTRIBUTION_INSTALLER` nếu repo
không ở `/opt/ooio`.

### 4. Cài đặt (dry-run → thật)

```bash
# Xem kế hoạch, không thay đổi gì:
sudo bash install-node.sh --system --config node-config.env --dry-run

# Cài thật:
sudo bash install-node.sh --system --config node-config.env
```

Script cài: MariaDB + WordPress Multisite + MU Plugin + Redis object cache + HyperDB +
WooCommerce + Core Plugin Set + php-fpm + Caddy + platform-agent (systemd).

### 5. Verify

```bash
systemctl status caddy php*-fpm mariadb redis-server platform-agent --no-pager

# Health check:
curl -s http://<IP>/wp-json/platform/v1/health

# Tạo thử 1 store:
curl -s -X POST http://<IP>/wp-json/platform/v1/sites \
  -H "Authorization: Bearer <SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"domain":"<IP>","path":"/probe","title":"Probe","adminEmail":"a@b.co"}'

# Verify store accessible:
curl -s -o /dev/null -w "%{http_code}\n" http://<IP>/probe/    # → 200
```

## Cấu hình MariaDB cho scale

`install-node.sh` tự động tune MariaDB dựa trên `OOIO_EXPECTED_STORES_PER_NODE` (mặc
định 200). Theo [Spike #002](../../scripts/spike/REPORT-002-table-cache.md), mỗi store
WooCommerce có **50 bảng nóng**. Công thức:

```
table_open_cache = stores × 50 × 1.2
open_files_limit ≥ table_open_cache × 2
```

Kiểm tra sau cài:
```bash
sudo mariadb -N -B -e 'SELECT @@table_open_cache, @@open_files_limit;'
```

## Spike test (Gate 1)

Sau khi node chạy, chạy spike test để kiểm chứng scale:

```bash
cd /opt/ooio/scripts/spike
WP_PATH=/var/www/wordpress SPIKE_SITES=500 bash create-sites.sh
bash measure.sh > /opt/ooio/SPIKE-001-results.csv
```

Đối chiếu với Exit Criteria trong
[ADR-005](../../Blueprint/ADR/ADR-005-Multisite-vs-Isolated-Sites.md).

Xem [scripts/spike/README.md](../../scripts/spike/README.md) cho chi tiết đầy đủ.

## SSL (khi có domain)

Caddy tự động lấy Let's Encrypt certificate. Đổi `CADDY_SITE_ADDRESS=:443` và trỏ
domain về VPS. Agent module SSL (C4) xử lý tự động hoá per-domain.

## Troubleshooting

| Vấn đề | Giải pháp |
|---|---|
| Tên service php-fpm khác | `PHP_FPM_SERVICE=php8.3-fpm` trong config |
| MariaDB root auth | Nếu root dùng `unix_socket`, để `MARIADB_ROOT_PASSWORD=` trống |
| Caddy phiên bản cũ | Cài từ repo Caddy chính thức |
| HyperDB không hoạt động | `db-config.php` phải ở `${WP_PATH}/db-config.php` |
| 502 Bad Gateway | Kiểm tra SELinux/AppArmor chặn php-fpm ↔ socket |

## Liên quan

- [DEPLOY.md gốc](../../apps/agent/deploy/DEPLOY.md) — tài liệu chi tiết với ví dụ config
- [Blueprint/11-Deployment.md](../../Blueprint/11-Deployment.md) — chiến lược deployment
- [Blueprint/14-Production.md](../../Blueprint/14-Production.md) — production readiness
