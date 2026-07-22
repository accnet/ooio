# Multisite Scale Spike Harness

This directory contains the non-production harness for ADR-005 Spike Report #001
(Gate 1), including the database-per-store feasibility workload for ADR-006/AP-002.
It is intentionally shell-only and does not install dependencies or run a WordPress
or MySQL environment by itself.

## Scope

The harness measures the Runtime Spike exit criterion from
`Blueprint/ADR/ADR-005-Multisite-vs-Isolated-Sites.md`:

- provisioning time for a controlled number of WordPress Multisite subsites;
- `wp_blogs` row count and data/index/total size;
- total database data/index/total size;
- end-to-end latency of a site-scoped WordPress option read through the configured
  HyperDB routing path;
- database-per-store creation time and the minimum WordPress table footprint;
- isolated WordPress provisioning time split into database creation, shared-core
  linking, wp-config.php generation, and `wp core install`;
- database count, table count, storage bytes, MySQL table/file limits, and the
  database server's file descriptor count.

The recommended points are 500 and 1000 sites. Run each point from a clean,
documented baseline and preserve the generated CSV files with the report.

## Prerequisites

- An existing WordPress Multisite installation reachable by WP-CLI.
- WP-CLI available as `wp`, or set `WP_BIN` to its executable path.
- A test database and disposable network. Do not use production data.
- HyperDB configured if routing latency is being measured.
- MySQL or MariaDB client available as `mysql`, or set `MYSQL_BIN` to its path.
- `curl` is required only when the optional MU Plugin REST comparison is enabled.
- A disposable MySQL or MariaDB server with permission to create and drop the
  `store_<numeric-id>` databases. Prefer an option file for credentials; the
  scripts also accept `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_SOCKET`, `MYSQL_USER`,
  and `MYSQL_PASSWORD`.

The scripts use only Bash, WP-CLI, and standard POSIX/GNU command-line tools
already expected on the test host. They do not create databases or change HyperDB
configuration.

## Run order

The scripts are descriptions of the runbook and are not executed as part of this
repository task.

```bash
export WP_PATH=/srv/wordpress
export SPIKE_SITES=500
export SPIKE_PREFIX=spike001
export SPIKE_LOG_DIR=/var/tmp/spike-001-500

scripts/spike/create-sites.sh
scripts/spike/measure.sh

export SPIKE_DATABASES=500
export SPIKE_DATABASE_PREFIX=store_
export SPIKE_LOG_DIR=/var/tmp/spike-001-databases-500
scripts/spike/create-databases.sh
scripts/spike/measure-databases.sh

# Isolated provisioning versus Multisite, sequentially on the same host.
export SPIKE_WORDPRESS_SOURCE=/srv/wordpress
export SPIKE_ISOLATED_SITES=100
export SPIKE_LOG_DIR=/var/tmp/spike-001-isolated-100
export SPIKE_MULTISITE_WP_PATH=/srv/wordpress
export SPIKE_MULTISITE_REST_URL=http://127.0.0.1/wp-json/platform/v1/sites
scripts/spike/measure-isolated-provisioning.sh

# Only after evidence is copied to the report and the run is disposable:
SPIKE_TEARDOWN_CONFIRM=DELETE_SPIKE_SITES scripts/spike/teardown.sh --yes
SPIKE_TEARDOWN_CONFIRM=DELETE_SPIKE_DATABASES scripts/spike/teardown-databases.sh --yes
```

For a second point, use a new `SPIKE_LOG_DIR` and either a new prefix or a clean
reset network. `SPIKE_PREFIX` must contain only letters, numbers, underscores, and
hyphens. Site paths are created as `<prefix>-<zero-padded-number>`.

## Outputs

`create-sites.sh` writes `provisioning.csv` with one row per requested site:

`site_number,blog_id,slug,started_at_utc,finished_at_utc,provisioning_ms,status`

`measure.sh` writes `measurements.csv` and a routing sample file in the selected
`SPIKE_LOG_DIR`. The summary records `wp_blogs`, `wp_site`, and `wp_sitemeta` table
size metrics, whole-database table/data/index/total bytes, probe site, sample count,
average, p50, p95, p99, and maximum routing latency. The individual routing sample
file preserves every successful and failed probe.

The latency probe is `wp option get blogname --url=<probe-url>`. It measures the
WP-CLI-to-WordPress path as well as database selection, so report the same command
and host conditions for all comparison runs. HyperDB routing latency alone cannot
be isolated without a lower-level driver trace; this limitation must remain in the
report.

`create-databases.sh` writes one row per database to
`database-provisioning.csv`:

`database_name,started_at_utc,finished_at_utc,create_database_ms,create_tables_ms,total_ms,table_count,status`

The database schema contains the 12 minimum WordPress-shaped tables listed in the
report. `measure-databases.sh` writes one row per selected database to
`database-measurements.csv` with one row per database plus an `aggregate,ALL` row,
including database count, table count, data/index/total bytes,
`innodb_file_per_table`, `table_open_cache`, `open_files_limit`, `Open_tables`,
`Open_files`, and the actual `/proc/<mysqld-pid>/fd` count. Set `MYSQL_SERVER_PID`
when automatic `mysqld`/`mariadbd` discovery is not suitable. The server values are
read-only observations and are not changed by the harness.

## Store lifecycle harness

`measure-store-lifecycle.sh` measures the operations that happen after a store
has been provisioned. It is intentionally a separate, destructive harness and
must only be pointed at disposable Multisite blogs and isolated databases.
It does not run as part of the repository tests; validate it with `bash -n` and
run it only from a documented spike environment.

