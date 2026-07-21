# Spike Report #001: Multisite Scale

**Status:** Draft template
**Gate:** Gate 1, Runtime Spike
**ADR:** ADR-005, Multisite vs Isolated Single-sites
**Owner:** `<name/team>`
**Run date:** `<UTC date>`
**Environment:** `<cluster/node/region>`

## Purpose

This report supplies the evidence for ADR-005 Exit Criterion 1: create 500-1000
WordPress Multisite subsites and measure provisioning time, multisite catalog size,
HyperDB routing latency, and database size. It is one input to the ADR decision; it
does not by itself close ADR-005 or establish the Isolation, Restore, or Plugin
Compatibility criteria.

## Gate 1 decision

**Result:** `<pass | fail | inconclusive>`
**Decision owner:** `<name>`
**Decision date:** `<UTC date>`
**Threshold source:** ADR-005 does not currently define numeric pass/fail budgets.
Record the observed values and the explicit operational decision here; do not
invent a threshold after seeing the result.

**Evidence paths:**

- Provisioning CSV: `<path to provisioning.csv>`
- Measurement CSV: `<path to measurements.csv>`
- Routing samples: `<path to measurements-routing.csv>`
- Logs or command transcript: `<path>`

## Hypothesis and workload

**Hypothesis:** A single Multisite network can provision the target site cohort and
retain acceptable catalog, database, and HyperDB routing behavior for the tested
scale point.

| Run | Requested sites | Prefix | Probe samples | Start | End |
| --- | ---: | --- | ---: | --- | --- |
| `<run id>` | `<500 or 1000>` | `<prefix>` | `<N>` | `<UTC>` | `<UTC>` |

Run each scale point as a separate row and preserve its raw evidence. Document
whether the network was empty, partially populated, or reused before the run.

## Environment and configuration

| Field | Value |
| --- | --- |
| WordPress version | `<version>` |
| WP-CLI version | `<version>` |
| PHP version | `<version>` |
| MySQL/MariaDB version | `<version>` |
| HyperDB version/commit | `<version or commit>` |
| HyperDB mapping | `<pool/database mapping>` |
| Database storage type and provisioned size | `<value>` |
| PHP-FPM worker configuration | `<pm.max_children and related limits>` |
| Object cache configuration | `<Redis or none, limits>` |
| Network URL/domain mode | `<value>` |
| Site creation command | `scripts/spike/create-sites.sh` |
| Measurement command | `scripts/spike/measure.sh` |

Record maintenance, cache warm-up, concurrent traffic, and any non-default
configuration that could affect latency or storage measurements.

## Metrics and results

### Provisioning

Measure every requested site from immediately before `wp site create` until the
command returns. Record both successful and failed attempts.

| Run | Requested | Created | Failed | p50 ms | p95 ms | Max ms | Total s | Sites/min |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `<run id>` | `<N>` | `<N>` | `<N>` | `<value>` | `<value>` | `<value>` | `<value>` | `<value>` |

Also record the first and last site number, WP-CLI exit behavior, and any retry or
manual intervention. The raw `provisioning.csv` is the source for these values.

### Multisite catalog tables

Capture row count and physical data/index/total bytes from the database. At minimum,
report `wp_blogs` as required by ADR-005 and `wp_site` to show network metadata
growth. Include `wp_sitemeta` when it is material to the installation.

| Run | `wp_blogs` rows | `wp_blogs` data bytes | `wp_blogs` index bytes | `wp_blogs` total bytes | `wp_site` rows | `wp_site` total bytes | `wp_sitemeta` total bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `<run id>` | `<value>` | `<value>` | `<value>` | `<value>` | `<value>` | `<value>` | `<value>` |

The checked-in harness summary records these table values and the whole-database
totals with a read-only `information_schema.tables` query. Attach the query
transcript when filling this template so the table prefix and database identity are
auditable.

### Database size

| Run | Table count | Data bytes | Index bytes | Total bytes | Free disk before | Free disk after | Growth/site |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `<run id>` | `<value>` | `<value>` | `<value>` | `<value>` | `<value>` | `<value>` | `<value>` |

State whether the database size includes pre-existing tables and whether filesystem
free space was measured on the database volume or the WordPress node.

### Database-per-store scale

This is the companion workload for ADR-006/AP-002 feasibility. Read these results
together with the Multisite measurements above and ADR-005's topology decision;
this section is not an independent ADR-006 decision and must not be used to close
ADR-005 by itself. The workload creates one disposable database per store using
`scripts/spike/create-databases.sh`, then measures it with
`scripts/spike/measure-databases.sh`.

**Workload configuration:**

| Field | Value |
| --- | --- |
| Requested databases | `<SPIKE_DATABASES, default 500>` |
| Database prefix | `<SPIKE_DATABASE_PREFIX, default store_>` |
| MySQL/MariaDB version | `<version>` |
| Storage engine | `InnoDB` |
| Minimum tables per database | `12` |
| Provisioning CSV | `<path to database-provisioning.csv>` |
| Measurement CSV | `<path to database-measurements.csv>` |
| Run start/end | `<UTC timestamps>` |

The minimum table set is `posts`, `postmeta`, `options`, `comments`,
`commentmeta`, `terms`, `term_taxonomy`, `term_relationships`, `termmeta`,
`users`, `usermeta`, and `links`, with the `wp_` prefix inside each database.
The fixture intentionally measures empty-table overhead; it does not represent a
populated store or plugin-heavy workload.

