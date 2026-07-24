#!/usr/bin/env bash

set -euo pipefail

MYSQL_BIN="${MYSQL_BIN:-mysql}"
MYSQL_HOST="${MYSQL_HOST:-127.0.0.1}"
MYSQL_USER="${MYSQL_USER:-}"
MYSQL_PORT="${MYSQL_PORT:-}"
MYSQL_SOCKET="${MYSQL_SOCKET:-}"
SPIKE_DATABASE_PREFIX="${SPIKE_DATABASE_PREFIX:-store_}"

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

database_list="$(mysql_cmd --execute="SELECT SCHEMA_NAME FROM information_schema.schemata;" | \
  awk -v prefix="$SPIKE_DATABASE_PREFIX" 'index($0, prefix) == 1 && substr($0, length(prefix) + 1) ~ /^[0-9]+$/ {print}' | \
  sort -V)"
if [[ -z "$database_list" ]]; then
  printf 'no databases found for prefix %s\n' "$SPIKE_DATABASE_PREFIX"
  exit 0
fi

printf 'databases selected for deletion (exact prefix %s plus numeric id):\n%s\n' \
  "$SPIKE_DATABASE_PREFIX" "$database_list"
if [[ "${1:-}" != --yes || "${SPIKE_TEARDOWN_CONFIRM:-}" != DELETE_SPIKE_DATABASES ]]; then
  printf 'refusing deletion: pass --yes and SPIKE_TEARDOWN_CONFIRM=DELETE_SPIKE_DATABASES\n' >&2
  exit 2
fi

while IFS= read -r database_name; do
  [[ -z "$database_name" ]] && continue
  if [[ ! "$database_name" =~ ^${SPIKE_DATABASE_PREFIX}[0-9]+$ ]]; then
    printf 'unexpected database name from server: %s\n' "$database_name" >&2
    exit 2
  fi
  mysql_cmd --execute="DROP DATABASE \`${database_name}\`;"
  printf 'deleted %s\n' "$database_name"
done <<<"$database_list"
