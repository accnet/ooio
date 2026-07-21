#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
PLUGIN_SET="$SCRIPT_DIR/core-plugin-set.json"
WP_PATH=

usage() {
  printf 'Usage: %s --wp-path PATH\n' "$(basename -- "$0")"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --wp-path)
      [[ $# -ge 2 ]] || { printf '%s\n' 'error: --wp-path requires a value' >&2; usage >&2; exit 2; }
      WP_PATH=$2
      shift 2
      ;;
    --wp-path=*)
      WP_PATH=${1#*=}
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'error: unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

[[ -n "$WP_PATH" ]] || { printf '%s\n' 'error: --wp-path is required' >&2; usage >&2; exit 2; }
[[ -f "$PLUGIN_SET" ]] || { printf 'error: plugin set not found: %s\n' "$PLUGIN_SET" >&2; exit 1; }
command -v wp >/dev/null 2>&1 || { printf '%s\n' 'error: wp-cli is required' >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { printf '%s\n' 'error: python3 is required' >&2; exit 1; }

WP=(wp --path="$WP_PATH")

# Validate and flatten the manifest before making any changes through WP-CLI.
plugin_lines=$(python3 - "$PLUGIN_SET" <<'PY'
import json
import sys

path = sys.argv[1]
with open(path, encoding="utf-8") as manifest_file:
    manifest = json.load(manifest_file)

plugins = manifest.get("plugins")
if not isinstance(plugins, list) or not plugins:
    raise SystemExit("plugin set must contain a non-empty plugins array")

for plugin in plugins:
    if not isinstance(plugin, dict):
        raise SystemExit("every plugin entry must be an object")
    for field in ("slug", "source", "version"):
        if not isinstance(plugin.get(field), str) or not plugin[field]:
            raise SystemExit(f"every plugin entry requires a non-empty {field}")
    if plugin["source"] not in ("wporg", "url"):
        raise SystemExit(f"unsupported source for {plugin['slug']}: {plugin['source']}")
    url = plugin.get("url", "")
    if plugin["source"] == "url" and not url:
        raise SystemExit(f"url source requires url: {plugin['slug']}")
    print("\t".join((plugin["slug"], plugin["source"], plugin["version"], url)))
PY
)

while IFS=$'\t' read -r slug source version url; do
  [[ -n "$slug" ]] || continue

  install_target=$slug
  if [[ "$source" == "url" ]]; then
    install_target=$url
  fi

  if "${WP[@]}" plugin is-installed "$slug" >/dev/null 2>&1; then
    printf 'skip installed plugin: %s\n' "$slug"
  else
    printf 'install plugin: %s (%s)\n' "$slug" "$version"
    "${WP[@]}" plugin install "$install_target" --version="$version"
  fi

  if "${WP[@]}" plugin is-active "$slug" --network >/dev/null 2>&1; then
    printf 'skip network-active plugin: %s\n' "$slug"
  else
    printf 'network-activate plugin: %s\n' "$slug"
    "${WP[@]}" plugin activate "$slug" --network
  fi
done <<< "$plugin_lines"
