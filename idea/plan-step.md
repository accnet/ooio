Nếu bắt đầu **từ con số 0** và mục tiêu cuối cùng là **WordPress SaaS quy mô hàng nghìn website**, mình sẽ không bắt đầu bằng WordPress mà bắt đầu bằng **Platform**.

Mình sẽ tổ chức dự án như một **monorepo**, sau này có thể tách thành nhiều repo nếu đội ngũ lớn hơn.

# Giai đoạn Development

```text
platform/
│
├── apps/
├── packages/
├── services/
├── infra/
├── scripts/
├── docs/
├── tools/
└── .github/
```

Đây là root của toàn bộ platform.

---

# apps/

Đây là các ứng dụng chạy được.

```text
apps/

├── saas-api/
├── saas-web/
├── wp-agent/
├── wp-platform/
├── installer/
└── cli/
```

## saas-api

```text
NestJS

Auth

Billing

Scheduler

REST API

Admin
```

---

## saas-web

```text
React

Vite

Tailwind

TanStack Query

Admin Dashboard

Customer Portal
```

---

## wp-agent

```text
Go

Go Agent

Modules

Self Update

Heartbeat
```

---

## wp-platform

Không phải WordPress.

Đây là project

```text
MU Plugin
```

Ví dụ

```text
wp-content/

mu-plugins/

platform-core/
```

CI sẽ build zip.

---

## installer

Một CLI

```bash
platform install
```

hoặc

```bash
platform node join
```

---

## cli

CLI cho SaaS

Ví dụ

```bash
platform site:create

platform deploy

platform cluster:list
```

---

# packages/

Shared library.

```text
packages/

api-client/

ui/

types/

config/

sdk/

logger/
```

Ví dụ

NestJS và React dùng chung

```text
types
```

---

# services/

Microservice hoặc Worker.

```text
services/

scheduler/

worker/

notification/

billing/

analytics/

ai/

webhook/
```

Lúc đầu có thể chưa cần deploy riêng.

---

# infra/

Đây là cực kỳ quan trọng.

```text
infra/

docker/

ansible/

terraform/

systemd/

caddy/

nginx/

mysql/

postgres/

redis/
```

Ví dụ

```text
infra/systemd

platform-agent.service

platform-api.service
```

---

# scripts/

```text
scripts/

install-node.sh

install-saas.sh

backup.sh

restore.sh

release.sh
```

---

# docs/

```text
docs/

architecture/

api/

database/

deployment/

roadmap/

adr/
```

ADR

Architecture Decision Record

---

# tools/

Các tool dev.

```text
tools/

generator/

lint/

release/

migration/
```

---

# GitHub

```text
.github/

workflows/

api.yml

agent.yml

platform.yml

theme.yml
```

---

# WordPress Node

Sau khi deploy.

Một server.

```text
/opt/platform/

wordpress/

agent/

config/

logs/

backup/

artifacts/
```

---

WordPress

```text
wordpress/

wp-admin/

wp-content/

plugins/

themes/

mu-plugins/
```

---

Agent

```text
agent/

platform-agent

config.yaml

cache/

modules/
```

---

# SaaS Server

Nếu Docker

```text
/opt/platform/

compose/

env/

volumes/

backup/

logs/
```

compose

```text
docker-compose.yml
```

---

# PostgreSQL

```text
data/

backup/

wal/
```

---

# Object Storage

```text
artifacts/

platform-core/

themes/

plugins/

agent/

releases/
```

Ví dụ

```text
artifacts/

agent/

1.0.0/

agent-linux-amd64
```

---

# CI/CD

```text
GitHub

↓

Actions

↓

Build

↓

Artifact

↓

Release

↓

SaaS

↓

Agent

↓

Deploy
```

---

# Phân tầng mã nguồn

Đây là phần mình nghĩ rất quan trọng.

```text
                        Platform

────────────────────────────────────────

Presentation

↓

Application

↓

Domain

↓

Infrastructure
```

NestJS

```text
Controller

↓

Service

↓

UseCase

↓

Repository
```

---

Agent

```text
HTTP

↓

Job

↓

Module

↓

Executor

↓

Linux
```

---

MU Plugin

```text
REST

↓

Service

↓

WordPress Adapter
```

---

# Roadmap phát triển

## Phase 1

```text
SaaS

Agent

MU Plugin

1 Cluster
```

---

## Phase 2

```text
Scheduler

Billing

SSL

Domains
```

---

## Phase 3

```text
Multiple Cluster

Marketplace

Plugin Manager

Theme Manager
```

---

## Phase 4

```text
AI

Analytics

Observability

Scaling
```

# Kiến trúc cuối cùng mình sẽ xây

```text
platform/
│
├── apps/
│   ├── saas-api/              # NestJS Control Plane
│   ├── saas-web/              # React Dashboard
│   ├── wp-agent/              # Go Management Plane
│   ├── wp-platform/           # MU Plugin (Data Plane SDK)
│   ├── installer/             # Bootstrap Node/Cluster
│   └── cli/                   # CLI
│
├── packages/
│   ├── sdk/
│   ├── types/
│   ├── ui/
│   ├── config/
│   └── logger/
│
├── services/
│   ├── scheduler/
│   ├── billing/
│   ├── notifications/
│   ├── analytics/
│   ├── webhooks/
│   └── ai/
│
├── infra/
│   ├── docker/
│   ├── ansible/
│   ├── systemd/
│   ├── caddy/
│   ├── terraform/
│   └── monitoring/
│
├── scripts/
├── docs/
├── tools/
└── .github/
```

## Một điểm mình sẽ thay đổi so với các trao đổi trước

Nếu đây là dự án dài hạn với nhiều module (SaaS, Agent, MU Plugin, AI...), mình sẽ **không để tất cả trong một repository quá lâu**.

Lộ trình mình chọn sẽ là:

### Giai đoạn 1 (MVP)

```
platform-monorepo
```

Ưu điểm:

* Refactor dễ.
* Dùng chung types, config.
* Một pipeline CI.
* Phù hợp khi chỉ có 1–5 lập trình viên.

### Giai đoạn 2 (ổn định)

Tách dần thành:

```
platform-saas
platform-agent
platform-wordpress
platform-infra
platform-sdk
```

Mỗi repo có release và version riêng.

Đây là mô hình mà nhiều nền tảng lớn áp dụng: **bắt đầu với monorepo để tăng tốc phát triển**, sau đó chỉ tách khi các thành phần có vòng đời phát hành và đội ngũ phát triển khác nhau. Với mục tiêu của bạn, đây sẽ là lộ trình cân bằng giữa tốc độ phát triển ban đầu và khả năng mở rộng lâu dài.
