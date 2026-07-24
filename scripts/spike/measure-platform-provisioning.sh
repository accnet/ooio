#!/usr/bin/env bash

set -euo pipefail

# End-to-end provisioning spike through the FULL platform path:
#   Control Plane (NestJS) -> Operation/BullMQ -> Go Agent -> MU Plugin -> WordPress
#
# This is deliberately different from create-sites.sh, which drives wp-cli
# directly. That one measures what WordPress multisite can take; this one
# measures what a CUSTOMER actually waits for, including DAS allocation, the
# transactional outbox, agent poll latency and the MU plugin round trip.
#
# Both numbers are needed for ADR-005: the structural limit and the lived
# latency are not the same question.

API="${API:-http://127.0.0.1:3100}"
EMAIL="${EMAIL:-owner@acme.test}"
PASSWORD="${PASSWORD:-secret123}"
RUNTIME_DOMAIN="${RUNTIME_DOMAIN:-localhost:8088}"
COUNT="${COUNT:-100}"
START="${START:-1}"
PREFIX="${PREFIX:-scale}"
OUT_DIR="${OUT_DIR:-./spike-003-platform}"
OUT="${OUT:-${OUT_DIR}/platform-provisioning.csv}"
# A store is only useful once its operation finishes; polling too fast just
# burns API calls, too slow inflates the measurement.
POLL_INTERVAL="${POLL_INTERVAL:-2}"
POLL_MAX="${POLL_MAX:-60}"

now_ms() {
  local v; v="$(date +%s%N 2>/dev/null)"
  [[ "$v" == *N* ]] && { date +%s000; return; }
  printf '%s\n' "$((v / 1000000))"
}

token() {
  curl -sS -X POST "$API/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
    | python3 -c 'import sys,json;print(json.load(sys.stdin)["accessToken"])'
}

TOKEN="$(token)"
[[ -n "$TOKEN" ]] || { printf 'could not authenticate as %s\n' "$EMAIL" >&2; exit 2; }

mkdir -p "$(dirname "$OUT")"
if (( START == 1 )) || [[ ! -s "$OUT" ]]; then
  printf 'n,slug,store_id,operation_id,create_ms,provision_ms,total_ms,status\n' >"$OUT"
fi

for ((i = START; i < START + COUNT; i++)); do
  slug="${PREFIX}-${i}"
  started="$(now_ms)"

  response="$(curl -sS -X POST "$API/stores" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d "{\"domain\":\"$RUNTIME_DOMAIN\",\"path\":\"/$slug\",\"title\":\"Scale $i\",\"adminEmail\":\"scale@acme.test\"}")"
  create_ms="$(( $(now_ms) - started ))"

  store_id="$(printf '%s' "$response" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("storeId",""))' 2>/dev/null || true)"
  operation_id="$(printf '%s' "$response" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("operationId",""))' 2>/dev/null || true)"

  if [[ -z "$operation_id" ]]; then
    # Quota exhaustion and placement refusal both land here. Record and stop:
    # continuing would measure error handling, not provisioning.
    message="$(printf '%s' "$response" | head -c 120 | tr ',\n' ' ')"
    printf '%s,%s,,,%s,,,rejected: %s\n' "$i" "$slug" "$create_ms" "$message" >>"$OUT"
    printf 'stopped at %s: %s\n' "$i" "$message" >&2
    exit 1
  fi

  provision_started="$(now_ms)"
  status='timeout'
  for ((p = 0; p < POLL_MAX; p++)); do
    status="$(curl -sS "$API/operations/$operation_id" -H "Authorization: Bearer $TOKEN" \
      | python3 -c 'import sys,json;print(json.load(sys.stdin)["status"])' 2>/dev/null || echo unknown)"
    [[ "$status" == succeeded || "$status" == failed ]] && break
    sleep "$POLL_INTERVAL"
  done
  provision_ms="$(( $(now_ms) - provision_started ))"
  total_ms="$(( $(now_ms) - started ))"

  printf '%s,%s,%s,%s,%s,%s,%s,%s\n' \
    "$i" "$slug" "$store_id" "$operation_id" "$create_ms" "$provision_ms" "$total_ms" "$status" >>"$OUT"
  printf '%4s/%s %-14s create=%sms provision=%sms %s\n' \
    "$i" "$((START + COUNT - 1))" "$slug" "$create_ms" "$provision_ms" "$status"
done

printf 'platform provisioning evidence: %s\n' "$OUT"
