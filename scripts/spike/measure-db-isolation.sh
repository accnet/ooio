#!/usr/bin/env bash
# Spike #006 — Isolation at the MySQL layer (ADR-005 Exit Criteria #2, remaining gap).
#
# Spike #005 showed a dedicated PHP-FPM pool contains a noisy store completely
# (neighbour 1.0x). But a pool only partitions PHP workers. Every store in a
# cluster still shares ONE MySQL server, so this asks the question the PHP-layer
# result cannot answer:
#
#   Can one store degrade its neighbours THROUGH the database, after PHP-layer
#   isolation is already in place?
#
# Load is applied with SQL clients, not HTTP, so it bypasses PHP entirely. Any
# degradation observed is attributable to MySQL and nothing else.
#
# Two mechanisms are measured separately because they fail differently:
#   cpu    — noisy store burns server CPU        → neighbours get SLOW
#   conn   — noisy store consumes max_connections → neighbours get ERRORS
set -Eeuo pipefail

BASE_URL="${OOIO_BASE_URL:-http://localhost:8088}"
VICTIM_PATH="${OOIO_VICTIM_PATH:-/}"
MYSQL_SOCKET="${OOIO_MYSQL_SOCKET:-$HOME/ooio-devenv/run/mysql.sock}"
WP_PATH="${OOIO_WP_PATH:-$HOME/ooio-devenv/wp}"
SAMPLES=20
WORKERS=8
MODE=all
OUT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/results"
CSV="$OUT_DIR/db-isolation.csv"

while getopts 'm:w:s:v:' opt; do
  case "$opt" in
    m) MODE="$OPTARG" ;;
    w) WORKERS="$OPTARG" ;;
    s) SAMPLES="$OPTARG" ;;
    v) VICTIM_PATH="$OPTARG" ;;
    *) echo "usage: $0 [-m cpu|conn|all] [-w workers] [-s samples] [-v victim_path]" >&2; exit 2 ;;
  esac
done

VICTIM_URL="${BASE_URL}${VICTIM_PATH}"
mkdir -p "$OUT_DIR"
die() { echo "FATAL: $*" >&2; exit 1; }

# Credentials come from the WordPress config already on the node; this harness
# never takes a password on the command line.
read_wp_const() {
  grep -oP "define\(\s*'$1'\s*,\s*'\K[^']*" "$WP_PATH/wp-config.php" | head -1
}

DB_NAME="$(read_wp_const DB_NAME)"; DB_USER="$(read_wp_const DB_USER)"
DB_PASS="$(read_wp_const DB_PASSWORD)"
[[ -n "$DB_NAME" && -n "$DB_USER" ]] || die "could not read DB credentials from $WP_PATH/wp-config.php"

mysql_q() {
  MYSQL_PWD="$DB_PASS" mysql --socket="$MYSQL_SOCKET" -u"$DB_USER" -D"$DB_NAME" \
    --batch --skip-column-names -e "$1" 2>/dev/null
}

percentiles() {
  sort -n | awk '
    { v[NR] = $1 }
    END {
      if (NR == 0) { print "0 0 0"; exit }
      p50 = v[int((NR + 1) * 0.50)]; if (p50 == "") p50 = v[NR]
      p95 = v[int((NR + 1) * 0.95)]; if (p95 == "") p95 = v[NR]
      printf "%d %d %d", p50, p95, v[NR]
    }'
}

# Returns "p50 p95 max errors" — errors counted separately because connection
# exhaustion shows up as failed requests, not slow ones, and a latency-only
# summary would report that as "fast".
sample_victim() {
  local n="$1" i code t errors=0 times=()
  for ((i = 0; i < n; i++)); do
    read -r code t < <(curl -s -o /dev/null -w '%{http_code} %{time_total}' --max-time 60 "$VICTIM_URL" 2>/dev/null || echo '000 60')
    [[ "$code" == "200" ]] || ((errors++)) || true
    times+=("$(awk -v t="$t" 'BEGIN { printf "%.0f", t * 1000 }')")
  done
  printf '%s %s\n' "$(printf '%s\n' "${times[@]}" | percentiles)" "$errors"
}

