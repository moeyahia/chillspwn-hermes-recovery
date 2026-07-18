#!/usr/bin/env bash

set -euo pipefail

readonly REQUIRED_CONFIRMATION="isolated-schema8-bridge-rehearsal"
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly REPOSITORY_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
readonly CANDIDATE_PLUGIN_SOURCE="$REPOSITORY_ROOT/chillspwn/plugin"
readonly CANDIDATE_WEBAPP_SOURCE="$CANDIDATE_PLUGIN_SOURCE/webapp"
readonly LIVE_PLUGIN_LINK="${SCHEMA8_LIVE_PLUGIN_LINK:-/opt/chillspwn/plugin}"
readonly EVIDENCE_BASE_INPUT="${SCHEMA8_EVIDENCE_ROOT:-/root/chillspwn-schema8-rehearsal}"
readonly RUN_ID="${SCHEMA8_REHEARSAL_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
readonly EXPECTED_LIVE_TARGET="${SCHEMA8_EXPECTED_LIVE_TARGET:-}"
readonly EXPECTED_LIVE_TREE_SHA256="${SCHEMA8_EXPECTED_LIVE_TREE_SHA256:-}"
readonly BUN_BIN="/root/.bun/bin/bun"
readonly STARTUP_HARNESS="$SCRIPT_DIR/schema8-startup-rehearsal.sh"
readonly CANARY_HELPER="$SCRIPT_DIR/schema8-canary.ts"
readonly SCHEMA7_SOURCE_VALIDATOR="$SCRIPT_DIR/schema8-validate-schema7-source.sh"

fail() {
  echo "schema-7-to-9 rehearsal refused: $*" >&2
  exit 1
}

[[ "${SCHEMA8_REHEARSAL_CONFIRM:-}" == "$REQUIRED_CONFIRMATION" ]] || fail \
  "set SCHEMA8_REHEARSAL_CONFIRM=$REQUIRED_CONFIRMATION"
[[ "$RUN_ID" =~ ^[0-9]{8}T[0-9]{6}Z(-[A-Za-z0-9._-]+)?$ ]] || fail \
  "SCHEMA8_REHEARSAL_RUN_ID has an unsafe format"

umask 077
readonly EVIDENCE_BASE="$(realpath -m -- "$EVIDENCE_BASE_INPUT")"
[[ "$EVIDENCE_BASE" == "/root/chillspwn-schema8-rehearsal" ]] || fail \
  "evidence root must be exactly /root/chillspwn-schema8-rehearsal"
mkdir -p -- "$EVIDENCE_BASE"
chmod 0700 -- "$EVIDENCE_BASE"

exec 9>"$EVIDENCE_BASE/.rehearsal.lock"
flock -n 9 || fail "another schema-8 rehearsal is already running"

readonly RUN_ROOT="$EVIDENCE_BASE/$RUN_ID"
[[ ! -e "$RUN_ROOT" && ! -L "$RUN_ROOT" ]] || fail "evidence run already exists: $RUN_ROOT"
mkdir -p \
  "$RUN_ROOT/artifacts" \
  "$RUN_ROOT/candidate" \
  "$RUN_ROOT/evidence" \
  "$RUN_ROOT/state" \
  "$RUN_ROOT/tmp" \
  "$RUN_ROOT/validation"
[[ -d "$RUN_ROOT" && ! -L "$RUN_ROOT" && "$(realpath -- "$RUN_ROOT")" == "$RUN_ROOT" ]] || fail \
  "evidence run root is not a real direct child of the protected evidence root"
export TMPDIR="$RUN_ROOT/tmp"

