#!/usr/bin/env bash

set -euo pipefail

MYSQL_BIN="${MYSQL_BIN:-mysql}"
MYSQL_HOST="${MYSQL_HOST:-127.0.0.1}"
MYSQL_USER="${MYSQL_USER:-}"
MYSQL_PORT="${MYSQL_PORT:-}"
MYSQL_SOCKET="${MYSQL_SOCKET:-}"
SPIKE_DATABASE_PREFIX="${SPIKE_DATABASE_PREFIX:-store_}"
SPIKE_LOG_DIR="${SPIKE_LOG_DIR:-./spike-001-databases}"
SPIKE_OUTPUT="${SPIKE_OUTPUT:-${SPIKE_LOG_DIR}/database-measurements.csv}"
MYSQL_SERVER_PID="${MYSQL_SERVER_PID:-}"

if [[ ! "$SPIKE_DATABASE_PREFIX" =~ ^[A-Za-z][A-Za-z0-9_]*_$ ]]; then
  printf 'SPIKE_DATABASE_PREFIX must end with an underscore and contain only safe identifier characters\n' >&2
  exit 2
fi

mysql_cmd() {
  local -a args=(--batch --skip-column-names)
  [[ -n "$MYSQL_HOST" ]] && args+=(--host="$MYSQL_HOST")
  [[ -n "$MYSQL_USER" ]] && args+=(--user="$MYSQL_USER")
  [[ -n "$MYSQL_PORT" ]] && args+=(--port="$MYSQL_PORT")
  [[ -n "$MYSQL_SOCKET" ]] && args+=(--socket="$MYSQL_SOCKET")
  MYSQL_PWD="${MYSQL_PASSWORD:-${MYSQL_PWD:-}}" "$MYSQL_BIN" "${args[@]}" "$@"
}

mkdir -p "$(dirname "$SPIKE_OUTPUT")"

# Keep the selected set exact: prefix followed by decimal digits only. This
# excludes similarly named application databases from the aggregate.
database_list="$(mysql_cmd --execute="SELECT SCHEMA_NAME FROM information_schema.schemata;" | \
  awk -v prefix="$SPIKE_DATABASE_PREFIX" 'index($0, prefix) == 1 && substr($0, length(prefix) + 1) ~ /^[0-9]+$/ {print}' | \
  sort -V)"
if [[ -z "$database_list" ]]; then
  printf 'no databases found for prefix %s\n' "$SPIKE_DATABASE_PREFIX" >&2
  exit 1
fi

settings="$(mysql_cmd --execute="SHOW VARIABLES WHERE Variable_name IN ('innodb_file_per_table','table_open_cache','open_files_limit');" | \
  awk -F '\t' '{values[$1] = $2} END {printf "%s\t%s\t%s", values["innodb_file_per_table"], values["table_open_cache"], values["open_files_limit"]}')"
read -r innodb_file_per_table table_open_cache open_files_limit <<<"$settings"
status_values="$(mysql_cmd --execute="SHOW GLOBAL STATUS WHERE Variable_name IN ('Open_tables','Open_files');" | \
  awk -F '\t' '{values[$1] = $2} END {printf "%s\t%s", values["Open_tables"], values["Open_files"]}')"
read -r open_tables open_files <<<"$status_values"

server_pid="$MYSQL_SERVER_PID"
if [[ -z "$server_pid" ]]; then
  for candidate in $(pgrep -x mysqld 2>/dev/null || true) $(pgrep -x mariadbd 2>/dev/null || true); do
    if [[ "$candidate" =~ ^[0-9]+$ ]]; then
      server_pid="$candidate"
      break
    fi
  done
fi
server_fd_count='unavailable'
if [[ "$server_pid" =~ ^[0-9]+$ && -r "/proc/${server_pid}/fd" ]]; then
  server_fd_count="$(find "/proc/${server_pid}/fd" -mindepth 1 -maxdepth 1 -type l 2>/dev/null | wc -l | tr -d ' ' )"
fi

metrics_query="SELECT COUNT(*) AS table_count, COALESCE(SUM(data_length), 0) AS data_bytes, COALESCE(SUM(index_length), 0) AS index_bytes, COALESCE(SUM(data_length + index_length), 0) AS total_bytes FROM information_schema.tables WHERE table_schema = DATABASE();"

{
  printf 'scope,database_name,database_count,measured_at_utc,table_count,data_bytes,index_bytes,total_bytes,innodb_file_per_table,table_open_cache,open_files_limit,open_tables,open_files,server_fd_count\n'
  database_count="$(printf '%s\n' "$database_list" | awk 'NF {count++} END {print count + 0}')"
  aggregate_table_count=0
  aggregate_data_bytes=0
  aggregate_index_bytes=0
  aggregate_total_bytes=0
  while IFS= read -r database_name; do
    [[ -z "$database_name" ]] && continue
    metrics="$(mysql_cmd "$database_name" --execute="$metrics_query" | tr '\t' ' ' | tr -d '\r')"
    read -r table_count data_bytes index_bytes total_bytes <<<"$metrics"
    printf 'database,%s,1,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s\n' \
      "$database_name" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$table_count" \
      "$data_bytes" "$index_bytes" "$total_bytes" "$innodb_file_per_table" \
      "$table_open_cache" "$open_files_limit" "$open_tables" "$open_files" \
      "$server_fd_count"
    aggregate_table_count=$((aggregate_table_count + table_count))
    aggregate_data_bytes=$((aggregate_data_bytes + data_bytes))
    aggregate_index_bytes=$((aggregate_index_bytes + index_bytes))
    aggregate_total_bytes=$((aggregate_total_bytes + total_bytes))
  done <<<"$database_list"
  printf 'aggregate,ALL,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s\n' \
    "$database_count" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$aggregate_table_count" \
    "$aggregate_data_bytes" "$aggregate_index_bytes" "$aggregate_total_bytes" \
    "$innodb_file_per_table" "$table_open_cache" "$open_files_limit" "$open_tables" \
    "$open_files" "$server_fd_count"
} >"$SPIKE_OUTPUT"

printf 'database measurement evidence: %s\n' "$SPIKE_OUTPUT"
