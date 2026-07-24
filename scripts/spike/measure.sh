#!/usr/bin/env bash

set -euo pipefail

WP_BIN="${WP_BIN:-wp}"
WP_PATH="${WP_PATH:-.}"
SPIKE_LOG_DIR="${SPIKE_LOG_DIR:-./spike-001}"
SPIKE_OUTPUT="${SPIKE_OUTPUT:-${SPIKE_LOG_DIR}/measurements.csv}"
SPIKE_ROUTING_SAMPLES="${SPIKE_ROUTING_SAMPLES:-10}"
SPIKE_PROBE_SITE_ID="${SPIKE_PROBE_SITE_ID:-}"

case "$SPIKE_ROUTING_SAMPLES" in
  ''|*[!0-9]*)
    printf 'SPIKE_ROUTING_SAMPLES must be a positive integer\n' >&2
    exit 2
    ;;
esac
if (( SPIKE_ROUTING_SAMPLES < 1 )); then
  printf 'SPIKE_ROUTING_SAMPLES must be at least 1\n' >&2
  exit 2
fi

wp_cmd() {
  "$WP_BIN" --path="$WP_PATH" "$@"
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

mkdir -p "$(dirname "$SPIKE_OUTPUT")"
sample_file="$(mktemp "${TMPDIR:-/tmp}/spike-001-routing.XXXXXX")"
trap 'rm -f "$sample_file"' EXIT

prefix="$(wp_cmd db prefix | tr -d '\r\n')"
if [[ ! "$prefix" =~ ^[A-Za-z0-9_]+$ ]]; then
  printf 'WP-CLI returned an unsafe database prefix\n' >&2
  exit 2
fi

if [[ -z "$SPIKE_PROBE_SITE_ID" ]]; then
  SPIKE_PROBE_SITE_ID="$(wp_cmd site list --field=blog_id --format=ids | awk '{print $NF}')"
fi
if [[ ! "$SPIKE_PROBE_SITE_ID" =~ ^[0-9]+$ ]] || (( SPIKE_PROBE_SITE_ID < 1 )); then
  printf 'SPIKE_PROBE_SITE_ID must identify an existing site\n' >&2
  exit 2
fi
probe_url="$(wp_cmd site get "$SPIKE_PROBE_SITE_ID" --field=url | tr -d '\r\n')"
if [[ -z "$probe_url" ]]; then
  printf 'could not resolve probe site URL\n' >&2
  exit 1
fi

blogs_table="${prefix}blogs"
site_table="${prefix}site"
sitemeta_table="${prefix}sitemeta"
metrics_query="SELECT (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = '${blogs_table}') AS blogs_rows, (SELECT COALESCE(SUM(data_length + index_length), 0) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = '${blogs_table}') AS blogs_bytes, (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = '${site_table}') AS site_rows, (SELECT COALESCE(SUM(data_length + index_length), 0) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = '${site_table}') AS site_bytes, (SELECT COALESCE(SUM(data_length + index_length), 0) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = '${sitemeta_table}') AS sitemeta_bytes, (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE()) AS table_count, COALESCE(SUM(data_length), 0) AS db_data_bytes, COALESCE(SUM(index_length), 0) AS db_index_bytes, COALESCE(SUM(data_length + index_length), 0) AS db_total_bytes FROM information_schema.tables WHERE table_schema = DATABASE();"
metrics="$(wp_cmd db query --skip-column-names --batch "$metrics_query" | tr '\t' ' ' | tr -d '\r')"
read -r blogs_rows blogs_bytes site_rows site_bytes sitemeta_bytes table_count db_data_bytes db_index_bytes db_total_bytes <<<"$metrics"

printf 'sample,status,duration_ms,site_id,probe_url\n' >"${SPIKE_OUTPUT%.csv}-routing.csv"
successful=0
failed=0
for ((sample = 1; sample <= SPIKE_ROUTING_SAMPLES; sample++)); do
  started_ms="$(now_ms)"
  status=ok
  if ! wp_cmd option get blogname --url="$probe_url" >/dev/null; then
    status=failed
    failed=$((failed + 1))
  else
    successful=$((successful + 1))
  fi
  duration_ms="$(( $(now_ms) - started_ms ))"
  printf '%s,%s,%s,%s,%s\n' "$sample" "$status" "$duration_ms" \
    "$SPIKE_PROBE_SITE_ID" "$probe_url" >>"${SPIKE_OUTPUT%.csv}-routing.csv"
  if [[ "$status" == ok ]]; then
    printf '%s\n' "$duration_ms" >>"$sample_file"
  fi
done

if (( successful == 0 )); then
  printf 'all HyperDB routing probes failed\n' >&2
  exit 1
fi

sorted_samples="$(sort -n "$sample_file")"
sample_count="$successful"
average_ms="$(awk '{sum += $1} END {if (NR) printf "%.2f", sum / NR}' "$sample_file")"
p50_index=$(( (sample_count + 1) / 2 ))
p95_index=$(( (sample_count * 95 + 99) / 100 ))
p99_index=$(( (sample_count * 99 + 99) / 100 ))
p50_ms="$(printf '%s\n' "$sorted_samples" | awk -v target="$p50_index" 'NR == target {print; exit}')"
p95_ms="$(printf '%s\n' "$sorted_samples" | awk -v target="$p95_index" 'NR == target {print; exit}')"
p99_ms="$(printf '%s\n' "$sorted_samples" | awk -v target="$p99_index" 'NR == target {print; exit}')"
max_ms="$(printf '%s\n' "$sorted_samples" | tail -n 1)"
run_id="$(basename "$(dirname "$SPIKE_OUTPUT")")"

{
  printf 'run_id,measured_at_utc,wp_blogs_rows,wp_blogs_size_bytes,wp_site_rows,wp_site_size_bytes,wp_sitemeta_size_bytes,db_table_count,db_data_bytes,db_index_bytes,db_total_bytes,probe_site_id,probe_url,routing_samples,routing_successes,routing_failures,routing_average_ms,routing_p50_ms,routing_p95_ms,routing_p99_ms,routing_max_ms\n'
  printf '%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s\n' \
    "$run_id" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$blogs_rows" "$blogs_bytes" \
    "$site_rows" "$site_bytes" "$sitemeta_bytes" "$table_count" "$db_data_bytes" \
    "$db_index_bytes" "$db_total_bytes" "$SPIKE_PROBE_SITE_ID" "$probe_url" \
    "$SPIKE_ROUTING_SAMPLES" "$successful" "$failed" "$average_ms" "$p50_ms" \
    "$p95_ms" "$p99_ms" "$max_ms"
} >"$SPIKE_OUTPUT"

printf 'measurement evidence: %s\n' "$SPIKE_OUTPUT"
printf 'routing samples: %s\n' "${SPIKE_OUTPUT%.csv}-routing.csv"
