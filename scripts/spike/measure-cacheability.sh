#!/usr/bin/env bash
# Spike #007 — Which WooCommerce routes can be served without touching PHP.
#
# Spike #005 proved a request that never reaches PHP is completely immune to a
# noisy neighbour (1.0x while the PHP path degraded 12.9x). It measured a static
# file. ADR-005 targets "~90% of requests must not touch PHP" — that number has
# no basis yet, and it is the number the whole Protection strategy rests on.
#
# This harness does NOT produce a hit rate. There is no real traffic here, so a
# single headline percentage would be invented. It measures per-route FACTS:
# whether a route's HTML differs between two visitors. The report turns those
# facts into a formula the reader supplies their own traffic mix to.
#
# Method: fetch every route twice — once anonymous, once with a session that has
# a cart — and compare. Different bodies mean the response is visitor-specific
# and cannot be served from one shared cache entry.
set -Eeuo pipefail

BASE_URL="${OOIO_BASE_URL:-http://localhost:8088}"
# Default to /noisy/, not /. Blog 1 in the dev network lost its WooCommerce block
# templates at some point (`wc-block-store-notices` absent, 3 WooCommerce blocks
# instead of 54), so measuring it reports `/shop/` as cacheable when the real
# template would not be. Verify before trusting a run:
#   curl -s <store>/shop/ | grep -c wc-block-store-notices   # must be 1
STORE_PATH="${OOIO_STORE_PATH:-/noisy/}"
WP_PATH="${OOIO_WP_PATH:-$HOME/ooio-devenv/wp}"
OUT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/results"
CSV="$OUT_DIR/cacheability.csv"
JAR_DIR="$(mktemp -d)"
trap 'rm -rf "$JAR_DIR"' EXIT

mkdir -p "$OUT_DIR"
die() { echo "FATAL: $*" >&2; exit 1; }

STORE_URL="${BASE_URL%/}${STORE_PATH}"

wpc() { ( cd "$WP_PATH" && wp "$@" --url="$STORE_URL" 2>/dev/null ); }

# A product permalink is needed for the product-detail row; picking it from the
# fixture keeps the harness from hard-coding a slug that may not exist.
product_url() {
  local id
  id="$(wpc post list --post_type=product --format=ids | awk '{print $1}')"
  [[ -n "$id" ]] || die 'no product found; run the fixture step first'
  wpc post list --post_type=product --format=csv --fields=url | sed -n 2p
}

# Returns "code bytes" for one request through the given cookie jar.
fetch() {
  local url="$1" jar="$2" body="$3"
  curl -s -o "$body" -c "$jar" -b "$jar" -w '%{http_code}' --max-time 30 "$url"
}

# Strip per-render noise so a difference means "this visitor sees other content",
# not "this token rotated".
# `quantity_<uniqid>` is a random DOM id WooCommerce generates per render to link
# a screen-reader label to its input. It changes on every request even for the
# same anonymous visitor, so leaving it in would report the product page as
# nondeterministic — and therefore uncacheable — when it is neither.
normalise() {
  sed -E 's/(nonce|_wpnonce)["'"'"'=:][^"'"'"'&<> ]*/NONCE/g;
          s/wp-settings-time=[0-9]+/TS/g;
          s/quantity_[0-9a-f]{8,}/QID/g' "$1"
}

# A page whose only difference is `<link rel=prefetch>` hints is NOT
# visitor-specific in content: the same HTML body is correct for everyone, and
# the hints are a performance optimisation. Reporting that as "not cacheable"
# would overstate the problem by a wide margin, so the two cases are separated.
diff_is_only_prefetch() {
  local d
  d="$(diff <(normalise "$1") <(normalise "$2") | grep -E '^[<>]' || true)"
  [[ -n "$d" ]] || return 1
  ! grep -qvE "^[<>] *(<link [^>]*rel='?prefetch'?[^>]*/?>)? *$" <<<"$d"
}

diff_line_count() {
  diff <(normalise "$1") <(normalise "$2") | grep -cE '^[<>]' || true
}

record() { printf '%s,%s,%s,%s,%s,%s\n' "$@" >> "$CSV"; }

