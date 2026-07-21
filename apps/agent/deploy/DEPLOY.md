# Deploy a Runtime node to a VPS (multisite scale test)

Mục tiêu: dựng một node WooCommerce Cloud Runtime thật trên VPS để chạy **spike test
multisite** (Gate 1). Không cần SaaS/NestJS — Runtime vận hành độc lập, điều khiển qua
CLI + harness. SSL bỏ qua ở bước này (dùng HTTP), làm sau khi có domain.

> Trạng thái: `install-node.sh` đã đầy đủ (MariaDB + WP multisite + MU Plugin + Redis +
> HyperDB + WooCommerce/Core Plugin Set + php-fpm + Caddy + Agent) và dry-run test xanh,
> **nhưng chưa chạy `--system` thật trên VPS lần nào** — lần đầu có thể phải vá 1–2 chỗ
> nhỏ (tên service php-fpm theo distro, quyền). Đây chính là bước này.

## 0. Yêu cầu VPS
- Ubuntu 22.04/24.04 (hoặc Debian), quyền `root`/`sudo`.
- ≥ 4 GB RAM, ≥ 2 vCPU cho test ~500 site; ≥ 8 GB / 4 vCPU cho ~1000.
- Mở port 80 (HTTP). Go toolchain để build agent (hoặc scp binary lên).

## 1. Đưa mã nguồn lên VPS
```bash
sudo mkdir -p /opt/ooio && sudo chown "$USER" /opt/ooio
# scp/rsync repo, hoặc git clone nếu đã đẩy lên remote:
rsync -a --exclude '.ai-work' --exclude '.git' /path/to/ooio/ /opt/ooio/
```

## 2. Build Agent binary cho arch VPS
```bash
cd /opt/ooio/apps/agent
go build -o /tmp/platform-agent .      # cần Go 1.22+ trên VPS
```
(Nếu không có Go trên VPS: build ở máy khác cùng arch rồi scp tới `/tmp/platform-agent`,
và đặt `AGENT_BINARY=/tmp/platform-agent` trong config.)

## 3. Cấu hình node
```bash
cd /opt/ooio/apps/agent/deploy
cp node-config.env.sample node-config.env
openssl rand -hex 32                    # dùng cho PLATFORM_CORE_SHARED_SECRET
nano node-config.env                    # sửa các dòng đánh dấu EDIT
```
Bắt buộc sửa: `WP_URL` (http://<IP VPS>), `WP_ADMIN_PASSWORD`, `WP_ADMIN_EMAIL`,
`MARIADB_PASSWORD`, `PLATFORM_CORE_SHARED_SECRET`, và `MU_PLUGIN_SOURCE` /
`DISTRIBUTION_INSTALLER` nếu repo không ở `/opt/ooio`.

## 4. Chạy thử (dry-run) rồi cài thật
```bash
# xem kế hoạch, không thay đổi gì:
sudo bash install-node.sh --system --config node-config.env --dry-run

# cài thật:
sudo bash install-node.sh --system --config node-config.env
```
Cài xong sẽ có: MariaDB + WordPress multisite (subdirectory) + MU Plugin (secret đã set)
+ Redis object cache + HyperDB (drop-in + db-config.php ở ABSPATH) + WooCommerce + Core
Plugin Set + php-fpm + Caddy (:80) + platform-agent (systemd).

## 5. Kiểm tra node lên đúng
```bash
systemctl status caddy php*-fpm mariadb redis-server platform-agent --no-pager
curl -s http://<IP>/wp-json/platform/v1/health           # {"status":"ok",...}
# tạo thử 1 store qua MU Plugin (thay <SECRET>):
curl -s -X POST http://<IP>/wp-json/platform/v1/sites \
  -H "Authorization: Bearer <SECRET>" -H "Content-Type: application/json" \
  -d '{"domain":"<IP>","path":"/probe","title":"Probe","adminEmail":"a@b.co"}'
curl -s -o /dev/null -w "%{http_code}\n" http://<IP>/probe/   # mong đợi 200
```
> Lưu ý domain: với subdirectory multisite, `domain` = domain của network (đúng bằng
> host trong `WP_URL`). MU Plugin (fix B4) tự dùng network domain nên truyền gì cũng được,
> nhưng dùng đúng host cho chắc.

## 6. Chạy spike test scale (Gate 1)
```bash
cd /opt/ooio/scripts/spike
WP_PATH=/var/www/wordpress SPIKE_SITES=500 bash create-sites.sh    # tạo 500 site
bash measure.sh > /opt/ooio/SPIKE-001-results.csv                  # đo & ghi số liệu
# dọn sau khi đo:
bash teardown.sh --yes SPIKE_TEARDOWN_CONFIRM=DELETE_SPIKE_SITES
```
Đối chiếu số liệu với Exit Criteria trong `Blueprint/ADR/ADR-005` (provisioning time,
kích thước `wp_blogs`, HyperDB routing latency, isolation).

## 7. Có thể vướng ở lần chạy thật đầu tiên
- **Tên service php-fpm** khác theo distro → set `PHP_FPM_SERVICE=php8.3-fpm` trong config.
- **MariaDB root auth**: nếu root dùng `unix_socket`, để `MARIADB_ROOT_PASSWORD=` trống và
  chạy script bằng `sudo`.
- **Caddy** cài từ repo Caddy chính thức nếu apt bản cũ thiếu.
- **HyperDB db-config.php** phải ở `${WP_PATH}/db-config.php` (đã set đúng trong sample).
- **SELinux/AppArmor** trên vài distro có thể chặn php-fpm ↔ socket; kiểm nếu 502.

## 8. SSL (làm sau, khi có domain)
Đổi `CADDY_SITE_ADDRESS=:443` + trỏ domain về VPS; Caddy tự lấy Let's Encrypt. Agent
module SSL (C4) dùng cho tự động hoá per-domain về sau.
