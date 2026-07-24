# System Architecture Diagrams — ooio

## 1. Tổng quan 3-Plane

```mermaid
graph TB
    subgraph Users["👤 Users"]
        Customer["Customer"]
        Operator["Operator"]
        Support["Support Staff"]
    end

    subgraph CP["Control Plane - NestJS"]
        direction TB
        Web["web :5173<br/>Customer Portal"]
        Ops["ops :5176<br/>Ops Console"]
        Admin["admin :5177<br/>Support Console"]
        API["api :3100<br/>NestJS API"]
        PG[("PostgreSQL")]
        Redis[("Redis + BullMQ")]
    end

    subgraph MP["Management Plane - Go"]
        Agent["Go Agent<br/>systemd"]
        CLI["Runtime CLI"]
    end

    subgraph RP["Runtime Plane - WordPress"]
        MU["MU Platform Plugin<br/>/platform/v1/*"]
        WP["WordPress Multisite<br/>+ WooCommerce"]
        HyperDB["HyperDB<br/>routing"]
        MySQL[("MySQL Pool<br/>A / B / C")]
        RedisOC[("Redis<br/>Object Cache")]
        Caddy["Caddy<br/>reverse proxy"]
    end

    Customer --> Web
    Operator --> Ops
    Support --> Admin

    Web -->|"JWT/HTTPS"| API
    Ops -->|"JWT/HTTPS"| API
    Admin -->|"JWT/HTTPS"| API

    API --> PG
    API --> Redis

    Agent -->|"outbound HTTPS<br/>poll jobs"| API
    API -.->|"job queue<br/>BullMQ"| Redis

    Agent -->|"localhost REST<br/>Bearer token"| MU
    CLI -->|"localhost REST"| MU

    MU -->|"WordPress Core API<br/>wpmu_create_blog..."| WP
    WP --> HyperDB
    HyperDB --> MySQL
    WP --> RedisOC

    Customer -->|"HTTP/HTTPS"| Caddy
    Caddy -->|"php-fpm"| WP

    style CP fill:#1a1a2e,stroke:#e94560,color:#fff
    style MP fill:#16213e,stroke:#0f3460,color:#fff
    style RP fill:#0f3460,stroke:#533483,color:#fff
```

---

## 2. Chi tiết Components và Connections

```mermaid
graph LR
    subgraph Frontend["Frontend Apps - React + Vite SPA"]
        WEB["web :5173<br/>─────────<br/>Overview<br/>Stores<br/>Create Store<br/>Billing<br/>Settings"]
        OPS["ops :5176<br/>─────────<br/>Pools<br/>Health<br/>Distributions<br/>Feature Flags<br/>Events"]
        ADM["admin :5177<br/>─────────<br/>Organizations<br/>Stores"]
    end

    subgraph NestJS["NestJS API :3100"]
        direction TB
        AUTH["auth<br/>JWT + RBAC"]
        ORGS["orgs"]
        BILLING["billing<br/>plans + quotas"]
        STORES["stores"]
        AGENTS["agents<br/>register + heartbeat"]
        OPS_MOD["operations"]
        WF["workflow<br/>BullMQ processor"]
        SCHED["scheduler<br/>placement"]
        DAS["das<br/>DB allocation"]
        EVENTS["events<br/>dispatcher"]
        MKT["marketplace<br/>distributions"]
        FLAGS["flags"]
        ANALYTICS["analytics"]
        AUDIT["audit"]
        NOTIF["notifications<br/>consumer"]
        MIGRATIONS["migrations"]
        ADMIN_MOD["admin"]
        HEALTH["health"]
    end

    subgraph Data["Data Stores"]
        PG[("PostgreSQL<br/>────────<br/>users + orgs<br/>stores + plans<br/>operations<br/>audit_log")]
        RD[("Redis<br/>────────<br/>BullMQ queues<br/>sessions<br/>cache")]
    end

    subgraph AgentNode["Runtime Node - per server"]
        AGENT["Go Agent - systemd<br/>────────<br/>heartbeat<br/>jobrunner<br/>provision<br/>backup/restore<br/>ssl + domain<br/>metrics + deploy"]
        MUPLUGIN["MU Plugin<br/>/platform/v1/<br/>────────<br/>sites<br/>plugins<br/>themes<br/>users<br/>options<br/>health"]
        WORDPRESS["WordPress Multisite<br/>+ WooCommerce"]
        HYPERDB["HyperDB"]
        MYSQL[("MySQL Pool")]
        REDIS_OC[("Redis<br/>Object Cache")]
        CADDY["Caddy :80/:443"]
        PROM["/metrics<br/>Prometheus"]
    end

    WEB & OPS & ADM -->|"Vite proxy /api<br/>JWT Bearer"| AUTH

    AUTH --> ORGS & BILLING & STORES
    STORES --> WF
    WF --> RD
    WF --> OPS_MOD
    SCHED --> DAS
    EVENTS --> RD
    NOTIF --> RD

    NestJS --> PG
    NestJS --> RD

    AGENT -->|"POST /v1/agents/register<br/>POST .../heartbeat<br/>GET .../jobs<br/>POST .../result"| AGENTS

    AGENT -->|"localhost REST<br/>Bearer shared secret"| MUPLUGIN

    MUPLUGIN -->|"wpmu_create_blog<br/>activate_plugin<br/>switch_theme..."| WORDPRESS

    WORDPRESS --> HYPERDB --> MYSQL
    WORDPRESS --> REDIS_OC
    CADDY -->|"php-fpm"| WORDPRESS
    AGENT --> PROM

    style Frontend fill:#2d3436,stroke:#6c5ce7,color:#fff
    style NestJS fill:#1a1a2e,stroke:#e94560,color:#fff
    style Data fill:#2d3436,stroke:#00b894,color:#fff
    style AgentNode fill:#0f3460,stroke:#533483,color:#fff
```

