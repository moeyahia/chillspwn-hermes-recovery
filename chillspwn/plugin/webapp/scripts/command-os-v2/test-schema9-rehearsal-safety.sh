#!/usr/bin/env bash

set -euo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly BUN_BIN="/root/.bun/bin/bun"
readonly REHEARSAL="$SCRIPT_DIR/rehearse-schema9-guided-boundary.sh"
readonly HELPER="$SCRIPT_DIR/schema9-guided-boundary-rehearsal.ts"
SAFETY_TARGET="$(mktemp -d /tmp/schema9-safety-target.XXXXXXXXXX)"
SAFETY_LINK="/tmp/chillspwn-schema9-rehearsal.Safety$$"

cleanup() {
  rm -f -- "$SAFETY_LINK"
  rm -rf -- "$SAFETY_TARGET"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

expect_refusal() {
  local label="$1" expected="$2"
  shift 2
  local output status=0
  output="$("$@" 2>&1)" || status=$?
  if [[ "$status" -eq 0 || "$output" != *"$expected"* ]]; then
    printf 'schema-9 safety test failed: %s\nstatus=%s\noutput=%s\n' \
      "$label" "$status" "$output" >&2
    exit 1
  fi
}

bash -n "$REHEARSAL" "$0"

expect_refusal \
  unexpected_path_argument \
  "this disposable rehearsal accepts no paths or arguments" \
  bash "$REHEARSAL" /var/lib/chillspwn/command-os-v2.sqlite

expect_refusal \
  helper_outside_disposable_root \
  "database must be the named fixture directly below a /tmp/chillspwn-schema9-rehearsal.* directory" \
  "$BUN_BIN" run "$HELPER" seed /tmp/not-a-schema9-rehearsal.sqlite

expect_refusal \
  helper_production_path \
  "database must be the named fixture directly below a /tmp/chillspwn-schema9-rehearsal.* directory" \
  "$BUN_BIN" run "$HELPER" verify /var/lib/chillspwn/command-os-v2.sqlite

ln -s -- "$SAFETY_TARGET" "$SAFETY_LINK"
expect_refusal \
  helper_symlinked_rehearsal_root \
  "rehearsal root must be a real non-symlink /tmp directory" \
  "$BUN_BIN" run "$HELPER" seed "$SAFETY_LINK/schema8-to-schema9.sqlite"

[[ -z "$(find "$SAFETY_TARGET" -mindepth 1 -print -quit)" ]] || {
  echo "schema-9 safety test wrote through the symlinked rehearsal root" >&2
  exit 1
}

printf 'schema-9 rehearsal safety checks passed (4 fail-closed cases; no database created)\n'
