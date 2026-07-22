#!/usr/bin/env bash

set -euo pipefail

# Measure whether an existing store can be exported and imported into another
# network. This harness is intentionally disposable and is never run as part
# of repository verification.
SPIKE_OPERATION="${SPIKE_OPERATION:-all}"
SPIKE_LOG_DIR="${SPIKE_LOG_DIR:-./spike-004-portability}"
SPIKE_OUTPUT="${SPIKE_OUTPUT:-${SPIKE_LOG_DIR}/store-portability.csv}"
SPIKE_MULTISITE_START="${SPIKE_MULTISITE_START:-1}"
SPIKE_ISOLATED_START="${SPIKE_ISOLATED_START:-1}"

WP_BIN="${WP_BIN:-wp}"
MYSQL_BIN="${MYSQL_BIN:-mysql}"
MYSQLDUMP_BIN="${MYSQLDUMP_BIN:-mysqldump}"
MYSQL_HOST="${MYSQL_HOST:-127.0.0.1}"
MYSQL_USER="${MYSQL_USER:-}"
MYSQL_PORT="${MYSQL_PORT:-}"
MYSQL_SOCKET="${MYSQL_SOCKET:-}"
SPIKE_DB_PASSWORD="${SPIKE_DB_PASSWORD:-${MYSQL_PASSWORD:-${MYSQL_PWD:-}}}"
SPIKE_DB_USER="${SPIKE_DB_USER:-$MYSQL_USER}"
SPIKE_DB_HOST="${SPIKE_DB_HOST:-}"

# Same-network clone: both blogs are in the source database and wp_users is
# global, so the sample user ID remains valid without an identity remap.
SPIKE_MULTISITE_DATABASE="${SPIKE_MULTISITE_DATABASE:-}"
SPIKE_MULTISITE_SOURCE_BLOG_ID="${SPIKE_MULTISITE_SOURCE_BLOG_ID:-2}"
SPIKE_MULTISITE_TARGET_BLOG_ID="${SPIKE_MULTISITE_TARGET_BLOG_ID:-7}"
SPIKE_MULTISITE_TABLE_PREFIX="${SPIKE_MULTISITE_TABLE_PREFIX:-wp_}"
SPIKE_MULTISITE_SOURCE_URL="${SPIKE_MULTISITE_SOURCE_URL:-}"
SPIKE_MULTISITE_TARGET_URL="${SPIKE_MULTISITE_TARGET_URL:-}"
SPIKE_MULTISITE_WP_PATH="${SPIKE_MULTISITE_WP_PATH:-${WP_PATH:-}}"

# Cross-network clone: source and target are separate network databases. The
# target network already exists; only the selected site tables are imported.
SPIKE_MULTISITE_TARGET_DATABASE="${SPIKE_MULTISITE_TARGET_DATABASE:-}"
SPIKE_MULTISITE_TARGET_TABLE_PREFIX="${SPIKE_MULTISITE_TARGET_TABLE_PREFIX:-$SPIKE_MULTISITE_TABLE_PREFIX}"
SPIKE_MULTISITE_TARGET_WP_PATH="${SPIKE_MULTISITE_TARGET_WP_PATH:-}"
SPIKE_EXPECT_TARGET_USER_ABSENT="${SPIKE_EXPECT_TARGET_USER_ABSENT:-1}"
SPIKE_REFERENCE_USER_ID="${SPIKE_REFERENCE_USER_ID:-7}"

# Isolated clone: restore one database, generate a new wp-config.php, and
# rewrite URLs. Runtime users travel with the database; no ID remap is needed.
SPIKE_ISOLATED_SOURCE_DATABASE="${SPIKE_ISOLATED_SOURCE_DATABASE:-}"
SPIKE_ISOLATED_TARGET_DATABASE="${SPIKE_ISOLATED_TARGET_DATABASE:-}"
SPIKE_ISOLATED_SOURCE_URL="${SPIKE_ISOLATED_SOURCE_URL:-}"
SPIKE_ISOLATED_TARGET_URL="${SPIKE_ISOLATED_TARGET_URL:-}"
SPIKE_WORDPRESS_SOURCE="${SPIKE_WORDPRESS_SOURCE:-${WP_PATH:-}}"
SPIKE_ISOLATED_ROOT="${SPIKE_ISOLATED_ROOT:-${SPIKE_LOG_DIR}/isolated-sites}"
SPIKE_ISOLATED_TARGET_ROOT="${SPIKE_ISOLATED_TARGET_ROOT:-${SPIKE_ISOLATED_ROOT}/isolated-import}"

MULTISITE_REFERENCE_COUNT=0

TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/spike-store-portability.XXXXXX")"
trap 'rm -rf -- "$TMP_ROOT"' EXIT

