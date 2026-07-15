#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fail=0

snapshot_paths() {
  if git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git -C "$ROOT" ls-files --cached --others --exclude-standard -z
  else
    find "$ROOT" \( -type f -o -type l \) -printf '%P\0'
  fi
}

required=(
  "chillspwn/plugin/.claude-plugin/plugin.json"
  "chillspwn/plugin/webapp/package.json"
  "chillspwn/plugin/webapp/server/index.ts"
  "chillspwn/plugin/webapp/server/providers/GrokAcpProtocol.ts"
  "chillspwn/plugin/webapp/server/providers/GrokAcpExecutionPolicy.ts"
  "chillspwn/plugin/webapp/server/providers/GrokAcpAttestation.ts"
  "chillspwn/plugin/webapp/server/providers/GrokCommanderRuntime.ts"
  "chillspwn/plugin/webapp/server/mcp/McpServerRegistry.ts"
  "chillspwn/plugin/webapp/server/providers/grok-commander-profile.md"
  "chillspwn/plugin/webapp/server/providers/grok-commander-plugin/bin/commander-tool-guard.ts"
  "chillspwn/plugin/webapp/server/agents/personas/chillspwn-commander-soul.md"
  "chillspwn/plugin/webapp/src/pages/ChatPage.tsx"
  "chillspwn/plugin/webapp/android/app/src/main/AndroidManifest.xml"
  "chillspwn/runtime/personas/chillspwn/persona.json"
  "chillspwn/report-template/generate_report.py"
  "hermes/source/pyproject.toml"
  "hermes/source/acp_adapter/entry.py"
  "hermes/runtime/SOUL.md"
  "hermes/runtime/runtime.env.example"
  "hermes/runtime/skills/red-teaming/council-of-ais/scripts/board_mcp_server.py"
  "hermes/runtime/scripts/chillspwn_learn_cron.py"
  "deployment/systemd/chillspwn.service"
  "deployment/systemd/hermes-gateway.service"
  "deployment/systemd/var-lib-chillspwn-workspaces-htb-boxes.mount"
  "deployment/systemd/var-lib-chillspwn-workspaces-engagements.mount"
  "deployment/systemd/README.md"
  "deployment/legacy/chillspwn-memory.service"
  "deployment/legacy/chillspwn.service"
  "deployment/legacy/hermes-gateway.service"
  "scripts/bootstrap-board.py"
  "scripts/stage-chillspwn-release.sh"
  "scripts/test-stage-chillspwn-release.sh"
  "scripts/smoke-skills.py"
  "scripts/chillspwn-memory-broker.py"
  "scripts/validate-hermes-config.py"
  "hermes/runtime/tests/test_validate_hermes_config.py"
)

for path in "${required[@]}"; do
  if [[ ! -e "$ROOT/$path" ]]; then
    echo "missing required path: $path" >&2
    fail=1
  fi
done

forbidden_name_regex='(^|/)(\.env($|\.)|auth\.json|state\.db|kanban\.db|active_sessions\.json|conversation\.mcp|client-logs\.jsonl|llm_raw\.jsonl)($|\.)|\.(db|sqlite|sqlite3)(-(wal|shm))?$|\.(log|out|ccache|pfx|p12|jks|keystore|pem|crt|cer|csr|key|keytab|kirbi|ovpn|kdbx|pcap|pcapng|zip|tar|tgz|gz|7z|rar)$'
safe_env_example_regex='(^|/)\.env([.][^/]*)?[.]example$'
while IFS= read -r -d '' rel; do
  if [[ "$rel" =~ $forbidden_name_regex && ! "$rel" =~ $safe_env_example_regex ]]; then
    echo "forbidden recovery filename: $rel" >&2
    fail=1
  fi
done < <(snapshot_paths)

for runtime_metadata in \
  "hermes/runtime/skills/.usage.json" \
  "hermes/runtime/skills/.curator_state"; do
  if [[ -e "$ROOT/$runtime_metadata" || -L "$ROOT/$runtime_metadata" ]]; then
    echo "mutable runtime metadata must not be retained: $runtime_metadata" >&2
    fail=1
  fi
done

for forbidden_path in \
  "chillspwn/plugin/webapp/public/chillspwn-qr.png" \
  "chillspwn/plugin/webapp/public/poc-theme-dark.html" \
  "chillspwn/plugin/webapp/android/app/src/main/assets"; do
  if [[ -e "$ROOT/$forbidden_path" || -L "$ROOT/$forbidden_path" ]]; then
    echo "forbidden generated/private recovery path: $forbidden_path" >&2
    fail=1
  fi
