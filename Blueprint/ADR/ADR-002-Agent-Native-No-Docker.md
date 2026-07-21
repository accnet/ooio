# ADR-002: Go Agent chạy Native (systemd), không container hoá

## Status

**Accepted** — nguồn thẩm quyền: `idea/plan-agent.md`, củng cố bởi `idea/plan-12.md`
(mục Deployment: "Cluster — Native"). Xem `Blueprint/DOC-STATUS.md` để hiểu quy ước
phân loại.

## Bối cảnh

Go Agent chạy trên mỗi Node của Runtime Cluster, cần thực hiện các thao tác đụng chạm
trực tiếp tới hệ điều hành và tiến trình cục bộ: `CREATE DATABASE`, `systemctl reload
caddy`, `php-fpm reload`, `mysqldump`, đọc/ghi filesystem của WordPress, gọi REST tới
MU Plugin qua `127.0.0.1`. Câu hỏi đặt ra là có nên container hoá Agent (Docker) như
cách triển khai Control Plane hay không.

## Quyết định

Go Agent (và toàn bộ Runtime Plane: WordPress, PHP-FPM, Caddy) chạy **native trên hệ
điều hành**, được quản lý bởi `systemd` (`platform-agent.service`), **không dùng
Docker**. Ngược lại, Control Plane (NestJS, Dashboard, Worker, Postgres, Redis) vẫn
dùng Docker vì không cần truy cập trực tiếp tài nguyên OS của Runtime.

## Lý do

1. **Truy cập trực tiếp filesystem và socket cục bộ** (PHP-FPM socket, Caddy admin
   API tại `localhost:2019`) mà không cần mount nhiều volume phức tạp.
2. **Vận hành đơn giản hơn**: `systemctl restart`/`status`, đọc log bằng `journalctl`
   — quen thuộc với đội vận hành hạ tầng Linux, không cần thêm lớp trừu tượng container.
3. **Agent không nằm trên đường đi request** (out-of-band): người dùng truy cập qua
   `Internet → Caddy → PHP-FPM → WordPress`, hoàn toàn không đi qua Agent, nên việc
   Agent native hay container không ảnh hưởng đến việc phục vụ traffic — nhưng native
   giúp Agent thao tác hạ tầng (mysqldump, systemctl) mà không bị giới hạn bởi
   container boundary.
4. Giảm rủi ro vận hành: không phải quản lý thêm registry image, network namespace,
   hay debug vấn đề container-in-container khi Agent cần gọi `systemctl` của host.

## Hệ quả

- CI/CD cho Agent build ra **binary** (không phải image), phân phối qua Artifact
  Repository, Agent tự tải bản mới và Agent Updater tự thay thế binary + restart
  service (xem `06-Go-Agent.md`, `11-Deployment.md`).
- Cần viết và duy trì unit file `systemd` chuẩn hoá, script cài đặt Node
  (`install-node.sh`) để đảm bảo mọi Node được thiết lập nhất quán.
- Khác biệt vận hành giữa hai Plane (Docker cho Control Plane, native cho Runtime)
  phải được tài liệu hoá rõ để tránh nhầm lẫn khi onboard nhân sự mới.

## Open question

Không có open question — nguồn (`plan-agent.md`) khẳng định dứt khoát native/systemd
là lựa chọn, có lý do rõ ràng, không để ngỏ phương án khác.
