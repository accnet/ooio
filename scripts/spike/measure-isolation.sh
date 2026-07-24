#!/usr/bin/env bash
# Spike #005 — Isolation Benchmark (ADR-005 Exit Criteria #2, "noisy neighbor").
#
# Question: when one store in a Multisite network saturates the shared PHP-FPM
# pool, how much does a DIFFERENT store in the same network degrade?
#
# The mechanism under test is PHP worker starvation, not WordPress itself: every
# store in a cluster shares one `pm.max_children` budget. This is the risk
# ADR-005 answers with four Protection layers; the point of this harness is to
# put a number on the unprotected baseline first, because a mitigation with no
# measured "before" cannot be shown to work.
#
# Method: measure victim latency alone, then again while N concurrent clients
# hammer the noisy store. Load is plain HTTP against a real page — no test
# endpoint is injected into WordPress, so nothing here changes what is served.
#
# Usage: measure-isolation.sh [-v victim_path] [-n noisy_path] [-c concurrency]
set -Eeuo pipefail

BASE_URL="${OOIO_BASE_URL:-http://localhost:8088}"
VICTIM_PATH="/"
NOISY_PATH="/noisy/"
CONCURRENCY=30
SAMPLES=40
LOAD_SECONDS=25
OUT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/results"

while getopts 'v:n:c:s:t:' opt; do
  case "$opt" in
    v) VICTIM_PATH="$OPTARG" ;;
    n) NOISY_PATH="$OPTARG" ;;
    c) CONCURRENCY="$OPTARG" ;;
    s) SAMPLES="$OPTARG" ;;
    t) LOAD_SECONDS="$OPTARG" ;;
    *) echo "usage: $0 [-v victim_path] [-n noisy_path] [-c concurrency] [-s samples] [-t load_seconds]" >&2; exit 2 ;;
  esac
done

VICTIM_URL="${BASE_URL}${VICTIM_PATH}"
NOISY_URL="${BASE_URL}${NOISY_PATH}"
CSV="${OUT_DIR}/isolation.csv"
mkdir -p "$OUT_DIR"

die() { echo "FATAL: $*" >&2; exit 1; }

# Refuse to measure a broken target. A 404 or 500 renders far faster than a real
# page, so a failed precondition here would silently produce optimistic numbers.
preflight() {
  local url="$1" label="$2" code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$url")" \
    || die "$label ($url) is unreachable"
  [[ "$code" == "200" ]] || die "$label ($url) returned HTTP $code; expected 200"
}

# p50/p95 from whitespace-separated milliseconds on stdin.
percentiles() {
  sort -n | awk '
    { v[NR] = $1 }
    END {
      if (NR == 0) { print "0 0 0 0"; exit }
      p50 = v[int((NR + 1) * 0.50)]; if (p50 == "") p50 = v[NR]
      p95 = v[int((NR + 1) * 0.95)]; if (p95 == "") p95 = v[NR]
      printf "%d %d %d %d", p50, p95, v[1], v[NR]
    }'
}

sample_victim() {
  local n="$1" i t
  for ((i = 0; i < n; i++)); do
    t="$(curl -s -o /dev/null -w '%{time_total}' --max-time 60 "$VICTIM_URL" 2>/dev/null || echo 60)"
    awk -v t="$t" 'BEGIN { printf "%.0f\n", t * 1000 }'
  done
}

# Background load. Each worker loops until the deadline file disappears, so the
# generator stops even if this script is interrupted mid-run.
start_load() {
  local stop_flag="$1" i
  for ((i = 0; i < CONCURRENCY; i++)); do
    (
      while [[ -e "$stop_flag" ]]; do
        curl -s -o /dev/null --max-time 60 "$NOISY_URL" || true
      done
    ) &
  done
}

record() {
  printf '%s,%s,%s,%s,%s,%s,%s,%s,%s\n' "$MITIGATION" "$@" >> "$CSV"
}

# The CSV must say which mitigation was active, otherwise two runs that differ
# only in server config produce indistinguishable rows and the report has to
# guess. Derived from the live config, not passed in, so it cannot disagree
# with what was actually measured.
detect_mitigation() {
  local caddyfile="${OOIO_CADDYFILE:-$HOME/ooio-devenv/Caddyfile}"
  if [[ "$VICTIM_PATH" != */ ]]; then
    echo 'static-path'
  elif grep -q 'php-fpm-noisy.sock' "$caddyfile" 2>/dev/null; then
    echo 'dedicated-pool'
  else
    echo 'none'
  fi
}

main() {
  command -v curl >/dev/null || die 'curl is required'

  preflight "$VICTIM_URL" 'victim'
  preflight "$NOISY_URL" 'noisy'

  local max_children
  max_children="$(grep -oP '^\s*pm\.max_children\s*=\s*\K[0-9]+' "${OOIO_PHP_FPM_CONF:-$HOME/ooio-devenv/php-fpm.conf}" 2>/dev/null || echo unknown)"

  MITIGATION="$(detect_mitigation)"
  [[ -s "$CSV" ]] || echo 'mitigation,phase,victim,noisy,concurrency,p50_ms,p95_ms,min_ms,max_ms' > "$CSV"

  echo "victim=$VICTIM_URL noisy=$NOISY_URL concurrency=$CONCURRENCY pm.max_children=$max_children mitigation=$MITIGATION"

  # Warm caches on both sites so the baseline is not measuring a cold opcache.
  curl -s -o /dev/null "$VICTIM_URL"; curl -s -o /dev/null "$NOISY_URL"

  echo '--- phase 1: baseline (no load) ---'
  local base
  base="$(sample_victim "$SAMPLES" | percentiles)"
  read -r b50 b95 bmin bmax <<<"$base"
  record baseline "$VICTIM_PATH" "$NOISY_PATH" 0 "$b50" "$b95" "$bmin" "$bmax"
  echo "baseline p50=${b50}ms p95=${b95}ms min=${bmin}ms max=${bmax}ms"

  echo "--- phase 2: victim under noisy-neighbour load (${CONCURRENCY} clients) ---"
  local stop_flag
  stop_flag="$(mktemp)"
  # shellcheck disable=SC2064
  trap "rm -f '$stop_flag'; wait 2>/dev/null || true" EXIT
  start_load "$stop_flag"
  sleep 3   # let the pool fill before sampling

  local under
  under="$(sample_victim "$SAMPLES" | percentiles)"
  read -r u50 u95 umin umax <<<"$under"

  rm -f "$stop_flag"
  wait 2>/dev/null || true
  trap - EXIT

  record loaded "$VICTIM_PATH" "$NOISY_PATH" "$CONCURRENCY" "$u50" "$u95" "$umin" "$umax"
  echo "loaded   p50=${u50}ms p95=${u95}ms min=${umin}ms max=${umax}ms"

  awk -v b="$b50" -v u="$u50" -v b95="$b95" -v u95="$u95" 'BEGIN {
    printf "\ndegradation: p50 %.1fx   p95 %.1fx\n", (b > 0 ? u / b : 0), (b95 > 0 ? u95 / b95 : 0)
  }'
  echo "csv: $CSV"
}

main "$@"
