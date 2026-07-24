#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/../.." && pwd -P)
BUILD="$SCRIPT_DIR/build.sh"

bash -n "$SCRIPT_DIR/lib.sh" "$BUILD" "$SCRIPT_DIR/test.sh"
command -v python3 >/dev/null 2>&1 || {
  printf 'test.sh: python3 is required\n' >&2
  exit 1
}

tmp_dir=$(mktemp -d "${TMPDIR:-/tmp}/distribution-builder-test.XXXXXX")
trap 'rm -rf "$tmp_dir"' EXIT
fixture="$tmp_dir/sample-distribution"
output="$tmp_dir/output"
mkdir -p "$fixture/plugins/example" "$fixture/config"
printf 'fixture plugin\n' > "$fixture/plugins/example/plugin.php"
printf 'profile=default\n' > "$fixture/config/runtime.ini"
cat > "$fixture/manifest.json" <<'JSON'
{
  "wordpress": {"name": "wordpress", "version": "6.9"},
  "woocommerce": {"name": "woocommerce", "version": "10.2"},
  "theme": {"name": "store-theme", "version": "1.0.0"},
  "plugins": [{"name": "example", "version": "2.0.0"}],
  "muPlugin": {"name": "mu-platform", "version": "1.0.0"},
  "config": {"profile": "default", "path": "config"}
}
JSON

dry_run_output=$($BUILD --version 1.2.3 --source "$fixture" --output "$output" --dry-run)
[[ "$dry_run_output" == *"would package source"* ]] || {
  printf 'test.sh: dry-run did not report the planned package\n' >&2
  exit 1
}
[[ ! -e "$output" ]] || {
  printf 'test.sh: dry-run created output\n' >&2
  exit 1
}

$BUILD --version 1.2.3 --source "$fixture" --output "$output" >/dev/null
archive="$output/sample-distribution-1.2.3.tar.gz"
checksum_file="$archive.sha256"
[[ -f "$archive" && -f "$checksum_file" ]] || {
  printf 'test.sh: expected archive and checksum were not created\n' >&2
  exit 1
}

mkdir "$tmp_dir/extracted"
tar -xzf "$archive" -C "$tmp_dir/extracted"
[[ -f "$tmp_dir/extracted/manifest.json" ]] || {
  printf 'test.sh: archive does not contain manifest.json\n' >&2
  exit 1
}
[[ -f "$tmp_dir/extracted/plugins/example/plugin.php" ]] || {
  printf 'test.sh: archive does not contain fixture content\n' >&2
  exit 1
}

python3 - "$ROOT_DIR/runtime/distribution/manifest.schema.json" "$tmp_dir/extracted/manifest.json" "$archive" "$checksum_file" <<'PY'
import hashlib
import json
import re
import sys
from pathlib import Path

schema_path, manifest_path, archive_path, checksum_path = sys.argv[1:]
schema = json.loads(Path(schema_path).read_text(encoding="utf-8"))
manifest = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
properties = schema["properties"]

assert set(schema["required"]).issubset(manifest)
assert set(manifest).issubset(properties)
assert re.fullmatch(properties["distribution"]["pattern"], manifest["distribution"])
assert re.fullmatch(properties["version"]["pattern"], manifest["version"])
assert manifest["version"] == "1.2.3"
assert manifest["checksum"]["algorithm"] == "sha256"
assert re.fullmatch(schema["$defs"]["checksum"]["properties"]["value"]["pattern"], manifest["checksum"]["value"])
for key in ("wordpress", "woocommerce"):
    assert set(("name", "version")).issubset(manifest[key])
for plugin in manifest["plugins"]:
    assert set(("name", "version")).issubset(plugin)

expected_hash = hashlib.sha256(Path(archive_path).read_bytes()).hexdigest()
checksum_line = Path(checksum_path).read_text(encoding="utf-8").strip().split()
assert checksum_line == [expected_hash, Path(archive_path).name]
PY

if $BUILD --version 1.2 --source "$fixture" --output "$tmp_dir/invalid" >/dev/null 2>&1; then
  printf 'test.sh: invalid semantic version was accepted\n' >&2
  exit 1
fi

printf 'distribution-builder tests passed\n'
