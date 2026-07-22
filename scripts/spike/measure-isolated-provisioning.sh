#!/usr/bin/env bash

set -euo pipefail

# Measure one isolated WordPress installation per store. The WordPress core
# tree is shared through symlinks; only wp-config.php, wp-content, and the
# store database are unique to each iteration.
WP_BIN="${WP_BIN:-wp}"
SPIKE_WORDPRESS_SOURCE="${SPIKE_WORDPRESS_SOURCE:-${WP_PATH:-}}"
SPIKE_ISOLATED_SITES="${SPIKE_ISOLATED_SITES:-${SPIKE_SITES:-100}}"
SPIKE_ISOLATED_START="${SPIKE_ISOLATED_START:-1}"
SPIKE_ISOLATED_PREFIX="${SPIKE_ISOLATED_PREFIX:-isolated}"
SPIKE_DATABASE_PREFIX="${SPIKE_DATABASE_PREFIX:-isolated_}"
SPIKE_LOG_DIR="${SPIKE_LOG_DIR:-./spike-001-isolated}"
SPIKE_OUTPUT="${SPIKE_OUTPUT:-${SPIKE_LOG_DIR}/isolated-provisioning.csv}"
SPIKE_INSTALL_ROOT="${SPIKE_INSTALL_ROOT:-${SPIKE_LOG_DIR}/isolated-sites}"
SPIKE_ADMIN_USER="${SPIKE_ADMIN_USER:-spikeadmin}"
SPIKE_ADMIN_PASSWORD="${SPIKE_ADMIN_PASSWORD:-spike-admin-password-change-me}"
SPIKE_ADMIN_EMAIL="${SPIKE_ADMIN_EMAIL:-spike-admin@example.invalid}"
SPIKE_SITE_HOST="${SPIKE_SITE_HOST:-isolated.example.invalid}"

MYSQL_BIN="${MYSQL_BIN:-mysql}"
MYSQL_HOST="${MYSQL_HOST:-127.0.0.1}"
MYSQL_USER="${MYSQL_USER:-}"
MYSQL_PORT="${MYSQL_PORT:-}"
MYSQL_SOCKET="${MYSQL_SOCKET:-}"
SPIKE_DB_USER="${SPIKE_DB_USER:-$MYSQL_USER}"
SPIKE_DB_PASSWORD="${SPIKE_DB_PASSWORD:-${MYSQL_PASSWORD:-${MYSQL_PWD:-}}}"
SPIKE_DB_HOST="${SPIKE_DB_HOST:-}"
MYSQL_USER="${MYSQL_USER:-$SPIKE_DB_USER}"

# Optional same-host Multisite comparison. Set SPIKE_MULTISITE_WP_PATH for the
# wp-cli path and/or SPIKE_MULTISITE_REST_URL for the MU Plugin REST endpoint.
SPIKE_MULTISITE_WP_PATH="${SPIKE_MULTISITE_WP_PATH:-}"
SPIKE_MULTISITE_REST_URL="${SPIKE_MULTISITE_REST_URL:-}"
SPIKE_MULTISITE_REST_TOKEN="${SPIKE_MULTISITE_REST_TOKEN:-}"
SPIKE_MULTISITE_PREFIX="${SPIKE_MULTISITE_PREFIX:-spike003-isolated-compare}"
SPIKE_MULTISITE_OUTPUT="${SPIKE_MULTISITE_OUTPUT:-${SPIKE_LOG_DIR}/multisite-comparison.csv}"
SPIKE_MULTISITE_START="${SPIKE_MULTISITE_START:-1}"

validate_positive_integer() {
  local name="$1"
  local value="$2"
  if [[ ! "$value" =~ ^[0-9]+$ ]] || (( value < 1 )); then
    printf '%s must be a positive integer\n' "$name" >&2
    exit 2
  fi
}

validate_positive_integer SPIKE_ISOLATED_SITES "$SPIKE_ISOLATED_SITES"
validate_positive_integer SPIKE_ISOLATED_START "$SPIKE_ISOLATED_START"
validate_positive_integer SPIKE_MULTISITE_START "$SPIKE_MULTISITE_START"
if [[ -z "$SPIKE_WORDPRESS_SOURCE" ]]; then
  printf 'SPIKE_WORDPRESS_SOURCE (or WP_PATH) is required\n' >&2
  exit 2
fi
if [[ ! "$SPIKE_ISOLATED_PREFIX" =~ ^[A-Za-z0-9_-]+$ ]]; then
  printf 'SPIKE_ISOLATED_PREFIX contains unsupported characters\n' >&2
  exit 2
