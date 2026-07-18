#!/usr/bin/env bash

set -euo pipefail

fail() {
  echo "schema-9 rehearsal refused: $*" >&2
  exit 64
}

[[ $# -eq 0 ]] || fail "this disposable rehearsal accepts no paths or arguments"

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly WEBAPP_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd -P)"
readonly BUN_BIN="/root/.bun/bin/bun"
readonly HELPER="$SCRIPT_DIR/schema9-guided-boundary-rehearsal.ts"
readonly MIGRATION="$WEBAPP_ROOT/server/db/migrations/009_guided_decision_boundary.ts"
readonly MIGRATION_INDEX="$WEBAPP_ROOT/server/db/migrations/index.ts"

for executable in "$BUN_BIN" jq sqlite3 sha256sum mktemp stat; do
  if [[ "$executable" == /* ]]; then
    [[ -x "$executable" ]] || fail "required executable is unavailable: $executable"
  else
    command -v "$executable" >/dev/null || fail "required command is unavailable: $executable"
  fi
done
for required in "$HELPER" "$MIGRATION" "$MIGRATION_INDEX" "$WEBAPP_ROOT/server/db/cli.ts"; do
  [[ -f "$required" && ! -L "$required" ]] || fail "required source is missing or unsafe: $required"
done

umask 077
RUN_ROOT="$(mktemp -d /tmp/chillspwn-schema9-rehearsal.XXXXXXXXXX)"
readonly RUN_ROOT
[[ "$RUN_ROOT" =~ ^/tmp/chillspwn-schema9-rehearsal\.[A-Za-z0-9]+$ ]] || fail \
  "mktemp returned an unexpected path"

cleanup() {
  rm -rf -- "$RUN_ROOT"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir -p -- "$RUN_ROOT/home" "$RUN_ROOT/backups-first" "$RUN_ROOT/backups-restart"
readonly DATABASE="$RUN_ROOT/schema8-to-schema9.sqlite"
readonly SOURCE_HASHES="$RUN_ROOT/source.before.sha256"
readonly FIRST_RESULT="$RUN_ROOT/migrate-first.json"
readonly SECOND_RESULT="$RUN_ROOT/migrate-restart.json"

sha256sum -- "$MIGRATION" "$MIGRATION_INDEX" >"$SOURCE_HASHES"

run_bun() {
  env -i \
    PATH="/root/.bun/bin:/usr/local/bin:/usr/bin:/bin" \
    HOME="$RUN_ROOT/home" \
    TMPDIR="$RUN_ROOT" \
    LANG="C.UTF-8" \
    LC_ALL="C.UTF-8" \
    TZ="Etc/UTC" \
    NODE_ENV="test" \
    "$BUN_BIN" "$@"
}

run_bun run "$HELPER" seed "$DATABASE" >"$RUN_ROOT/seed.json"
[[ "$(stat -c '%a' "$DATABASE")" == "600" ]] || fail "fixture database is not mode 0600"
[[ "$(sqlite3 "$DATABASE" 'SELECT MAX(version) FROM schema_migrations')" == "8" ]] || fail \
  "fixture is not schema 8"
[[ "$(sqlite3 "$DATABASE" \
  "SELECT COUNT(*) FROM guided_decisions WHERE run_id='run-schema9-ambiguous' AND status='pending'")" == "2" ]] || fail \
  "fixture does not contain the intended ambiguous authority"

run_bun run "$WEBAPP_ROOT/server/db/cli.ts" migrate \
  --db "$DATABASE" --backup-dir "$RUN_ROOT/backups-first" >"$FIRST_RESULT"
jq -e '
  (.applied.applied | length) == 1
  and .applied.applied[0].version == 9
  and .applied.applied[0].name == "guided_decision_single_pending_boundary"
  and .applied.currentVersion == 9
  and .health.healthy == true
  and .health.currentMigration == 9
  and (.backup.destination | type) == "string"
' "$FIRST_RESULT" >/dev/null || fail "first CLI migration did not apply exactly migration 9"

readonly FIRST_BACKUP="$(jq -r '.backup.destination' "$FIRST_RESULT")"
[[ "$FIRST_BACKUP" == "$RUN_ROOT"/* && -f "$FIRST_BACKUP" && ! -L "$FIRST_BACKUP" ]] || fail \
  "CLI backup escaped the disposable rehearsal"
[[ "$(stat -c '%a' "$FIRST_BACKUP")" == "600" ]] || fail "CLI backup is not mode 0600"
[[ "$(sqlite3 "$FIRST_BACKUP" 'PRAGMA quick_check')" == "ok" ]] || fail \
  "schema-8 backup failed quick_check"
[[ -z "$(sqlite3 "$FIRST_BACKUP" 'PRAGMA foreign_key_check')" ]] || fail \
  "schema-8 backup failed foreign_key_check"
[[ "$(sqlite3 "$FIRST_BACKUP" 'SELECT MAX(version) FROM schema_migrations')" == "8" ]] || fail \
  "pre-migration backup is not schema 8"
[[ "$(sqlite3 "$FIRST_BACKUP" \
  "SELECT COUNT(*) FROM guided_decisions WHERE run_id='run-schema9-ambiguous' AND status='pending'")" == "2" ]] || fail \
  "pre-migration backup did not preserve the ambiguous fixture"

run_bun run "$WEBAPP_ROOT/server/db/cli.ts" migrate \
  --db "$DATABASE" --backup-dir "$RUN_ROOT/backups-restart" >"$SECOND_RESULT"
jq -e '
  (.applied.applied | length) == 0
  and .applied.currentVersion == 9
  and .health.healthy == true
  and .health.currentMigration == 9
' "$SECOND_RESULT" >/dev/null || fail "restart migration was not idempotent"

run_bun run "$HELPER" verify "$DATABASE" >"$RUN_ROOT/verify.json"
jq -e '
  .status == "schema9_guided_boundary_verified"
  and .ambiguous.decisionsCancelled == 2
  and .ambiguous.stepsBlocked == 2
  and .ambiguous.assignmentsBlocked == 2
  and .preserved.validPendingDecisions == 1
  and .uniquenessEnforced == true
  and .idempotentRestart == true
  and .schemaEightRollbackBoundary == "fail_closed"
  and .health.healthy == true
  and .health.currentMigration == 9
' "$RUN_ROOT/verify.json" >/dev/null || fail "post-migration Guided boundary verification failed"

sha256sum --check --status "$SOURCE_HASHES" || fail "migration source changed during rehearsal"
[[ "$(sqlite3 "$DATABASE" 'PRAGMA quick_check')" == "ok" ]] || fail \
  "final database failed quick_check"
[[ -z "$(sqlite3 "$DATABASE" 'PRAGMA foreign_key_check')" ]] || fail \
  "final database failed foreign_key_check"

jq -n \
  --arg migrationSourceSha256 "$(sha256sum "$MIGRATION" | awk '{print $1}')" \
  --arg migrationDatabaseChecksum "$(sqlite3 "$DATABASE" \
    "SELECT checksum FROM schema_migrations WHERE version=9")" \
  --arg backupSha256 "$(sha256sum "$FIRST_BACKUP" | awk '{print $1}')" \
  '{
    status: "passed",
    scope: "disposable schema-8 to schema-9 database rehearsal",
    productionAccess: false,
    temporaryWorkspaceRemovedOnExit: true,
    migration: {
      version: 9,
      name: "guided_decision_single_pending_boundary",
      sourceSha256: $migrationSourceSha256,
      databaseChecksum: $migrationDatabaseChecksum
    },
    backup: {
      schema: 8,
      mode: "0600",
      sha256: $backupSha256,
      quickCheck: "ok",
      foreignKeyViolations: 0
    },
    boundary: {
      ambiguousDecisionsCancelled: 2,
      ambiguousStepsBlocked: 2,
      ambiguousAssignmentsBlocked: 2,
      validPendingDecisionPreserved: true,
      onePendingDecisionPerRunEnforced: true,
      nonPendingHistoryPreserved: true,
      schemaEightApplicationFailsClosed: true
    },
    restart: {migrationReapplied: false},
    finalDatabase: {schema: 9, quickCheck: "ok", foreignKeyViolations: 0}
  }'
