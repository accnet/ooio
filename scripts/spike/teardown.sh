#!/usr/bin/env bash

set -euo pipefail

WP_BIN="${WP_BIN:-wp}"
WP_PATH="${WP_PATH:-.}"
SPIKE_PREFIX="${SPIKE_PREFIX:-spike001}"

if [[ ! "$SPIKE_PREFIX" =~ ^[A-Za-z0-9_-]+$ ]]; then
  printf 'SPIKE_PREFIX contains unsupported characters\n' >&2
  exit 2
fi

wp_cmd() {
  "$WP_BIN" --path="$WP_PATH" "$@"
}

prefix="$(wp_cmd db prefix | tr -d '\r\n')"
if [[ ! "$prefix" =~ ^[A-Za-z0-9_]+$ ]]; then
  printf 'WP-CLI returned an unsafe database prefix\n' >&2
  exit 2
fi
site_query="SELECT blog_id, path FROM ${prefix}blogs;"
site_ids="$(wp_cmd db query --skip-column-names --batch "$site_query" | \
  awk -F '\t' -v path_prefix="/${SPIKE_PREFIX}-" 'index($2, path_prefix) == 1 {print $1}' | tr -d '\r')"

if [[ -z "$site_ids" ]]; then
  printf 'no sites found for prefix %s\n' "$SPIKE_PREFIX"
  exit 0
fi

printf 'sites selected for deletion (prefix %s):\n%s\n' "$SPIKE_PREFIX" "$site_ids"
if [[ "${1:-}" != --yes || "${SPIKE_TEARDOWN_CONFIRM:-}" != DELETE_SPIKE_SITES ]]; then
  printf 'refusing deletion: pass --yes and SPIKE_TEARDOWN_CONFIRM=DELETE_SPIKE_SITES\n' >&2
  exit 2
fi

while IFS= read -r blog_id; do
  [[ -z "$blog_id" ]] && continue
  if [[ ! "$blog_id" =~ ^[0-9]+$ ]]; then
    printf 'unexpected blog id from database: %s\n' "$blog_id" >&2
    exit 2
  fi
  wp_cmd site delete "$blog_id" --yes
  printf 'deleted blog_id=%s\n' "$blog_id"
done <<<"$site_ids"
