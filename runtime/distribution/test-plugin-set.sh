#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
PLUGIN_SET="$SCRIPT_DIR/core-plugin-set.json"

command -v python3 >/dev/null 2>&1 || { printf '%s\n' 'error: python3 is required' >&2; exit 1; }

python3 - "$PLUGIN_SET" <<'PY'
import json
import sys

path = sys.argv[1]
with open(path, encoding="utf-8") as manifest_file:
    manifest = json.load(manifest_file)

if not isinstance(manifest.get("$schema"), str) or not manifest["$schema"]:
    raise SystemExit("core plugin set must declare $schema")

plugins = manifest.get("plugins")
if not isinstance(plugins, list) or not plugins:
    raise SystemExit("core plugin set must contain a non-empty plugins array")

required_slugs = {
    "woocommerce",
    "redis-cache",
    "wordpress-seo",
    "wp-mail-smtp",
    "ewww-image-optimizer",
    "backup-client",
    "platform-connector",
}
seen_slugs = set()
for plugin in plugins:
    if not isinstance(plugin, dict):
        raise SystemExit("every plugin entry must be an object")
    for field in ("slug", "source", "version"):
        if not isinstance(plugin.get(field), str) or not plugin[field]:
            raise SystemExit(f"every plugin entry requires a non-empty {field}")
    if plugin["source"] not in ("wporg", "url"):
        raise SystemExit(f"unsupported source: {plugin['source']}")
    if plugin["source"] == "url" and not plugin.get("url"):
        raise SystemExit(f"url source requires url: {plugin['slug']}")
    if plugin["slug"] in seen_slugs:
        raise SystemExit(f"duplicate plugin slug: {plugin['slug']}")
    seen_slugs.add(plugin["slug"])

missing = required_slugs - seen_slugs
if missing:
    raise SystemExit("missing required plugins: " + ", ".join(sorted(missing)))

# A plugin removed for a measured reason must not drift back in silently. Every
# store in a cluster gets this set, so a regression here multiplies by store
# count. Re-adding one requires deleting its `excluded` entry deliberately.
excluded = manifest.get("excluded", [])
if not isinstance(excluded, list):
    raise SystemExit("`excluded` must be an array")
for entry in excluded:
    for field in ("slug", "removed", "reason", "replacement", "reinstate_if"):
        if not isinstance(entry.get(field), str) or not entry[field]:
            raise SystemExit(f"excluded entry requires a non-empty {field}")
    if entry["slug"] in seen_slugs:
        raise SystemExit(
            f"{entry['slug']} is listed in `plugins` but also in `excluded` "
            f"(removed {entry['removed']}): {entry['reason']}"
        )
PY

bash -n "$SCRIPT_DIR/install-plugins.sh" "$SCRIPT_DIR/test-plugin-set.sh"
printf 'plugin set validation passed\n'
