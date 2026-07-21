#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

usage() {
  cat <<'USAGE'
Usage: build.sh --version VERSION --source DIRECTORY --output PATH [--dry-run]

Package DIRECTORY as a gzip-compressed tarball. PATH is an output directory,
or an explicit .tar.gz/.tgz archive path. A manifest.json and SHA-256 sidecar
are generated alongside the archive.
USAGE
}

version=''
source_dir=''
output=''
dry_run=false

while (($# > 0)); do
  case "$1" in
    --version)
      (($# >= 2)) || die '--version requires a value'
      version=$2
      shift 2
      ;;
    --source)
      (($# >= 2)) || die '--source requires a directory'
      source_dir=$2
      shift 2
      ;;
    --output)
      (($# >= 2)) || die '--output requires a path'
      output=$2
      shift 2
      ;;
    --dry-run)
      dry_run=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
done

[[ -n "$version" ]] || die '--version is required'
[[ "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$ ]] || die "invalid semantic version: $version"
[[ -n "$source_dir" ]] || die '--source is required'
[[ -n "$output" ]] || die '--output is required'
[[ -d "$source_dir" ]] || die "source directory does not exist: $source_dir"

require_command tar
require_command python3

source_dir=$(cd -- "$source_dir" && pwd -P)
distribution=$(normalize_distribution_name "$(basename -- "$source_dir")")

if [[ "$output" == *.tar.gz || "$output" == *.tgz ]]; then
  archive=$output
else
  archive="$output/${distribution}-${version}.tar.gz"
fi

if $dry_run; then
  info "would package source: $source_dir"
  info "would write archive: $archive"
  info "would write checksum: $archive.sha256"
  exit 0
fi

[[ ! -e "$archive" ]] || die "output archive already exists: $archive"
mkdir -p -- "$(dirname -- "$archive")"
archive=$(cd -- "$(dirname -- "$archive")" && pwd -P)/$(basename -- "$archive")

tmp_dir=$(mktemp -d "${TMPDIR:-/tmp}/distribution-builder.XXXXXX")
trap 'rm -rf "$tmp_dir"' EXIT
stage="$tmp_dir/bundle"
mkdir -p -- "$stage"
cp -a -- "$source_dir"/. "$stage"/
rm -f -- "$stage/manifest.json"

payload_hash=$(payload_checksum "$stage")
template='-'
if [[ -f "$source_dir/manifest.json" ]]; then
  template=$source_dir/manifest.json
fi
write_manifest "$template" "$stage/manifest.json" "$distribution" "$version" "$payload_hash" "$(basename -- "$archive")"

tar \
  --sort=name \
  --mtime='UTC 1970-01-01' \
  --owner=0 \
  --group=0 \
  --numeric-owner \
  -cf - \
  -C "$stage" \
  . | gzip -n > "$archive"

archive_hash=$(sha256_file "$archive")
checksum_path="$archive.sha256"
printf '%s  %s\n' "$archive_hash" "$(basename -- "$archive")" > "$checksum_path"

info "created archive: $archive"
info "created checksum: $checksum_path"
info "payload checksum in manifest: $payload_hash"