die() {
  printf '%s\n' "$1" >&2
  exit 2
}

step_fail() {
  STEP_STATUS_OVERRIDE="$1"
  STEP_ERROR_STAGE="$2"
  [[ "$1" == manual_intervention_required ]] && STEP_AUTOMATABLE_OVERRIDE=no
  printf '%s\n' "${3:-portability step failed}" >&2
  return 1
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

sql_quote() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\'/\'\'}"
  printf "'%s'" "$value"
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

mysql_args() {
  MYSQL_ARGS=(--batch --skip-column-names --raw)
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
    MYSQL_PWD="$SPIKE_DB_PASSWORD" "$MYSQL_BIN" "${MYSQL_ARGS[@]}" "$database" "$@"
  else
    MYSQL_PWD="$SPIKE_DB_PASSWORD" "$MYSQL_BIN" "${MYSQL_ARGS[@]}" "$@"
  fi
}

mysqldump_cmd() {
  local -a args=(--single-transaction --quick --no-tablespaces)
  [[ -n "$MYSQL_HOST" ]] && args+=(--host="$MYSQL_HOST")
  [[ -n "$MYSQL_USER" ]] && args+=(--user="$MYSQL_USER")
  [[ -n "$MYSQL_PORT" ]] && args+=(--port="$MYSQL_PORT")
  [[ -n "$MYSQL_SOCKET" ]] && args+=(--socket="$MYSQL_SOCKET")
  MYSQL_PWD="$SPIKE_DB_PASSWORD" "$MYSQLDUMP_BIN" "${args[@]}" "$@"
}

wp_cmd() {
  local path="$1"
  shift
  [[ -n "$path" ]] || die 'a WordPress path is required for this operation'
  "$WP_BIN" --path="$path" "$@"
}

csv_field() {
  local value="${1//\"/\"\"}"
  printf '"%s"' "$value"
}

record_row() {
  local -a fields=("$@")
  local i
  for ((i = 0; i < ${#fields[@]}; i++)); do
    (( i > 0 )) && printf ','
    csv_field "${fields[i]}"
  done
  printf '\n' >>"$SPIKE_OUTPUT"
}

ensure_header() {
  mkdir -p "$(dirname "$SPIKE_OUTPUT")"
  if [[ ! -s "$SPIKE_OUTPUT" ]]; then
    printf 'operation,topology,method,item_number,source_id,target_id,started_at_utc,finished_at_utc,elapsed_ms,cpu_user_s,cpu_system_s,cpu_total_s,export_bytes,user_id_references_to_remap,automatable,status,error_stage,notes\n' >"$SPIKE_OUTPUT"
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

run_step() {
  local operation="$1" topology="$2" method="$3" item="$4" source="$5" target="$6"
  local remap_count="$7" automatable="$8" notes="$9" function_name="${10}"
  shift 10
  local started finished start_ms elapsed status=pass error_stage='' timing="$TMP_ROOT/${topology}-${method}-${item}.time"

  STEP_STATUS_OVERRIDE=pass
  STEP_ERROR_STAGE=''
  STEP_EXPORT_BYTES=0
  STEP_USER_REMAP_COUNT=0
  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  start_ms="$(now_ms)"
  STEP_AUTOMATABLE_OVERRIDE=''
  if ! run_timed "$timing" "$function_name" "$@"; then
    status="${STEP_STATUS_OVERRIDE:-failed}"
    error_stage="${STEP_ERROR_STAGE:-operation}"
  fi
  [[ "$remap_count" == auto ]] && remap_count="${STEP_USER_REMAP_COUNT:-0}"
  [[ -n "$STEP_AUTOMATABLE_OVERRIDE" ]] && automatable="$STEP_AUTOMATABLE_OVERRIDE"
  elapsed="$(( $(now_ms) - start_ms ))"
  finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  record_row "$operation" "$topology" "$method" "$item" "$source" "$target" "$started" "$finished" "$elapsed" \
    "$cpu_user_s" "$cpu_system_s" "$cpu_total_s" "$STEP_EXPORT_BYTES" "$remap_count" "$automatable" \
    "$status" "$error_stage" "$notes"
  LAST_STEP_STATUS="$status"
  [[ "$status" == pass ]]
}

database_exists() {
  local database="$1"
  mysql_cmd --execute="SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name = $(sql_quote "$database");" | tr -d '\r\n'
}

table_exists() {
  local database="$1" table="$2"
  mysql_cmd "$database" --execute="SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = $(sql_quote "$table");" | tr -d '\r\n'
}

list_site_tables() {
  local database="$1" prefix="$2"
  mysql_cmd "$database" --execute="SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND LEFT(table_name, CHAR_LENGTH($(sql_quote "$prefix"))) = $(sql_quote "$prefix") ORDER BY table_name;" | tr -d '\r'
}

require_table_set() {
  local database="$1" prefix="$2" table
  for table in "${prefix}posts" "${prefix}comments" "${prefix}wc_orders"; do
    [[ "$(table_exists "$database" "$table")" == 1 ]] || die "required portability table is missing: ${database}.${table}"
  done
  [[ "$(table_exists "$database" "${prefix%${SPIKE_MULTISITE_SOURCE_BLOG_ID}_}users")" == 1 ]] || die "global users table is missing in $database"
  [[ "$(table_exists "$database" "${prefix%${SPIKE_MULTISITE_SOURCE_BLOG_ID}_}usermeta")" == 1 ]] || die "global usermeta table is missing in $database"
}

multisite_reference_count() {
  local database="$1" site_prefix="$2" usermeta_table="$3"
  mysql_cmd "$database" --execute="SELECT COALESCE((SELECT COUNT(*) FROM \`${site_prefix}posts\` WHERE post_author > 0), 0) + COALESCE((SELECT COUNT(*) FROM \`${site_prefix}comments\` WHERE user_id > 0), 0) + COALESCE((SELECT COUNT(*) FROM \`${site_prefix}wc_orders\` WHERE customer_id > 0), 0) + COALESCE((SELECT COUNT(*) FROM \`${usermeta_table}\` WHERE meta_key = $(sql_quote "${site_prefix}capabilities") AND user_id > 0), 0);" | tr -d '\r\n'
}

multisite_reference_ids() {
  local database="$1" site_prefix="$2" usermeta_table="$3"
  mysql_cmd "$database" --execute="SELECT DISTINCT user_id FROM (SELECT post_author AS user_id FROM \`${site_prefix}posts\` WHERE post_author > 0 UNION SELECT user_id FROM \`${site_prefix}comments\` WHERE user_id > 0 UNION SELECT customer_id AS user_id FROM \`${site_prefix}wc_orders\` WHERE customer_id > 0 UNION SELECT user_id FROM \`${usermeta_table}\` WHERE meta_key = $(sql_quote "${site_prefix}capabilities") AND user_id > 0) AS refs ORDER BY user_id;" | tr -d '\r'
}

copy_multisite_tables() {
  local database="$1" source_prefix="$2" target_prefix="$3" source_table suffix target_table table_list=''
  while IFS= read -r source_table; do
    [[ -n "$source_table" ]] || continue
    suffix="${source_table#"$source_prefix"}"
    target_table="${target_prefix}${suffix}"
    safe_identifier "$source_table" && safe_identifier "$target_table" || die "unsafe Multisite table name: $source_table"
    mysql_cmd "$database" --execute="DROP TABLE IF EXISTS \`${target_table}\`; CREATE TABLE \`${target_table}\` LIKE \`${source_table}\`; INSERT INTO \`${target_table}\` SELECT * FROM \`${source_table}\`;"
    [[ -z "$table_list" ]] || table_list+=','
    table_list+="$target_table"
  done < <(list_site_tables "$database" "$source_prefix")
  [[ -n "$table_list" ]] || die "no source tables found for prefix $source_prefix"
  COPIED_TABLE_LIST="$table_list"
}

write_blog_row() {
  local database="$1" base_prefix="$2" source_blog="$3" target_blog="$4" target_domain="$5" target_path="$6"
  local blogs_table="${base_prefix}blogs" usermeta_table="${base_prefix}usermeta"
  mysql_cmd "$database" --execute="DELETE FROM \`${blogs_table}\` WHERE blog_id = ${target_blog}; INSERT INTO \`${blogs_table}\` (blog_id,site_id,domain,path,registered,last_updated,public,archived,mature,spam,deleted,lang_id) SELECT ${target_blog},site_id,$(sql_quote "$target_domain"),$(sql_quote "$target_path"),registered,last_updated,public,archived,mature,spam,deleted,lang_id FROM \`${blogs_table}\` WHERE blog_id = ${source_blog};"
  local source_cap="${base_prefix}${source_blog}_capabilities" target_cap="${base_prefix}${target_blog}_capabilities"
  mysql_cmd "$database" --execute="DELETE FROM \`${usermeta_table}\` WHERE meta_key = $(sql_quote "$target_cap"); INSERT INTO \`${usermeta_table}\` (user_id,meta_key,meta_value) SELECT user_id,$(sql_quote "$target_cap"),meta_value FROM \`${usermeta_table}\` WHERE meta_key = $(sql_quote "$source_cap");"
}

multisite_same_network_clone_impl() {
  local database="$SPIKE_MULTISITE_DATABASE" source_prefix="${SPIKE_MULTISITE_TABLE_PREFIX}${SPIKE_MULTISITE_SOURCE_BLOG_ID}_" target_prefix="${SPIKE_MULTISITE_TABLE_PREFIX}${SPIKE_MULTISITE_TARGET_BLOG_ID}_"
  copy_multisite_tables "$database" "$source_prefix" "$target_prefix"
  write_blog_row "$database" "$SPIKE_MULTISITE_TABLE_PREFIX" "$SPIKE_MULTISITE_SOURCE_BLOG_ID" "$SPIKE_MULTISITE_TARGET_BLOG_ID" \
    "${SPIKE_MULTISITE_TARGET_DOMAIN:-clone-${SPIKE_MULTISITE_TARGET_BLOG_ID}.example.invalid}" \
    "${SPIKE_MULTISITE_TARGET_PATH:-/clone-${SPIKE_MULTISITE_TARGET_BLOG_ID}/}"
  wp_cmd "$SPIKE_MULTISITE_WP_PATH" search-replace "$SPIKE_MULTISITE_SOURCE_URL" "$SPIKE_MULTISITE_TARGET_URL" \
    --url="$SPIKE_MULTISITE_TARGET_URL" --tables="$COPIED_TABLE_LIST" --skip-columns=guid --precise --recurse-objects --quiet
}

multisite_same_network_audit_impl() {
  local database="$SPIKE_MULTISITE_DATABASE" users_table="${SPIKE_MULTISITE_TABLE_PREFIX}users" usermeta_table="${SPIKE_MULTISITE_TABLE_PREFIX}usermeta"
  local source_prefix="${SPIKE_MULTISITE_TABLE_PREFIX}${SPIKE_MULTISITE_SOURCE_BLOG_ID}_" count user_exists
  count="$(multisite_reference_count "$database" "$source_prefix" "$usermeta_table")"
  user_exists="$(mysql_cmd "$database" --execute="SELECT COUNT(*) FROM \`${users_table}\` WHERE ID = ${SPIKE_REFERENCE_USER_ID};" | tr -d '\r\n')"
  if [[ "$user_exists" != 1 ]]; then
    step_fail failed identity_fixture "same-network fixture must contain global wp_users ID ${SPIKE_REFERENCE_USER_ID}"
    return 1
  fi
  STEP_SOURCE_REFERENCE_COUNT="$count"
  STEP_USER_REMAP_COUNT=0
}

multisite_export_import_impl() {
  local source_database="$SPIKE_MULTISITE_DATABASE" target_database="$SPIKE_MULTISITE_TARGET_DATABASE"
  local source_prefix="${SPIKE_MULTISITE_TABLE_PREFIX}${SPIKE_MULTISITE_SOURCE_BLOG_ID}_" target_prefix="${SPIKE_MULTISITE_TARGET_TABLE_PREFIX}${SPIKE_MULTISITE_TARGET_BLOG_ID}_"
  local dump="$TMP_ROOT/multisite-${SPIKE_MULTISITE_START}.sql" source_table
  local -a tables=()
  if [[ "$source_database" == "$target_database" ]]; then
    step_fail failed topology 'cross-network source and target databases must differ'
    return 1
  fi
  while IFS= read -r source_table; do
    [[ -n "$source_table" ]] && tables+=("$source_table")
  done < <(list_site_tables "$source_database" "$source_prefix")
  if ((${#tables[@]} == 0)); then
    step_fail failed export "no source site tables found for $source_prefix"
    return 1
  fi
  if ! mysqldump_cmd --add-drop-table "$source_database" "${tables[@]}" >"$dump"; then
    step_fail failed export 'Multisite export failed'
    return 1
  fi
  STEP_EXPORT_BYTES="$(wc -c <"$dump" | tr -d '[:space:]')"
  if ! sed "s/\`${source_prefix}/\`${target_prefix}/g" "$dump" | mysql_cmd "$target_database"; then
    step_fail failed import 'Multisite import failed'
    return 1
  fi
}

multisite_cross_network_audit_impl() {
  local source_database="$SPIKE_MULTISITE_DATABASE" target_database="$SPIKE_MULTISITE_TARGET_DATABASE"
  local source_prefix="${SPIKE_MULTISITE_TABLE_PREFIX}${SPIKE_MULTISITE_SOURCE_BLOG_ID}_" source_users="${SPIKE_MULTISITE_TABLE_PREFIX}users" source_usermeta="${SPIKE_MULTISITE_TABLE_PREFIX}usermeta"
  local target_users="${SPIKE_MULTISITE_TARGET_TABLE_PREFIX}users" count source_user_exists target_user_exists
  count="$(multisite_reference_count "$source_database" "$source_prefix" "$source_usermeta")"
  source_user_exists="$(mysql_cmd "$source_database" --execute="SELECT COUNT(*) FROM \`${source_users}\` WHERE ID = ${SPIKE_REFERENCE_USER_ID};" | tr -d '\r\n')"
  target_user_exists="$(mysql_cmd "$target_database" --execute="SELECT COUNT(*) FROM \`${target_users}\` WHERE ID = ${SPIKE_REFERENCE_USER_ID};" | tr -d '\r\n')"
  if [[ "$source_user_exists" != 1 ]]; then
    step_fail failed identity_fixture "source fixture must contain global user ID ${SPIKE_REFERENCE_USER_ID}"
    return 1
  fi
  if [[ "$SPIKE_EXPECT_TARGET_USER_ABSENT" == 1 && "$target_user_exists" != 0 ]]; then
    step_fail manual_intervention_required identity_collision "target network already contains user ID ${SPIKE_REFERENCE_USER_ID}; identity cannot be inferred safely"
    return 1
  fi
  MULTISITE_REFERENCE_COUNT="$count"
  MULTISITE_REFERENCE_IDS_FILE="$TMP_ROOT/multisite-user-ids"
  multisite_reference_ids "$source_database" "$source_prefix" "$source_usermeta" >"$MULTISITE_REFERENCE_IDS_FILE"
  STEP_SOURCE_REFERENCE_COUNT="$count"
  STEP_USER_REMAP_COUNT="$count"
}

load_source_user() {
  local database="$1" users_table="$2" user_id="$3" row
  row="$(mysql_cmd "$database" --execute="SELECT ID,COALESCE(user_login,''),COALESCE(user_pass,''),COALESCE(user_nicename,''),COALESCE(user_email,''),COALESCE(user_url,''),COALESCE(user_registered,''),COALESCE(user_activation_key,''),COALESCE(user_status,0),COALESCE(display_name,'') FROM \`${users_table}\` WHERE ID = ${user_id};")"
  [[ -n "$row" ]] || return 1
  IFS=$'\t' read -r USER_ID USER_LOGIN USER_PASS USER_NICENAME USER_EMAIL USER_URL USER_REGISTERED USER_ACTIVATION_KEY USER_STATUS USER_DISPLAY_NAME <<<"$row"
  [[ "$USER_ID" == "$user_id" ]]
}

multisite_user_remap_impl() {
  local source_database="$SPIKE_MULTISITE_DATABASE" target_database="$SPIKE_MULTISITE_TARGET_DATABASE"
  local source_prefix="${SPIKE_MULTISITE_TABLE_PREFIX}${SPIKE_MULTISITE_SOURCE_BLOG_ID}_" target_prefix="${SPIKE_MULTISITE_TARGET_TABLE_PREFIX}${SPIKE_MULTISITE_TARGET_BLOG_ID}_"
  local source_users="${SPIKE_MULTISITE_TABLE_PREFIX}users" source_usermeta="${SPIKE_MULTISITE_TABLE_PREFIX}usermeta" target_users="${SPIKE_MULTISITE_TARGET_TABLE_PREFIX}users" target_usermeta="${SPIKE_MULTISITE_TARGET_TABLE_PREFIX}usermeta"
  local source_id target_id target_match meta_value source_cap="${source_prefix}capabilities" target_cap="${target_prefix}capabilities"
  local map_file="$TMP_ROOT/multisite-user-map"
  : >"$map_file"

  # Preflight every referenced identity before inserting anything. Reusing a
  # target login/email can merge two humans, so that case is manual by design.
  while IFS= read -r source_id; do
    [[ -n "$source_id" ]] || continue
    if ! load_source_user "$source_database" "$source_users" "$source_id"; then
      step_fail failed missing_user "source user ID ${source_id} is referenced but not present"
      return 1
    fi
    target_match="$(mysql_cmd "$target_database" --execute="SELECT ID FROM \`${target_users}\` WHERE user_email = $(sql_quote "$USER_EMAIL") OR user_login = $(sql_quote "$USER_LOGIN") LIMIT 1;" | tr -d '\r\n')"
    if [[ -n "$target_match" ]]; then
      step_fail manual_intervention_required identity_collision "target login/email collision for source user ID ${source_id}; user mapping is not safely automatable"
      return 1
    fi
  done <"$MULTISITE_REFERENCE_IDS_FILE"

  while IFS= read -r source_id; do
    [[ -n "$source_id" ]] || continue
    if ! load_source_user "$source_database" "$source_users" "$source_id"; then
      step_fail failed missing_user "source user ID ${source_id} is missing during remap"
      return 1
    fi
    target_id="$(mysql_cmd "$target_database" --execute="INSERT INTO \`${target_users}\` (user_login,user_pass,user_nicename,user_email,user_url,user_registered,user_activation_key,user_status,display_name) VALUES ($(sql_quote "$USER_LOGIN"),$(sql_quote "$USER_PASS"),$(sql_quote "$USER_NICENAME"),$(sql_quote "$USER_EMAIL"),$(sql_quote "$USER_URL"),$(sql_quote "$USER_REGISTERED"),$(sql_quote "$USER_ACTIVATION_KEY"),${USER_STATUS},$(sql_quote "$USER_DISPLAY_NAME")); SELECT LAST_INSERT_ID();" | tail -n 1 | tr -d '\r\n')"
    [[ "$target_id" =~ ^[0-9]+$ ]] || step_fail failed create_user "could not create target user for source ID ${source_id}"
    printf '%s\t%s\n' "$source_id" "$target_id" >>"$map_file"
  done <"$MULTISITE_REFERENCE_IDS_FILE"

  while IFS=$'\t' read -r source_id target_id; do
    [[ -n "$source_id" ]] || continue
    mysql_cmd "$target_database" --execute="UPDATE \`${target_prefix}posts\` SET post_author = ${target_id} WHERE post_author = ${source_id}; UPDATE \`${target_prefix}comments\` SET user_id = ${target_id} WHERE user_id = ${source_id}; UPDATE \`${target_prefix}wc_orders\` SET customer_id = ${target_id} WHERE customer_id = ${source_id};"
    mysql_cmd "$target_database" --execute="DELETE FROM \`${target_usermeta}\` WHERE user_id = ${target_id} AND meta_key = $(sql_quote "$target_cap");"
    while IFS= read -r meta_value; do
      mysql_cmd "$target_database" --execute="INSERT INTO \`${target_usermeta}\` (user_id,meta_key,meta_value) VALUES (${target_id},$(sql_quote "$target_cap"),$(sql_quote "$meta_value"));"
    done < <(mysql_cmd "$source_database" --execute="SELECT meta_value FROM \`${source_usermeta}\` WHERE user_id = ${source_id} AND meta_key = $(sql_quote "$source_cap");")
  done <"$map_file"
  STEP_USER_MAP_FILE="$map_file"
}

multisite_cross_network_search_replace_impl() {
  wp_cmd "$SPIKE_MULTISITE_TARGET_WP_PATH" search-replace "$SPIKE_MULTISITE_SOURCE_URL" "$SPIKE_MULTISITE_TARGET_URL" \
    --url="$SPIKE_MULTISITE_TARGET_URL" --all-tables-with-prefix --skip-columns=guid --precise --recurse-objects --quiet
}

isolated_export_impl() {
  local dump="$TMP_ROOT/isolated-${SPIKE_ISOLATED_START}.sql"
  if ! mysqldump_cmd "$SPIKE_ISOLATED_SOURCE_DATABASE" >"$dump"; then
    step_fail failed export 'isolated database export failed'
    return 1
  fi
  STEP_EXPORT_DUMP="$dump"
  STEP_EXPORT_BYTES="$(wc -c <"$dump" | tr -d '[:space:]')"
}

isolated_restore_impl() {
  if [[ "$SPIKE_ISOLATED_SOURCE_DATABASE" == "$SPIKE_ISOLATED_TARGET_DATABASE" ]]; then
    step_fail failed topology 'isolated source and target databases must differ'
    return 1
  fi
  mysql_cmd --execute="DROP DATABASE IF EXISTS \`${SPIKE_ISOLATED_TARGET_DATABASE}\`; CREATE DATABASE \`${SPIKE_ISOLATED_TARGET_DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
  mysql_cmd "$SPIKE_ISOLATED_TARGET_DATABASE" <"$STEP_EXPORT_DUMP"
}

safe_child_path() {
  local parent="$1" child="$2" parent_real child_parent child_real
  parent_real="$(mkdir -p -- "$parent" && cd -- "$parent" && pwd -P)"
  child_parent="$(dirname -- "$child")"
  mkdir -p -- "$child_parent"
  child_real="$(cd -- "$child_parent" && pwd -P)/$(basename -- "$child")"
  case "$child_real" in
    "$parent_real"/*) ;;
    *) die "refusing to operate outside portability root: $child" ;;
  esac
}

isolated_config_impl() {
  safe_child_path "$SPIKE_ISOLATED_ROOT" "$SPIKE_ISOLATED_TARGET_ROOT"
  if [[ ! -d "$SPIKE_WORDPRESS_SOURCE" ]]; then
    step_fail failed wordpress_source 'SPIKE_WORDPRESS_SOURCE is not a readable directory'
    return 1
  fi
  rm -rf -- "$SPIKE_ISOLATED_TARGET_ROOT"
  mkdir -p -- "$SPIKE_ISOLATED_TARGET_ROOT"
  cp -a -- "$SPIKE_WORDPRESS_SOURCE/." "$SPIKE_ISOLATED_TARGET_ROOT/"
  rm -f -- "$SPIKE_ISOLATED_TARGET_ROOT/wp-config.php"
  wp_cmd "$SPIKE_ISOLATED_TARGET_ROOT" config create \
    --dbname="$SPIKE_ISOLATED_TARGET_DATABASE" --dbuser="$SPIKE_DB_USER" \
    --dbpass="$SPIKE_DB_PASSWORD" --dbhost="${SPIKE_DB_HOST:-$MYSQL_HOST}" --skip-check
}

isolated_search_replace_impl() {
  wp_cmd "$SPIKE_ISOLATED_TARGET_ROOT" search-replace "$SPIKE_ISOLATED_SOURCE_URL" "$SPIKE_ISOLATED_TARGET_URL" \
    --all-tables-with-prefix --skip-columns=guid --precise --recurse-objects --quiet
}

isolated_identity_audit_impl() {
  # The restored database contains wp_users and wp_usermeta, so runtime
  # identity follows the data and the remap count is intentionally zero.
  STEP_USER_REMAP_COUNT=0
}

run_multisite() {
  local item="$1" source_prefix="${SPIKE_MULTISITE_TABLE_PREFIX}${SPIKE_MULTISITE_SOURCE_BLOG_ID}_" usermeta_table="${SPIKE_MULTISITE_TABLE_PREFIX}usermeta"
  [[ -n "$SPIKE_MULTISITE_WP_PATH" ]] || die 'SPIKE_MULTISITE_WP_PATH (or WP_PATH) is required for Multisite URL replacement'
  require_table_set "$SPIKE_MULTISITE_DATABASE" "$source_prefix"
  run_step clone multisite same_network "$item" "$SPIKE_MULTISITE_SOURCE_BLOG_ID" "$SPIKE_MULTISITE_TARGET_BLOG_ID" 0 yes \
    'Same-network clone: wp_users is global; user 7 remains valid and no user ID references need remapping.' multisite_same_network_audit_impl
  run_step clone multisite same_network "$item" "$SPIKE_MULTISITE_SOURCE_BLOG_ID" "$SPIKE_MULTISITE_TARGET_BLOG_ID" 0 yes \
    'Copies wp_N_* tables, updates wp_blogs, recreates wp_N_capabilities, and search-replaces the URL.' multisite_same_network_clone_impl

  [[ -n "$SPIKE_MULTISITE_TARGET_DATABASE" ]] || die 'SPIKE_MULTISITE_TARGET_DATABASE is required for cross-network Multisite portability'
  [[ "$SPIKE_MULTISITE_TARGET_DATABASE" != "$SPIKE_MULTISITE_DATABASE" ]] || die 'cross-network target database must differ from source database'
  [[ -n "$SPIKE_MULTISITE_TARGET_WP_PATH" ]] || die 'SPIKE_MULTISITE_TARGET_WP_PATH is required for cross-network URL replacement'
  run_step export_import multisite cross_network "$item" "$SPIKE_MULTISITE_DATABASE" "$SPIKE_MULTISITE_TARGET_DATABASE" 0 yes \
    'Exports source wp_N_* site tables and imports them into the other network after prefix translation.' multisite_export_import_impl
  run_step identity_audit multisite cross_network "$item" "$SPIKE_MULTISITE_DATABASE" "$SPIKE_MULTISITE_TARGET_DATABASE" auto yes \
    'Cross-network clone starts without source user 7; the report count is every post_author, comments.user_id, wc_orders.customer_id, and wp_N_capabilities reference requiring remap.' multisite_cross_network_audit_impl
  run_step identity_remap multisite cross_network "$item" "$SPIKE_MULTISITE_DATABASE" "$SPIKE_MULTISITE_TARGET_DATABASE" auto yes \
    'Recreates referenced users, remaps post_author/comments.user_id/wc_orders.customer_id, and copies the target wp_N_capabilities key.' multisite_user_remap_impl
  run_step search_replace multisite cross_network "$item" "$SPIKE_MULTISITE_SOURCE_URL" "$SPIKE_MULTISITE_TARGET_URL" auto yes \
    'URL rewrite is measured after identity remapping; user ID reference count remains the cross-network total.' multisite_cross_network_search_replace_impl
}

run_isolated() {
  local item="$1"
  [[ -n "$SPIKE_ISOLATED_SOURCE_DATABASE" ]] || die 'SPIKE_ISOLATED_SOURCE_DATABASE is required for isolated portability'
  [[ -n "$SPIKE_ISOLATED_TARGET_DATABASE" ]] || die 'SPIKE_ISOLATED_TARGET_DATABASE is required for isolated portability'
  [[ -n "$SPIKE_WORDPRESS_SOURCE" ]] || die 'SPIKE_WORDPRESS_SOURCE (or WP_PATH) is required for isolated config generation'
  run_step export isolated dump_restore "$item" "$SPIKE_ISOLATED_SOURCE_DATABASE" "$SPIKE_ISOLATED_TARGET_DATABASE" 0 yes \
    'Isolated export is a complete database dump; runtime users travel with the database.' isolated_export_impl
  run_step import isolated dump_restore "$item" "$SPIKE_ISOLATED_SOURCE_DATABASE" "$SPIKE_ISOLATED_TARGET_DATABASE" 0 yes \
    'Restores one database. No user ID mapping is required because wp_users and wp_usermeta are in the restored database.' isolated_restore_impl
  run_step config isolated generate_wp_config "$item" "$SPIKE_ISOLATED_SOURCE_DATABASE" "$SPIKE_ISOLATED_TARGET_DATABASE" 0 yes \
    'Generates a target wp-config.php for the restored database.' isolated_config_impl
  run_step search_replace isolated url_rewrite "$item" "$SPIKE_ISOLATED_SOURCE_URL" "$SPIKE_ISOLATED_TARGET_URL" 0 yes \
    'Search-replaces the source URL in the restored isolated database; user ID remap count is 0 by topology.' isolated_search_replace_impl
  run_step identity_audit isolated runtime_identity "$item" "$SPIKE_ISOLATED_SOURCE_DATABASE" "$SPIKE_ISOLATED_TARGET_DATABASE" 0 yes \
    'Isolated identity is database-local and follows the restore; user ID references needing remap: 0.' isolated_identity_audit_impl
}

[[ "$SPIKE_OPERATION" =~ ^(all|multisite|isolated)$ ]] || die 'SPIKE_OPERATION must be all, multisite, or isolated'
positive_integer SPIKE_MULTISITE_START "$SPIKE_MULTISITE_START"
positive_integer SPIKE_ISOLATED_START "$SPIKE_ISOLATED_START"
safe_blog_id "$SPIKE_MULTISITE_SOURCE_BLOG_ID" || die 'SPIKE_MULTISITE_SOURCE_BLOG_ID must be a positive integer'
safe_blog_id "$SPIKE_MULTISITE_TARGET_BLOG_ID" || die 'SPIKE_MULTISITE_TARGET_BLOG_ID must be a positive integer'
safe_identifier "$SPIKE_MULTISITE_TABLE_PREFIX" || die 'SPIKE_MULTISITE_TABLE_PREFIX is unsafe'
safe_identifier "$SPIKE_MULTISITE_TARGET_TABLE_PREFIX" || die 'SPIKE_MULTISITE_TARGET_TABLE_PREFIX is unsafe'
[[ "$SPIKE_EXPECT_TARGET_USER_ABSENT" =~ ^[01]$ ]] || die 'SPIKE_EXPECT_TARGET_USER_ABSENT must be 0 or 1'
safe_blog_id "$SPIKE_REFERENCE_USER_ID" || die 'SPIKE_REFERENCE_USER_ID must be a positive integer'
[[ -n "$SPIKE_MULTISITE_DATABASE" ]] || [[ "$SPIKE_OPERATION" == isolated ]] || die 'SPIKE_MULTISITE_DATABASE is required for Multisite portability'
ensure_header

if [[ "$SPIKE_OPERATION" == all || "$SPIKE_OPERATION" == multisite ]]; then
  [[ -n "$SPIKE_MULTISITE_SOURCE_URL" && -n "$SPIKE_MULTISITE_TARGET_URL" ]] || die 'Multisite source and target URLs are required'
  for ((i = SPIKE_MULTISITE_START; i < SPIKE_MULTISITE_START + 1; i++)); do run_multisite "$i"; done
fi

if [[ "$SPIKE_OPERATION" == all || "$SPIKE_OPERATION" == isolated ]]; then
  [[ -n "$SPIKE_ISOLATED_SOURCE_URL" && -n "$SPIKE_ISOLATED_TARGET_URL" ]] || die 'Isolated source and target URLs are required'
  for ((i = SPIKE_ISOLATED_START; i < SPIKE_ISOLATED_START + 1; i++)); do run_isolated "$i"; done
fi

printf 'store portability evidence: %s\n' "$SPIKE_OUTPUT"
