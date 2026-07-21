#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
installer="$script_dir/install-node.sh"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

bash -n "$installer"

cat > "$tmp_dir/node-config.env" <<EOF
PLATFORM_CORE_SHARED_SECRET=test-secret-for-dry-run
WP_ADMIN_PASSWORD=test-password
MARIADB_PASSWORD=test-password
EOF

output="$tmp_dir/dry-run.txt"
bash "$installer" --prefix "$tmp_dir/prefix" --config "$tmp_dir/node-config.env" --dry-run > "$output"
[[ ! -e "$tmp_dir/prefix" ]] || { printf '%s\n' 'dry-run created files' >&2; exit 1; }

system_output="$tmp_dir/system-dry-run.txt"
bash "$installer" --system --config "$tmp_dir/node-config.env" --dry-run > "$system_output"

assert_contains() {
  local needle="$1"
  grep -Fq "$needle" "$output" || {
    printf 'missing dry-run phase: %s\n' "$needle" >&2
    cat "$output" >&2
    exit 1
  }
}

assert_system_contains() {
  local needle="$1"
  grep -Fq "$needle" "$system_output" || {
    printf 'missing system dry-run phase: %s\n' "$needle" >&2
    cat "$system_output" >&2
    exit 1
  }
}

assert_contains 'initialize MariaDB datadir'
assert_contains 'create MariaDB database'
assert_contains 'download wp-cli'
assert_contains 'subdirectory multisite'
assert_contains 'start Redis in background'
assert_contains 'install HyperDB plugin'
assert_contains 'copy HyperDB db.php drop-in'
assert_contains 'write HyperDB single-pool config'
assert_contains 'core plugin set (including WooCommerce)'
assert_contains 'set WP_CACHE'
assert_contains 'wp redis enable'
assert_contains 'MU plugin'
assert_contains 'Caddy'
assert_contains 'platform-agent'
assert_contains 'plan complete'
assert_system_contains 'enable and start Redis service redis-server'

printf '%s\n' 'install-node.sh dry-run test passed'
