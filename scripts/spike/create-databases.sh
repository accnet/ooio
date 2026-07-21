#!/usr/bin/env bash

set -euo pipefail

# Create isolated databases with the minimum WordPress table shape used by the
# database-per-store feasibility spike. This harness is intentionally not run
# by the repository tests or by this script's caller automatically.
MYSQL_BIN="${MYSQL_BIN:-mysql}"
MYSQL_HOST="${MYSQL_HOST:-127.0.0.1}"
MYSQL_USER="${MYSQL_USER:-}"
MYSQL_PORT="${MYSQL_PORT:-}"
MYSQL_SOCKET="${MYSQL_SOCKET:-}"
SPIKE_DATABASES="${SPIKE_DATABASES:-500}"
SPIKE_DATABASE_PREFIX="${SPIKE_DATABASE_PREFIX:-store_}"
SPIKE_LOG_DIR="${SPIKE_LOG_DIR:-./spike-001-databases}"
SPIKE_OUTPUT="${SPIKE_OUTPUT:-${SPIKE_LOG_DIR}/database-provisioning.csv}"

case "$SPIKE_DATABASES" in
  ''|*[!0-9]*)
    printf 'SPIKE_DATABASES must be a positive integer\n' >&2
    exit 2
    ;;
esac
if (( SPIKE_DATABASES < 1 )); then
  printf 'SPIKE_DATABASES must be at least 1\n' >&2
  exit 2
fi
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

now_ms() {
  local value
  value="$(date +%s%N 2>/dev/null)"
  if [[ "$value" == *N* ]]; then
    date +%s000
  else
    printf '%s\n' "$((value / 1000000))"
  fi
}