---

## 3. Luồng CreateStore - end-to-end

```mermaid
sequenceDiagram
    actor Customer
    participant Web as web :5173
    participant API as NestJS API :3100
    participant PG as PostgreSQL
    participant BullMQ as Redis/BullMQ
    participant Agent as Go Agent
    participant MU as MU Plugin
    participant WP as WordPress

    Customer->>Web: Click "Create Store"
    Web->>API: POST /v1/stores (JWT)

    Note over API: Auth + RBAC + Quota check

    API->>API: Scheduler: chon Cluster + Pool
    API->>API: DAS: allocate database
    API->>PG: INSERT store (status: provisioning)
    API->>PG: INSERT operation (type: create-store)
    API->>BullMQ: Enqueue operation

    API-->>Web: 202 Accepted + operationId

    loop Poll jobs (moi 5s)
        Agent->>API: GET /v1/agents/{id}/jobs
        API-->>Agent: jobs array with create-store
    end

    Note over Agent: Job Runner dispatches

    Agent->>MU: POST /platform/v1/sites
    MU->>WP: wpmu_create_blog()
    WP-->>MU: blogId
    MU-->>Agent: siteId + domain + status created

    Agent->>MU: POST /platform/v1/plugins/activate
    MU->>WP: activate_plugin()
    MU-->>Agent: status activated

    Agent->>MU: POST /platform/v1/themes/switch
    MU->>WP: switch_theme()
    MU-->>Agent: status switched

    Agent->>MU: POST /platform/v1/options
    MU->>WP: update_option()
    MU-->>Agent: updated true

    Agent->>API: POST /v1/agents/{id}/jobs/{jobId}/result
    Note over Agent: status pass, result blogId N

    API->>PG: UPDATE store (status: active)
    API->>BullMQ: Publish StoreCreated event

    Note over BullMQ: Event fan-out
    BullMQ-->>API: Analytics subscriber
    BullMQ-->>API: Billing subscriber
    BullMQ-->>API: Notification subscriber

    Web->>API: GET /v1/operations/{id} (polling)
    API-->>Web: status completed, progress 100
    Web-->>Customer: Store ready!
```

---

## 4. Agent Lifecycle

```mermaid
sequenceDiagram
    participant Agent as Go Agent
    participant API as NestJS API
    participant PG as PostgreSQL

    Note over Agent: systemd starts agent

    Agent->>API: POST /v1/agents/register
    Note over Agent: hostname, version, capabilities, capacity
    API->>PG: UPSERT node record
    API-->>Agent: agentId + JWT

    loop Heartbeat (moi 30s)
        Agent->>API: POST /v1/agents/{id}/heartbeat
        Note over Agent: status, capabilities, versions, capacity, metrics
        API->>PG: UPDATE node health + last_heartbeat
        API-->>Agent: 200 OK
    end

    loop Job poll (moi 5s)
        Agent->>API: GET /v1/agents/{id}/jobs
        alt Co jobs
            API-->>Agent: jobs array
            Note over Agent: Execute job via handler
            Agent->>API: POST .../jobs/{id}/result
        else Khong co jobs
            API-->>Agent: empty jobs array
        end
    end

    Note over API: Reconciler kiem tra heartbeat
    alt Heartbeat qua han
        API->>PG: UPDATE node health unhealthy
        API->>PG: INSERT alert event
    end
```

---

## 5. Request Flow - Customer truy cap Store

