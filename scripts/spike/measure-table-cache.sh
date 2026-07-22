#!/usr/bin/env bash

set -euo pipefail

# Table-cache working-set spike.
#
# WHY THIS EXISTS: create-databases.sh measures PROVISIONING — it creates a store
# database and moves on. That answers "how fast can we make stores" but says
# nothing about serving them, and it left the real question untouched: with 48
# tables per WooCommerce store and table_open_cache entries shared across the whole
# server, how many stores can be ACTIVE at once before MariaDB starts evicting and
# reopening tables on every request?
#
# METHOD: cache thrashing is simply "working set larger than cache", so this does
# not need concurrency to expose it. Cycle round-robin through K store databases,
# touching every table in each, and repeat for several passes:
#
#   K * 48 <= table_open_cache  ->  Opened_tables stops growing after pass 1
#   K * 48 >  table_open_cache  ->  Opened_tables grows by ~K*48 EVERY pass
#
# The second case is thrashing: each pass evicts the tables the next pass needs.
# The growth of Opened_tables is the signal; wall time per pass shows the cost.

MYSQL_BIN="${MYSQL_BIN:-mariadb}"
MYSQL_HOST="${MYSQL_HOST:-127.0.0.1}"
MYSQL_PORT="${MYSQL_PORT:-3309}"
MYSQL_USER="${MYSQL_USER:-root}"
SPIKE_DATABASE_PREFIX="${SPIKE_DATABASE_PREFIX:-store_}"
# Working-set sizes to test, in stores.
SPIKE_WORKING_SETS="${SPIKE_WORKING_SETS:-10 20 40 60 80 120 200}"
SPIKE_PASSES="${SPIKE_PASSES:-3}"
SPIKE_LOG_DIR="${SPIKE_LOG_DIR:-./spike-002-table-cache}"
SPIKE_OUTPUT="${SPIKE_OUTPUT:-${SPIKE_LOG_DIR}/table-cache.csv}"

mysql_cmd() {
  MYSQL_PWD="${MYSQL_PASSWORD:-${MYSQL_PWD:-}}" "$MYSQL_BIN" \
    --batch --skip-column-names --host="$MYSQL_HOST" --port="$MYSQL_PORT" \
    --user="$MYSQL_USER" "$@" 2>/dev/null
}

status_of() {
  mysql_cmd --execute="SHOW GLOBAL STATUS LIKE '$1';" | awk '{print $2}'
}

now_ms() {
  local value
  value="$(date +%s%N 2>/dev/null)"
  [[ "$value" == *N* ]] && { date +%s000; return; }
  printf '%s\n' "$((value / 1000000))"
}

available="$(mysql_cmd --execute="SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name LIKE '${SPIKE_DATABASE_PREFIX}%';")"
if [[ -z "$available" || "$available" -lt 1 ]]; then
  printf 'no %s* databases found — run create-databases.sh first\n' "$SPIKE_DATABASE_PREFIX" >&2
  exit 2
fi

cache_size="$(mysql_cmd --execute='SELECT @@table_open_cache;')"
def_cache="$(mysql_cmd --execute='SELECT @@table_definition_cache;')"
printf 'databases=%s table_open_cache=%s table_definition_cache=%s\n' \
  "$available" "$cache_size" "$def_cache"

mkdir -p "$(dirname "$SPIKE_OUTPUT")"
printf 'stores,tables_in_working_set,pass,opened_tables_delta,open_tables,pass_ms,thrashing\n' >"$SPIKE_OUTPUT"

# Touch a representative slice of a store's tables. information_schema is
# deliberately avoided: reading metadata does not open tables the way a real query
# does.
#
# NOTE: wp_users/wp_usermeta are absent from the spiked databases. The schema
# template was dumped from Multisite's wp_2_* prefix, where users live in GLOBAL
# tables with no subsite prefix — which is exactly the non-self-containment AP-002
# objects to. store-schema.sql has since been corrected to 50 tables (48 + users),
# so databases created from now on will have them; the ones already spiked do not.
touch_store() {
  local database="$1"
  mysql_cmd "$database" --execute="
    SELECT (SELECT COUNT(*) FROM wp_options)
         + (SELECT COUNT(*) FROM wp_posts)
         + (SELECT COUNT(*) FROM wp_postmeta)
         + (SELECT COUNT(*) FROM wp_terms)
         + (SELECT COUNT(*) FROM wp_term_taxonomy)
         + (SELECT COUNT(*) FROM wp_term_relationships)
         + (SELECT COUNT(*) FROM wp_comments)
         + (SELECT COUNT(*) FROM wp_commentmeta)
         + (SELECT COUNT(*) FROM wp_wc_orders)
         + (SELECT COUNT(*) FROM wp_wc_orders_meta)
         + (SELECT COUNT(*) FROM wp_wc_order_addresses)
         + (SELECT COUNT(*) FROM wp_wc_order_stats)
         + (SELECT COUNT(*) FROM wp_wc_product_meta_lookup)
         + (SELECT COUNT(*) FROM wp_wc_customer_lookup)
         + (SELECT COUNT(*) FROM wp_woocommerce_sessions)
         + (SELECT COUNT(*) FROM wp_woocommerce_order_items)
         + (SELECT COUNT(*) FROM wp_woocommerce_order_itemmeta)
         + (SELECT COUNT(*) FROM wp_actionscheduler_actions)
         + (SELECT COUNT(*) FROM wp_actionscheduler_claims);" >/dev/null
}

for stores in $SPIKE_WORKING_SETS; do
  if (( stores > available )); then
    printf 'skipping working set %s (only %s databases exist)\n' "$stores" "$available"
    continue
  fi

  # FLUSH TABLES empties the cache so each working set starts from the same place.
  mysql_cmd --execute='FLUSH TABLES;'

  for ((pass = 1; pass <= SPIKE_PASSES; pass++)); do
    before="$(status_of Opened_tables)"
    started="$(now_ms)"
    for ((id = 1; id <= stores; id++)); do
      touch_store "${SPIKE_DATABASE_PREFIX}${id}"
    done
    elapsed="$(( $(now_ms) - started ))"
    after="$(status_of Opened_tables)"
    open_now="$(status_of Open_tables)"
    delta="$(( after - before ))"

    # Pass 1 always opens tables (cache was flushed). From pass 2 on, a large
    # delta means the previous pass's tables were evicted before reuse.
    thrashing='no'
    if (( pass > 1 && delta > stores * 5 )); then
      thrashing='YES'
    fi

    printf '%s,%s,%s,%s,%s,%s,%s\n' \
      "$stores" "$((stores * 48))" "$pass" "$delta" "$open_now" "$elapsed" "$thrashing" >>"$SPIKE_OUTPUT"
    printf '  stores=%-4s pass=%s opened_tables+=%-7s open_tables=%-6s %sms %s\n' \
      "$stores" "$pass" "$delta" "$open_now" "$elapsed" \
      "$([[ $thrashing == YES ]] && echo '<- THRASHING')"
  done
done

printf 'table cache evidence: %s\n' "$SPIKE_OUTPUT"