schema_sql() {
  cat <<'SQL'
CREATE TABLE IF NOT EXISTS `wp_posts` (
  `ID` bigint unsigned NOT NULL AUTO_INCREMENT,
  `post_author` bigint unsigned NOT NULL DEFAULT 0,
  `post_date` datetime NOT NULL DEFAULT '1970-01-01 00:00:00',
  `post_content` longtext NOT NULL,
  `post_title` text NOT NULL,
  `post_status` varchar(20) NOT NULL DEFAULT 'publish',
  `comment_status` varchar(20) NOT NULL DEFAULT 'open',
  `post_name` varchar(200) NOT NULL DEFAULT '',
  `post_modified` datetime NOT NULL DEFAULT '1970-01-01 00:00:00',
  PRIMARY KEY (`ID`),
  KEY `post_name` (`post_name`(191)),
  KEY `post_status` (`post_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `wp_postmeta` (
  `meta_id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `post_id` bigint unsigned NOT NULL DEFAULT 0,
  `meta_key` varchar(255) DEFAULT NULL,
  `meta_value` longtext,
  PRIMARY KEY (`meta_id`),
  KEY `post_id` (`post_id`),
  KEY `meta_key` (`meta_key`(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `wp_options` (
  `option_id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `option_name` varchar(191) NOT NULL DEFAULT '',
  `option_value` longtext NOT NULL,
  `autoload` varchar(20) NOT NULL DEFAULT 'yes',
  PRIMARY KEY (`option_id`),
  UNIQUE KEY `option_name` (`option_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `wp_comments` (
  `comment_ID` bigint unsigned NOT NULL AUTO_INCREMENT,
  `comment_post_ID` bigint unsigned NOT NULL DEFAULT 0,
  `comment_author` tinytext NOT NULL,
  `comment_content` text NOT NULL,
  `comment_approved` varchar(20) NOT NULL DEFAULT '1',
  `comment_date` datetime NOT NULL DEFAULT '1970-01-01 00:00:00',
  `user_id` bigint unsigned NOT NULL DEFAULT 0,
  PRIMARY KEY (`comment_ID`),
  KEY `comment_post_ID` (`comment_post_ID`),
  KEY `comment_approved_date` (`comment_approved`,`comment_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `wp_commentmeta` (
  `meta_id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `comment_id` bigint unsigned NOT NULL DEFAULT 0,
  `meta_key` varchar(255) DEFAULT NULL,
  `meta_value` longtext,
  PRIMARY KEY (`meta_id`),
  KEY `comment_id` (`comment_id`),
  KEY `meta_key` (`meta_key`(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `wp_terms` (
  `term_id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(200) NOT NULL DEFAULT '',
  `slug` varchar(200) NOT NULL DEFAULT '',
  `term_group` bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (`term_id`),
  KEY `slug` (`slug`(191)),
  KEY `name` (`name`(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `wp_term_taxonomy` (
  `term_taxonomy_id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `term_id` bigint unsigned NOT NULL DEFAULT 0,
  `taxonomy` varchar(32) NOT NULL DEFAULT '',
  `description` longtext NOT NULL,
  `parent` bigint unsigned NOT NULL DEFAULT 0,
  `count` bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (`term_taxonomy_id`),
  UNIQUE KEY `term_id_taxonomy` (`term_id`,`taxonomy`),
  KEY `taxonomy` (`taxonomy`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `wp_term_relationships` (
  `object_id` bigint unsigned NOT NULL DEFAULT 0,
  `term_taxonomy_id` bigint unsigned NOT NULL DEFAULT 0,
  `term_order` int NOT NULL DEFAULT 0,
  PRIMARY KEY (`object_id`,`term_taxonomy_id`),
  KEY `term_taxonomy_id` (`term_taxonomy_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `wp_termmeta` (
  `meta_id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `term_id` bigint unsigned NOT NULL DEFAULT 0,
  `meta_key` varchar(255) DEFAULT NULL,
  `meta_value` longtext,
  PRIMARY KEY (`meta_id`),
  KEY `term_id` (`term_id`),
  KEY `meta_key` (`meta_key`(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `wp_users` (
  `ID` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_login` varchar(60) NOT NULL DEFAULT '',
  `user_pass` varchar(255) NOT NULL DEFAULT '',
  `user_nicename` varchar(50) NOT NULL DEFAULT '',
  `user_email` varchar(100) NOT NULL DEFAULT '',
  `user_status` int NOT NULL DEFAULT 0,
  `display_name` varchar(250) NOT NULL DEFAULT '',
  PRIMARY KEY (`ID`),
  KEY `user_login` (`user_login`),
  KEY `user_nicename` (`user_nicename`),
  KEY `user_email` (`user_email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `wp_usermeta` (
  `umeta_id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` bigint unsigned NOT NULL DEFAULT 0,
  `meta_key` varchar(255) DEFAULT NULL,
  `meta_value` longtext,
  PRIMARY KEY (`umeta_id`),
  KEY `user_id` (`user_id`),
  KEY `meta_key` (`meta_key`(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `wp_links` (
  `link_id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `link_url` varchar(255) NOT NULL DEFAULT '',
  `link_name` varchar(255) NOT NULL DEFAULT '',
  `link_image` varchar(255) NOT NULL DEFAULT '',
  `link_target` varchar(25) NOT NULL DEFAULT '',
  `link_visible` varchar(20) NOT NULL DEFAULT 'Y',
  `link_owner` bigint unsigned NOT NULL DEFAULT 1,
  PRIMARY KEY (`link_id`),
  KEY `link_visible` (`link_visible`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
SQL
}

mkdir -p "$(dirname "$SPIKE_OUTPUT")"
printf 'database_name,started_at_utc,finished_at_utc,create_database_ms,create_tables_ms,total_ms,table_count,status\n' >"$SPIKE_OUTPUT"

for ((database_id = 1; database_id <= SPIKE_DATABASES; database_id++)); do
  database_name="${SPIKE_DATABASE_PREFIX}${database_id}"
  started_at_utc="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  started_ms="$(now_ms)"
  create_database_started_ms="$started_ms"
  mysql_cmd --execute="CREATE DATABASE \`${database_name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
  create_database_ms="$(( $(now_ms) - create_database_started_ms ))"

  create_tables_started_ms="$(now_ms)"
  schema_sql | mysql_cmd "$database_name"
  create_tables_ms="$(( $(now_ms) - create_tables_started_ms ))"
  finished_at_utc="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  total_ms="$(( $(now_ms) - started_ms ))"
  table_count="$(mysql_cmd "$database_name" --execute="SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE();" | tr -d '\r\n')"

  printf '%s,%s,%s,%s,%s,%s,%s,created\n' \
    "$database_name" "$started_at_utc" "$finished_at_utc" "$create_database_ms" \
    "$create_tables_ms" "$total_ms" "$table_count" >>"$SPIKE_OUTPUT"
  printf 'created %s/%s: tables=%s total_ms=%s\n' \
    "$database_id" "$SPIKE_DATABASES" "$table_count" "$total_ms"
done

printf 'database provisioning evidence: %s\n' "$SPIKE_OUTPUT"
