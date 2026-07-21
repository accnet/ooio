# Distribution Builder

`build.sh` packages a local distribution directory into a versioned `.tar.gz`
archive. It performs no network access and does not execute files from the
source directory.

```sh
tools/distribution-builder/build.sh \
  --version 1.2.3 \
  --source runtime/distribution \
  --output dist/
```

The output directory receives `<distribution>-<version>.tar.gz` and a matching
`<distribution>-<version>.tar.gz.sha256` sidecar. The distribution name is the
lowercase, hyphen-normalized source directory name. An explicit output path
ending in `.tar.gz` or `.tgz` is also accepted.

If the source root contains `manifest.json`, its valid component metadata is
used as the template. The builder always sets `distribution`, `version`,
`artifact.path`, and `checksum`. A source without a manifest receives valid
default WordPress and WooCommerce component entries.

The manifest checksum is the SHA-256 digest of the deterministic package
payload before `manifest.json` is added, which avoids a circular self-hash. The
sidecar checksum is the SHA-256 digest of the final archive.

Use `--dry-run` to validate arguments and print the planned outputs without
creating files. Run the dependency-free test harness with:

```sh
tools/distribution-builder/test.sh
```
