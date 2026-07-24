#!/usr/bin/env bash

set -euo pipefail

# Create a deterministic site cohort and keep one timing record per attempt.
WP_BIN="${WP_BIN:-wp}"
WP_PATH="${WP_PATH:-.}"
SPIKE_SITES="${SPIKE_SITES:-500}"
SPIKE_PREFIX="${SPIKE_PREFIX:-spike001}"
SPIKE_LOG_DIR="${SPIKE_LOG_DIR:-./spike-001}"
SPIKE_OUTPUT="${SPIKE_OUTPUT:-${SPIKE_LOG_DIR}/provisioning.csv}"
SPIKE_ADMIN_EMAIL="${SPIKE_ADMIN_EMAIL:-spike-admin@example.invalid}"

case "$SPIKE_SITES" in
  ''|*[!0-9]*)
    printf 'SPIKE_SITES must be a positive integer\n' >&2
    exit 2
    ;;
esac
if (( SPIKE_SITES < 1 )); then
  printf 'SPIKE_SITES must be at least 1\n' >&2
  exit 2
fi
if [[ ! "$SPIKE_PREFIX" =~ ^[A-Za-z0-9_-]+$ ]]; then
  printf 'SPIKE_PREFIX contains unsupported characters\n' >&2
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
printf 'site_number,blog_id,slug,started_at_utc,finished_at_utc,provisioning_ms,status\n' >"$SPIKE_OUTPUT"

for ((site_number = 1; site_number <= SPIKE_SITES; site_number++)); do
  slug="${SPIKE_PREFIX}-$(printf '%04d' "$site_number")"
  started_at_utc="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  started_ms="$(now_ms)"
  blog_id=''
  status=failed

  if blog_id="$(wp_cmd site create \
      --slug="$slug" \
      --title="Spike ${slug}" \
      --email="$SPIKE_ADMIN_EMAIL" \
      --porcelain)"; then
    status=created
  fi

  finished_at_utc="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  duration_ms="$(( $(now_ms) - started_ms ))"
  printf '%s,%s,%s,%s,%s,%s,%s\n' \
    "$site_number" "$blog_id" "$slug" "$started_at_utc" \
    "$finished_at_utc" "$duration_ms" "$status" >>"$SPIKE_OUTPUT"

  if [[ "$status" != created ]]; then
    printf 'site %s (%s) failed; see WP-CLI output\n' "$site_number" "$slug" >&2
    exit 1
  fi
  printf 'created %s/%s: blog_id=%s duration_ms=%s\n' \
    "$site_number" "$SPIKE_SITES" "$blog_id" "$duration_ms"
done

printf 'provisioning evidence: %s\n' "$SPIKE_OUTPUT"

