#!/usr/bin/env bash
# Spike #007 — Plugin Compatibility Matrix on WordPress Multisite.
# ADR-005 Exit Criteria #4 — the last criterion that can still overturn Multisite.
#
# For each plugin: install → network-activate → exercise TWO different stores →
# read the PHP error log → uninstall → confirm both stores are back to 200.
#
# The uninstall step is not cleanup politeness. Without it, a fatal caused by
# plugin N-1 is attributed to plugin N and the whole matrix becomes worthless.
#
# Beyond "does it work", three Multisite-specific facts are recorded, because
# they are what makes a plugin unsafe for a SHARED network even when it runs:
#   dropin   — writes to wp-content/*.php, which is NETWORK-WIDE, not per store
#   global   — writes to wp_users / wp_usermeta / wp_sitemeta, shared across stores
#   scope    — settings stored per-site or per-network
set -Eeuo pipefail

WP_PATH="${OOIO_WP_PATH:-$HOME/ooio-devenv/wp}"
BASE_URL="${OOIO_BASE_URL:-http://localhost:8088}"
SITE_A="${OOIO_SITE_A:-$BASE_URL/}"
SITE_B="${OOIO_SITE_B:-$BASE_URL/noisy/}"
PHP_LOG="${OOIO_PHP_LOG:-$HOME/ooio-devenv/run/php-fpm.log}"
OUT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/results"
CSV="$OUT_DIR/plugin-compat.csv"

PLUGINS=(
  "wordpress-seo:SEO"
  "seo-by-rank-math:SEO"
  "w3-total-cache:cache"
  "wp-super-cache:cache"
  "litespeed-cache:cache"
  "woocommerce-gateway-stripe:thanh-toan"
  "woo-stripe-payment:thanh-toan"
  "flexible-shipping:van-chuyen"
  "woocommerce-shipping:van-chuyen"
  "elementor:builder"
  "contact-form-7:form"
  "wpforms-lite:form"
  "redirection:tien-ich"
  "wordfence:bao-mat"
)

mkdir -p "$OUT_DIR"
die() { echo "FATAL: $*" >&2; exit 1; }
wpx() { ( cd "$WP_PATH" && wp "$@" 2>&1 | grep -viE 'database error|made by |^\s*$' ); }

dropins() { ls "$WP_PATH/wp-content"/*.php 2>/dev/null | xargs -r -n1 basename | sort | tr '\n' ' '; }

global_row_counts() {
  ( cd "$WP_PATH" && wp db query \
    "SELECT (SELECT COUNT(*) FROM wp_usermeta) + (SELECT COUNT(*) FROM wp_sitemeta)" \
    --skip-column-names 2>/dev/null )
}

http_code() { curl -s -o /dev/null -w '%{http_code}' --max-time 45 "$1"; }

# Exercise both stores. A plugin that only breaks the SECOND site is exactly the
# Multisite-specific failure this matrix exists to find, so one site is not enough.
probe_sites() {
  local out=""
  for base in "$SITE_A" "$SITE_B"; do
    for p in "" "shop/" "cart/"; do
      out+="$(http_code "${base%/}/$p") "
    done
  done
  echo "${out% }"
}

all_ok() { [[ "$1" =~ ^(200|302)([[:space:]](200|302))*$ ]]; }

record() { printf '%s,%s,%s,%s,%s,%s,%s,%s\n' "$@" >> "$CSV"; }

main() {
  command -v wp >/dev/null || die 'wp-cli is required'
  [[ -s "$CSV" ]] || echo 'plugin,group,install,network_activate,http_codes,dropin_added,global_meta_delta,verdict' > "$CSV"

  local base_dropins base_globals baseline
  base_dropins="$(dropins)"; base_globals="$(global_row_counts)"
  baseline="$(probe_sites)"
  all_ok "$baseline" || die "stores are not healthy before the run: $baseline"
  echo "baseline http=[$baseline] dropins=[$base_dropins] global_meta=$base_globals"
  echo

  for entry in "${PLUGINS[@]}"; do
    local slug="${entry%%:*}" group="${entry##*:}"
    local install=fail netact=n/a codes="" added="" delta=0 verdict=""
    local before_globals; before_globals="$(global_row_counts)"

    if timeout 180 bash -c "cd '$WP_PATH' && wp plugin install '$slug' --force" >/dev/null 2>&1; then
      install=ok
    fi

    if [[ "$install" == ok ]]; then
      if timeout 180 bash -c "cd '$WP_PATH' && wp plugin activate '$slug' --network" >/dev/null 2>&1; then
        netact=ok
      else
        netact=fail
      fi
      codes="$(probe_sites)"
      added="$(comm -13 <(tr ' ' '\n' <<<"$base_dropins" | sort -u) <(tr ' ' '\n' <<<"$(dropins)" | sort -u) | tr '\n' '+')"
      delta=$(( $(global_row_counts) - before_globals ))

      timeout 180 bash -c "cd '$WP_PATH' && wp plugin deactivate '$slug' --network" >/dev/null 2>&1 || true
      timeout 180 bash -c "cd '$WP_PATH' && wp plugin uninstall '$slug' --deactivate" >/dev/null 2>&1 || true
      # Drop-ins survive uninstall. Remove EVERY wp-content/*.php that was not in
      # the baseline rather than a hard-coded list: the first run of this harness
      # left `wp-cache-config.php` behind and then attributed it to all eleven
      # plugins that followed.
      while read -r leftover; do
        [[ -n "$leftover" ]] || continue
        rm -f "$WP_PATH/wp-content/$leftover"
      done < <(comm -13 <(tr ' ' '\n' <<<"$base_dropins" | sed '/^$/d' | sort -u) \
                       <(dropins | tr ' ' '\n' | sed '/^$/d' | sort -u))
      ( cd "$WP_PATH" && wp cache flush >/dev/null 2>&1 ) || true
    fi

    local after; after="$(probe_sites)"
    if [[ "$install" != ok ]]; then
      verdict="khong-cai-duoc"
    elif [[ "$netact" != ok ]]; then
      verdict="khong-network-activate-duoc"
    elif ! all_ok "$codes"; then
      verdict="HONG-STORE"
    elif [[ -n "${added//+/}" ]]; then
      verdict="chay-duoc-NHUNG-ghi-dropin"
    else
      verdict="chay-duoc"
    fi
    all_ok "$after" || verdict="$verdict|KHONG-KHOI-PHUC-DUOC"

    record "$slug" "$group" "$install" "$netact" "\"$codes\"" "${added//+/ }" "$delta" "$verdict"
    printf '%-28s %-12s cai=%-5s net=%-5s http=[%s] dropin=[%s] meta%+d  %s\n' \
      "$slug" "$group" "$install" "$netact" "$codes" "${added//+/ }" "$delta" "$verdict"
  done

  echo
  echo "csv: $CSV"
}

main "$@"
