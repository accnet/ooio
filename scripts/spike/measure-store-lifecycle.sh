#!/usr/bin/env bash

set -euo pipefail

# Measure the operations that make a store portable after it exists. This is a
# disposable harness: it deliberately performs real deletes and clones when
# invoked, so use a test network and databases only.
SPIKE_OPERATION="${SPIKE_OPERATION:-${SPIKE_LIFECYCLE_OPERATION:-all}}"
SPIKE_LOG_DIR="${SPIKE_LOG_DIR:-./spike-001-lifecycle}"
SPIKE_OUTPUT="${SPIKE_OUTPUT:-${SPIKE_LOG_DIR}/store-lifecycle.csv}"
SPIKE_MULTISITE_DELETE_START="${SPIKE_MULTISITE_DELETE_START:-2}"
SPIKE_ISOLATED_DELETE_START="${SPIKE_ISOLATED_DELETE_START:-1}"
SPIKE_CLONE_START="${SPIKE_CLONE_START:-1}"
SPIKE_UPGRADE_START="${SPIKE_UPGRADE_START:-1}"

WP_BIN="${WP_BIN:-wp}"
WP_PATH="${WP_PATH:-}"
MYSQL_BIN="${MYSQL_BIN:-mysql}"
MYSQLDUMP_BIN="${MYSQLDUMP_BIN:-mysqldump}"
MYSQL_HOST="${MYSQL_HOST:-127.0.0.1}"
MYSQL_USER="${MYSQL_USER:-}"
MYSQL_PORT="${MYSQL_PORT:-}"
MYSQL_SOCKET="${MYSQL_SOCKET:-}"

# Multisite inputs. The source and target blog IDs are intentionally explicit:
# a clone is normally measured as blog 2 -> blog 7 in the spike report.
SPIKE_MULTISITE_DATABASE="${SPIKE_MULTISITE_DATABASE:-}"
SPIKE_MULTISITE_SOURCE_BLOG_ID="${SPIKE_MULTISITE_SOURCE_BLOG_ID:-2}"
SPIKE_MULTISITE_TARGET_BLOG_ID="${SPIKE_MULTISITE_TARGET_BLOG_ID:-7}"
SPIKE_MULTISITE_CLONE_DOMAIN="${SPIKE_MULTISITE_CLONE_DOMAIN:-}"
SPIKE_MULTISITE_CLONE_PATH="${SPIKE_MULTISITE_CLONE_PATH:-}"
SPIKE_MULTISITE_SOURCE_URL="${SPIKE_MULTISITE_SOURCE_URL:-}"
SPIKE_MULTISITE_TARGET_URL="${SPIKE_MULTISITE_TARGET_URL:-}"
SPIKE_MULTISITE_ROOT="${SPIKE_MULTISITE_ROOT:-$WP_PATH}"

# Isolated inputs. A delete drops the selected database and removes its root;
# a clone only measures the database dump/restore, as requested by ADR-005.
SPIKE_ISOLATED_DATABASE_PREFIX="${SPIKE_ISOLATED_DATABASE_PREFIX:-isolated_}"
SPIKE_ISOLATED_SOURCE_DATABASE="${SPIKE_ISOLATED_SOURCE_DATABASE:-${SPIKE_ISOLATED_DATABASE_PREFIX}2}"
SPIKE_ISOLATED_TARGET_DATABASE="${SPIKE_ISOLATED_TARGET_DATABASE:-${SPIKE_ISOLATED_DATABASE_PREFIX}7}"
SPIKE_ISOLATED_ROOT="${SPIKE_ISOLATED_ROOT:-${SPIKE_LOG_DIR}/isolated-sites}"
SPIKE_ISOLATED_SOURCE_ROOT="${SPIKE_ISOLATED_SOURCE_ROOT:-${SPIKE_ISOLATED_ROOT}/isolated-0002}"
SPIKE_ISOLATED_TARGET_ROOT="${SPIKE_ISOLATED_TARGET_ROOT:-${SPIKE_ISOLATED_ROOT}/isolated-0007}"