#### Provisioning metrics

| Run | Requested DBs | Created | Failed | CREATE DATABASE p50 ms | CREATE DATABASE p95 ms | Table setup p50 ms | Table setup p95 ms | Total p95 ms | Total s | DBs/min |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `<run id>` | `<N>` | `<N>` | `<N>` | `<value>` | `<value>` | `<value>` | `<value>` | `<value>` | `<value>` | `<value>` |

Use `database-provisioning.csv` as the source. Preserve failed rows and record any
manual retry or pre-existing schema discovered before the run.

#### Database and limit metrics

| Run | Database count | Table count | Data bytes | Index bytes | Total bytes | Bytes/DB | Tables/DB | `innodb_file_per_table` | `table_open_cache` | `open_files_limit` | `Open_tables` | `Open_files` | Server FDs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| `<run id>` | `<value>` | `<value>` | `<value>` | `<value>` | `<value>` | `<value>` | `<value>` | `<ON/OFF>` | `<value>` | `<value>` | `<value>` | `<value>` | `<value>` |

`database-measurements.csv` records one row per selected database and a final
`aggregate,ALL` row. Use the aggregate row for run totals and retain the per-database
rows for distribution analysis. Record the server-level limit and status values from
the same measurement window. `Server FDs` is the actual descriptor count for the
MySQL/MariaDB server process when its PID is discoverable or supplied through
`MYSQL_SERVER_PID`; an `unavailable` value is an explicit evidence gap.

#### Evaluation criteria

| Question | Evidence | Evaluation |
| --- | --- | --- |
| Can the target cohort be created repeatably? | Per-database timing/status rows | Compare failure rate, p95/p99, total duration, and operator retries at each scale point. |
| What is the empty-store storage overhead? | Per-database bytes and table count | Compare bytes/database and aggregate growth with the Multisite database-size result. |
| Are database/table/file limits approaching saturation? | `table_open_cache`, `open_files_limit`, `Open_tables`, `Open_files`, and database count | Record observed headroom and any errors; do not invent pass/fail budgets after the run. |
| Does the topology remain operable? | Raw CSVs, server logs, and teardown transcript | Consider backup/restore, migrations, connection pooling, monitoring, and cleanup burden alongside performance. |

The result remains `<pass | fail | inconclusive>` until the observed values are
reviewed against explicit ADR-006/AP-002 operating budgets and then reconciled
with ADR-005's Multisite, isolation, restore, and plugin-compatibility evidence.

### HyperDB routing

Use the same site-scoped option read for every sample and record the selected probe
site and database pool. The harness command is:
`wp option get blogname --url=<probe-url>`.

| Run | Probe site | Pool/database | Samples | Successes | Failures | Average ms | p50 ms | p95 ms | p99 ms | Max ms |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `<run id>` | `<blog_id>` | `<pool>` | `<N>` | `<N>` | `<N>` | `<value>` | `<value>` | `<value>` | `<value>` | `<value>` |

This is an end-to-end WP-CLI probe, not a pure database-driver timing. Note PHP
bootstrap, object-cache state, connection reuse, and whether the probe was routed
to the expected HyperDB pool. If a lower-level HyperDB trace is available, attach it
as corroborating evidence rather than replacing the end-to-end measurement.

## Interpretation

### Observations

- Provisioning behavior: `<text>`
- `wp_blogs` growth: `<text>`
- Database growth and free-space impact: `<text>`
- HyperDB routing behavior: `<text>`
- Errors, retries, or anomalies: `<text>`

### ADR-005 Exit Criteria mapping

| ADR-005 criterion | Evidence in this report | Status |
| --- | --- | --- |
| Runtime Spike: 500-1000 sites, provisioning time, multisite table size, HyperDB routing latency | This report and attached raw CSVs | `<pass/fail/inconclusive>` |
| Isolation Benchmark | Not tested by this spike; requires Phase 5 Stress Test Report | Open |
| Restore Test | Not tested by this spike; requires Restore Test Report | Open |
| Plugin Compatibility Matrix | Not tested by this spike; requires Compatibility Matrix v1 | Open |

### ADR-006/AP-002 evidence mapping

| ADR-006/AP-002 question | Evidence in this report | Status |
| --- | --- | --- |
| Database-per-store creation feasibility at 500-1000 stores | Database provisioning CSV and server logs | `<pass/fail/inconclusive>` |
| Storage and table overhead | Database measurement CSV and database-volume free space | `<pass/fail/inconclusive>` |
| MySQL descriptor/table-cache headroom | Database measurement CSV plus server status snapshots | `<pass/fail/inconclusive>` |
| Operational comparison with Multisite | This section read together with the ADR-005 sections above | Open until both topology results are reviewed |

## Limitations and follow-up

Document limits such as a single-node run, no concurrent traffic, warm caches,
unrepresentative plugin set, missing per-database traces, or an absent numeric SLO.
List the smallest follow-up experiment for each limitation and its owner.

**Follow-up actions:**

1. `<action, owner, due date>`
2. `<action, owner, due date>`

## Reproduction and cleanup

The harness is in `scripts/spike/`. Use a disposable Multisite network and archive
all CSV evidence before teardown. Cleanup requires both `--yes` and
`SPIKE_TEARDOWN_CONFIRM=DELETE_SPIKE_SITES`; do not run it against production.