fi
if [[ ! "$SPIKE_DATABASE_PREFIX" =~ ^[A-Za-z][A-Za-z0-9_]*_$ ]]; then
  printf 'SPIKE_DATABASE_PREFIX must end with an underscore and contain only safe identifier characters\n' >&2
  exit 2
fi
if [[ -z "$SPIKE_DB_USER" ]]; then
  printf 'SPIKE_DB_USER or MYSQL_USER is required for wp-config.php\n' >&2
  exit 2
fi
if [[ -n "$SPIKE_MULTISITE_REST_URL" && ! "$SPIKE_MULTISITE_REST_URL" =~ /platform/v1/sites/?$ ]]; then
  printf 'SPIKE_MULTISITE_REST_URL must point to the MU Plugin /platform/v1/sites endpoint\n' >&2
  exit 2
fi

source_path="$(cd -- "$SPIKE_WORDPRESS_SOURCE" 2>/dev/null && pwd -P)" || {
  printf 'WordPress source is not a readable directory: %s\n' "$SPIKE_WORDPRESS_SOURCE" >&2
  exit 2
}
for required_path in wp-admin wp-includes wp-load.php; do
  if [[ ! -e "$source_path/$required_path" ]]; then
    printf 'WordPress source is missing %s: %s\n' "$required_path" "$source_path" >&2
    exit 2
  fi
done

mkdir -p "$SPIKE_INSTALL_ROOT" "$(dirname "$SPIKE_OUTPUT")"
install_root="$(cd -- "$SPIKE_INSTALL_ROOT" && pwd -P)"
if [[ "$source_path" == "$install_root"/* || "$source_path" == "$install_root" ]]; then
  printf 'SPIKE_WORDPRESS_SOURCE must not be inside SPIKE_INSTALL_ROOT\n' >&2
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

wp_cmd() {
  local path="$1"
  shift
  "$WP_BIN" --path="$path" "$@"
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

db_host_for_wp() {
  if [[ -n "$SPIKE_DB_HOST" ]]; then
    printf '%s\n' "$SPIKE_DB_HOST"
  elif [[ -n "$MYSQL_SOCKET" ]]; then
    printf 'localhost\n'
  elif [[ -n "$MYSQL_PORT" ]]; then
    printf '%s:%s\n' "$MYSQL_HOST" "$MYSQL_PORT"
  else
    printf '%s\n' "$MYSQL_HOST"
  fi
}

link_shared_core() {
  local root="$1"
  local entry name
  mkdir -p "$root/wp-content"
  while IFS= read -r -d '' entry; do
    name="${entry##*/}"
    case "$name" in
      wp-config.php|wp-content)
        continue
        ;;
    esac
    ln -s -- "$entry" "$root/$name"
  done < <(find "$source_path" -mindepth 1 -maxdepth 1 -print0)
}

database_metrics() {
  local database_name="$1"
  mysql_cmd "$database_name" --execute='SELECT COUNT(*), COALESCE(SUM(data_length), 0), COALESCE(SUM(index_length), 0), COALESCE(SUM(data_length + index_length), 0) FROM information_schema.tables WHERE table_schema = DATABASE();' | tr '\t' ' ' | tr -d '\r'
}

writable_filesystem_bytes() {
  local root="$1"
  du -sb --apparent-size "$root/wp-content" "$root/wp-config.php" | awk '{total += $1} END {print total + 0}'
}

write_header() {
  printf 'store_number,store_slug,database_name,install_root,started_at_utc,finished_at_utc,create_database_ms,link_source_ms,wp_config_ms,wp_core_install_ms,filesystem_bytes,database_table_count,database_data_bytes,database_index_bytes,database_total_bytes,status,error_stage\n' >"$SPIKE_OUTPUT"
}

record_store() {
  local store_number="$1" store_slug="$2" database_name="$3" root="$4"
  local started_at="$5" finished_at="$6" create_database_ms="$7" link_source_ms="$8"
  local wp_config_ms="$9" wp_core_install_ms="${10}" filesystem_bytes="${11}"
  local table_count="${12}" database_data_bytes="${13}" database_index_bytes="${14}"
  local database_total_bytes="${15}" status="${16}" error_stage="${17}"
  printf '%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s\n' \
    "$store_number" "$store_slug" "$database_name" "$root" "$started_at" "$finished_at" \
    "$create_database_ms" "$link_source_ms" "$wp_config_ms" "$wp_core_install_ms" \
    "$filesystem_bytes" "$table_count" "$database_data_bytes" "$database_index_bytes" \
    "$database_total_bytes" "$status" "$error_stage" >>"$SPIKE_OUTPUT"
}

