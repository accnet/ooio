#!/usr/bin/env bash
# Spike #010 — Where the table_open_cache ceiling actually bites.
#
# Spike #002 showed Open_tables saturates exactly at table_open_cache. It did not
# show what happens AFTER saturation: does latency degrade gradually, or cliff?
# That is the question behind "how many stores fit in one cluster", and the
# density figures in DEPLOYMENT-PLAN rest on the answer.
#
# Method: create real WooCommerce stores one at a time past the computed ceiling,
# and after each batch record the cache counters plus the latency of a store that
# was created FIRST — an existing tenant, not the one just added. A platform
# cares what happens to the stores it already has.
#
# The thrash signal is Opened_tables per request: once the cache is full MySQL
# must close a table to open another, so this counter climbs with traffic instead
# of staying flat.
set -Eeuo pipefail

WP_PATH="${OOIO_WP_PATH:-$HOME/ooio-devenv/wp}"
BASE_URL="${OOIO_BASE_URL:-http://localhost:8088}"
VICTIM="${OOIO_VICTIM:-$BASE_URL/noisy/}"
TARGET="${OOIO_TARGET_STORES:-120}"
BATCH="${OOIO_BATCH:-10}"
PROBES="${OOIO_PROBES:-8}"
PREFIX="${OOIO_SLUG_PREFIX:-tc}"
OUT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/results"
CSV="$OUT_DIR/table-cache-breakpoint.csv"

mkdir -p "$OUT_DIR"
die() { echo "FATAL: $*" >&2; exit 1; }
wpq() { ( cd "$WP_PATH" && wp db query "$1" --skip-column-names 2>/dev/null ); }
status() { wpq "SHOW GLOBAL STATUS LIKE '$1'" | awk '{print $2}'; }
var() { wpq "SELECT @@$1"; }

# p50 latency of the victim, in ms.
victim_p50() {
  local i t
  for ((i = 0; i < PROBES; i++)); do
    t="$(curl -s -o /dev/null -w '%{time_total}' --max-time 60 "$VICTIM")"
    awk -v t="$t" 'BEGIN { printf "%.0f\n", t * 1000 }'
  done | sort -n | awk '{v[NR]=$1} END {print v[int((NR+1)*0.5)]}'
}

store_tables() {
  wpq "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name LIKE 'wp\\\\_%'"
}

main() {
  command -v wp >/dev/null || die 'wp-cli is required'
  local toc; toc="$(var table_open_cache)"
  [[ -n "$toc" ]] || die 'could not read table_open_cache'

  local existing; existing="$(wpq 'SELECT COUNT(*) FROM wp_blogs')"
  echo "table_open_cache=$toc  open_files_limit=$(var open_files_limit)"
  echo "store hiện có=$existing  mục tiêu=+$TARGET  batch=$BATCH"
  echo "ceiling lý thuyết ≈ $((toc / 53)) store (53 bảng/store)"
  echo

  [[ -s "$CSV" ]] || echo 'stores,tables_total,open_tables,opened_tables,opened_per_probe,victim_p50_ms,table_open_cache' > "$CSV"

  local created=0 prev_opened
  prev_opened="$(status Opened_tables)"

  while (( created < TARGET )); do
    local i
    for ((i = 0; i < BATCH && created < TARGET; i++)); do
      created=$((created + 1))
      local slug="${PREFIX}${created}"
      ( cd "$WP_PATH" && wp site create --slug="$slug" --title="$slug" ) >/dev/null 2>&1 || true
      ( cd "$WP_PATH" && wp eval 'WC_Install::install();' --url="$BASE_URL/$slug/" ) >/dev/null 2>&1 || true
    done

    # Warm, then measure: the counter delta must come from the probe requests
    # alone, not from the site-creation traffic that preceded them.
    curl -s -o /dev/null "$VICTIM" || true
    prev_opened="$(status Opened_tables)"
    local p50; p50="$(victim_p50)"
    local opened; opened="$(status Opened_tables)"
    local per_probe=$(( (opened - prev_opened) / PROBES ))

    local total blogs
    total="$(store_tables)"; blogs="$(wpq 'SELECT COUNT(*) FROM wp_blogs')"
    printf '%s,%s,%s,%s,%s,%s,%s\n' \
      "$blogs" "$total" "$(status Open_tables)" "$opened" "$per_probe" "$p50" "$toc" >> "$CSV"
    printf 'store=%-5s bảng=%-6s Open_tables=%-6s Opened/probe=%-6s victim_p50=%sms\n' \
      "$blogs" "$total" "$(status Open_tables)" "$per_probe" "$p50"
  done

  echo
  echo "csv: $CSV"
}

main "$@"