done

while IFS= read -r -d '' rel; do
  path="$ROOT/$rel"
  if [[ -L "$path" ]]; then
    target="$(readlink "$path")"
    if [[ "$target" == /* ]]; then
      echo "absolute symlink target is forbidden: $rel" >&2
      fail=1
      continue
    fi
    if ! retained="$(realpath -e -- "$path" 2>/dev/null)"; then
      echo "symlink has no retained recovery target: $rel" >&2
      fail=1
      continue
    fi
    case "$retained" in
      "$ROOT/hermes/runtime/SOUL.md"|"$ROOT/hermes/runtime/skills/"*)
        ;;
      *)
        echo "symlink target is outside the reviewed recovery contract: $rel" >&2
        fail=1
        ;;
    esac
    if [[ ! -e "$retained" ]]; then
      echo "symlink has no retained recovery target: $rel" >&2
      fail=1
    fi
    continue
  fi
  if [[ -f "$path" ]] && (( $(stat -c '%s' "$path") > 50 * 1024 * 1024 )); then
    echo "file exceeds 50 MiB: $rel" >&2
    fail=1
  fi
done < <(snapshot_paths)

grok_protocol="$ROOT/chillspwn/plugin/webapp/server/providers/GrokAcpProtocol.ts"
grok_runtime="$ROOT/chillspwn/plugin/webapp/server/providers/GrokCommanderRuntime.ts"
grok_policy="$ROOT/chillspwn/plugin/webapp/server/providers/GrokAcpExecutionPolicy.ts"
grok_guard="$ROOT/chillspwn/plugin/webapp/server/providers/grok-commander-plugin/bin/commander-tool-guard.ts"
server_index="$ROOT/chillspwn/plugin/webapp/server/index.ts"
board_bootstrap="$ROOT/scripts/bootstrap-board.py"

if ! grep -Fq '"--reasoning-effort",' "$grok_protocol" || ! grep -Fq '"high",' "$grok_protocol"; then
  echo "Grok ACP Expert/high argument builder not found" >&2
  fail=1
fi

if [[ $(grep -Fc 'buildGrokAgentArgs(' "$server_index") -lt 2 ]]; then
  echo "Grok ACP argument builder is not used by every process entry point" >&2
  fail=1
fi

if [[ $(grep -Fc 'spawn(trustedGrokBin()' "$server_index") -lt 2 ]] \
  || grep -Fq 'spawn("grok"' "$server_index" \
  || ! grep -Fq 'GROK_BIN must be an absolute path' "$server_index" \
  || ! grep -Fq 'GROK_BIN parent chain must be root-controlled' "$server_index"; then
  echo "Grok ACP launch does not use the reviewed absolute executable" >&2
  fail=1
fi

if [[ $(grep -Fc '"--plugin-dir", CHILLSPWN_PLUGIN_DIR' "$server_index") -lt 5 ]]; then
  echo "Reviewed ChillsPwn plugin is not explicit on every tool-bearing Claude launch" >&2
  fail=1
fi

if ! grep -Fq 'env.GROK_AUTH_PATH = resolve(authPath);' "$grok_runtime" \
  || ! grep -Fq 'validateGrokOAuthAuthFile(options.authPath);' "$grok_runtime" \
  || ! grep -Fq 'delete env.XAI_API_KEY;' "$server_index"; then
  echo "Grok API-key removal guard not found" >&2
  fail=1
fi

if ! grep -Fq 'evaluateGrokAcpTool("planner"' "$server_index" \
  || ! grep -Fq 'evaluateGrokAcpTool("commander"' "$server_index" \
  || ! grep -Fq 'const COMMANDER_MCP_ALLOWLIST' "$grok_policy" \
  || ! grep -Fq 'const GROK_NATIVE_EXECUTION_TOOLS' "$grok_policy" \
  || ! grep -Fq 'evaluateGrokAcpTool(role as "commander" | "planner"' "$grok_guard"; then
  echo "Grok ACP commander delegation boundary not found" >&2
  fail=1
fi

if ! grep -Fq 'supportsGrokPreToolDeny' "$server_index" \
  || ! grep -Fq 'GROK_COMMANDER_BOUNDARY_VERSION' "$server_index"; then
  echo "Grok ACP fail-closed attestation guard not found" >&2
  fail=1
fi

if grep -Fq 'grok ACP stderr' "$server_index"; then
  echo "Grok ACP stderr must not be persisted to dashboard logs" >&2
  fail=1
fi

if ! grep -Fq 'Environment=HOME=/home/chillspwn' "$ROOT/deployment/systemd/chillspwn.service" \
  || ! grep -Fq 'SupplementaryGroups=' "$ROOT/deployment/systemd/chillspwn.service" \
  || ! grep -Fq 'Environment=CHILLSPWN_BUN_BIN=/opt/chillspwn-runtime/bin/bun' "$ROOT/deployment/systemd/chillspwn.service" \
  || ! grep -Fq 'Environment=GROK_COMMANDER_BUN=/opt/chillspwn-runtime/bin/bun' "$ROOT/deployment/systemd/chillspwn.service" \
  || ! grep -Fq 'Environment=GROK_BIN=/opt/chillspwn/bin/grok' "$ROOT/deployment/systemd/chillspwn.service" \
  || ! grep -Fq 'Environment=GROK_AUTH_PATH=/var/lib/chillspwn/grok-auth/auth.json' "$ROOT/deployment/systemd/chillspwn.service" \
  || ! grep -Fq 'Environment=COMMAND_OS_DB_PATH=/var/lib/chillspwn/command-os-v2.sqlite' "$ROOT/deployment/systemd/chillspwn.service" \
  || ! grep -Fq 'Environment=CHILLSPWN_VAULT_ROOT=/var/lib/chillspwn/brain-vaults' "$ROOT/deployment/systemd/chillspwn.service" \
  || grep -Fq 'Environment=HOME=/root' "$ROOT/deployment/systemd/chillspwn.service"; then
  echo "Hardened service state or Grok executable/OAuth split contract not found" >&2
  fail=1
fi

htb_mount="$ROOT/deployment/systemd/var-lib-chillspwn-workspaces-htb-boxes.mount"
engagement_mount="$ROOT/deployment/systemd/var-lib-chillspwn-workspaces-engagements.mount"
workspace_requires='RequiresMountsFor=/var/lib/chillspwn/workspaces/htb/boxes /var/lib/chillspwn/workspaces/engagements'
if ! grep -Fq 'What=/root/htb/boxes' "$htb_mount" \
  || ! grep -Fq 'Where=/var/lib/chillspwn/workspaces/htb/boxes' "$htb_mount" \
  || ! grep -Fq 'What=/root/engagements' "$engagement_mount" \
  || ! grep -Fq 'Where=/var/lib/chillspwn/workspaces/engagements' "$engagement_mount" \
  || ! grep -Fq "$workspace_requires" "$ROOT/deployment/systemd/chillspwn.service" \
  || ! grep -Fq "$workspace_requires" "$ROOT/deployment/systemd/hermes-gateway.service"; then
  echo "Hardened workspace bind-mount contract is missing" >&2
  fail=1
fi

if ! grep -Fq '"provider": "xai-grok"' "$ROOT/chillspwn/runtime/personas/chillspwn/persona.json" \
  || ! grep -Fq 'HARD NO-HANDS BOUNDARY' "$ROOT/chillspwn/runtime/personas/chillspwn/persona.json" \
  || ! grep -Fq '"name": "ChillsPwn Continuous Learning"' "$ROOT/hermes/runtime/cron-jobs.json"; then
  echo "Restored Grok commander persona or continuous-learning schedule is missing" >&2
  fail=1
fi

if ! grep -Fq -- '--chown=root:root' "$ROOT/scripts/restore.sh" \
  || ! grep -Fq 'validate_service_account' "$ROOT/scripts/restore.sh" \
  || ! grep -Fq '"$UV_BIN" sync' "$ROOT/scripts/restore.sh" \
  || ! grep -Fq -- '--locked --extra all' "$ROOT/scripts/restore.sh" \
  || ! grep -Fq 'normalize_readonly_tree "$NEW_VENV"' "$ROOT/scripts/restore.sh" \
  || ! grep -Fq '"$NEW_VENV/bin/python" -c' "$ROOT/scripts/restore.sh"; then
  echo "Restore ownership, service-account, or locked dependency guard is missing" >&2
  fail=1
fi

if ! grep -Fq 'User=chillspwn' "$ROOT/deployment/systemd/hermes-gateway.service" \
  || ! grep -Fq 'hermes-gateway.service' "$ROOT/scripts/restore.sh"; then
  echo "Hermes gateway/cron recovery service contract is missing" >&2
  fail=1
fi

if ! grep -Fq 'kanban_db.init_db(db_path=db_path)' "$board_bootstrap" \
  || ! grep -Fq 'rollback_crud_smoke(conn)' "$board_bootstrap" \
  || ! grep -Fq 'conn.execute("BEGIN IMMEDIATE")' "$board_bootstrap" \
  || ! grep -Fq 'conn.execute("ROLLBACK")' "$board_bootstrap" \
  || ! grep -Fq 'runuser -u chillspwn -- /usr/bin/env' "$ROOT/scripts/restore.sh" \
  || ! grep -Fq '"$HERMES_PYTHON" "$BOARD_BOOTSTRAP" --db "$KANBAN_DB"' "$ROOT/scripts/restore.sh" \
  || ! grep -Fq 'if (( INSTALL_DEPS == 1 || ENABLE_SERVICE == 1 || FORCE == 1 )); then' "$ROOT/scripts/restore.sh" \
  || ! grep -Fq 'install -d -o root -g chillspwn -m 1770 "$HERMES_HOME"' "$ROOT/scripts/restore.sh" \
  || ! grep -Fq '"$HERMES_HOME/state"' "$ROOT/scripts/restore.sh" \
  || ! grep -Fq '"$HERMES_HOME/logs"' "$ROOT/scripts/restore.sh" \
  || ! grep -Fq '"$CHILLSPWN_RUNTIME/runtime"' "$ROOT/scripts/restore.sh" \
  || ! grep -Fq '"$HERMES_HOME/runtime.env.example"' "$ROOT/scripts/restore.sh" \
  || ! grep -Fq 'Environment=HERMES_HOME=/var/lib/chillspwn/hermes' "$ROOT/deployment/systemd/chillspwn.service" \
  || ! grep -Fq 'Environment=HERMES_HOME=/var/lib/chillspwn/hermes' "$ROOT/deployment/systemd/hermes-gateway.service" \
  || ! grep -Fq 'Environment=HERMES_PYTHON=/opt/chillspwn-runtime/hermes-venv/bin/python' "$ROOT/deployment/systemd/chillspwn.service" \
  || ! grep -Fq 'ExecStart=/opt/chillspwn-runtime/hermes-venv/bin/python' "$ROOT/deployment/systemd/hermes-gateway.service" \
  || ! grep -Fq 'Environment=CHILLSPWN_PLUGIN_DIR=/opt/chillspwn/plugin' "$ROOT/deployment/systemd/chillspwn.service" \
  || ! grep -Fq 'Environment=CHILLSPWN_STATE_DIR=/var/lib/chillspwn/state' "$ROOT/deployment/systemd/chillspwn.service" \
  || ! grep -Fq 'Environment=CHILLSPWN_SESSIONS_DIR=/var/lib/chillspwn/state/sessions' "$ROOT/deployment/systemd/chillspwn.service" \
  || ! grep -Fq 'Environment=CHILLSPWN_PERSONAS_DIR=/opt/chillspwn/plugin/webapp/server/agents/personas' "$ROOT/deployment/systemd/chillspwn.service" \
  || ! grep -Fq 'WorkingDirectory=/opt/chillspwn/plugin/webapp' "$ROOT/deployment/systemd/chillspwn.service" \
  || ! grep -Fq 'process.env.CHILLSPWN_PLUGIN_DIR' "$server_index" \
  || [[ $(grep -Fc 'spawn(HERMES_PYTHON' "$server_index") -lt 2 ]] \
  || ! grep -Fq 'missingAdditive' "$server_index" \
  || ! grep -Fq 'missingBoard' "$server_index"; then
  echo "Clean-host database/bootstrap or hardened runtime-path guard is missing" >&2
  fail=1
fi

if ! grep -Fq 'capture_and_quiesce_services' "$ROOT/scripts/restore.sh" \
  || ! grep -Fq 'service-state.tsv' "$ROOT/scripts/restore.sh" \
  || ! grep -Fq 'backup_kanban_database' "$ROOT/scripts/restore.sh" \
  || ! grep -Fq ".backup '\$db_backup'" "$ROOT/scripts/restore.sh" \
  || ! grep -Fq 'sha256sum kanban.db' "$ROOT/scripts/restore.sh" \
  || ! grep -Fq 'RESTORE_VALIDATED=1' "$ROOT/scripts/restore.sh" \
  || ! grep -Fq 'activate_services_after_validation' "$ROOT/scripts/restore.sh"; then
  echo "Forced-restore quiesce, consistent database backup, or state restoration guard is missing" >&2
  fail=1
fi

if ! grep -Fq 'refuse_nonforce_collisions' "$ROOT/scripts/restore.sh" \
  || ! grep -Fq 'preflight_destination_types' "$ROOT/scripts/restore.sh" \
  || ! grep -Fq 'forced restore requires --install-deps' "$ROOT/scripts/restore.sh" \
  || ! grep -Fq 'find -P "$tree" -type d' "$ROOT/scripts/restore.sh" \
  || grep -Fq 'chmod -R u=rwX,go=rX' "$ROOT/scripts/restore.sh" \
  || ! grep -Fq 'PLUGIN_DIR=/opt/chillspwn/plugin' "$ROOT/scripts/restore.sh" \
  || ! grep -Fq 'CHILLSPWN_RUNTIME="$HERMES_HOME/chillspwn"' "$ROOT/scripts/restore.sh" \
  || grep -Fq '/root/.claude' "$ROOT/scripts/restore.sh" \
  || grep -Fq '/root/.claude' "$ROOT/deployment/systemd/chillspwn.service" \
  || grep -Fq '/root/.claude' "$ROOT/deployment/systemd/hermes-gateway.service"; then
  echo "Restore collision, symlink-safe mode, or isolated state-path boundary is missing" >&2
  fail=1
fi

if ! grep -Fq 'EnvironmentFile=-/etc/chillspwn/chillspwn.env' "$ROOT/deployment/systemd/chillspwn.service" \
  || ! grep -Fq 'EnvironmentFile=-/etc/chillspwn/chillspwn.env' "$ROOT/deployment/systemd/hermes-gateway.service" \
  || ! grep -Fq 'EnvironmentFile=-/etc/hermes-gateway.env' "$ROOT/deployment/systemd/hermes-gateway.service" \
  || ! grep -Fq 'User=chillspwn' "$ROOT/deployment/systemd/chillspwn.service" \
  || ! grep -Fq 'Group=chillspwn' "$ROOT/deployment/systemd/chillspwn.service" \
  || ! grep -Fq 'SupplementaryGroups=' "$ROOT/deployment/systemd/hermes-gateway.service" \
  || grep -Fq 'join(HERMES_HOME, ".env")' "$server_index" \
  || grep -Fq 'readFileSync("/root/.hermes/.env"' "$server_index" \
  || ! grep -Fq 'return process.env.OPENROUTER_API_KEY || "";' "$server_index" \
  || ! grep -Fq 'except PermissionError:' "$ROOT/hermes/source/hermes_cli/env_loader.py"; then
  echo "Root-only systemd environment injection or service identity guard is missing" >&2
  fail=1
fi

config_validator="$ROOT/scripts/validate-hermes-config.py"
if ! grep -Fq 'literal credential value is prohibited' "$config_validator" \
  || ! grep -Fq 'UniqueKeyLoader' "$config_validator" \
  || ! grep -Fq '/opt/chillspwn-runtime/hermes-venv/bin/python' "$ROOT/chillspwn/plugin/webapp/docs/configuration.md" \
  || ! grep -Fq '/var/lib/chillspwn/hermes/config.yaml' "$ROOT/chillspwn/plugin/webapp/docs/configuration.md"; then
  echo "Hermes config literal-secret validation guard is missing" >&2
  fail=1
fi

council_dir="$ROOT/hermes/runtime/skills/red-teaming/council-of-ais/scripts"
council_summon="$council_dir/council_summon.py"
council_conversation="$council_dir/council_conversation.py"
council_lane_agent="$council_dir/council_lane_agent.py"
if ! grep -Fq 'def build_lane_environment(member, source_env=None, file_env=None):' "$council_summon" \
  || ! grep -Fq 'env=build_lane_environment(member),' "$council_summon" \
  || ! grep -Fq 'env=build_lane_environment(member), start_new_session=True,' "$council_conversation" \
  || ! grep -Fq 'def load_key(name):' "$council_lane_agent" \
  || ! grep -Fq 'return os.environ.get(name, "").strip()' "$council_lane_agent" \
  || grep -Fq '.hermes/.env' "$council_lane_agent" \
  || grep -REq 'env[[:space:]]*=[[:space:]]*\{[[:space:]]*\*\*os\.environ' "$council_dir" \
  || ! grep -Fq '# COUNCIL_CODEX_HERMES_HOME=/var/lib/chillspwn/hermes/profiles/council-codex' "$ROOT/hermes/runtime/runtime.env.example" \
  || ! grep -Fq '# COUNCIL_XAI_HERMES_HOME=/var/lib/chillspwn/hermes/profiles/council-xai' "$ROOT/hermes/runtime/runtime.env.example"; then
  echo "Council provider-specific child environment boundary is missing" >&2
  fail=1
fi

memory_repository="$ROOT/chillspwn/plugin/webapp/server/memory/MemoryRepository.ts"
memory_policy="$ROOT/chillspwn/plugin/webapp/server/memory/MemoryControlPolicy.ts"
memory_migration="$ROOT/chillspwn/plugin/webapp/server/db/migrations/002_memory_learning.ts"
if ! grep -Fq 'Environment=COMMAND_OS_DB_PATH=/var/lib/chillspwn/command-os-v2.sqlite' "$ROOT/deployment/systemd/chillspwn.service" \
  || ! grep -Fq 'Environment=CHILLSPWN_VAULT_ROOT=/var/lib/chillspwn/brain-vaults' "$ROOT/deployment/systemd/chillspwn.service" \
  || grep -Fq 'chillspwn-memory.service' "$ROOT/deployment/systemd/chillspwn.service" \
  || grep -Fq 'chillspwn-memory.service' "$ROOT/deployment/systemd/hermes-gateway.service" \
  || grep -Fq 'CHILLSPWN_MEMORY_SOCKET' "$ROOT/hermes/runtime/runtime.env.example" \
  || [[ ! -f "$memory_repository" || ! -f "$memory_policy" || ! -f "$memory_migration" ]] \
  || ! grep -Fq 'Do not install them on the hardened V2.1 host.' "$ROOT/deployment/legacy/README.md"; then
  echo "Canonical Second Brain database/vault or legacy-broker isolation guard is missing" >&2
  fail=1
fi

mcp_registry="$ROOT/chillspwn/plugin/webapp/server/mcp/McpServerRegistry.ts"
mcp_setup="$ROOT/chillspwn/plugin/webapp/scripts/setup-mcp-arsenal.sh"
if ! grep -Fq 'assertTrustedDirectoryChain' "$mcp_registry" \
  || ! grep -Fq 'configured command is missing or not a trusted executable' "$mcp_registry" \
  || ! grep -Fq 'configured working directory is missing or not root-controlled' "$mcp_registry" \
  || ! grep -Fq 'MCP_ARSENAL_DIR=/opt/chillspwn-mcp-arsenal' "$ROOT/scripts/restore.sh" \
  || ! grep -Fq 'setfacl -Rb -k "$MCP_ARSENAL_DIR"' "$ROOT/scripts/restore.sh" \
  || ! grep -Fq 'chown -hR root:root "$MCP_ARSENAL_DIR"' "$ROOT/scripts/restore.sh" \
  || ! grep -Fq 'normalize_readonly_tree "$PLUGIN_DIR"' "$ROOT/scripts/restore.sh" \
  || ! grep -Fq 'smoke_mcp_arsenal_registry' "$ROOT/scripts/restore.sh" \
  || ! grep -Fq 'Environment=MCP_ARSENAL_ALLOW_DOCKER=false' "$ROOT/deployment/systemd/chillspwn.service" \
  || ! grep -Fq 'Refusing mutable MCP arsenal setup as a non-root user' "$mcp_setup" \
  || grep -Fq 'sudo chown $USER' "$mcp_setup"; then
  echo "MCP arsenal immutable config/manifest/cwd/executable boundary is missing" >&2
  fail=1
fi

skill_smoke="$ROOT/scripts/smoke-skills.py"
if ! grep -Fq 'skill_manage("create"' "$skill_smoke" \
  || ! grep -Fq 'skill_manage("delete"' "$skill_smoke" \
  || ! grep -Fq 'skill_usage.mark_agent_created' "$skill_smoke" \
  || ! grep -Fq 'restore_regular_file(usage_path, usage_before)' "$skill_smoke" \
  || ! grep -Fq 'install -d -o root -g chillspwn -m 1770 "$HERMES_HOME/skills"' "$ROOT/scripts/restore.sh" \
  || ! grep -Fq 'smoke_learned_skills' "$ROOT/scripts/restore.sh" \
  || grep -Fq 'rsync -a --delete --chown=root:root "$ROOT/hermes/runtime/skills/' "$ROOT/scripts/restore.sh"; then
  echo "Mutable learned-skill preservation or disposable sidecar CRUD guard is missing" >&2
  fail=1
fi

if (( fail != 0 )); then
  exit 1
fi

echo "Snapshot structure, hardened service paths, root-only secret injection, canonical memory, and Grok OAuth/Expert/delegation guards verified."