Select a cohort with `SPIKE_OPERATION=delete`, `clone`, `upgrade`, or `all`.
The CSV is append-only after its header, so interrupted cohorts can resume with
`SPIKE_MULTISITE_DELETE_START`, `SPIKE_ISOLATED_DELETE_START`,
`SPIKE_CLONE_START`, or `SPIKE_UPGRADE_START`. The Multisite delete cursor
defaults to blog 2 so the network's main blog (blog 1) is not selected by
accident. The output
schema is shared by every operation:

`operation,topology,method,item_number,source_id,target_id,started_at_utc,finished_at_utc,elapsed_ms,cpu_user_s,cpu_system_s,cpu_total_s,files_created,files_deleted,storage_before_bytes,storage_after_bytes,storage_reclaimed_bytes,table_count_before,table_count_after,iops,status,error_stage,notes`

DELETE runs `wpmu_delete_blog(<id>, true)` for Multisite and `DROP DATABASE`
plus removal of the isolated store directory for Isolated. It records the
database/table and filesystem bytes before and after each operation. Compare
the deletion timings with the corresponding provisioning timings: deletion is
expected to be slower for Multisite because roughly 50 prefixed tables are
removed. The report must state whether that expectation was observed rather
than treating it as a result in advance.

CLONE is the primary topology comparison. Isolated uses `mysqldump` piped into
`mysql` for one database. Multisite copies every `wp_<source>_*` table to the
target prefix, updates `wp_blogs`, recreates the target capabilities key in
the global `wp_usermeta`, and runs a URL search-replace over the copied tables.
Set `SPIKE_MULTISITE_SOURCE_URL` and `SPIKE_MULTISITE_TARGET_URL` for the URL
step; the default clone example is blog 2 to blog 7.

UPGRADE always emits both isolated methods: `symlink` to the shared
`SPIKE_DISTRIBUTION_SOURCE` and `copy` into a private directory. Do not compare
Multisite with only the private-copy result. Upgrade Distribution is the one
measurement that can favor Multisite; the CSV note records this limitation so
the report can disclose it. The other common harnesses already favor Isolated,
so this single balancing measurement should be shown explicitly instead of
being used as a post-hoc justification.

In addition to elapsed time, the harness records process CPU time, file/link
creation and deletion counts, and apparent storage bytes. IOPS is not measured
by this shell harness and is recorded as `not_measured` in every row; it must
never be left blank or inferred from elapsed time.

Example configuration (do not run against production):

```bash
export WP_PATH=/srv/wordpress
export SPIKE_MULTISITE_DATABASE=wordpress_spike
export SPIKE_MULTISITE_SOURCE_URL=https://source.example.test/site-2/
export SPIKE_MULTISITE_TARGET_URL=https://clone.example.test/site-7/
export SPIKE_ISOLATED_DATABASE_PREFIX=store_
export SPIKE_ISOLATED_ROOT=/var/tmp/spike-001-isolated-sites
export SPIKE_DISTRIBUTION_SOURCE=/srv/wordpress
export SPIKE_LOG_DIR=/var/tmp/spike-001-lifecycle

bash -n scripts/spike/measure-store-lifecycle.sh
SPIKE_OPERATION=clone scripts/spike/measure-store-lifecycle.sh
SPIKE_OPERATION=upgrade scripts/spike/measure-store-lifecycle.sh
```

`measure-isolated-provisioning.sh` writes one row per isolated store to
`isolated-provisioning.csv`:

`store_number,store_slug,database_name,install_root,started_at_utc,finished_at_utc,create_database_ms,link_source_ms,wp_config_ms,wp_core_install_ms,filesystem_bytes,database_table_count,database_data_bytes,database_index_bytes,database_total_bytes,status,error_stage`

Set `SPIKE_WORDPRESS_SOURCE` (or `WP_PATH`) to a WordPress core tree. The script
creates a separate database and installation root for every store, symlinking the
shared core tree and keeping `wp-config.php` and `wp-content` per-store. The
`filesystem_bytes` value is the writable per-store footprint (`wp-config.php` and
`wp-content`); shared core bytes are intentionally not counted once per store.
`SPIKE_ISOLATED_SITES` defaults to 100, and `SPIKE_ISOLATED_START` resumes from a
store number after an interrupted run. A failed or partial current store must be
cleaned up before resuming at the next number.

When `SPIKE_MULTISITE_WP_PATH` and/or `SPIKE_MULTISITE_REST_URL` is set, the same
script provisions a second, sequential cohort and writes `multisite-comparison.csv`.
The wp-cli method uses `wp site create`; the REST method calls the MU Plugin
`/platform/v1/sites` endpoint. This makes the comparison run on the same host and
at the same time as the isolated measurement. Compare its output with Spike #003's
historical Multisite reference values: about 382 ms through the MU Plugin REST
path and about 1,400 ms through wp-cli. Those values are evidence for comparison,
not a substitute for the fresh run.

## Safety and cleanup

`teardown.sh` selects only sites whose path starts with the validated
`SPIKE_PREFIX-`. It refuses to delete anything unless both `--yes` and
`SPIKE_TEARDOWN_CONFIRM=DELETE_SPIKE_SITES` are supplied. Review its printed site
list and archive the measurement files before cleanup.

`teardown-databases.sh` selects only schemas whose name is exactly the configured
`SPIKE_DATABASE_PREFIX` followed by decimal digits. It refuses to drop anything
unless both `--yes` and `SPIKE_TEARDOWN_CONFIRM=DELETE_SPIKE_DATABASES` are supplied.
Review the printed schema list and archive both CSV files before cleanup.
