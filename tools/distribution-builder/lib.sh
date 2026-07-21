#!/usr/bin/env bash

set -euo pipefail

die() {
  printf 'distribution-builder: %s\n' "$*" >&2
  exit 1
}

info() {
  printf 'distribution-builder: %s\n' "$*"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

sha256_file() {
  local file=$1

  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
  else
    die 'neither sha256sum nor shasum is available'
  fi
}

sha256_stream() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 | awk '{print $1}'
  else
    die 'neither sha256sum nor shasum is available'
  fi
}

# The manifest is generated after this digest is computed. This avoids a
# circular checksum while still making the payload identity explicit.
payload_checksum() {
  local directory=$1

  tar \
    --sort=name \
    --mtime='UTC 1970-01-01' \
    --owner=0 \
    --group=0 \
    --numeric-owner \
    -cf - \
    -C "$directory" \
    . | sha256_stream
}

normalize_distribution_name() {
  local value=$1
  value=$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')
  [[ -n "$value" ]] || die 'source directory name cannot produce a distribution name'
  printf '%s' "$value"
}

write_manifest() {
  local template=$1
  local destination=$2
  local distribution=$3
  local version=$4
  local checksum=$5
  local artifact_name=$6

  python3 - "$template" "$destination" "$distribution" "$version" "$checksum" "$artifact_name" <<'PY'
import json
import re
import sys
from pathlib import Path

template_path, destination, distribution, version, checksum, artifact_name = sys.argv[1:]
template = {}
if template_path != "-":
    with Path(template_path).open(encoding="utf-8") as handle:
        template = json.load(handle)
    if not isinstance(template, dict):
        raise SystemExit("source manifest must contain a JSON object")

semver = re.compile(
    r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)"
    r"(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?"
    r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$"
)
checksum_pattern = re.compile(r"^[a-fA-F0-9]{64}$")

def component(name, default_version="unknown"):
    value = template.get(name, {"name": name, "version": default_version})
    if not isinstance(value, dict):
        raise SystemExit(f"manifest component {name!r} must be an object")
    return value

manifest = {
    "distribution": distribution,
    "version": version,
    "wordpress": component("wordpress"),
    "woocommerce": component("woocommerce"),
    "plugins": template.get("plugins", []),
    "checksum": {"algorithm": "sha256", "value": checksum},
}

for name in ("theme", "muPlugin", "config"):
    if name in template:
        manifest[name] = template[name]

artifact = template.get("artifact", {})
if not isinstance(artifact, dict):
    raise SystemExit("manifest artifact must be an object")
manifest["artifact"] = {"path": artifact_name}
if isinstance(artifact.get("repository"), str) and re.match(r"^[A-Za-z][A-Za-z0-9+.-]*:", artifact["repository"]):
    manifest["artifact"]["repository"] = artifact["repository"]

def validate_checksum(value, label):
    if not isinstance(value, dict) or set(value) != {"algorithm", "value"}:
        raise SystemExit(f"{label} must contain algorithm and value only")
    if value["algorithm"] != "sha256" or not isinstance(value["value"], str):
        raise SystemExit(f"{label} must be a sha256 checksum")
    if not checksum_pattern.fullmatch(value["value"]):
        raise SystemExit(f"{label} must be a 64-character hexadecimal value")

def validate_component(value, label):
    if not isinstance(value, dict) or not {"name", "version"}.issubset(value):
        raise SystemExit(f"{label} must contain name and version")
    if set(value) - {"name", "version", "checksum"}:
        raise SystemExit(f"{label} contains unsupported properties")
    if not isinstance(value["name"], str) or not value["name"]:
        raise SystemExit(f"{label}.name must be a non-empty string")
    if not isinstance(value["version"], str) or not value["version"]:
        raise SystemExit(f"{label}.version must be a non-empty string")
    if "checksum" in value:
        validate_checksum(value["checksum"], f"{label}.checksum")

if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", manifest["distribution"]):
    raise SystemExit("distribution must contain lowercase letters, digits, and hyphens")
if not semver.fullmatch(manifest["version"]):
    raise SystemExit("version must be semantic versioning")
validate_component(manifest["wordpress"], "wordpress")
validate_component(manifest["woocommerce"], "woocommerce")
if not isinstance(manifest["plugins"], list):
    raise SystemExit("plugins must be an array")
for index, plugin in enumerate(manifest["plugins"]):
    validate_component(plugin, f"plugins[{index}]")
if "theme" in manifest:
    validate_component(manifest["theme"], "theme")
if "muPlugin" in manifest:
    validate_component(manifest["muPlugin"], "muPlugin")
if "config" in manifest:
    config = manifest["config"]
    if not isinstance(config, dict) or set(config) - {"profile", "path"}:
        raise SystemExit("config contains unsupported properties")
    if "profile" in config and config["profile"] not in {"default", "performance", "security"}:
        raise SystemExit("config.profile is invalid")
    if "path" in config and (not isinstance(config["path"], str) or not config["path"]):
        raise SystemExit("config.path must be a non-empty string")
validate_checksum(manifest["checksum"], "checksum")

with Path(destination).open("w", encoding="utf-8") as handle:
    json.dump(manifest, handle, indent=2)
    handle.write("\n")
PY
}