provision_store() {
  local store_number="$1" store_slug="$2" database_name="$3" root="$4"
  local started_at started_ms finished_at duration_start
  local create_database_ms='' link_source_ms='' wp_config_ms='' wp_core_install_ms=''
  local filesystem_bytes='' table_count='' database_data_bytes='' database_index_bytes='' database_total_bytes=''
  local error_stage='' status=failed

  started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  started_ms="$(now_ms)"

  if [[ -e "$root" || -L "$root" ]]; then
    error_stage=install_root_exists
    finished_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    record_store "$store_number" "$store_slug" "$database_name" "$root" "$started_at" "$finished_at" \
      "$create_database_ms" "$link_source_ms" "$wp_config_ms" "$wp_core_install_ms" "$filesystem_bytes" \
      "$table_count" "$database_data_bytes" "$database_index_bytes" "$database_total_bytes" "$status" "$error_stage"
    return 1
  fi

  duration_start="$(now_ms)"
  if ! mysql_cmd --execute="CREATE DATABASE \`${database_name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"; then
    error_stage=create_database
    create_database_ms="$(( $(now_ms) - duration_start ))"
    finished_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    record_store "$store_number" "$store_slug" "$database_name" "$root" "$started_at" "$finished_at" \
      "$create_database_ms" "$link_source_ms" "$wp_config_ms" "$wp_core_install_ms" "$filesystem_bytes" \
      "$table_count" "$database_data_bytes" "$database_index_bytes" "$database_total_bytes" "$status" "$error_stage"
    return 1
  fi
  create_database_ms="$(( $(now_ms) - duration_start ))"

  duration_start="$(now_ms)"
  if ! link_shared_core "$root"; then
    error_stage=link_source
    link_source_ms="$(( $(now_ms) - duration_start ))"
    finished_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    record_store "$store_number" "$store_slug" "$database_name" "$root" "$started_at" "$finished_at" \
      "$create_database_ms" "$link_source_ms" "$wp_config_ms" "$wp_core_install_ms" "$filesystem_bytes" \
      "$table_count" "$database_data_bytes" "$database_index_bytes" "$database_total_bytes" "$status" "$error_stage"
    return 1
  fi
  link_source_ms="$(( $(now_ms) - duration_start ))"

  duration_start="$(now_ms)"
  if ! wp_cmd "$root" config create \
      --dbname="$database_name" --dbuser="$SPIKE_DB_USER" --dbpass="$SPIKE_DB_PASSWORD" \
      --dbhost="$(db_host_for_wp)" --skip-check; then
    error_stage=wp_config
    wp_config_ms="$(( $(now_ms) - duration_start ))"
    finished_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    record_store "$store_number" "$store_slug" "$database_name" "$root" "$started_at" "$finished_at" \
      "$create_database_ms" "$link_source_ms" "$wp_config_ms" "$wp_core_install_ms" "$filesystem_bytes" \
      "$table_count" "$database_data_bytes" "$database_index_bytes" "$database_total_bytes" "$status" "$error_stage"
    return 1
  fi
  wp_config_ms="$(( $(now_ms) - duration_start ))"

  duration_start="$(now_ms)"
  if ! wp_cmd "$root" core install \
      --url="http://${SPIKE_ISOLATED_PREFIX}-${store_number}.${SPIKE_SITE_HOST}" \
      --title="Isolated Spike ${store_slug}" --admin_user="$SPIKE_ADMIN_USER" \
      --admin_password="$SPIKE_ADMIN_PASSWORD" --admin_email="$SPIKE_ADMIN_EMAIL" --skip-email; then
    error_stage=wp_core_install
    wp_core_install_ms="$(( $(now_ms) - duration_start ))"
    finished_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    record_store "$store_number" "$store_slug" "$database_name" "$root" "$started_at" "$finished_at" \
      "$create_database_ms" "$link_source_ms" "$wp_config_ms" "$wp_core_install_ms" "$filesystem_bytes" \
      "$table_count" "$database_data_bytes" "$database_index_bytes" "$database_total_bytes" "$status" "$error_stage"
    return 1
  fi
  wp_core_install_ms="$(( $(now_ms) - duration_start ))"

  read -r table_count database_data_bytes database_index_bytes database_total_bytes <<<"$(database_metrics "$database_name")"
  filesystem_bytes="$(writable_filesystem_bytes "$root")"
  status=installed
  finished_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  record_store "$store_number" "$store_slug" "$database_name" "$root" "$started_at" "$finished_at" \
    "$create_database_ms" "$link_source_ms" "$wp_config_ms" "$wp_core_install_ms" "$filesystem_bytes" \
    "$table_count" "$database_data_bytes" "$database_index_bytes" "$database_total_bytes" "$status" "$error_stage"
  printf 'installed %s/%s: tables=%s db_bytes=%s total_ms=%s\n' \
    "$store_number" "$SPIKE_ISOLATED_SITES" "$table_count" "$database_total_bytes" "$(( $(now_ms) - started_ms ))"
}