classify() {
  local label="$1" url="$2"
  local a="$JAR_DIR/a.html" a2="$JAR_DIR/a2.html" b="$JAR_DIR/b.html"
  local ca cb

  # A FRESH anonymous jar per route. Reusing one jar let earlier routes leave a
  # cart cookie behind, which made both visitors identical and reported
  # `?add-to-cart=` as cacheable — the exact opposite of the truth.
  local anon="$JAR_DIR/anon-$RANDOM.jar"

  ca="$(fetch "$url" "$anon" "$a")"
  # Control: the same anonymous visitor twice. If these differ, the page render
  # is nondeterministic and any anon-vs-cart comparison below is meaningless.
  rm -f "$anon"; fetch "$url" "$anon" "$a2" >/dev/null
  local deterministic=yes
  diff -q <(normalise "$a") <(normalise "$a2") >/dev/null 2>&1 || deterministic=no

  cb="$(fetch "$url" "$JAR_DIR/cart.jar" "$b")"

  local setcookie verdict lines
  setcookie="$(curl -sI -b "$JAR_DIR/cart.jar" --max-time 30 "$url" | grep -ci '^set-cookie' || true)"
  lines="$(diff_line_count "$a" "$b")"

  if [[ "$ca" != 200 && "$ca" != 302 ]]; then
    verdict="khong-do-duoc(HTTP $ca)"
  elif [[ "$deterministic" == no ]]; then
    verdict="RENDER-KHONG-TAT-DINH"
  elif diff -q <(normalise "$a") <(normalise "$b") >/dev/null 2>&1; then
    verdict=$([[ "$setcookie" -gt 0 ]] && echo 'cacheable-neu-bo-Set-Cookie' || echo 'cacheable')
  elif diff_is_only_prefetch "$a" "$b"; then
    verdict="cacheable-chi-khac-prefetch"
  else
    verdict="KHONG-cacheable"
  fi

  record "$label" "$ca" "$deterministic" "$lines" "$setcookie" "$verdict"
  printf '%-22s http=%-4s tat-dinh=%-4s dong-khac=%-5s set-cookie=%-3s %s\n' \
    "$label" "$ca" "$deterministic" "$lines" "$setcookie" "$verdict"
}

main() {
  command -v wp >/dev/null || die 'wp-cli is required'
  [[ -s "$CSV" ]] || echo 'route,http,deterministic,diff_lines,set_cookie_headers,verdict' > "$CSV"

  local prod first_id
  first_id="$(wpc post list --post_type=product --format=ids | awk '{print $1}')"
  [[ -n "$first_id" ]] || die 'no products; the fixture step must run first'
  prod="$(wpc post url "$first_id")"

  echo "store=$STORE_URL"

  # THE OPERATIVE NUMBER. A page cache does not serve one entry to everyone — it
  # bypasses for visitors holding a cart (WooCommerce sets `woocommerce_cart_hash`
  # and `woocommerce_items_in_cart`, and calls nocache_headers() for them). So the
  # question that decides hit rate is not "do two different visitors match" but
  # "is the anonymous page stable enough to store once". Measured 2026-07-23:
  # three independent anonymous sessions on /shop/ differed by ZERO lines.
  local a1="$JAR_DIR/anon-a.html" a2="$JAR_DIR/anon-b.html"
  curl -s -o "$a1" -c "$JAR_DIR/s1.jar" --max-time 30 "${STORE_URL%/}/shop/"
  curl -s -o "$a2" -c "$JAR_DIR/s2.jar" --max-time 30 "${STORE_URL%/}/shop/"
  local anon_diff; anon_diff="$(diff "$a1" "$a2" | grep -cE '^[<>]' || true)"
  printf 'hai phien AN DANH doc lap tren /shop/: %s dong khac  -> %s\n' \
    "$anon_diff" "$([[ "$anon_diff" -eq 0 ]] && echo 'CACHE DUOC cho khach khong co gio' || echo 'KHONG on dinh')"
  echo
  echo 'Bang duoi so ANH DANH vs CO GIO HANG — huu ich de biet cai gi mang trang thai,'
  echo 'nhung KHONG phai dieu kien de cache: khach co gio duoc bypass theo cookie.'
  echo

  # Seed the cart jar so the two visitors genuinely differ.
  curl -s -o /dev/null -c "$JAR_DIR/cart.jar" -b "$JAR_DIR/cart.jar" \
    "${STORE_URL%/}/?add-to-cart=${first_id}"

  classify 'trang chu'        "$STORE_URL"
  classify 'shop'             "${STORE_URL%/}/shop/"
  classify 'san pham'         "$prod"
  classify 'danh muc'         "${STORE_URL%/}/product-category/sample-category/"
  classify 'cart'             "${STORE_URL%/}/cart/"
  classify 'checkout'         "${STORE_URL%/}/checkout/"
  classify 'my-account'       "${STORE_URL%/}/my-account/"
  classify 'add-to-cart'      "${STORE_URL%/}/?add-to-cart=${first_id}"
  classify 'tim kiem'         "${STORE_URL%/}/?s=sample"
  classify 'wp-json wc'       "${STORE_URL%/}/wp-json/wc/store/v1/products"
  classify 'feed'             "${STORE_URL%/}/feed/"

  echo
  echo "csv: $CSV"
}

main "$@"