# Distribution inputs. The same source is materialized once as a shared-core
# symlink and once as a private copy, so the Multisite comparison is not given
# an unfair advantage by measuring only one isolated deployment strategy.
SPIKE_DISTRIBUTION_SOURCE="${SPIKE_DISTRIBUTION_SOURCE:-${SPIKE_WORDPRESS_SOURCE:-}}"
SPIKE_UPGRADE_ROOT="${SPIKE_UPGRADE_ROOT:-${SPIKE_LOG_DIR}/distribution-upgrades}"
SPIKE_UPGRADE_SITES="${SPIKE_UPGRADE_SITES:-1}"
SPIKE_UPGRADE_SOURCE_ROOT="${SPIKE_UPGRADE_SOURCE_ROOT:-}"

SPIKE_DB_PASSWORD="${SPIKE_DB_PASSWORD:-${MYSQL_PASSWORD:-${MYSQL_PWD:-}}}"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/spike-store-lifecycle.XXXXXX")"
trap 'rm -rf -- "$TMP_ROOT"' EXIT

die() {
  printf '%s\n' "$1" >&2
  exit 2
}

positive_integer() {
  local name="$1" value="$2"
  [[ "$value" =~ ^[0-9]+$ ]] && (( value >= 1 )) || die "$name must be a positive integer"
}

safe_identifier() {
  [[ "$1" =~ ^[A-Za-z][A-Za-z0-9_]*$ ]]
}

safe_blog_id() {
  [[ "$1" =~ ^[0-9]+$ ]] && (( $1 >= 1 ))
}

now_ms() {
  local value
  value="$(date +%s%N 2>/dev/null)"
  if [[ "$value" == *N* ]]; then
    date +%s000
  else
    printf '%s\n' "$((value / 1000000))"
  fi
}

# Connection flags only. `--batch` and `--skip-column-names` belong to the mysql
# client and are REJECTED by mysqldump ("unknown option '--batch'", exit 2), so
# they are added by mysql_cmd rather than shared here. Sharing them made every
# dump/restore fail while the surrounding pipeline still looked plausible.
mysql_args() {
  MYSQL_ARGS=()
  [[ -n "$MYSQL_HOST" ]] && MYSQL_ARGS+=(--host="$MYSQL_HOST")
  [[ -n "$MYSQL_USER" ]] && MYSQL_ARGS+=(--user="$MYSQL_USER")
  [[ -n "$MYSQL_PORT" ]] && MYSQL_ARGS+=(--port="$MYSQL_PORT")
  [[ -n "$MYSQL_SOCKET" ]] && MYSQL_ARGS+=(--socket="$MYSQL_SOCKET")
}

mysql_cmd() {
  local database=''
  if [[ "${1:-}" != --* ]]; then
    database="$1"
    shift
  fi
  mysql_args
  if [[ -n "$database" ]]; then
    MYSQL_PWD="$SPIKE_DB_PASSWORD" "$MYSQL_BIN" --batch --skip-column-names "${MYSQL_ARGS[@]}" "$database" "$@"
  else
    MYSQL_PWD="$SPIKE_DB_PASSWORD" "$MYSQL_BIN" --batch --skip-column-names "${MYSQL_ARGS[@]}" "$@"
  fi
}

mysqldump_cmd() {
  mysql_args
  MYSQL_PWD="$SPIKE_DB_PASSWORD" "$MYSQLDUMP_BIN" "${MYSQL_ARGS[@]}" \
    --single-transaction --quick --no-tablespaces "$@"
}

wp_cmd() {
  [[ -n "$WP_PATH" ]] || die "WP_PATH is required for this operation"
  "$WP_BIN" --path="$WP_PATH" "$@"
}

database_exists() {
  local database="$1"
  mysql_cmd --execute="SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name = '${database}';" \
    | tr -d '\r\n'
}

