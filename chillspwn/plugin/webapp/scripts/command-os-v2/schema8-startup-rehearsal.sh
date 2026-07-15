#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat >&2 <<'EOF'
usage: schema8-startup-rehearsal.sh RUN_ROOT LABEL PLUGIN_ROOT STATE_ROOT DATABASE PORT EVIDENCE_DIR CANARY_ID [EXPECTED_SCHEMA]

Starts one copied ChillsPwn plugin in an isolated, credential-free environment,
checks schema-8 or schema-9 readiness, then proves cooperative shutdown and
listener cleanup. EXPECTED_SCHEMA defaults to 8.
Every writable path must be below RUN_ROOT. Ports 3131 and 3132 are forbidden.
EOF
  exit 64
}

[[ $# -eq 8 || $# -eq 9 ]] || usage

RUN_ROOT="$(realpath -m -- "$1")"
LABEL="$2"
PLUGIN_ROOT="$(realpath -m -- "$3")"
STATE_ROOT="$(realpath -m -- "$4")"
DATABASE="$(realpath -m -- "$5")"
PORT="$6"
EVIDENCE_DIR="$(realpath -m -- "$7")"
CANARY_ID="$8"
EXPECTED_SCHEMA="${9:-8}"
WEBAPP="$PLUGIN_ROOT/webapp"
HOME_DIR="$STATE_ROOT/home"
HERMES_HOME="$HOME_DIR/.hermes"
WORKSPACE="$STATE_ROOT/workspace"
REPORT_TEMPLATE="$STATE_ROOT/report-template"
LOG="$EVIDENCE_DIR/${LABEL}.server.log"
HEALTH="$EVIDENCE_DIR/${LABEL}.health.json"
RESULT="$EVIDENCE_DIR/${LABEL}.result.tsv"
PID=""

is_below_run_root() {
  local candidate="$1"
  [[ "$candidate" == "$RUN_ROOT"/* ]]
}

for writable in "$STATE_ROOT" "$DATABASE" "$EVIDENCE_DIR" "$HOME_DIR"; do
  is_below_run_root "$writable" || {
    echo "refusing writable path outside rehearsal root: $writable" >&2
    exit 65
  }
done

is_below_run_root "$PLUGIN_ROOT" || {
  echo "refusing plugin outside rehearsal root: $PLUGIN_ROOT" >&2
  exit 65
}

[[ "$LABEL" =~ ^[a-z0-9][a-z0-9._-]{0,79}$ ]] || {
  echo "invalid rehearsal label" >&2
  exit 65
}
[[ "$CANARY_ID" =~ ^[A-Za-z0-9._:-]{1,120}$ ]] || {
  echo "invalid canary identifier" >&2
  exit 65
}
[[ "$PORT" =~ ^[0-9]+$ ]] && (( PORT >= 1024 && PORT <= 65535 )) || {
  echo "invalid rehearsal port: $PORT" >&2
  exit 65
}
[[ "$PORT" != "3131" && "$PORT" != "3132" ]] || {
  echo "production/tunnel port is forbidden: $PORT" >&2
  exit 65
}
[[ "$EXPECTED_SCHEMA" == "8" || "$EXPECTED_SCHEMA" == "9" ]] || {
  echo "expected schema must be 8 or 9: $EXPECTED_SCHEMA" >&2
  exit 65
}

for required in \
  "$WEBAPP/server/index.ts" \
  "$WEBAPP/package.json" \
  "$WEBAPP/server/db/migrations/008_follow_up_context.ts" \
  "$DATABASE"; do
  [[ -e "$required" ]] || {
    echo "missing rehearsal input: $required" >&2
    exit 66
  }
done
if [[ "$EXPECTED_SCHEMA" == "9" && ! -f "$WEBAPP/server/db/migrations/009_guided_decision_boundary.ts" ]]; then
  echo "missing schema-9 migration in rehearsal artifact" >&2
  exit 66
fi
[[ -f "$DATABASE" && ! -L "$DATABASE" ]] || {
  echo "rehearsal database must be a regular non-symlink file" >&2
  exit 66
}

if ss -ltnH "sport = :$PORT" | grep -q .; then
  echo "isolated port is already occupied: $PORT" >&2
  exit 69
fi

verify_database() {
  local quick foreign migration_count migration_max canary_count
  quick="$(sqlite3 "$DATABASE" 'PRAGMA quick_check')"
  foreign="$(sqlite3 "$DATABASE" 'PRAGMA foreign_key_check')"
  migration_count="$(sqlite3 "$DATABASE" 'SELECT COUNT(*) FROM schema_migrations')"
  migration_max="$(sqlite3 "$DATABASE" 'SELECT COALESCE(MAX(version), 0) FROM schema_migrations')"
  canary_count="$(sqlite3 "$DATABASE" \
    "SELECT COUNT(*) FROM missions WHERE id = '$CANARY_ID' AND name = 'Schema 8 rehearsal canary' AND journey = 'guided' AND created_by = 'schema8-rehearsal';")"
  [[ "$quick" == "ok" ]] || { echo "database quick_check failed: $quick" >&2; exit 70; }
  [[ -z "$foreign" ]] || { echo "database foreign_key_check failed: $foreign" >&2; exit 70; }
  [[ "$migration_count" == "$EXPECTED_SCHEMA" && "$migration_max" == "$EXPECTED_SCHEMA" ]] || {
    echo "database is not exactly schema $EXPECTED_SCHEMA (count=$migration_count max=$migration_max)" >&2
    exit 70
  }
  [[ "$canary_count" == "1" ]] || { echo "synthetic canary is missing or changed" >&2; exit 70; }
}

umask 077
mkdir -p \
  "$HOME_DIR" \
  "$HERMES_HOME" \
  "$WORKSPACE" \
  "$REPORT_TEMPLATE" \
  "$EVIDENCE_DIR" \
  "$STATE_ROOT/sessions" \
  "$STATE_ROOT/brain-vaults" \
  "$STATE_ROOT/tmp"

if [[ ! -e "$HERMES_HOME/kanban.db" ]]; then
  sqlite3 "$HERMES_HOME/kanban.db" <<'SQL'
CREATE TABLE tasks (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT, assignee TEXT,
  status TEXT NOT NULL, priority INTEGER DEFAULT 0, created_by TEXT,
  created_at INTEGER NOT NULL, started_at INTEGER, completed_at INTEGER,
  workspace_kind TEXT NOT NULL DEFAULT 'scratch', result TEXT,
  worker_pid INTEGER, last_failure_error TEXT, current_run_id INTEGER,
  model_override TEXT, max_retries INTEGER, session_id TEXT
);
CREATE TABLE task_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL,
  status TEXT NOT NULL, claim_lock TEXT, claim_expires INTEGER,
  worker_pid INTEGER, started_at INTEGER NOT NULL, ended_at INTEGER,
  outcome TEXT, summary TEXT, error TEXT
);
CREATE TABLE task_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL,
  kind TEXT NOT NULL, payload TEXT, created_at INTEGER NOT NULL
);
SQL
fi

cleanup() {
  local member
  if [[ -n "$PID" ]]; then
    if kill -0 "$PID" 2>/dev/null || kill -0 -- "-$PID" 2>/dev/null; then
      kill -TERM -- "-$PID" 2>/dev/null || true
      for _ in $(seq 1 100); do
        if ! kill -0 "$PID" 2>/dev/null && ! kill -0 -- "-$PID" 2>/dev/null; then
          break
        fi
        sleep 0.1
      done
      if kill -0 "$PID" 2>/dev/null || kill -0 -- "-$PID" 2>/dev/null; then
        kill -KILL -- "-$PID" 2>/dev/null || true
      fi
      wait "$PID" 2>/dev/null || true
    fi
    while read -r member; do
      [[ -z "$member" ]] || kill -KILL "$member" 2>/dev/null || true
    done < <(ps -eo pid=,pgid= | awk -v group="$PID" '$2 == group { print $1 }')
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

verify_database

cd "$WEBAPP"
setsid env -i \
  PATH="/root/.bun/bin:/usr/local/bin:/usr/bin:/bin" \
  LANG="C.UTF-8" \
  LC_ALL="C.UTF-8" \
  TZ="Etc/UTC" \
  NODE_ENV="test" \
  TMPDIR="$STATE_ROOT/tmp" \
  HOME="$HOME_DIR" \
  HERMES_HOME="$HERMES_HOME" \
  CHILLSPWN_PLUGIN_DIR="$PLUGIN_ROOT" \
  CHILLSPWN_REPORT_TEMPLATE_DIR="$REPORT_TEMPLATE" \
  CHILLSPWN_STATE_DIR="$STATE_ROOT" \
  CHILLSPWN_SESSIONS_DIR="$STATE_ROOT/sessions" \
  COMMAND_OS_DB_PATH="$DATABASE" \
  CHILLSPWN_VAULT_ROOT="$STATE_ROOT/brain-vaults" \
  CHILLSPWN_BIND="127.0.0.1" \
  CHILLSPWN_PORT="$PORT" \
  DASHBOARD_TOKEN="" \
  CODEX_HOME="$HOME_DIR/.codex" \
  CODEX_BIN="$STATE_ROOT/unavailable/codex" \
  CLAUDE_CONFIG_DIR="$STATE_ROOT/unavailable/claude" \
  CLAUDE_BIN="$STATE_ROOT/unavailable/claude-bin" \
  GROK_AUTH_PATH="$STATE_ROOT/unavailable/grok-auth.json" \
  GROK_BIN="$STATE_ROOT/unavailable/grok" \
  HERMES_PYTHON="$STATE_ROOT/unavailable/python" \
  ALLOWED_WORKSPACE_ROOTS="$WORKSPACE" \
  ENABLE_TERMINAL="false" \
  ENABLE_PROXY="false" \
  ENABLE_FILE_WRITE="false" \
  ENABLE_SECURITY_TOOLS="false" \
  ENABLE_MCP_ARSENAL="false" \
  MCP_ARSENAL_MODE="disabled" \
  MCP_ARSENAL_START_SERVERS="false" \
  ENABLE_SPECIALIST_AGENT_ROUTING="true" \
  ENFORCE_CHILLSPWN_DELEGATION="true" \
  ENFORCE_CHILLSPWN_NO_HANDS="true" \
  ALLOW_CHILLSPWN_DIRECT_TOOLS="false" \
  REQUIRE_SPECIALIST_ASSIGNMENT="true" \
  OPENROUTER_API_KEY="" \
  GEMINI_API_KEY="" \
  XAI_API_KEY="" \
  ANTHROPIC_API_KEY="" \
  /root/.bun/bin/bun run server/index.ts >"$LOG" 2>&1 &
PID=$!

ready=0
for _ in $(seq 1 300); do
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "isolated server exited before readiness: $LABEL" >&2
    tail -n 100 "$LOG" >&2
    exit 70
  fi
  if curl -fsS --max-time 2 "http://127.0.0.1:$PORT/api/v2/health" -o "$HEALTH" 2>/dev/null; then
    ready=1
    break
  fi
  sleep 0.1
done

if [[ "$ready" -ne 1 ]]; then
  echo "readiness timeout: $LABEL" >&2
  tail -n 100 "$LOG" >&2
  exit 70
fi

jq -e --argjson expectedSchema "$EXPECTED_SCHEMA" \
  '.status == "healthy"
   and .database.healthy == true
   and .database.currentMigration == $expectedSchema
   and .eventStream.status == "healthy"' \
  "$HEALTH" >/dev/null
curl -fsS --max-time 2 "http://127.0.0.1:$PORT/api/health" >/dev/null
verify_database

kill -TERM -- "-$PID"
status=0
process_state=""
for _ in $(seq 1 120); do
  process_state="$(ps -o stat= -p "$PID" 2>/dev/null | awk '{$1=$1; print}' || true)"
  if [[ -z "$process_state" || "$process_state" == Z* ]]; then
    break
  fi
  sleep 0.1
done
if [[ -n "$process_state" && "$process_state" != Z* ]]; then
  echo "isolated process group did not stop cooperatively: $LABEL" >&2
  exit 70
fi
wait "$PID" || status=$?
[[ "$status" -eq 0 ]] || {
  echo "isolated server exited with status $status: $LABEL" >&2
  exit "$status"
}

if ss -ltnH "sport = :$PORT" | grep -q .; then
  echo "isolated listener remained after shutdown: $PORT" >&2
  exit 70
fi
if ps -eo pgid= | awk -v group="$PID" '$1 == group { found = 1 } END { exit found ? 0 : 1 }'; then
  echo "isolated process group remained after shutdown: $LABEL" >&2
  exit 70
fi
PID=""
verify_database

printf '%s\thealthy\tmigration=%s\tport=%s\tclean_shutdown=true\tcanary=true\n' \
  "$LABEL" "$EXPECTED_SCHEMA" "$PORT" >"$RESULT"
cat "$RESULT"