```mermaid
graph LR
    Browser["Browser<br/>customer.store.com"]
    DNS["DNS<br/>Cloudflare"]
    CDY["Caddy<br/>:443<br/>auto-TLS"]
    PHP["PHP-FPM"]
    WP["WordPress<br/>Multisite"]
    HDB["HyperDB<br/>routing"]
    MC["MySQL Primary"]
    MR["MySQL Replica"]
    RC["Redis<br/>Object Cache"]

    Browser -->|"HTTPS"| DNS
    DNS -->|"TCP"| CDY
    CDY -->|"FastCGI"| PHP
    PHP --> WP

    WP -->|"write query"| HDB
    HDB -->|"write"| MC
    HDB -->|"read"| MR
    WP <-->|"get/set"| RC

    style Browser fill:#2d3436,stroke:#6c5ce7,color:#fff
    style CDY fill:#00b894,stroke:#00b894,color:#fff
    style WP fill:#0f3460,stroke:#533483,color:#fff
    style HDB fill:#e94560,stroke:#e94560,color:#fff
```

> **Luu y:** Control Plane khong nam trong duong di cua request khach hang.
> Store chay doc lap — neu Control Plane down, store van phuc vu traffic binh thuong.

---

## 6. Security Boundaries

```mermaid
graph TB
    subgraph Public["Public Internet"]
        Browser["Browser"]
        ExtAPI["External API clients"]
    end

    subgraph DMZ["DMZ — Caddy reverse proxy"]
        Caddy["Caddy :80/:443<br/>auto-TLS"]
    end

    subgraph CP_Net["Control Plane Network"]
        API["NestJS API :3100"]
        PG[("PostgreSQL :5432")]
        Redis[("Redis :6379")]
        Dashboard["React SPAs<br/>static CDN"]
    end

    subgraph Node_Net["Runtime Node - per server"]
        Agent["Go Agent<br/>outbound-only"]
        MU["MU Plugin<br/>127.0.0.1 only"]
        WP["WordPress"]
        MySQL[("MySQL :3306<br/>bind 127.0.0.1")]
    end

    Browser -->|"HTTPS"| Dashboard
    Browser -->|"HTTPS"| Caddy
    ExtAPI -->|"HTTPS + API Key"| API
    Dashboard -->|"JWT Bearer"| API

    API --- PG
    API --- Redis

    Agent ==>|"outbound HTTPS<br/>poll - khong can inbound port"| API
    Agent -->|"localhost:80<br/>Bearer secret"| MU

    Caddy -->|"php-fpm socket"| WP
    MU --> WP
    WP --> MySQL

    style Public fill:#2d3436,stroke:#636e72,color:#fff
    style DMZ fill:#00b894,stroke:#00b894,color:#fff
    style CP_Net fill:#1a1a2e,stroke:#e94560,color:#fff
    style Node_Net fill:#0f3460,stroke:#533483,color:#fff
```

### Nguyen tac bao mat chinh

| Nguyen tac | Co che |
|---|---|
| **Control Plane khong SSH** | Agent outbound-only, poll jobs qua HTTPS - ADR-003 |
| **Control Plane khong ghi DB WordPress** | Moi thay doi qua Agent → MU Plugin → Core API - ADR-003 |
| **MU Plugin chi localhost** | Bearer token shared secret, bind 127.0.0.1 |
| **MySQL khong public** | bind 127.0.0.1, HyperDB routing local |
| **3 app frontend tach phien** | localStorage key rieng, PlatformRoleGuard o API |
| **Agent khong chua business logic** | Chi thuc thi lenh ha tang tu Control Plane |

---

## 7. Data Ownership - AP-002

```mermaid
graph TB
    subgraph Platform["Platform Data - PostgreSQL"]
        Users["users + orgs + memberships"]
        Plans["plans + subscriptions + quotas"]
        Stores_Meta["stores metadata<br/>cluster + pool + tier"]
        Ops["operations + audit_log"]
        Clusters["clusters + nodes + pools"]
    end

    subgraph RuntimeGlobal["Runtime Global Data - MySQL shared tables"]
        WPUsers["wp_users<br/>projection tu Platform"]
        WPSite["wp_site + wp_sitemeta"]
        WPBlogs["wp_blogs"]
    end

    subgraph StoreData["Store Data - MySQL per-store prefix wp_N_*"]
        Posts["wp_N_posts + wp_N_postmeta"]
        Options["wp_N_options"]
        WC["wp_N_wc_orders<br/>wp_N_wc_products<br/>...50 tables/store"]
    end

    Platform -->|"projection"| WPUsers
    Platform -->|"metadata ref"| RuntimeGlobal
    RuntimeGlobal -->|"prefix routing"| StoreData

    style Platform fill:#1a1a2e,stroke:#e94560,color:#fff
    style RuntimeGlobal fill:#16213e,stroke:#0f3460,color:#fff
    style StoreData fill:#0f3460,stroke:#533483,color:#fff
```

> **AP-001:** Khong JOIN vuot store. Aggregate qua event/projection.
> **AP-002:** Platform so huu user; store chi nhan projection.