database_metrics() {
  local database="$1"
  if [[ "$(database_exists "$database")" == 1 ]]; then
    mysql_cmd "$database" --execute='SELECT COUNT(*), COALESCE(SUM(data_length), 0), COALESCE(SUM(index_length), 0), COALESCE(SUM(data_length + index_length), 0) FROM information_schema.tables WHERE table_schema = DATABASE();' |
      tr '\t' ' ' | tr -d '\r'
  else
    printf '0 0 0 0\n'
  fi
}

# In SQL LIKE, `_` is a SINGLE-CHARACTER WILDCARD, so 'wp_2_%' also matches
# wp_20_commentmeta, wp_21_posts and every other two-digit blog. That silently
# pulls another store's tables into a clone. Escaping makes the prefix literal.
sql_like_prefix() {
  local value="${1//\\/\\\\}"
  value="${value//_/\\_}"
  value="${value//%/\\%}"
  printf '%s' "$value"
}

prefix_metrics() {
  local database="$1" prefix="$2"
  mysql_cmd "$database" --execute="SELECT COUNT(*), COALESCE(SUM(data_length), 0), COALESCE(SUM(index_length), 0), COALESCE(SUM(data_length + index_length), 0) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name LIKE '$(sql_like_prefix "$prefix")%';" |
    tr '\t' ' ' | tr -d '\r'
}

path_bytes() {
  local path="$1"
  if [[ -e "$path" || -L "$path" ]]; then
    du -sb --apparent-size -- "$path" 2>/dev/null | awk 'NR == 1 {print $1; exit}'
  else
    printf '0\n'
  fi
}

file_snapshot() {
  local path="$1" output="$2"
  if [[ -L "$path" ]]; then
    printf '.\n' >"$output"
  elif [[ -d "$path" ]]; then
    find "$path" -mindepth 1 \( -type f -o -type l \) -printf '%P\n' 2>/dev/null | sort >"$output"
  else
    : >"$output"
  fi
}

file_diff() {
  local before="$1" after="$2"
  files_created="$(comm -13 "$before" "$after" | awk 'NF {count++} END {print count + 0}')"
  files_deleted="$(comm -23 "$before" "$after" | awk 'NF {count++} END {print count + 0}')"
}

