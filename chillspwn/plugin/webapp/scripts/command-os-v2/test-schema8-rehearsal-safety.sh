#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPOSITORY_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
EVIDENCE_BASE="/root/chillspwn-schema8-rehearsal"
TEST_ID="safety-test-$(date -u +%Y%m%dT%H%M%SZ)-$$"
TEST_ROOT="$EVIDENCE_BASE/$TEST_ID"
LOG="$TEST_ROOT/results.tsv"

umask 077
mkdir -p "$TEST_ROOT"
: >"$LOG"

expect_refusal() {
  local label="$1" expected="$2"
  shift 2
  local output status=0
  output="$("$@" 2>&1)" || status=$?
  if [[ "$status" -eq 0 || "$output" != *"$expected"* ]]; then
    printf 'negative safety test failed: %s\nstatus=%s\noutput=%s\n' \
      "$label" "$status" "$output" >&2
    exit 1
  fi
  printf '%s\tpass\texit=%s\tmatched=%q\n' "$label" "$status" "$expected" >>"$LOG"
}

for script in \
  "$SCRIPT_DIR/rehearse-schema8-bridge.sh" \
  "$SCRIPT_DIR/schema8-startup-rehearsal.sh" \
  "$SCRIPT_DIR/schema8-validate-schema7-source.sh" \
  "$SCRIPT_DIR/test-schema8-rehearsal-safety.sh"; do
  bash -n "$script"
done
printf 'bash_syntax\tpass\n' >>"$LOG"

expect_refusal \
  "missing_confirmation" \
  "set SCHEMA8_REHEARSAL_CONFIRM=isolated-schema8-bridge-rehearsal" \
  env SCHEMA8_REHEARSAL_CONFIRM=wrong \
  bash "$SCRIPT_DIR/rehearse-schema8-bridge.sh"

expect_refusal \
  "forbidden_evidence_destination" \
  "evidence root must be exactly /root/chillspwn-schema8-rehearsal" \
  env \
    SCHEMA8_REHEARSAL_CONFIRM=isolated-schema8-bridge-rehearsal \
    SCHEMA8_EVIDENCE_ROOT=/var/lib/chillspwn \
  bash "$SCRIPT_DIR/rehearse-schema8-bridge.sh"

SYMLINK_TARGET="$(mktemp -d /tmp/chillspwn-schema7-to-9-safety.XXXXXXXXXX)"
SYMLINK_RUN_ID="20260715T000000Z-symlink-safety-$$"
SYMLINK_RUN="$EVIDENCE_BASE/$SYMLINK_RUN_ID"
ln -s -- "$SYMLINK_TARGET" "$SYMLINK_RUN"
expect_refusal \
  "symlinked_run_root" \
  "evidence run already exists" \
  env \
    SCHEMA8_REHEARSAL_CONFIRM=isolated-schema8-bridge-rehearsal \
    SCHEMA8_REHEARSAL_RUN_ID="$SYMLINK_RUN_ID" \
  bash "$SCRIPT_DIR/rehearse-schema8-bridge.sh"
rm -f -- "$SYMLINK_RUN"
rm -rf -- "$SYMLINK_TARGET"

expect_refusal \
  "live_plugin_as_startup_artifact" \
  "refusing plugin outside rehearsal root" \
  bash "$SCRIPT_DIR/schema8-startup-rehearsal.sh" \
    "$TEST_ROOT" \
    negative-live-plugin \
    /opt/chillspwn/plugin \
    "$TEST_ROOT/state" \
    "$TEST_ROOT/database.sqlite" \
    39991 \
    "$TEST_ROOT/evidence" \
    negative-canary

expect_refusal \
  "forbidden_state_destination" \
  "refusing writable path outside rehearsal root" \
  bash "$SCRIPT_DIR/schema8-startup-rehearsal.sh" \
    "$TEST_ROOT" \
    negative-state \
    "$TEST_ROOT/plugin" \
    /var/lib/chillspwn/schema8-negative \
    "$TEST_ROOT/database.sqlite" \
    39992 \
    "$TEST_ROOT/evidence" \
    negative-canary

expect_refusal \
  "unsupported_expected_schema" \
  "expected schema must be 8 or 9" \
  bash "$SCRIPT_DIR/schema8-startup-rehearsal.sh" \
    "$TEST_ROOT" \
    negative-schema \
    "$TEST_ROOT/plugin" \
    "$TEST_ROOT/state" \
    "$TEST_ROOT/database.sqlite" \
    39993 \
    "$TEST_ROOT/evidence" \
    negative-canary \
    10

expect_refusal \
  "non_schema7_candidate" \
  "source is not schema 7" \
  bash "$SCRIPT_DIR/schema8-validate-schema7-source.sh" \
    "$REPOSITORY_ROOT/chillspwn/plugin"

if grep -Eq '^[[:space:]]*systemctl[[:space:]]+(restart|start|stop|reload)' \
  "$SCRIPT_DIR/rehearse-schema8-bridge.sh" \
  "$SCRIPT_DIR/schema8-startup-rehearsal.sh" \
  || grep -Eq '^[[:space:]]*(rm|cp|mv|rsync|sqlite3|mkdir|touch|chmod|chown).*\/var/lib/chillspwn' \
  "$SCRIPT_DIR/rehearse-schema8-bridge.sh" \
  "$SCRIPT_DIR/schema8-startup-rehearsal.sh"; then
  echo "rehearsal contains a production service mutation or data path" >&2
  exit 1
fi
printf 'no_production_mutation_commands_or_data_paths\tpass\n' >>"$LOG"

printf 'safety test evidence: %s\n' "$LOG"