record() { printf '%s,%s,%s,%s,%s,%s,%s\n' "$@" >> "$CSV"; }

report() {
  local label="$1" phase="$2" workers="$3" res="$4"
  read -r p50 p95 mx errs <<<"$res"
  record "$label" "$phase" "$workers" "$p50" "$p95" "$mx" "$errs"
  printf '%-12s %-9s p50=%-6s p95=%-6s max=%-6s errors=%s\n' "$label" "$phase" "${p50}ms" "${p95}ms" "${mx}ms" "$errs"
}

# ---- mechanism 1: CPU contention -------------------------------------------
# BENCHMARK() burns server CPU deterministically without depending on how much
# data a store happens to hold, so the result does not silently change as the
# fixture grows.
load_cpu() {
  local stop_flag="$1" i
  for ((i = 0; i < WORKERS; i++)); do
    ( while [[ -e "$stop_flag" ]]; do mysql_q "SELECT BENCHMARK(20000000, MD5(RAND()))" >/dev/null || true; done ) &
  done
}

# ---- mechanism 2: connection exhaustion ------------------------------------
# Every store in a Multisite network connects as the SAME MySQL user, so
# max_user_connections cannot separate them. Holding connections open is the
# whole attack: no query volume is needed.
load_conn() {
  local stop_flag="$1" n="$2" i
  for ((i = 0; i < n; i++)); do
    ( MYSQL_PWD="$DB_PASS" mysql --socket="$MYSQL_SOCKET" -u"$DB_USER" -D"$DB_NAME" \
        -e "SELECT SLEEP(600)" >/dev/null 2>&1 ) &
  done
  # Wait for the connections to actually land before the caller samples.
  local waited=0
  while ((waited < 30)); do
    local connected
    connected="$(mysql_q "SHOW STATUS LIKE 'Threads_connected'" | awk '{print $2}')"
    [[ -n "$connected" ]] && ((connected >= n)) && break
    sleep 1; ((waited++))
  done
}

run_phase() {
  local label="$1" loader="$2" arg="${3:-}"
  local stop_flag; stop_flag="$(mktemp)"
  # shellcheck disable=SC2064
  trap "rm -f '$stop_flag'" EXIT
  "$loader" "$stop_flag" "$arg"
  sleep 2
  report "$label" loaded "${arg:-$WORKERS}" "$(sample_victim "$SAMPLES")"
  rm -f "$stop_flag"
  # pkill -f takes an ERE, so parentheses in the query text would be read as a
  # group and match nothing; keep this pattern free of regex metacharacters.
  pkill -f 'SELECT SLEEP' 2>/dev/null || true
  wait 2>/dev/null || true
  trap - EXIT
  sleep 3   # let MySQL reclaim threads before the next phase
}

main() {
  command -v mysql >/dev/null || die 'mysql client is required'
  curl -s -o /dev/null -w '%{http_code}' "$VICTIM_URL" | grep -q 200 \
    || die "victim ($VICTIM_URL) is not returning 200"

  local max_conn
  max_conn="$(mysql_q 'SELECT @@max_connections')"
  echo "victim=$VICTIM_URL db=$DB_NAME max_connections=$max_conn cpu_workers=$WORKERS"
  echo "max_user_connections=$(mysql_q 'SELECT @@max_user_connections') (0 = unlimited; every store shares this user)"
  echo

  [[ -s "$CSV" ]] || echo 'mechanism,phase,workers,p50_ms,p95_ms,max_ms,errors' > "$CSV"

  curl -s -o /dev/null "$VICTIM_URL"
  report baseline none 0 "$(sample_victim "$SAMPLES")"

  if [[ "$MODE" == cpu || "$MODE" == all ]]; then
    run_phase cpu load_cpu
  fi

  if [[ "$MODE" == conn || "$MODE" == all ]]; then
    # HOLDERS_OVERSHOOT > 0 pushes past max_connections. The default leaves a few
    # slots free so the harness can still read server status; the overshoot run is
    # the one that shows what a neighbour actually experiences at the limit.
    run_phase connections load_conn "$((max_conn - 3 + ${HOLDERS_OVERSHOOT:-0}))"
  fi

  echo
  echo "csv: $CSV"
}

main "$@"