if (( SPIKE_ISOLATED_START == 1 )) || [[ ! -s "$SPIKE_OUTPUT" ]]; then
  write_header
fi

for ((store_number = SPIKE_ISOLATED_START; store_number <= SPIKE_ISOLATED_SITES; store_number++)); do
  store_slug="${SPIKE_ISOLATED_PREFIX}-$(printf '%04d' "$store_number")"
  database_name="${SPIKE_DATABASE_PREFIX}${store_number}"
  store_root="${install_root}/${store_slug}"
  if ! provision_store "$store_number" "$store_slug" "$database_name" "$store_root"; then
    printf 'store %s failed; clean up it and set SPIKE_ISOLATED_START=%s to resume\n' \
      "$store_number" "$((store_number + 1))" >&2
    exit 1
  fi
done

printf 'isolated provisioning evidence: %s\n' "$SPIKE_OUTPUT"

# The comparison is optional so the isolated run can be prepared on a host
# before the disposable Multisite cohort is provisioned. When enabled, all
# methods run serially on this same host after the isolated cohort.
if [[ -n "$SPIKE_MULTISITE_WP_PATH" || -n "$SPIKE_MULTISITE_REST_URL" ]]; then
  mkdir -p "$(dirname "$SPIKE_MULTISITE_OUTPUT")"
  if (( SPIKE_MULTISITE_START == 1 )) || [[ ! -s "$SPIKE_MULTISITE_OUTPUT" ]]; then
    printf 'method,site_number,started_at_utc,finished_at_utc,provisioning_ms,status\n' >"$SPIKE_MULTISITE_OUTPUT"
  fi

  multisite_wp_cmd() {
    "$WP_BIN" --path="$SPIKE_MULTISITE_WP_PATH" "$@"
  }

  if [[ -n "$SPIKE_MULTISITE_WP_PATH" ]]; then
    for ((site_number = SPIKE_MULTISITE_START; site_number <= SPIKE_ISOLATED_SITES; site_number++)); do
      slug="${SPIKE_MULTISITE_PREFIX}-$(printf '%04d' "$site_number")"
      started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      started_ms="$(now_ms)"
      status=created
      if ! multisite_wp_cmd site create --slug="$slug" --title="Multisite Spike ${slug}" \
          --email="$SPIKE_ADMIN_EMAIL" --porcelain >/dev/null; then
        status=failed
      fi
      finished_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      printf 'wp-cli,%s,%s,%s,%s,%s\n' "$site_number" "$started_at" "$finished_at" \
        "$(( $(now_ms) - started_ms ))" "$status" >>"$SPIKE_MULTISITE_OUTPUT"
      [[ "$status" == created ]] || exit 1
    done
  fi

  if [[ -n "$SPIKE_MULTISITE_REST_URL" ]]; then
    for ((site_number = SPIKE_MULTISITE_START; site_number <= SPIKE_ISOLATED_SITES; site_number++)); do
      slug="${SPIKE_MULTISITE_PREFIX}-rest-$(printf '%04d' "$site_number")"
      started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      started_ms="$(now_ms)"
      status=created
      body="$(printf '{"domain":"%s","path":"/%s/","title":"Multisite REST %s","adminEmail":"%s"}' \
        "$SPIKE_SITE_HOST" "$slug" "$slug" "$SPIKE_ADMIN_EMAIL")"
      rest_args=(-H 'Content-Type: application/json')
      if [[ -n "$SPIKE_MULTISITE_REST_TOKEN" ]]; then
        rest_args+=(-H "Authorization: Bearer ${SPIKE_MULTISITE_REST_TOKEN}")
      fi
      if ! curl -fsS --max-time "${SPIKE_HTTP_TIMEOUT_SECONDS:-30}" \
          "${rest_args[@]}" \
          --data "$body" "$SPIKE_MULTISITE_REST_URL" >/dev/null; then
        status=failed
      fi
      finished_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      printf 'mu-plugin-rest,%s,%s,%s,%s,%s\n' "$site_number" "$started_at" "$finished_at" \
        "$(( $(now_ms) - started_ms ))" "$status" >>"$SPIKE_MULTISITE_OUTPUT"
      [[ "$status" == created ]] || exit 1
    done
  fi
  printf 'Multisite comparison evidence: %s\n' "$SPIKE_MULTISITE_OUTPUT"
fi
