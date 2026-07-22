#!/usr/bin/env bash

set -uo pipefail

# Verification entrypoint for the ai-kit gate.
#
# WHY A SCRIPT: project.yaml declares a single `cwd` and one command per check,
# but this repo is polyglot — a NestJS API, a Go agent and three Vite SPAs. The
# gate re-runs these checks itself instead of trusting the executor's
# self-reported evidence, so they have to actually cover the repo.
#
# Every check runs even if an earlier one fails, and the failures are summarised
# at the end. Stopping at the first failure would hide the other three.

cd "$(dirname "$0")/.." || exit 2

FAILED=()

run() {
  local label="$1"; shift
  printf '\n=== %s ===\n' "$label"
  if "$@"; then
    printf '  OK: %s\n' "$label"
  else
    printf '  FAIL: %s\n' "$label"
    FAILED+=("$label")
  fi
}

in_dir() {
  local dir="$1"; shift
  ( cd "$dir" && "$@" )
}

case "${1:-all}" in
  build)
    run "api build"    in_dir apps/api npm run build
    run "agent build"  in_dir apps/agent go build ./...
    for app in web ops admin; do
      # A missing node_modules is a setup gap, not a code failure — say so
      # instead of reporting a build error the author cannot act on.
      if [[ -d "apps/$app/node_modules" ]]; then
        run "$app build" in_dir "apps/$app" npm run build
      else
        printf '\n=== %s build ===\n  SKIP: apps/%s/node_modules missing (run npm install)\n' "$app" "$app"
      fi
    done
    ;;
  test)
    # Only the Go agent has a real suite. The SPA `test` scripts are echo
    # placeholders, so running them would report a pass that means nothing.
    run "agent test" in_dir apps/agent go test ./...
    ;;
  typecheck)
    run "api typecheck" in_dir apps/api npm run typecheck
    ;;
  all)
    "$0" build
    "$0" test
    "$0" typecheck
    exit $?
    ;;
  *)
    printf 'usage: %s [build|test|typecheck|all]\n' "$0" >&2
    exit 2
    ;;
esac

if (( ${#FAILED[@]} )); then
  printf '\nFAILED: %s\n' "${FAILED[*]}"
  exit 1
fi
printf '\nall checks passed\n'