safe_child_path() {
  local parent="$1" child="$2"
  local parent_real
  parent_real="$(mkdir -p -- "$parent" && cd -- "$parent" && pwd -P)"
  case "$child" in
    "$parent_real"/*) return 0 ;;
    *) die "refusing to operate outside lifecycle root: $child" ;;
  esac
}

csv_field() {
  local value="${1//\"/\"\"}"
  printf '"%s"' "$value"
}

write_row() {
  local -a fields=("$@")
  local i
  for ((i = 0; i < ${#fields[@]}; i++)); do
    (( i > 0 )) && printf ','
    csv_field "${fields[i]}"
  done
  printf '\n'
}

ensure_header() {
  mkdir -p "$(dirname "$SPIKE_OUTPUT")"
  if [[ ! -s "$SPIKE_OUTPUT" ]]; then
    printf 'operation,topology,method,item_number,source_id,target_id,started_at_utc,finished_at_utc,elapsed_ms,cpu_user_s,cpu_system_s,cpu_total_s,files_created,files_deleted,storage_before_bytes,storage_after_bytes,storage_reclaimed_bytes,table_count_before,table_count_after,iops,status,error_stage,notes\n' >"$SPIKE_OUTPUT"
  fi
}

run_timed() {
  local timing_file="$1"
  shift
  local status=0
  TIMEFORMAT='__SPIKE_CPU__ %U %S'
  { time "$@"; } 2>"$timing_file" || status=$?
  cpu_user_s="$(awk '$1 == "__SPIKE_CPU__" {print $2}' "$timing_file" | tail -n 1)"
  cpu_system_s="$(awk '$1 == "__SPIKE_CPU__" {print $3}' "$timing_file" | tail -n 1)"
  [[ -n "$cpu_user_s" ]] || cpu_user_s='unavailable'
  [[ -n "$cpu_system_s" ]] || cpu_system_s='unavailable'
  if [[ "$cpu_user_s" != unavailable && "$cpu_system_s" != unavailable ]]; then
    cpu_total_s="$(awk -v user="$cpu_user_s" -v sys="$cpu_system_s" 'BEGIN {printf "%.6f", user + sys}')"
  else
    cpu_total_s='unavailable'
  fi
  sed '/^__SPIKE_CPU__/d' "$timing_file" >&2 || true
  return "$status"
}

record_operation() {
  write_row "$@" >>"$SPIKE_OUTPUT"
}

multisite_database() {
  if [[ -n "$SPIKE_MULTISITE_DATABASE" ]]; then
    printf '%s\n' "$SPIKE_MULTISITE_DATABASE"
  else
    wp_cmd db query --skip-column-names --batch 'SELECT DATABASE();' | tr -d '\r\n'
  fi
}

multisite_prefix() {
  local prefix
  prefix="$(wp_cmd db prefix | tr -d '\r\n')"
  [[ "$prefix" =~ ^[A-Za-z0-9_]+$ ]] || die 'WP-CLI returned an unsafe database prefix'
  printf '%s\n' "$prefix"
}

multisite_table_metrics() {
  local database="$1" prefix="$2"
  prefix_metrics "$database" "$prefix"
}

delete_multisite_impl() {
  local blog_id="$1"
  wp_cmd eval "wpmu_delete_blog(${blog_id}, true);"
}

delete_isolated_impl() {
  local database="$1" root="$2"
  mysql_cmd --execute="DROP DATABASE \`${database}\`;"
  safe_child_path "$SPIKE_ISOLATED_ROOT" "$root"
  rm -rf -- "$root"
}

clone_isolated_impl() {
  local source_database="$1" target_database="$2"
  [[ "$source_database" != "$target_database" ]] || die 'isolated clone source and target databases must differ'
  [[ "$(database_exists "$source_database")" == 1 ]] || die "source database does not exist: $source_database"
  mysql_cmd --execute="DROP DATABASE IF EXISTS \`${target_database}\`; CREATE DATABASE \`${target_database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
  mysqldump_cmd "$source_database" | mysql_cmd "$target_database"
}

sql_quote() {
  local value="${1//\'/\'\'}"
  printf "'%s'" "$value"
}

clone_multisite_impl() {
  local database="$1" source_prefix="$2" target_prefix="$3"
  local source_blog="$SPIKE_MULTISITE_SOURCE_BLOG_ID" target_blog="$SPIKE_MULTISITE_TARGET_BLOG_ID"
  local source_table target_table suffix table_list='' source_tables
  local blogs_table="${source_prefix%${source_blog}_}blogs" usermeta_table="${source_prefix%${source_blog}_}usermeta"
  [[ "$source_prefix" != "$target_prefix" ]] || die 'Multisite clone prefixes must differ'
  [[ "$(mysql_cmd "$database" --execute="SELECT COUNT(*) FROM \`${blogs_table}\` WHERE blog_id = ${source_blog};" | tr -d '\r\n')" == 1 ]] || die "source blog does not exist: $source_blog"

  # Materialize the query before iterating so mysql failures are visible to
  # set -e/pipefail instead of becoming an empty process-substitution stream.
  source_tables="$(mysql_cmd "$database" --execute="SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name LIKE '$(sql_like_prefix "$source_prefix")%';" | tr -d '\r' | sort)"
  while IFS= read -r source_table; do
    [[ -z "$source_table" ]] && continue
    suffix="${source_table#"$source_prefix"}"
    target_table="${target_prefix}${suffix}"
    [[ "$source_table" == "$source_prefix"* && "$target_table" =~ ^[A-Za-z0-9_]+$ ]] || die "unsafe Multisite table name: $source_table"
    # WordPress creates tables with DEFAULT '0000-00-00 00:00:00' by relaxing
    # sql_mode itself. A default MySQL 8.4 session has NO_ZERO_DATE, so
    # CREATE TABLE ... LIKE REJECTS the very table WordPress just made
    # ("ERROR 1067: Invalid default value for 'comment_date'"). Relax the mode
    # for this session so the clone reproduces the source faithfully instead of
    # failing on a value the running site already contains. MariaDB is permissive
    # by default, which is why this only appears on MySQL.
    mysql_cmd "$database" --execute="SET SESSION sql_mode='NO_ENGINE_SUBSTITUTION'; DROP TABLE IF EXISTS \`${target_table}\`; CREATE TABLE \`${target_table}\` LIKE \`${source_table}\`; INSERT INTO \`${target_table}\` SELECT * FROM \`${source_table}\`;"
    if [[ -n "$table_list" ]]; then table_list+=","; fi
    table_list+="$target_table"
  done <<<"$source_tables"

  local clone_domain="${SPIKE_MULTISITE_CLONE_DOMAIN:-clone-${target_blog}.example.invalid}"
  local clone_path="${SPIKE_MULTISITE_CLONE_PATH:-/clone-${target_blog}/}"
  local source_cap="${source_prefix}capabilities" target_cap="${target_prefix}capabilities"
  mysql_cmd "$database" --execute="DELETE FROM \`${blogs_table}\` WHERE blog_id = ${target_blog}; INSERT INTO \`${blogs_table}\` (blog_id,site_id,domain,path,registered,last_updated,public,archived,mature,spam,deleted,lang_id) SELECT ${target_blog},site_id,$(sql_quote "$clone_domain"),$(sql_quote "$clone_path"),registered,last_updated,public,archived,mature,spam,deleted,lang_id FROM \`${blogs_table}\` WHERE blog_id = ${source_blog}; DELETE FROM \`${usermeta_table}\` WHERE meta_key = $(sql_quote "$target_cap"); INSERT INTO \`${usermeta_table}\` (user_id,meta_key,meta_value) SELECT user_id,$(sql_quote "$target_cap"),meta_value FROM \`${usermeta_table}\` WHERE meta_key = $(sql_quote "$source_cap");"

  [[ -n "$SPIKE_MULTISITE_SOURCE_URL" ]] || die 'SPIKE_MULTISITE_SOURCE_URL is required for Multisite clone'
  [[ -n "$SPIKE_MULTISITE_TARGET_URL" ]] || die 'SPIKE_MULTISITE_TARGET_URL is required for Multisite clone'
  [[ -n "$table_list" ]] || die "no source tables found for prefix $source_prefix"
  # wp search-replace takes tables as POSITIONAL arguments; there is no --tables
  # flag ("unknown --tables parameter. Did you mean '--table'?"). Passing the
  # comma-joined list as a flag made every Multisite clone fail after the tables
  # had already been copied — the expensive part had run, only the rewrite failed.
  local -a search_replace_tables=()
  IFS=',' read -r -a search_replace_tables <<<"$table_list"
  wp_cmd search-replace "$SPIKE_MULTISITE_SOURCE_URL" "$SPIKE_MULTISITE_TARGET_URL" \
    "${search_replace_tables[@]}" \
    --url="$SPIKE_MULTISITE_TARGET_URL" --skip-columns=guid \
    --precise --recurse-objects --quiet
}

upgrade_symlink_impl() {
  local target="$1"
  [[ ! -e "$target" && ! -L "$target" ]] || rm -rf -- "$target"
  mkdir -p "$(dirname "$target")"
  ln -s -- "$SPIKE_DISTRIBUTION_SOURCE" "$target"
}

upgrade_copy_impl() {
  local target="$1"
  [[ ! -e "$target" && ! -L "$target" ]] || rm -rf -- "$target"
  mkdir -p "$target"
  cp -a -- "$SPIKE_DISTRIBUTION_SOURCE/." "$target/"
}

# NOTE: the CSV has both source_id and target_id. A delete has no target, so an
# empty field must still be written — omitting it shifted every later column left
# by one and made elapsed_ms read as cpu_user_s (1022ms reported as 0.435ms).
run_delete_multisite() {
  local item="$1" database blog_id prefix root_before root_after
  local before after before_bytes after_bytes reclaimed fs_before fs_after
  local start_ms started finished elapsed status=pass error_stage='' timing="$TMP_ROOT/delete-multisite-$item.time"
  database="$(multisite_database)"; blog_id="$item"; prefix="$(multisite_prefix)${blog_id}_"; root="$SPIKE_MULTISITE_ROOT"
  # prefix_metrics returns: count, data_length, index_length, total. Take the
  # COUNT first like the isolated path does — skipping it reported data_length
  # (180224) as the table count.
  read -r before _ _ before_bytes <<<"$(multisite_table_metrics "$database" "$prefix")"
  fs_before="$(path_bytes "$root")"; file_snapshot "$root" "$TMP_ROOT/before"
  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"; start_ms="$(now_ms)"
  if ! run_timed "$timing" delete_multisite_impl "$blog_id"; then status=failed; error_stage=delete; fi
  elapsed="$(( $(now_ms) - start_ms ))"; finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  read -r _ after _ after_bytes <<<"$(multisite_table_metrics "$database" "$prefix")"
  fs_after="$(path_bytes "$root")"; file_snapshot "$root" "$TMP_ROOT/after"; file_diff "$TMP_ROOT/before" "$TMP_ROOT/after"
  before_bytes=$((before_bytes + fs_before)); after_bytes=$((after_bytes + fs_after)); reclaimed=$((before_bytes - after_bytes))
  record_operation delete multisite wpmu_delete_blog "$item" "$blog_id" '' "$started" "$finished" "$elapsed" "$cpu_user_s" "$cpu_system_s" "$cpu_total_s" "$files_created" "$files_deleted" "$before_bytes" "$after_bytes" "$reclaimed" "$before" "$after" not_measured "$status" "$error_stage" 'Multisite deletion is expected to be slower than creation; compare with provisioning.csv.'
}

run_delete_isolated() {
  local item="$1" database root before after before_bytes after_bytes reclaimed fs_before fs_after
  local start_ms started finished elapsed status=pass error_stage='' timing="$TMP_ROOT/delete-isolated-$item.time"
  database="${SPIKE_ISOLATED_DATABASE_PREFIX}${item}"; root="${SPIKE_ISOLATED_ROOT}/isolated-$(printf '%04d' "$item")"
  read -r before _ _ before_bytes <<<"$(database_metrics "$database")"; fs_before="$(path_bytes "$root")"; file_snapshot "$root" "$TMP_ROOT/before"
  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"; start_ms="$(now_ms)"
  if ! run_timed "$timing" delete_isolated_impl "$database" "$root"; then status=failed; error_stage=delete; fi
  elapsed="$(( $(now_ms) - start_ms ))"; finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  read -r after _ _ after_bytes <<<"$(database_metrics "$database")"; fs_after="$(path_bytes "$root")"; file_snapshot "$root" "$TMP_ROOT/after"; file_diff "$TMP_ROOT/before" "$TMP_ROOT/after"
  before_bytes=$((before_bytes + fs_before)); after_bytes=$((after_bytes + fs_after)); reclaimed=$((before_bytes - after_bytes))
  record_operation delete isolated 'DROP DATABASE + rm -rf' "$item" "$database" "$root" "$started" "$finished" "$elapsed" "$cpu_user_s" "$cpu_system_s" "$cpu_total_s" "$files_created" "$files_deleted" "$before_bytes" "$after_bytes" "$reclaimed" "$before" "$after" not_measured "$status" "$error_stage" 'Isolated deletion measures database and per-store filesystem reclamation.'
}

run_clone_isolated() {
  local item="$1" before after before_bytes after_bytes reclaimed source target
  local started finished start_ms elapsed status=pass error_stage='' timing="$TMP_ROOT/clone-isolated-$item.time"
  source="$SPIKE_ISOLATED_SOURCE_DATABASE"; target="$SPIKE_ISOLATED_TARGET_DATABASE"
  read -r before _ _ before_bytes <<<"$(database_metrics "$source")"; read -r _ _ _ after_bytes <<<"$(database_metrics "$target")"; after=0
  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"; start_ms="$(now_ms)"
  if ! run_timed "$timing" clone_isolated_impl "$source" "$target"; then status=failed; error_stage=dump_restore; fi
  elapsed="$(( $(now_ms) - start_ms ))"; finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"; read -r after _ _ after_bytes <<<"$(database_metrics "$target")"; reclaimed=$((after_bytes - before_bytes))
  record_operation clone isolated dump_restore "$item" "$source" "$target" "$started" "$finished" "$elapsed" "$cpu_user_s" "$cpu_system_s" "$cpu_total_s" 0 0 "$before_bytes" "$after_bytes" "$reclaimed" "$before" "$after" not_measured "$status" "$error_stage" 'Isolated clone is a database dump/restore; filesystem distribution is measured separately.'
}

run_clone_multisite() {
  local item="$1" database base_prefix source_prefix target_prefix source target before after before_bytes after_bytes reclaimed
  local started finished start_ms elapsed status=pass error_stage='' timing="$TMP_ROOT/clone-multisite-$item.time"
  database="$(multisite_database)"; base_prefix="$(multisite_prefix)"; source="${SPIKE_MULTISITE_SOURCE_BLOG_ID}"; target="${SPIKE_MULTISITE_TARGET_BLOG_ID}"
  source_prefix="${base_prefix}${source}_"; target_prefix="${base_prefix}${target}_"
  read -r before _ _ before_bytes <<<"$(database_metrics "$database")"; read -r after _ _ after_bytes <<<"$(database_metrics "$database")"
  file_snapshot "$SPIKE_MULTISITE_ROOT" "$TMP_ROOT/before"; started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"; start_ms="$(now_ms)"
  if ! run_timed "$timing" clone_multisite_impl "$database" "$source_prefix" "$target_prefix"; then status=failed; error_stage=copy_rewrite; fi
  elapsed="$(( $(now_ms) - start_ms ))"; finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"; read -r after _ _ after_bytes <<<"$(database_metrics "$database")"; file_snapshot "$SPIKE_MULTISITE_ROOT" "$TMP_ROOT/after"; file_diff "$TMP_ROOT/before" "$TMP_ROOT/after"; reclaimed=$((after_bytes - before_bytes))
  record_operation clone multisite 'copy_tables + wp_blogs + capabilities + search_replace' "$item" "$source" "$target" "$started" "$finished" "$elapsed" "$cpu_user_s" "$cpu_system_s" "$cpu_total_s" "$files_created" "$files_deleted" "$before_bytes" "$after_bytes" "$reclaimed" "$before" "$after" not_measured "$status" "$error_stage" 'Multisite clone copies every wp_<source>_* table and rewrites the target URL.'
}

run_upgrade() {
  local method="$1" item="$2" target before after before_bytes after_bytes reclaimed
  local started finished start_ms elapsed status=pass error_stage='' timing="$TMP_ROOT/upgrade-${method}-${item}.time"
  target="${SPIKE_UPGRADE_ROOT}/${method}-$(printf '%04d' "$item")"; before_bytes="$(path_bytes "$target")"; after_bytes=0; before=0; after=0
  file_snapshot "$target" "$TMP_ROOT/before"; started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"; start_ms="$(now_ms)"
  if [[ "$method" == symlink ]]; then
    run_timed "$timing" upgrade_symlink_impl "$target" || { status=failed; error_stage=symlink; }
  else
    run_timed "$timing" upgrade_copy_impl "$target" || { status=failed; error_stage=copy; }
  fi
  elapsed="$(( $(now_ms) - start_ms ))"; finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"; after_bytes="$(path_bytes "$target")"; file_snapshot "$target" "$TMP_ROOT/after"; file_diff "$TMP_ROOT/before" "$TMP_ROOT/after"; reclaimed=$((after_bytes - before_bytes))
  record_operation upgrade isolated "$method" "$item" "$SPIKE_DISTRIBUTION_SOURCE" "$target" "$started" "$finished" "$elapsed" "$cpu_user_s" "$cpu_system_s" "$cpu_total_s" "$files_created" "$files_deleted" "$before_bytes" "$after_bytes" "$reclaimed" "$before" "$after" not_measured "$status" "$error_stage" 'Only upgrade distribution can favor Multisite; report both symlink and private-copy isolated results.'
}

[[ "$SPIKE_OPERATION" =~ ^(all|delete|clone|upgrade)$ ]] || die 'SPIKE_OPERATION must be all, delete, clone, or upgrade'
positive_integer SPIKE_MULTISITE_DELETE_START "$SPIKE_MULTISITE_DELETE_START"
positive_integer SPIKE_ISOLATED_DELETE_START "$SPIKE_ISOLATED_DELETE_START"
positive_integer SPIKE_CLONE_START "$SPIKE_CLONE_START"
positive_integer SPIKE_UPGRADE_START "$SPIKE_UPGRADE_START"
positive_integer SPIKE_UPGRADE_SITES "$SPIKE_UPGRADE_SITES"
safe_identifier "$SPIKE_ISOLATED_DATABASE_PREFIX" || die 'SPIKE_ISOLATED_DATABASE_PREFIX is unsafe'
safe_identifier "$SPIKE_ISOLATED_SOURCE_DATABASE" || die 'SPIKE_ISOLATED_SOURCE_DATABASE is unsafe'
safe_identifier "$SPIKE_ISOLATED_TARGET_DATABASE" || die 'SPIKE_ISOLATED_TARGET_DATABASE is unsafe'
safe_identifier "$SPIKE_MULTISITE_DATABASE" || [[ -z "$SPIKE_MULTISITE_DATABASE" ]] || die 'SPIKE_MULTISITE_DATABASE is unsafe'
[[ "$SPIKE_ISOLATED_ROOT" != / && -n "$SPIKE_ISOLATED_ROOT" ]] || die 'SPIKE_ISOLATED_ROOT must be a non-root directory'
safe_blog_id "$SPIKE_MULTISITE_SOURCE_BLOG_ID" || die 'SPIKE_MULTISITE_SOURCE_BLOG_ID must be a positive integer'
safe_blog_id "$SPIKE_MULTISITE_TARGET_BLOG_ID" || die 'SPIKE_MULTISITE_TARGET_BLOG_ID must be a positive integer'
ensure_header

if [[ "$SPIKE_OPERATION" == all || "$SPIKE_OPERATION" == delete ]]; then
  positive_integer SPIKE_MULTISITE_DELETE_COUNT "${SPIKE_MULTISITE_DELETE_COUNT:-1}"
  positive_integer SPIKE_ISOLATED_DELETE_COUNT "${SPIKE_ISOLATED_DELETE_COUNT:-1}"
  for ((i = SPIKE_MULTISITE_DELETE_START; i < SPIKE_MULTISITE_DELETE_START + ${SPIKE_MULTISITE_DELETE_COUNT:-1}; i++)); do run_delete_multisite "$i"; done
  for ((i = SPIKE_ISOLATED_DELETE_START; i < SPIKE_ISOLATED_DELETE_START + ${SPIKE_ISOLATED_DELETE_COUNT:-1}; i++)); do run_delete_isolated "$i"; done
fi

if [[ "$SPIKE_OPERATION" == all || "$SPIKE_OPERATION" == clone ]]; then
  run_clone_isolated "$SPIKE_CLONE_START"
  run_clone_multisite "$SPIKE_CLONE_START"
fi

if [[ "$SPIKE_OPERATION" == all || "$SPIKE_OPERATION" == upgrade ]]; then
  [[ -n "$SPIKE_DISTRIBUTION_SOURCE" && -d "$SPIKE_DISTRIBUTION_SOURCE" ]] || die 'SPIKE_DISTRIBUTION_SOURCE must be a readable directory for upgrade'
  for ((i = SPIKE_UPGRADE_START; i < SPIKE_UPGRADE_START + SPIKE_UPGRADE_SITES; i++)); do
    run_upgrade symlink "$i"
    run_upgrade copy "$i"
  done
fi

printf 'store lifecycle evidence: %s\n' "$SPIKE_OUTPUT"