FINALIZED=0
on_exit() {
  local status=$?
  if [[ "$FINALIZED" -ne 1 ]]; then
    {
      printf 'status\tfailed\n'
      printf 'exit_code\t%s\n' "$status"
      printf 'finished_at\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    } >"$RUN_ROOT/FAILED.tsv" 2>/dev/null || true
  fi
  exit "$status"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

for command in \
  "$BUN_BIN" \
  realpath rsync sqlite3 jq curl ss tar gzip sha256sum git sed diff find \
  flock setsid stat sort awk cmp cp chmod readlink xargs mv basename grep ps seq tr rm systemctl; do
  if [[ "$command" == /* ]]; then
    [[ -x "$command" ]] || fail "required executable is unavailable: $command"
  else
    command -v "$command" >/dev/null || fail "required command is unavailable: $command"
  fi
done
for required in "$STARTUP_HARNESS" "$CANARY_HELPER" "$SCHEMA7_SOURCE_VALIDATOR" \
  "$CANDIDATE_WEBAPP_SOURCE/server/db/migrations/008_follow_up_context.ts" \
  "$CANDIDATE_WEBAPP_SOURCE/server/db/migrations/009_guided_decision_boundary.ts" \
  "$CANDIDATE_WEBAPP_SOURCE/server/db/migrations/index.ts"; do
  [[ -f "$required" ]] || fail "required candidate input is missing: $required"
done

is_forbidden_runtime_secret_name() {
  local base
  base="$(basename -- "$1")"
  case "$base" in
    .env|.env.local|.env.production|.env.development|auth.json|credentials.json|credentials.db|\
    .netrc|.npmrc|id_rsa|id_dsa|id_ecdsa|id_ed25519|*.pem|*.p12|*.pfx)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

assert_no_runtime_secret_files() {
  local root="$1" entry
  while IFS= read -r -d '' entry; do
    if is_forbidden_runtime_secret_name "$entry"; then
      echo "unsafe runtime credential filename found: ${entry#"$root"/}" >&2
      return 1
    fi
  done < <(find -P "$root" -xdev -mindepth 1 -print0)
}

tree_manifest() {
  local root="$1" destination="$2"
  local metadata_tmp="$destination.metadata.tmp"
  local content_tmp="$destination.content.tmp"
  [[ -d "$root" && ! -L "$root" ]] || fail "manifest root is not a real directory: $root"
  (
    cd "$root"
    while IFS= read -r -d '' entry; do
      local_path="${entry#./}"
      if [[ "$local_path" == *$'\n'* || "$local_path" == *$'\t'* ]]; then
        echo "unsupported newline/tab in source path: $local_path" >&2
        exit 1
      fi
      if [[ -L "$entry" ]]; then
        target="$(readlink -- "$entry")"
        if [[ "$target" == *$'\n'* || "$target" == *$'\t'* ]]; then
          echo "unsupported newline/tab in symlink target: $local_path" >&2
          exit 1
        fi
      elif [[ ! -f "$entry" && ! -d "$entry" ]]; then
        echo "unsupported filesystem object in source tree: $local_path" >&2
        exit 1
      fi
    done < <(find -P . -xdev -print0)
    find -P . -xdev -printf 'M\t%y\t%m:%U:%G\t%s\t%p\t%l\0' \
      | LC_ALL=C sort -z \
      | tr '\0' '\n' \
      | awk -F '\t' 'BEGIN { OFS = "\t" } { if ($2 == "d") $4 = "-"; print }'
  ) >"$metadata_tmp"
  (
    cd "$root"
    find -P . -xdev -type f -print0 \
      | LC_ALL=C sort -z \
      | xargs -0 -r sha256sum --zero -- \
      | while IFS= read -r -d '' checksum_record; do
          digest="${checksum_record%% *}"
          local_path="${checksum_record#*  }"
          [[ "$digest" =~ ^[a-f0-9]{64}$ ]] || {
            echo "invalid SHA-256 record for $local_path" >&2
            exit 1
          }
          printf 'C\t%s\t%s\n' "$digest" "$local_path"
        done
  ) >"$content_tmp"
  LC_ALL=C sort "$metadata_tmp" "$content_tmp" >"$destination"
  rm -f -- "$metadata_tmp" "$content_tmp"
}

manifest_sha() {
  sha256sum -- "$1" | awk '{print $1}'
}

run_build_suite() {
  local plugin_root="$1" label="$2"
  local webapp="$plugin_root/webapp"
  local build_state="$RUN_ROOT/state/build-$label"
  local log="$RUN_ROOT/evidence/$label.build.log"
  [[ -f "$webapp/package.json" && -d "$webapp/node_modules" ]] || fail \
    "$label build input is incomplete"
  mkdir -p "$build_state/home" "$build_state/tmp"
  : >"$log"
  for task in typecheck typecheck:client typecheck:e2e build; do
    printf '== %s ==\n' "$task" >>"$log"
    (
      cd "$webapp"
      env -i \
        PATH="/root/.bun/bin:/usr/local/bin:/usr/bin:/bin" \
        HOME="$build_state/home" \
        TMPDIR="$build_state/tmp" \
        LANG="C.UTF-8" \
        LC_ALL="C.UTF-8" \
        TZ="Etc/UTC" \
        NODE_ENV="test" \
        CI="true" \
        "$BUN_BIN" run "$task"
    ) >>"$log" 2>&1 || {
      tail -n 120 "$log" >&2
      fail "$label failed $task"
    }
  done
  printf '%s\ttypecheck=pass\tclient_typecheck=pass\te2e_typecheck=pass\tbuild=pass\n' \
    "$label" >"$RUN_ROOT/evidence/$label.build.result.tsv"
}

credential_free_db_cli() {
  local plugin_root="$1" database="$2" backup_dir="$3" output="$4" label="$5"
  local cli_state="$RUN_ROOT/state/cli-$label"
  mkdir -p "$cli_state/home" "$cli_state/tmp" "$backup_dir"
  (
    cd "$plugin_root/webapp"
    env -i \
      PATH="/root/.bun/bin:/usr/local/bin:/usr/bin:/bin" \
      HOME="$cli_state/home" \
      TMPDIR="$cli_state/tmp" \
      LANG="C.UTF-8" \
      LC_ALL="C.UTF-8" \
      TZ="Etc/UTC" \
      NODE_ENV="test" \
      OPENROUTER_API_KEY="" \
      GEMINI_API_KEY="" \
      XAI_API_KEY="" \
      ANTHROPIC_API_KEY="" \
      "$BUN_BIN" run server/db/cli.ts migrate --db "$database" --backup-dir "$backup_dir"
  ) >"$output" 2>"$RUN_ROOT/evidence/$label.db-cli.stderr.log"
}

assert_bridge_rejects_schema9() {
  local database="$1" label="$2"
  local before_dump="$RUN_ROOT/evidence/$label.before.sql"
  local after_dump="$RUN_ROOT/evidence/$label.after.sql"
  local output="$RUN_ROOT/evidence/$label.json"
  local stderr="$RUN_ROOT/evidence/$label.db-cli.stderr.log"

  sqlite3 "$database" .dump >"$before_dump"
  if credential_free_db_cli \
    "$BRIDGE_PLUGIN" \
    "$database" \
    "$RUN_ROOT/state/$label-backups" \
    "$output" \
    "$label"; then
    fail "schema-8 bridge accepted a schema-9 database"
  fi
  grep -Fq "Database contains unknown migration version 9" "$stderr" || {
    tail -n 40 "$stderr" >&2
    fail "schema-8 bridge did not fail for the expected unknown schema-9 boundary"
  }
  sqlite3 "$database" .dump >"$after_dump"
  cmp -s "$before_dump" "$after_dump" || fail \
    "schema-8 bridge changed the schema-9 database while failing closed"
}

verify_database() {
  local database="$1" label="$2" expected_version="$3" expected_migration_count="$4"
  local quick foreign max_version migration_count canary_count
  quick="$(sqlite3 "$database" 'PRAGMA quick_check')"
  foreign="$(sqlite3 "$database" 'PRAGMA foreign_key_check')"
  max_version="$(sqlite3 "$database" 'SELECT COALESCE(MAX(version), 0) FROM schema_migrations')"
  migration_count="$(sqlite3 "$database" 'SELECT COUNT(*) FROM schema_migrations')"
  canary_count="$(sqlite3 "$database" \
    "SELECT COUNT(*) FROM missions WHERE id = '$CANARY_ID' AND name = 'Schema 8 rehearsal canary' AND journey = 'guided' AND created_by = 'schema8-rehearsal';")"
  [[ "$quick" == "ok" ]] || fail "$label quick_check failed: $quick"
  [[ -z "$foreign" ]] || fail "$label foreign_key_check failed: $foreign"
  [[ "$max_version" == "$expected_version" ]] || fail \
    "$label migration max is $max_version, expected $expected_version"
  [[ "$migration_count" == "$expected_migration_count" ]] || fail \
    "$label migration count is $migration_count, expected $expected_migration_count"
  [[ "$canary_count" == "1" ]] || fail "$label canary is missing or changed"
  {
    printf 'label\tquick_check\tforeign_key_rows\tmigration_max\tmigration_count\tcanary_count\n'
    printf '%s\tok\t0\t%s\t%s\t1\n' "$label" "$max_version" "$migration_count"
  } >"$RUN_ROOT/evidence/$label.database.tsv"
}

allocate_port() {
  local output_variable="$1" candidate attempts=0
  while (( attempts < 2000 )); do
    candidate=$(( 35000 + (RANDOM * 32768 + RANDOM) % 24000 ))
    attempts=$(( attempts + 1 ))
    [[ "$candidate" != "3131" && "$candidate" != "3132" ]] || continue
    [[ -z "${ALLOCATED_PORTS[$candidate]:-}" ]] || continue
    if ! ss -ltnH "sport = :$candidate" | grep -q .; then
      ALLOCATED_PORTS[$candidate]=1
      printf -v "$output_variable" '%s' "$candidate"
      return 0
    fi
  done
  fail "could not allocate an isolated loopback port"
}

run_startup() {
  local label="$1" plugin_root="$2" database="$3" port="$4" expected_schema="${5:-8}"
  local state_root="$RUN_ROOT/state/startup-$label"
  bash "$STARTUP_HARNESS" \
    "$RUN_ROOT" \
    "$label" \
    "$plugin_root" \
    "$state_root" \
    "$database" \
    "$port" \
    "$RUN_ROOT/evidence" \
    "$CANARY_ID" \
    "$expected_schema"
}

[[ "$LIVE_PLUGIN_LINK" == "/opt/chillspwn/plugin" ]] || fail \
  "live source link must be /opt/chillspwn/plugin"
[[ -L "$LIVE_PLUGIN_LINK" ]] || fail "live source must be the release symlink: $LIVE_PLUGIN_LINK"
readonly LIVE_LINK_TEXT_BEFORE="$(readlink -- "$LIVE_PLUGIN_LINK")"
readonly LIVE_TARGET="$(readlink -f -- "$LIVE_PLUGIN_LINK")"
[[ "$LIVE_TARGET" == /opt/chillspwn/releases/*/plugin ]] || fail \
  "live source does not resolve to an immutable release plugin: $LIVE_TARGET"
[[ -d "$LIVE_TARGET" && ! -L "$LIVE_TARGET" ]] || fail "live source target is not a real directory"
systemctl show chillspwn.service \
  --property=ActiveState,SubState,MainPID,NRestarts \
  >"$RUN_ROOT/evidence/live-service.before.tsv" || fail \
  "could not capture the live service identity read-only"
if [[ -n "$EXPECTED_LIVE_TARGET" ]]; then
  [[ "$(realpath -m -- "$EXPECTED_LIVE_TARGET")" == "$LIVE_TARGET" ]] || fail \
    "live source target differs from SCHEMA8_EXPECTED_LIVE_TARGET"
fi

readonly LIVE_WEBAPP="$LIVE_TARGET/webapp"
readonly LIVE_MIGRATIONS="$LIVE_WEBAPP/server/db/migrations"
[[ -f "$LIVE_MIGRATIONS/007_audit_journey.ts" ]] || fail "live source is not the expected schema-7 application"
bash "$SCHEMA7_SOURCE_VALIDATOR" "$LIVE_TARGET" \
  >"$RUN_ROOT/evidence/live-schema7-validation.tsv"

assert_no_runtime_secret_files "$LIVE_TARGET" || fail "live release contains a forbidden runtime secret file"
assert_no_runtime_secret_files "$CANDIDATE_PLUGIN_SOURCE" || fail "candidate contains a forbidden runtime secret file"

tree_manifest "$LIVE_TARGET" "$RUN_ROOT/evidence/live-source.before.manifest.tsv"
readonly LIVE_TREE_SHA="$(manifest_sha "$RUN_ROOT/evidence/live-source.before.manifest.tsv")"
if [[ -n "$EXPECTED_LIVE_TREE_SHA256" ]]; then
  [[ "$EXPECTED_LIVE_TREE_SHA256" == "$LIVE_TREE_SHA" ]] || fail \
    "live tree identity differs from SCHEMA8_EXPECTED_LIVE_TREE_SHA256"
fi

git -C "$REPOSITORY_ROOT" rev-parse HEAD >"$RUN_ROOT/evidence/candidate.git-head.txt"
git -C "$REPOSITORY_ROOT" branch --show-current >"$RUN_ROOT/evidence/candidate.git-branch.txt"
git -C "$REPOSITORY_ROOT" status --porcelain=v1 --untracked-files=all >"$RUN_ROOT/evidence/candidate.git-status.txt"

tree_manifest "$CANDIDATE_PLUGIN_SOURCE" "$RUN_ROOT/evidence/candidate-source.before.manifest.tsv"
readonly ARTIFACT_NAME="chillspwn-schema8-bridge-$RUN_ID"
readonly ARTIFACT_ROOT="$RUN_ROOT/artifacts/$ARTIFACT_NAME"
readonly BRIDGE_PLUGIN="$ARTIFACT_ROOT/plugin"
readonly CANDIDATE_PLUGIN="$RUN_ROOT/candidate/plugin"
mkdir -p "$BRIDGE_PLUGIN" "$CANDIDATE_PLUGIN"

rsync -aHAX --numeric-ids --delete -- "$LIVE_TARGET/" "$BRIDGE_PLUGIN/"
tree_manifest "$BRIDGE_PLUGIN" "$RUN_ROOT/evidence/bridge.exact-live-copy.manifest.tsv"
cmp -s \
  "$RUN_ROOT/evidence/live-source.before.manifest.tsv" \
  "$RUN_ROOT/evidence/bridge.exact-live-copy.manifest.tsv" || fail \
  "isolated bridge base is not an exact live-source copy"

rsync -aHAX --numeric-ids --delete -- "$CANDIDATE_PLUGIN_SOURCE/" "$CANDIDATE_PLUGIN/"
tree_manifest "$CANDIDATE_PLUGIN_SOURCE" "$RUN_ROOT/evidence/candidate-source.after.manifest.tsv"
cmp -s \
  "$RUN_ROOT/evidence/candidate-source.before.manifest.tsv" \
  "$RUN_ROOT/evidence/candidate-source.after.manifest.tsv" || fail \
  "candidate worktree changed while it was being snapshotted; rerun from a stable worktree"
tree_manifest "$CANDIDATE_PLUGIN" "$RUN_ROOT/evidence/candidate.snapshot-source.manifest.tsv"
cmp -s \
  "$RUN_ROOT/evidence/candidate-source.before.manifest.tsv" \
  "$RUN_ROOT/evidence/candidate.snapshot-source.manifest.tsv" || fail \
  "candidate snapshot differs from the guarded worktree"

readonly LIVE_INDEX="$LIVE_MIGRATIONS/index.ts"
readonly CANDIDATE_INDEX="$CANDIDATE_PLUGIN/webapp/server/db/migrations/index.ts"
readonly CANDIDATE_MIGRATION_008="$CANDIDATE_PLUGIN/webapp/server/db/migrations/008_follow_up_context.ts"
readonly CANDIDATE_MIGRATION_009="$CANDIDATE_PLUGIN/webapp/server/db/migrations/009_guided_decision_boundary.ts"
readonly EXPECTED_BRIDGE_INDEX="$RUN_ROOT/tmp/expected-bridge-index.ts"
readonly EXPECTED_CANDIDATE_INDEX="$RUN_ROOT/tmp/expected-candidate-index.ts"

sed \
  -e '/^import { auditJourneyMigration } from "\.\/007_audit_journey";$/a import { followUpContextMigration } from "./008_follow_up_context";' \
  -e '/^  auditJourneyMigration,$/a\  followUpContextMigration,' \
  "$LIVE_INDEX" >"$EXPECTED_BRIDGE_INDEX"
sed \
  -e '/^import { followUpContextMigration } from "\.\/008_follow_up_context";$/a import { guidedDecisionBoundaryMigration } from "./009_guided_decision_boundary";' \
  -e '/^  followUpContextMigration,$/a\  guidedDecisionBoundaryMigration,' \
  "$EXPECTED_BRIDGE_INDEX" >"$EXPECTED_CANDIDATE_INDEX"
cmp -s "$EXPECTED_CANDIDATE_INDEX" "$CANDIDATE_INDEX" || fail \
  "candidate migration index is not the exact schema-7 index plus migrations 8 and 9"

cp -a -- "$EXPECTED_BRIDGE_INDEX" "$BRIDGE_PLUGIN/webapp/server/db/migrations/index.ts"
cp -a -- "$CANDIDATE_MIGRATION_008" "$BRIDGE_PLUGIN/webapp/server/db/migrations/008_follow_up_context.ts"
diff -u -- "$LIVE_INDEX" "$BRIDGE_PLUGIN/webapp/server/db/migrations/index.ts" \
  >"$RUN_ROOT/evidence/approved-migration-index.diff" || [[ $? -eq 1 ]]

rsync -aHAXnc --delete --itemize-changes --omit-dir-times -- \
  "$LIVE_TARGET/" "$BRIDGE_PLUGIN/" >"$RUN_ROOT/evidence/bridge-vs-live.rsync-itemized.txt"
while IFS= read -r line; do
  [[ -n "$line" ]] || continue
  [[ "${#line}" -ge 13 ]] || fail "malformed rsync itemization record"
  printf '%s\n' "${line:12}"
done <"$RUN_ROOT/evidence/bridge-vs-live.rsync-itemized.txt" \
  | LC_ALL=C sort >"$RUN_ROOT/evidence/bridge-vs-live.changed-paths.txt"
cat >"$RUN_ROOT/tmp/approved-bridge-paths.txt" <<'EOF'
webapp/server/db/migrations/008_follow_up_context.ts
webapp/server/db/migrations/index.ts
EOF
cmp -s \
  "$RUN_ROOT/tmp/approved-bridge-paths.txt" \
  "$RUN_ROOT/evidence/bridge-vs-live.changed-paths.txt" || {
  cat "$RUN_ROOT/evidence/bridge-vs-live.rsync-itemized.txt" >&2
  fail "bridge differs from live outside the two approved migration paths"
}
cmp -s \
  "$CANDIDATE_MIGRATION_008" \
  "$BRIDGE_PLUGIN/webapp/server/db/migrations/008_follow_up_context.ts" || fail \
  "bridge migration 008 is not the current candidate migration"

mkdir -p "$RUN_ROOT/validation/bridge"
rsync -aHAX --numeric-ids --delete -- "$BRIDGE_PLUGIN/" "$RUN_ROOT/validation/bridge/plugin/"
run_build_suite "$RUN_ROOT/validation/bridge/plugin" "bridge"
run_build_suite "$CANDIDATE_PLUGIN" "candidate"
tree_manifest "$CANDIDATE_PLUGIN" "$RUN_ROOT/evidence/candidate.built.manifest.tsv"

readonly ARCHIVE="$RUN_ROOT/artifacts/$ARTIFACT_NAME.tar.gz"
tar \
  --sort=name \
  --mtime='UTC 1970-01-01' \
  --owner=0 \
  --group=0 \
  --numeric-owner \
  -C "$RUN_ROOT/artifacts" \
  -czf "$RUN_ROOT/tmp/$ARTIFACT_NAME.tar.gz" \
  "$ARTIFACT_NAME"
mv -- "$RUN_ROOT/tmp/$ARTIFACT_NAME.tar.gz" "$ARCHIVE"
readonly ARCHIVE_SHA="$(sha256sum "$ARCHIVE" | awk '{print $1}')"
printf '%s  %s\n' "$ARCHIVE_SHA" "$(basename -- "$ARCHIVE")" \
  >"$ARCHIVE.sha256"
chmod 0444 "$ARCHIVE" "$ARCHIVE.sha256"

readonly CANARY_ID="mission-schema8-canary-$RUN_ID"
readonly SCHEMA7_DB="$RUN_ROOT/state/schema7.sqlite"
readonly SCHEMA7_PRE_BRIDGE_DB="$RUN_ROOT/state/schema7-before-bridge.sqlite"
readonly BRIDGE_DB="$RUN_ROOT/state/bridge-idempotency.sqlite"
readonly ROUNDTRIP_DB="$RUN_ROOT/state/schema8-to-schema9.sqlite"
readonly ROLLBACK_DB="$RUN_ROOT/state/schema8-rollback-restored.sqlite"
readonly ARCHIVE_BRIDGE_DB="$RUN_ROOT/state/schema8-archive-startup.sqlite"
readonly PRESERVED_SCHEMA9_DB="$RUN_ROOT/state/schema9-preserved-before-rollback.sqlite"

credential_free_db_cli \
  "$LIVE_TARGET" \
  "$SCHEMA7_DB" \
  "$RUN_ROOT/state/schema7-backups" \
  "$RUN_ROOT/evidence/schema7-create.json" \
  "schema7-create"
jq -e \
  '(.applied.applied | length) == 7
   and .applied.currentVersion == 7
   and .health.healthy == true
   and .health.currentMigration == 7' \
  "$RUN_ROOT/evidence/schema7-create.json" >/dev/null
mkdir -p "$RUN_ROOT/state/canary-home"
env -i \
  PATH="/root/.bun/bin:/usr/local/bin:/usr/bin:/bin" \
  HOME="$RUN_ROOT/state/canary-home" \
  TMPDIR="$RUN_ROOT/tmp" \
  LANG="C.UTF-8" \
  LC_ALL="C.UTF-8" \
  TZ="Etc/UTC" \
  "$BUN_BIN" run "$CANARY_HELPER" "$LIVE_WEBAPP" "$SCHEMA7_DB" "$CANARY_ID" \
  >"$RUN_ROOT/evidence/schema7-canary.json"
verify_database "$SCHEMA7_DB" "schema7-canary" 7 7
sqlite3 "$SCHEMA7_DB" "PRAGMA wal_checkpoint(TRUNCATE)" >/dev/null
sqlite3 "$SCHEMA7_DB" ".backup '$SCHEMA7_PRE_BRIDGE_DB'"
sqlite3 "$SCHEMA7_PRE_BRIDGE_DB" ".backup '$BRIDGE_DB'"
verify_database "$SCHEMA7_PRE_BRIDGE_DB" "schema7-pre-bridge-image" 7 7

credential_free_db_cli \
  "$BRIDGE_PLUGIN" \
  "$BRIDGE_DB" \
  "$RUN_ROOT/state/bridge-backups" \
  "$RUN_ROOT/evidence/bridge-migrate-first.json" \
  "bridge-migrate-first"
jq -e \
  '(.applied.applied | length) == 1
   and .applied.currentVersion == 8
   and .applied.applied[0].version == 8
   and .applied.applied[0].name == "follow_up_run_context_selections"
   and .health.healthy == true
   and .health.currentMigration == 8
   and (.backup.destination | type) == "string"' \
  "$RUN_ROOT/evidence/bridge-migrate-first.json" >/dev/null
readonly FIRST_BACKUP="$(jq -r '.backup.destination' "$RUN_ROOT/evidence/bridge-migrate-first.json")"
[[ "$FIRST_BACKUP" == "$RUN_ROOT"/* && -f "$FIRST_BACKUP" ]] || fail \
  "first bridge backup escaped the rehearsal or is missing"
[[ "$(sha256sum "$FIRST_BACKUP" | awk '{print $1}')" == \
   "$(sha256sum "$SCHEMA7_PRE_BRIDGE_DB" | awk '{print $1}')" ]] || fail \
  "first bridge backup is not the exact schema-7 image"
verify_database "$BRIDGE_DB" "bridge-after-first-migration" 8 8

credential_free_db_cli \
  "$BRIDGE_PLUGIN" \
  "$BRIDGE_DB" \
  "$RUN_ROOT/state/bridge-restart-backups" \
  "$RUN_ROOT/evidence/bridge-migrate-idempotent.json" \
  "bridge-migrate-idempotent"
jq -e \
  '(.applied.applied | length) == 0
   and .applied.currentVersion == 8
   and .health.healthy == true
   and .health.currentMigration == 8' \
  "$RUN_ROOT/evidence/bridge-migrate-idempotent.json" >/dev/null
verify_database "$BRIDGE_DB" "bridge-after-idempotent-migration" 8 8

declare -A ALLOCATED_PORTS=()
PORT_BRIDGE_FIRST=""
PORT_BRIDGE_RESTART=""
PORT_CANDIDATE_FIRST=""
PORT_CANDIDATE_RESTART=""
PORT_BRIDGE_ROLLBACK=""
PORT_CANDIDATE_FINAL=""
PORT_ARCHIVE_EXTRACT=""
allocate_port PORT_BRIDGE_FIRST
allocate_port PORT_BRIDGE_RESTART
allocate_port PORT_CANDIDATE_FIRST
allocate_port PORT_CANDIDATE_RESTART
allocate_port PORT_BRIDGE_ROLLBACK
allocate_port PORT_CANDIDATE_FINAL
allocate_port PORT_ARCHIVE_EXTRACT
readonly PORT_BRIDGE_FIRST PORT_BRIDGE_RESTART PORT_CANDIDATE_FIRST \
  PORT_CANDIDATE_RESTART PORT_BRIDGE_ROLLBACK PORT_CANDIDATE_FINAL PORT_ARCHIVE_EXTRACT

run_startup "bridge-first-start" "$BRIDGE_PLUGIN" "$BRIDGE_DB" "$PORT_BRIDGE_FIRST"
run_startup "bridge-idempotent-restart" "$BRIDGE_PLUGIN" "$BRIDGE_DB" "$PORT_BRIDGE_RESTART"

sqlite3 "$BRIDGE_DB" "PRAGMA wal_checkpoint(TRUNCATE)" >/dev/null
sqlite3 "$BRIDGE_DB" ".backup '$ROUNDTRIP_DB'"
verify_database "$ROUNDTRIP_DB" "schema8-before-candidate" 8 8

credential_free_db_cli \
  "$CANDIDATE_PLUGIN" \
  "$ROUNDTRIP_DB" \
  "$RUN_ROOT/state/candidate-schema9-backups" \
  "$RUN_ROOT/evidence/candidate-migrate-schema9.json" \
  "candidate-migrate-schema9"
jq -e \
  '(.applied.applied | length) == 1
   and .applied.currentVersion == 9
   and .applied.applied[0].version == 9
   and .applied.applied[0].name == "guided_decision_single_pending_boundary"
   and .health.healthy == true
   and .health.currentMigration == 9
   and (.backup.destination | type) == "string"' \
  "$RUN_ROOT/evidence/candidate-migrate-schema9.json" >/dev/null
readonly SCHEMA8_PRE_CANDIDATE_BACKUP="$(jq -r '.backup.destination' \
  "$RUN_ROOT/evidence/candidate-migrate-schema9.json")"
[[ "$SCHEMA8_PRE_CANDIDATE_BACKUP" == "$RUN_ROOT"/* \
   && -f "$SCHEMA8_PRE_CANDIDATE_BACKUP" \
   && ! -L "$SCHEMA8_PRE_CANDIDATE_BACKUP" ]] || fail \
  "schema-8 pre-candidate backup escaped the rehearsal or is missing"
[[ "$(stat -c '%a' "$SCHEMA8_PRE_CANDIDATE_BACKUP")" == "600" ]] || fail \
  "schema-8 pre-candidate backup is not mode 0600"
verify_database "$SCHEMA8_PRE_CANDIDATE_BACKUP" "schema8-pre-candidate-backup" 8 8
verify_database "$ROUNDTRIP_DB" "candidate-after-schema9-migration" 9 9

credential_free_db_cli \
  "$CANDIDATE_PLUGIN" \
  "$ROUNDTRIP_DB" \
  "$RUN_ROOT/state/candidate-schema9-restart-backups" \
  "$RUN_ROOT/evidence/candidate-migrate-schema9-idempotent.json" \
  "candidate-migrate-schema9-idempotent"
jq -e \
  '(.applied.applied | length) == 0
   and .applied.currentVersion == 9
   and .health.healthy == true
   and .health.currentMigration == 9' \
  "$RUN_ROOT/evidence/candidate-migrate-schema9-idempotent.json" >/dev/null
verify_database "$ROUNDTRIP_DB" "candidate-schema9-idempotent" 9 9

run_startup \
  "candidate-schema9-first-start" "$CANDIDATE_PLUGIN" "$ROUNDTRIP_DB" \
  "$PORT_CANDIDATE_FIRST" 9
run_startup \
  "candidate-schema9-restart" "$CANDIDATE_PLUGIN" "$ROUNDTRIP_DB" \
  "$PORT_CANDIDATE_RESTART" 9
assert_bridge_rejects_schema9 "$ROUNDTRIP_DB" "bridge-rejects-schema9"
verify_database "$ROUNDTRIP_DB" "schema9-after-bridge-refusal" 9 9

sqlite3 "$ROUNDTRIP_DB" "PRAGMA wal_checkpoint(TRUNCATE)" >/dev/null
sqlite3 "$ROUNDTRIP_DB" ".backup '$PRESERVED_SCHEMA9_DB'"
verify_database "$PRESERVED_SCHEMA9_DB" "schema9-preserved-before-rollback" 9 9
sqlite3 "$SCHEMA8_PRE_CANDIDATE_BACKUP" ".backup '$ROLLBACK_DB'"
verify_database "$ROLLBACK_DB" "schema8-rollback-restored" 8 8
sqlite3 "$SCHEMA8_PRE_CANDIDATE_BACKUP" .dump \
  >"$RUN_ROOT/evidence/schema8-pre-candidate-backup.sql"
sqlite3 "$ROLLBACK_DB" .dump \
  >"$RUN_ROOT/evidence/schema8-rollback-restored.sql"
cmp -s \
  "$RUN_ROOT/evidence/schema8-pre-candidate-backup.sql" \
  "$RUN_ROOT/evidence/schema8-rollback-restored.sql" || fail \
  "schema-8 rollback image is not logically identical to its verified backup"
run_startup \
  "bridge-after-schema8-rollback" "$BRIDGE_PLUGIN" "$ROLLBACK_DB" \
  "$PORT_BRIDGE_ROLLBACK" 8
verify_database "$ROLLBACK_DB" "schema8-rollback-after-bridge-start" 8 8

credential_free_db_cli \
  "$CANDIDATE_PLUGIN" \
  "$ROLLBACK_DB" \
  "$RUN_ROOT/state/candidate-forward-after-rollback-backups" \
  "$RUN_ROOT/evidence/candidate-forward-after-rollback.json" \
  "candidate-forward-after-rollback"
jq -e \
  '(.applied.applied | length) == 1
   and .applied.currentVersion == 9
   and .applied.applied[0].version == 9
   and .health.healthy == true
   and .health.currentMigration == 9' \
  "$RUN_ROOT/evidence/candidate-forward-after-rollback.json" >/dev/null
verify_database "$ROLLBACK_DB" "candidate-forward-after-rollback" 9 9
run_startup \
  "candidate-after-rollback" "$CANDIDATE_PLUGIN" "$ROLLBACK_DB" \
  "$PORT_CANDIDATE_FINAL" 9

readonly EXTRACT_ROOT="$RUN_ROOT/validation/archive-extraction"
mkdir -p "$EXTRACT_ROOT"
tar -xzf "$ARCHIVE" -C "$EXTRACT_ROOT"
readonly EXTRACTED_BRIDGE="$EXTRACT_ROOT/$ARTIFACT_NAME/plugin"
tree_manifest "$BRIDGE_PLUGIN" "$RUN_ROOT/evidence/bridge.packaged.manifest.tsv"
tree_manifest "$EXTRACTED_BRIDGE" "$RUN_ROOT/evidence/bridge.archive-extracted.manifest.tsv"
cmp -s \
  "$RUN_ROOT/evidence/bridge.packaged.manifest.tsv" \
  "$RUN_ROOT/evidence/bridge.archive-extracted.manifest.tsv" || fail \
  "fresh archive extraction differs from the packaged bridge"
sqlite3 "$SCHEMA8_PRE_CANDIDATE_BACKUP" ".backup '$ARCHIVE_BRIDGE_DB'"
run_startup \
  "fresh-archive-extraction" "$EXTRACTED_BRIDGE" "$ARCHIVE_BRIDGE_DB" \
  "$PORT_ARCHIVE_EXTRACT" 8
verify_database "$ARCHIVE_BRIDGE_DB" "archive-bridge-final" 8 8
verify_database "$PRESERVED_SCHEMA9_DB" "schema9-preserved-final" 9 9

readonly MIGRATION_008_SOURCE_SHA="$(sha256sum "$CANDIDATE_MIGRATION_008" | awk '{print $1}')"
readonly MIGRATION_008_DB_SHA="$(sqlite3 "$ROUNDTRIP_DB" \
  "SELECT checksum FROM schema_migrations WHERE version = 8 AND name = 'follow_up_run_context_selections';")"
readonly MIGRATION_009_SOURCE_SHA="$(sha256sum "$CANDIDATE_MIGRATION_009" | awk '{print $1}')"
readonly MIGRATION_009_DB_SHA="$(sqlite3 "$ROUNDTRIP_DB" \
  "SELECT checksum FROM schema_migrations WHERE version = 9 AND name = 'guided_decision_single_pending_boundary';")"
[[ "$MIGRATION_008_DB_SHA" =~ ^[a-f0-9]{64}$ ]] || fail \
  "migration-008 database checksum is absent or invalid"
[[ "$MIGRATION_009_DB_SHA" =~ ^[a-f0-9]{64}$ ]] || fail \
  "migration-009 database checksum is absent or invalid"
[[ "$(sqlite3 "$ROUNDTRIP_DB" \
  "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('run_context_selections', 'mission_contract_snapshots', 'run_branches', 'runtime_continuations');")" == "4" ]] || fail \
  "migration-008 tables are incomplete"
[[ "$(sqlite3 "$ROUNDTRIP_DB" \
  "SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name IN ('run_context_selections_immutable_update', 'run_context_selections_immutable_delete', 'runs_bind_contract_after_insert', 'runs_contract_binding_immutable', 'mission_contract_snapshots_immutable_update', 'mission_contract_snapshots_immutable_delete', 'run_branches_immutable_update', 'run_branches_immutable_delete');")" == "8" ]] || fail \
  "migration-008 immutability triggers are incomplete"
[[ "$(sqlite3 "$ROUNDTRIP_DB" \
  "SELECT COUNT(*) FROM pragma_table_info('runs') WHERE name IN ('contract_version_bound', 'contract_hash_bound');")" == "2" ]] || fail \
  "migration-008 immutable run-contract binding columns are incomplete"
[[ "$(sqlite3 "$ROUNDTRIP_DB" \
  "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name IN ('idx_run_context_selections_run_type', 'idx_contract_snapshots_mission_source', 'idx_run_branches_source_created', 'idx_run_branches_mission_created', 'idx_runtime_continuations_ready', 'idx_runtime_continuations_run_status');")" == "6" ]] || fail \
  "migration-008 indexed query paths are incomplete"
[[ "$(sqlite3 "$ROUNDTRIP_DB" \
  "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_guided_decisions_one_pending_per_run';")" == "1" ]] || fail \
  "migration-009 Guided-decision uniqueness index is missing"

for port in \
  "$PORT_BRIDGE_FIRST" "$PORT_BRIDGE_RESTART" "$PORT_CANDIDATE_FIRST" \
  "$PORT_CANDIDATE_RESTART" "$PORT_BRIDGE_ROLLBACK" "$PORT_CANDIDATE_FINAL" \
  "$PORT_ARCHIVE_EXTRACT"; do
  if ss -ltnH "sport = :$port" | grep -q .; then
    fail "listener remained on isolated port $port"
  fi
done

tree_manifest "$LIVE_TARGET" "$RUN_ROOT/evidence/live-source.after.manifest.tsv"
cmp -s \
  "$RUN_ROOT/evidence/live-source.before.manifest.tsv" \
  "$RUN_ROOT/evidence/live-source.after.manifest.tsv" || fail \
  "live release source changed during the read-only rehearsal"
[[ "$(readlink -- "$LIVE_PLUGIN_LINK")" == "$LIVE_LINK_TEXT_BEFORE" ]] || fail \
  "live plugin symlink text changed during the rehearsal"
[[ "$(readlink -f -- "$LIVE_PLUGIN_LINK")" == "$LIVE_TARGET" ]] || fail \
  "live plugin symlink target changed during the rehearsal"
systemctl show chillspwn.service \
  --property=ActiveState,SubState,MainPID,NRestarts \
  >"$RUN_ROOT/evidence/live-service.after.tsv" || fail \
  "could not recapture the live service identity read-only"
cmp -s \
  "$RUN_ROOT/evidence/live-service.before.tsv" \
  "$RUN_ROOT/evidence/live-service.after.tsv" || fail \
  "live service identity or restart state changed during the rehearsal"

readonly CANDIDATE_SOURCE_TREE_SHA="$(manifest_sha "$RUN_ROOT/evidence/candidate.snapshot-source.manifest.tsv")"
readonly CANDIDATE_BUILT_TREE_SHA="$(manifest_sha "$RUN_ROOT/evidence/candidate.built.manifest.tsv")"
readonly BRIDGE_TREE_SHA="$(manifest_sha "$RUN_ROOT/evidence/bridge.packaged.manifest.tsv")"
readonly GIT_HEAD="$(cat "$RUN_ROOT/evidence/candidate.git-head.txt")"
readonly GIT_BRANCH="$(cat "$RUN_ROOT/evidence/candidate.git-branch.txt")"

cat >"$RUN_ROOT/evidence/startup-sequence.tsv" <<EOF
order\tlabel\tartifact\tport\tdatabase\tresult
1\tbridge-first-start\tbridge\t$PORT_BRIDGE_FIRST\tbridge-idempotency.sqlite\thealthy-schema8-clean
2\tbridge-idempotent-restart\tbridge\t$PORT_BRIDGE_RESTART\tbridge-idempotency.sqlite\thealthy-schema8-clean
3\tcandidate-schema9-first-start\tcandidate\t$PORT_CANDIDATE_FIRST\tschema8-to-schema9.sqlite\thealthy-schema9-clean
4\tcandidate-schema9-restart\tcandidate\t$PORT_CANDIDATE_RESTART\tschema8-to-schema9.sqlite\thealthy-schema9-clean
5\tbridge-after-schema8-rollback\tbridge\t$PORT_BRIDGE_ROLLBACK\tschema8-rollback-restored.sqlite\thealthy-schema8-clean
6\tcandidate-after-rollback\tcandidate\t$PORT_CANDIDATE_FINAL\tschema8-rollback-restored.sqlite\thealthy-schema9-clean
7\tfresh-archive-extraction\tarchive-extracted-bridge\t$PORT_ARCHIVE_EXTRACT\tschema8-archive-startup.sqlite\thealthy-schema8-clean
EOF

jq -n \
  --arg status "isolated_rehearsal_passed_not_release_acceptance" \
  --arg runId "$RUN_ID" \
  --arg evidenceRoot "$RUN_ROOT" \
  --arg liveLink "$LIVE_PLUGIN_LINK" \
  --arg liveTarget "$LIVE_TARGET" \
  --arg liveTreeSha256 "$LIVE_TREE_SHA" \
  --arg gitHead "$GIT_HEAD" \
  --arg gitBranch "$GIT_BRANCH" \
  --arg candidateSourceTreeSha256 "$CANDIDATE_SOURCE_TREE_SHA" \
  --arg candidateBuiltTreeSha256 "$CANDIDATE_BUILT_TREE_SHA" \
  --arg bridgeTreeSha256 "$BRIDGE_TREE_SHA" \
  --arg migration008SourceSha256 "$MIGRATION_008_SOURCE_SHA" \
  --arg migration008DatabaseSha256 "$MIGRATION_008_DB_SHA" \
  --arg migration009SourceSha256 "$MIGRATION_009_SOURCE_SHA" \
  --arg migration009DatabaseSha256 "$MIGRATION_009_DB_SHA" \
  --arg schema7BackupSha256 "$(sha256sum "$FIRST_BACKUP" | awk '{print $1}')" \
  --arg schema8BackupSha256 "$(sha256sum "$SCHEMA8_PRE_CANDIDATE_BACKUP" | awk '{print $1}')" \
  --arg archive "$ARCHIVE" \
  --arg archiveSha256 "$ARCHIVE_SHA" \
  --arg canaryId "$CANARY_ID" \
  --argjson ports "[$PORT_BRIDGE_FIRST,$PORT_BRIDGE_RESTART,$PORT_CANDIDATE_FIRST,$PORT_CANDIDATE_RESTART,$PORT_BRIDGE_ROLLBACK,$PORT_CANDIDATE_FINAL,$PORT_ARCHIVE_EXTRACT]" \
  '{
    status: $status,
    runId: $runId,
    evidenceRoot: $evidenceRoot,
    liveSource: {
      link: $liveLink,
      target: $liveTarget,
      contentTreeSha256: $liveTreeSha256,
      verifiedUnchanged: true
    },
    candidate: {
      gitHead: $gitHead,
      gitBranch: $gitBranch,
      sourceTreeSha256: $candidateSourceTreeSha256,
      builtTreeSha256: $candidateBuiltTreeSha256,
      dirtyStatusRecorded: true
    },
    bridge: {
      contentTreeSha256: $bridgeTreeSha256,
      onlyApprovedPathsDiffer: true,
      migration008SourceSha256: $migration008SourceSha256,
      migration008DatabaseSha256: $migration008DatabaseSha256
    },
    candidateMigration: {
      migration009SourceSha256: $migration009SourceSha256,
      migration009DatabaseSha256: $migration009DatabaseSha256,
      idempotent: true,
      bridgeRejectsUnknownSchema9: true
    },
    archive: {
      path: $archive,
      sha256: $archiveSha256,
      freshExtractionVerified: true,
      mode: "0444"
    },
    database: {
      path: "7 -> 8 -> 9",
      quickCheck: "ok",
      foreignKeyViolations: 0,
      canaryId: $canaryId,
      canaryPreserved: true,
      schema7BackupSha256: $schema7BackupSha256,
      schema8BackupSha256: $schema8BackupSha256,
      schema8RollbackRestored: true,
      schema9ForwardMigrationAfterRollback: true
    },
    startupSequence: {
      ports: $ports,
      credentialFree: true,
      cleanShutdowns: true,
      listenersRemaining: 0
    },
    productionWrites: false,
    productionServiceUnchanged: true,
    releaseAcceptance: false
  }' >"$RUN_ROOT/summary.json"

cat >"$RUN_ROOT/REHEARSAL.md" <<EOF
# Schema-7 to schema-9 compatibility-bridge isolated rehearsal

- Status: **passed as an isolated preliminary rehearsal; this is not final release acceptance**
- Run: \`$RUN_ID\`
- Live source observed read-only: \`$LIVE_TARGET\`
- Live content-tree SHA-256: \`$LIVE_TREE_SHA\`
- Candidate snapshot: \`$GIT_HEAD\` on \`$GIT_BRANCH\` (dirty status preserved separately)
- Candidate source-tree SHA-256: \`$CANDIDATE_SOURCE_TREE_SHA\`
- Bridge content-tree SHA-256: \`$BRIDGE_TREE_SHA\`
- Migration-008 source SHA-256: \`$MIGRATION_008_SOURCE_SHA\`
- Migration-008 database checksum: \`$MIGRATION_008_DB_SHA\`
- Migration-009 source SHA-256: \`$MIGRATION_009_SOURCE_SHA\`
- Migration-009 database checksum: \`$MIGRATION_009_DB_SHA\`
- Immutable archive: \`$ARCHIVE\`
- Archive SHA-256: \`$ARCHIVE_SHA\`

The bridge was copied from the exact live schema-7 release and differs only at
\`webapp/server/db/migrations/008_follow_up_context.ts\` and
\`webapp/server/db/migrations/index.ts\`. The index was accepted only after it
matched a mechanically generated schema-7 index plus the exact migration-8
import and registration lines.

The exact live schema-7 code created an isolated database and inserted the
synthetic canary through its database connection. The bridge applied migration
8 once, a second invocation applied nothing, and both bridge startups were
healthy after restart. The exact candidate then applied migration 9 once and
applied nothing on restart. Both candidate schema-9 startups were healthy. The
schema-8 bridge rejected the higher schema without changing it.

The candidate's verified, mode-0600 pre-migration schema-8 backup was restored
to a separate database. The bridge started successfully against that rollback
image, the candidate migrated the restored copy forward to schema 9 again, and
the candidate started successfully. A fresh extraction of the immutable bridge
archive also started against a separate copy of the retained schema-8 backup.
Every startup preserved the canary, passed SQLite quick/FK checks, shut down
cooperatively, and left no listener.

All server processes used an empty environment with isolated HOME, state,
database, vault, session, and workspace paths. Provider credentials, terminal,
proxy, file-write, security-tool, and MCP execution were unavailable. The
script did not read or write authentication files and did not access ports 3131
or 3132. It made no writes under \`/opt\` or \`/var/lib/chillspwn\` and did not
interact with services or live symlinks beyond read-only identity checks.
The live source tree, symlink text/target, service PID, active state, and restart
counter were identical before and after the rehearsal.

Re-run this harness from the final reviewed commit and repeat the full release
gate before any promotion. A successful preliminary result is not permission
to modify production.
EOF

(
  cd "$RUN_ROOT"
  find . -type f \
    ! -name 'CHECKSUMS.sha256' \
    ! -name 'CHECKSUMS.sha256.sha256' \
    -print0 \
    | LC_ALL=C sort -z \
    | xargs -0 sha256sum
) >"$RUN_ROOT/CHECKSUMS.sha256"
(
  cd "$RUN_ROOT"
  sha256sum CHECKSUMS.sha256 >CHECKSUMS.sha256.sha256
)
chmod 0444 "$RUN_ROOT/CHECKSUMS.sha256" "$RUN_ROOT/CHECKSUMS.sha256.sha256"

FINALIZED=1
trap - EXIT
printf 'schema-7-to-9 isolated rehearsal passed\n'
printf 'evidence=%s\n' "$RUN_ROOT"
printf 'archive=%s\n' "$ARCHIVE"
printf 'archive_sha256=%s\n' "$ARCHIVE_SHA"
printf 'live_tree_sha256=%s\n' "$LIVE_TREE_SHA"
printf 'candidate_source_tree_sha256=%s\n' "$CANDIDATE_SOURCE_TREE_SHA"
printf 'bridge_tree_sha256=%s\n' "$BRIDGE_TREE_SHA"
