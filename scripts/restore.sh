#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_DEPS=0
ENABLE_SERVICE=0
FORCE=0

usage() {
  cat <<'EOF'
Usage: sudo ./scripts/restore.sh [options]

Options:
  --install-deps    create the Hermes venv and install Bun dependencies
  --enable-service  install, enable, and start all three recovery services
  --force           back up, then exactly replace source-owned installation trees
  -h, --help        show this help
EOF
}

while (($#)); do
  case "$1" in
    --install-deps) INSTALL_DEPS=1 ;;
    --enable-service) ENABLE_SERVICE=1 ;;
    --force) FORCE=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

if (( EUID != 0 )); then
  echo "restore must run as root" >&2
  exit 1
fi

"$ROOT/scripts/verify-snapshot.sh"

PLUGIN_DIR=/opt/chillspwn/plugin
HERMES_HOME=/root/.hermes
CHILLSPWN_RUNTIME="$HERMES_HOME/chillspwn"
GROK_LEGACY_HOME=/root/.grok
GROK_RUNTIME_HOME="$CHILLSPWN_RUNTIME/grok"
GROK_AUTH_DIR="$HERMES_HOME/auth/grok"
GROK_AUTH_PATH="$GROK_AUTH_DIR/auth.json"
GROK_BIN=/opt/chillspwn/bin/grok
GROK_SOURCE_BIN=""
GROK_SOURCE_SHA256=""
HERMES_SOURCE=/opt/chillspwn/hermes-agent
HERMES_VENV=/root/hermes-venv
HERMES_PYTHON="$HERMES_VENV/bin/python"
KANBAN_DB="$HERMES_HOME/kanban.db"
BOARD_BOOTSTRAP=/opt/chillspwn/libexec/bootstrap-board.py
SKILL_SMOKE=/opt/chillspwn/libexec/smoke-skills.py
MEMORY_BROKER=/opt/chillspwn/libexec/chillspwn-memory-broker
HERMES_CONFIG_VALIDATOR=/opt/chillspwn/libexec/validate-hermes-config.py
MEMORY_SOCKET=/run/chillspwn-memory/broker.sock
MCP_ARSENAL_DIR=/opt/chillspwn-mcp-arsenal
MCP_ARSENAL_CONFIG="$MCP_ARSENAL_DIR/.mcp.arsenal.json"
MCP_ARSENAL_RUNTIME="$CHILLSPWN_RUNTIME/mcp-runtime"
MCP_ARSENAL_MANIFEST="$PLUGIN_DIR/webapp/server/agents/mcpArsenal.manifest.json"
REPORT_TEMPLATE=/root/report-template
HTB_ROOT=/root/htb
HTB_ENGAGEMENT_ROOT=/root/htb/boxes
ENGAGEMENT_ROOT=/root/engagements
BACKUP_ROOT=""
EXPECTED_UV_VERSION=0.11.15
EXPECTED_BUN_VERSION=1.3.14
UV_BIN=""
BUN_BIN=""
SERVICE_UNITS=(chillspwn-memory.service chillspwn.service hermes-gateway.service)
SERVICE_LOAD_STATES=()
SERVICE_ACTIVE_STATES=()
SERVICE_ENABLED_STATES=()
PRIOR_RUNNING_UNITS=()
SERVICES_QUIESCED=0
SERVICES_CAPTURED=0
RESTORE_VALIDATED=0

restore_exit_report() {
  local status=$?
  trap - EXIT
  if (( status != 0 && SERVICES_QUIESCED == 1 )); then
    echo "Recovery failed after systemd writers were quiesced; services remain stopped." >&2
    if [[ -n "$BACKUP_ROOT" ]]; then
      echo "Review the rollback files and service-state.tsv under: $BACKUP_ROOT" >&2
    else
      echo "The stop failed before a rollback directory could be created." >&2
    fi
  fi
  exit "$status"
}
trap restore_exit_report EXIT

validate_service_account() {
  local passwd uid gid home shell primary groups uid_min
  passwd="$(getent passwd chillspwn || true)"
  [[ -n "$passwd" ]] || return 0
  IFS=: read -r _ _ uid gid _ home shell <<<"$passwd"
  primary="$(getent group "$gid" | cut -d: -f1)"
  groups="$(id -nG chillspwn)"
  uid_min="$(awk '$1 == "UID_MIN" { print $2; exit }' /etc/login.defs 2>/dev/null || true)"
  uid_min="${uid_min:-1000}"
  if (( uid >= uid_min )) || [[ "$primary" != "chillspwn" ]] \
      || [[ "$groups" != "chillspwn" ]] || [[ "$home" != "/nonexistent" ]] \
      || [[ "$shell" != "/usr/sbin/nologin" && "$shell" != "/sbin/nologin" ]]; then
    cat >&2 <<EOF
Refusing unsafe existing chillspwn service account.
Expected: system UID, primary/only group chillspwn, home /nonexistent, nologin shell.
Observed: uid=$uid primary=$primary groups=$groups home=$home shell=$shell
Remove privileged supplementary groups and correct the account explicitly before restoring.
EOF
    exit 1
  fi
}

preflight_dependency_tools() {
  local uv_version
  command -v runuser >/dev/null 2>&1 \
    || { echo "runuser is required to validate the service identity" >&2; exit 1; }
  command -v setfacl >/dev/null 2>&1 \
    || { echo "setfacl is required for exact service-path traversal" >&2; exit 1; }
  (( INSTALL_DEPS == 1 )) || return 0

  command -v python3 >/dev/null 2>&1 || { echo "python3 is required" >&2; exit 1; }
  python3 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' \
    || { echo "Python >=3.11 is required" >&2; exit 1; }
  UV_BIN="$(command -v uv || true)"
  [[ -n "$UV_BIN" ]] || { echo "uv $EXPECTED_UV_VERSION is required" >&2; exit 1; }
  uv_version="$($UV_BIN --version)"
  [[ "$uv_version" == "uv $EXPECTED_UV_VERSION" || "$uv_version" == "uv $EXPECTED_UV_VERSION "* ]] \
    || { echo "uv $EXPECTED_UV_VERSION is required; found: $uv_version" >&2; exit 1; }

  BUN_BIN="$(command -v bun || true)"
  if [[ -z "$BUN_BIN" && -x /root/.bun/bin/bun ]]; then
    BUN_BIN=/root/.bun/bin/bun
  fi
  [[ -n "$BUN_BIN" ]] \
    || { echo "Bun $EXPECTED_BUN_VERSION is required" >&2; exit 1; }
  [[ "$($BUN_BIN --version)" == "$EXPECTED_BUN_VERSION" ]] \
    || { echo "Bun $EXPECTED_BUN_VERSION is required; found: $($BUN_BIN --version)" >&2; exit 1; }
}

validate_trusted_grok_binary() {
  local binary="$1"
  local path owner mode links mode_value

  [[ "$binary" == /* && -f "$binary" && ! -L "$binary" && -x "$binary" ]] \
    || { echo "Grok executable must be an absolute, regular, non-symlink file: $binary" >&2; exit 1; }
  owner="$(stat -c '%u:%g' "$binary")"
  mode="$(stat -c '%a' "$binary")"
  links="$(stat -c '%h' "$binary")"
  mode_value=$((8#$mode))
  [[ "$owner" == "0:0" && "$links" == "1" ]] && (( (mode_value & 0022) == 0 )) \
    || { echo "Grok executable is not root-controlled: $binary" >&2; exit 1; }

  for path in /opt /opt/chillspwn /opt/chillspwn/bin; do
    [[ -d "$path" && ! -L "$path" ]] \
      || { echo "Grok executable parent is unsafe: $path" >&2; exit 1; }
    owner="$(stat -c '%u:%g' "$path")"
    mode="$(stat -c '%a' "$path")"
    mode_value=$((8#$mode))
    [[ "$owner" == "0:0" ]] && (( (mode_value & 0022) == 0 )) \
      || { echo "Grok executable parent is not root-controlled: $path" >&2; exit 1; }
  done
}

preflight_grok_binary() {
  local candidate owner mode links mode_value

  if [[ -e "$GROK_BIN" || -L "$GROK_BIN" ]]; then
    validate_trusted_grok_binary "$GROK_BIN"
    return 0
  fi
  candidate="$(command -v grok || true)"
  [[ -n "$candidate" ]] \
    || { echo "Grok CLI is required before recovery; install it first" >&2; exit 1; }
  candidate="$(readlink -f -- "$candidate")"
  [[ -f "$candidate" && ! -L "$candidate" && -x "$candidate" ]] \
    || { echo "installed Grok CLI does not resolve to a regular executable" >&2; exit 1; }
  owner="$(stat -c '%u:%g' "$candidate")"
  mode="$(stat -c '%a' "$candidate")"
  links="$(stat -c '%h' "$candidate")"
  mode_value=$((8#$mode))
  [[ "$owner" == "0:0" && "$links" == "1" ]] && (( (mode_value & 0022) == 0 )) \
    || { echo "installed Grok CLI source is not root-controlled" >&2; exit 1; }
  GROK_SOURCE_BIN="$candidate"
  GROK_SOURCE_SHA256="$(sha256sum "$candidate" | awk '{print $1}')"
}

preflight_grok_oauth_state() {
  local path

  for path in "$HERMES_HOME" "$CHILLSPWN_RUNTIME" "$HERMES_HOME/auth" "$GROK_AUTH_DIR"; do
    if [[ -L "$path" || ( -e "$path" && ! -d "$path" ) ]]; then
      echo "Grok OAuth parent has an unsafe type: $path" >&2
      exit 1
    fi
  done
  if [[ -e "$GROK_AUTH_PATH" || -L "$GROK_AUTH_PATH" ]]; then
    [[ -f "$GROK_AUTH_PATH" && ! -L "$GROK_AUTH_PATH" ]] \
      || { echo "Grok OAuth path must be a regular non-symlink file: $GROK_AUTH_PATH" >&2; exit 1; }
  fi
  if [[ ! -e "$GROK_AUTH_PATH" && ! -L "$GROK_AUTH_PATH" \
      && ( -e "$GROK_LEGACY_HOME/auth.json" || -L "$GROK_LEGACY_HOME/auth.json" ) ]]; then
    [[ -d "$GROK_LEGACY_HOME" && ! -L "$GROK_LEGACY_HOME" \
        && -f "$GROK_LEGACY_HOME/auth.json" && ! -L "$GROK_LEGACY_HOME/auth.json" ]] \
      || { echo "legacy Grok OAuth state has an unsafe type" >&2; exit 1; }
  fi
}

preflight_memory_boundary() {
  local memories="$HERMES_HOME/memories"

  if [[ -L "$memories" || ( -e "$memories" && ! -d "$memories" ) ]]; then
    echo "reusable memory root has an unsafe type: $memories" >&2
    exit 1
  fi
  if [[ -d "$memories" ]] \
      && find -P "$memories" -mindepth 1 ! -type d ! -type f -print -quit | grep -q .; then
    echo "reusable memory tree contains a symlink or special file" >&2
    exit 1
  fi
  if [[ -d "$memories" ]] \
      && find -P "$memories" -type f -links +1 -print -quit | grep -q .; then
    echo "reusable memory tree contains a multiply-linked file" >&2
    exit 1
  fi
}

preflight_mcp_arsenal_boundary() {
  local path

  for path in "$MCP_ARSENAL_DIR" "$MCP_ARSENAL_CONFIG"; do
    if [[ -L "$path" ]]; then
      echo "MCP arsenal trust path must not be a symlink: $path" >&2
      exit 1
    fi
  done
  if [[ -e "$MCP_ARSENAL_DIR" && ! -d "$MCP_ARSENAL_DIR" ]]; then
    echo "MCP arsenal root is not a directory: $MCP_ARSENAL_DIR" >&2
    exit 1
  fi
  if [[ -e "$MCP_ARSENAL_CONFIG" && ! -f "$MCP_ARSENAL_CONFIG" ]]; then
    echo "MCP arsenal config is not a regular file: $MCP_ARSENAL_CONFIG" >&2
    exit 1
  fi
}

install_trusted_grok_binary() {
  local staged="${GROK_BIN}.new-$$"

  install -d -o root -g root -m 0755 /opt/chillspwn/bin
  if [[ ! -e "$GROK_BIN" && ! -L "$GROK_BIN" ]]; then
    [[ -n "$GROK_SOURCE_BIN" ]] \
      || { echo "no reviewed Grok CLI source was selected during preflight" >&2; exit 1; }
    [[ "$(sha256sum "$GROK_SOURCE_BIN" | awk '{print $1}')" == "$GROK_SOURCE_SHA256" ]] \
      || { echo "installed Grok CLI changed after preflight" >&2; exit 1; }
    install -o root -g root -m 0755 "$GROK_SOURCE_BIN" "$staged"
    mv -f -- "$staged" "$GROK_BIN"
  fi
  validate_trusted_grok_binary "$GROK_BIN"
  runuser -u chillspwn -- /usr/bin/test -x "$GROK_BIN" \
    || { echo "chillspwn cannot execute the trusted Grok CLI" >&2; exit 1; }
  if runuser -u chillspwn -- /usr/bin/test -w "$GROK_BIN" \
      || runuser -u chillspwn -- /usr/bin/test -w "$(dirname "$GROK_BIN")"; then
    echo "chillspwn can modify the trusted Grok executable boundary" >&2
    exit 1
  fi
}

install_grok_oauth_state() {
  local legacy_auth="$GROK_LEGACY_HOME/auth.json"
  local links

  install -d -o chillspwn -g chillspwn -m 0700 "$GROK_RUNTIME_HOME" "$GROK_AUTH_DIR"
  setfacl -b -k "$GROK_RUNTIME_HOME" "$GROK_AUTH_DIR"
  chown chillspwn:chillspwn "$GROK_RUNTIME_HOME" "$GROK_AUTH_DIR"
  chmod 0700 "$GROK_RUNTIME_HOME" "$GROK_AUTH_DIR"

  if [[ ! -e "$GROK_AUTH_PATH" && ! -L "$GROK_AUTH_PATH" && -f "$legacy_auth" ]]; then
    install -o chillspwn -g chillspwn -m 0600 "$legacy_auth" "$GROK_AUTH_PATH"
  fi
  if [[ -e "$GROK_AUTH_PATH" || -L "$GROK_AUTH_PATH" ]]; then
    [[ -f "$GROK_AUTH_PATH" && ! -L "$GROK_AUTH_PATH" ]] \
      || { echo "Grok OAuth path must be a regular non-symlink file: $GROK_AUTH_PATH" >&2; exit 1; }
    links="$(stat -c '%h' "$GROK_AUTH_PATH")"
    [[ "$links" == "1" ]] \
      || { echo "refusing multiply-linked Grok OAuth state" >&2; exit 1; }
    setfacl -b "$GROK_AUTH_PATH"
    chown chillspwn:chillspwn "$GROK_AUTH_PATH"
    chmod 0600 "$GROK_AUTH_PATH"
  fi

  runuser -u chillspwn -- /usr/bin/test -r "$GROK_AUTH_DIR" \
    || { echo "chillspwn cannot read its private Grok OAuth directory" >&2; exit 1; }
  runuser -u chillspwn -- /usr/bin/test -w "$GROK_AUTH_DIR" \
    || { echo "chillspwn cannot refresh its private Grok OAuth directory" >&2; exit 1; }
  if [[ -f "$GROK_AUTH_PATH" ]]; then
    runuser -u chillspwn -- /usr/bin/test -r "$GROK_AUTH_PATH" \
      || { echo "chillspwn cannot read its Grok OAuth file" >&2; exit 1; }
    runuser -u chillspwn -- /usr/bin/test -w "$GROK_AUTH_PATH" \
      || { echo "chillspwn cannot refresh its Grok OAuth file" >&2; exit 1; }
  fi

  # The installer-owned legacy tree may still contain its original download,
  # but it is no longer a service runtime or executable lookup location.
  if [[ -d "$GROK_LEGACY_HOME" && ! -L "$GROK_LEGACY_HOME" ]]; then
    setfacl -b -k "$GROK_LEGACY_HOME"
    chown root:root "$GROK_LEGACY_HOME"
    chmod 0700 "$GROK_LEGACY_HOME"
  fi
}

validate_memory_boundary() {
  local memories="$HERMES_HOME/memories"
  local mem_cli="$HERMES_HOME/skills/red-teaming/council-of-ais/scripts/chillspwn_mem.py"
  local owner mode links path

  owner="$(stat -c '%U:%G' "$memories")"
  mode="$(stat -c '%a' "$memories")"
  [[ "$owner" == "root:root" && "$mode" == "700" ]] \
    || { echo "unsafe reusable memory root: owner=$owner mode=$mode" >&2; exit 1; }
  if runuser -u chillspwn -- /usr/bin/test -r "$memories" \
      || runuser -u chillspwn -- /usr/bin/test -w "$memories" \
      || runuser -u chillspwn -- /usr/bin/test -x "$memories"; then
    echo "chillspwn can bypass the broker and directly access reusable memory" >&2
    exit 1
  fi
  while IFS= read -r -d '' path; do
    owner="$(stat -c '%U:%G' "$path")"
    mode="$(stat -c '%a' "$path")"
    links="$(stat -c '%h' "$path")"
    [[ "$owner" == "root:root" && "$mode" == "600" && "$links" == "1" ]] \
      || { echo "unsafe reusable memory file: $path owner=$owner mode=$mode links=$links" >&2; exit 1; }
  done < <(find -P "$memories" -type f -print0)
  for path in "$memories/MEMORY.md" "$memories/USER.md"; do
    if [[ -e "$path" ]] \
        && { runuser -u chillspwn -- /usr/bin/test -r "$path" \
          || runuser -u chillspwn -- /usr/bin/test -w "$path"; }; then
      echo "chillspwn can directly access protected reusable memory: $path" >&2
      exit 1
    fi
  done
  for path in "$MEMORY_BROKER" "$mem_cli"; do
    [[ -f "$path" && ! -L "$path" && -x "$path" ]] \
      || { echo "memory boundary executable is unsafe or missing: $path" >&2; exit 1; }
    owner="$(stat -c '%U:%G' "$path")"
    mode="$(stat -c '%a' "$path")"
    [[ "$owner" == "root:root" && "$mode" == "755" ]] \
      || { echo "memory boundary executable is not immutable: $path" >&2; exit 1; }
    if runuser -u chillspwn -- /usr/bin/test -w "$path"; then
      echo "chillspwn can modify memory boundary executable: $path" >&2
      exit 1
    fi
  done
}

harden_mcp_arsenal_boundary() {
  local path owner mode mode_value

  install -d -o chillspwn -g chillspwn -m 0750 "$MCP_ARSENAL_RUNTIME"

  # The deployed application and manifest remain reviewed, immutable inputs
  # even when this host has no optional third-party MCP arsenal installed.
  for path in "$PLUGIN_DIR" "$MCP_ARSENAL_MANIFEST"; do
    [[ -e "$path" && ! -L "$path" ]] \
      || { echo "MCP trust path is missing or unsafe: $path" >&2; exit 1; }
    owner="$(stat -c '%u:%g' "$path")"
    mode="$(stat -c '%a' "$path")"
    mode_value=$((8#$mode))
    [[ "$owner" == "0:0" ]] && (( (mode_value & 0022) == 0 )) \
      || { echo "MCP trust path is not root-controlled: $path" >&2; exit 1; }
    if runuser -u chillspwn -- /usr/bin/test -w "$path"; then
      echo "chillspwn can modify MCP trust path: $path" >&2
      exit 1
    fi
  done
  if runuser -u chillspwn -- /usr/bin/find -P "$PLUGIN_DIR" \
      \( -type d -o -type f \) -writable -print -quit | grep -q .; then
    echo "chillspwn can modify the reviewed plugin/MCP manifest tree" >&2
    exit 1
  fi

  [[ -d "$MCP_ARSENAL_DIR" ]] || return 0
  setfacl -Rb -k "$MCP_ARSENAL_DIR"
  chown -hR root:root "$MCP_ARSENAL_DIR"
  normalize_readonly_tree "$MCP_ARSENAL_DIR"
  if [[ -f "$MCP_ARSENAL_CONFIG" ]]; then
    chmod 0644 "$MCP_ARSENAL_CONFIG"
    python3 -c 'import json,sys; data=json.load(open(sys.argv[1], encoding="utf-8")); assert isinstance(data.get("mcpServers", {}), dict)' "$MCP_ARSENAL_CONFIG" \
      || { echo "MCP arsenal config is not valid JSON with an mcpServers object" >&2; exit 1; }
  fi

  for path in "$MCP_ARSENAL_DIR"; do
    [[ -e "$path" && ! -L "$path" ]] \
      || { echo "MCP trust path is missing or unsafe: $path" >&2; exit 1; }
    owner="$(stat -c '%u:%g' "$path")"
    mode="$(stat -c '%a' "$path")"
    mode_value=$((8#$mode))
    [[ "$owner" == "0:0" ]] && (( (mode_value & 0022) == 0 )) \
      || { echo "MCP trust path is not root-controlled: $path" >&2; exit 1; }
    if runuser -u chillspwn -- /usr/bin/test -w "$path"; then
      echo "chillspwn can modify MCP trust path: $path" >&2
      exit 1
    fi
  done
  for path in "$MCP_ARSENAL_DIR"; do
    if runuser -u chillspwn -- /usr/bin/find -P "$path" \
        \( -type d -o -type f \) -writable -print -quit | grep -q .; then
      echo "chillspwn can modify a reviewed MCP code/config tree: $path" >&2
      exit 1
    fi
  done
  if [[ -f "$MCP_ARSENAL_CONFIG" ]]; then
    owner="$(stat -c '%u:%g' "$MCP_ARSENAL_CONFIG")"
    mode="$(stat -c '%a' "$MCP_ARSENAL_CONFIG")"
    [[ "$owner" == "0:0" && "$mode" == "644" ]] \
      || { echo "MCP arsenal config is not immutable" >&2; exit 1; }
    if runuser -u chillspwn -- /usr/bin/test -w "$MCP_ARSENAL_CONFIG"; then
      echo "chillspwn can modify the MCP arsenal config" >&2
      exit 1
    fi
  fi
  runuser -u chillspwn -- /usr/bin/test -w "$MCP_ARSENAL_RUNTIME" \
    || { echo "chillspwn cannot write the isolated MCP runtime state" >&2; exit 1; }
}

smoke_mcp_arsenal_registry() {
  [[ -f "$MCP_ARSENAL_CONFIG" ]] || return 0
  [[ -x /root/.bun/bin/bun ]] \
    || { echo "Bun is required to validate the installed MCP arsenal registry" >&2; exit 1; }
  (cd "$PLUGIN_DIR/webapp" && runuser -u chillspwn -- /usr/bin/env \
    HOME=/root \
    CHILLSPWN_PLUGIN_DIR="$PLUGIN_DIR" \
    MCP_ARSENAL_CONFIG="$MCP_ARSENAL_CONFIG" \
    MCP_ARSENAL_MANIFEST="$MCP_ARSENAL_MANIFEST" \
    /root/.bun/bin/bun -e \
      'import { McpServerRegistry } from "./server/mcp/McpServerRegistry.ts"; const r = new McpServerRegistry(process.env.MCP_ARSENAL_CONFIG!, process.env.MCP_ARSENAL_MANIFEST!); if (r.getLoadError() || r.list().some((s) => s.enabled && s.startError)) process.exit(1);') \
    || { echo "MCP arsenal config, manifest, cwd, or executable trust validation failed" >&2; exit 1; }
}

backup_path() {
  local source="$1"
  local relative="$2"
  if [[ -d "$source" && ! -L "$source" ]]; then
    install -d -m 0700 "$BACKUP_ROOT/$relative"
    rsync -a "$source/" "$BACKUP_ROOT/$relative/"
  elif [[ -e "$source" || -L "$source" ]]; then
    install -d -m 0700 "$(dirname "$BACKUP_ROOT/$relative")"
    cp -a -- "$source" "$BACKUP_ROOT/$relative"
  fi
}

normalize_readonly_tree() {
  local tree="$1"
  find -P "$tree" -type d -exec chmod 0755 {} +
  find -P "$tree" -type f -perm /111 -exec chmod 0755 {} +
  find -P "$tree" -type f ! -perm /111 -exec chmod 0644 {} +
}

harden_environment_file() {
  local path="$1"
  local owner mode links

  [[ -e "$path" || -L "$path" ]] || return 0
  [[ -f "$path" && ! -L "$path" ]] \
    || { echo "refusing unsafe environment file: $path" >&2; exit 1; }
  links="$(stat -c '%h' "$path")"
  [[ "$links" == "1" ]] \
    || { echo "refusing multiply-linked environment file: $path" >&2; exit 1; }
  setfacl -b -- "$path"
  chown root:root "$path"
  chmod 0600 "$path"
  owner="$(stat -c '%u:%g' "$path")"
  mode="$(stat -c '%a' "$path")"
  [[ "$owner" == "0:0" && "$mode" == "600" ]] \
    || { echo "environment file is not root-only: $path" >&2; exit 1; }
  if runuser -u chillspwn -- /usr/bin/test -r "$path" \
      || runuser -u chillspwn -- /usr/bin/test -w "$path"; then
    echo "chillspwn can directly access protected environment file: $path" >&2
    exit 1
  fi
}

validate_hermes_config() {
  [[ -f "$HERMES_HOME/config.yaml" ]] || return 0
  [[ -x "$HERMES_PYTHON" ]] \
    || { echo "Hermes venv is required to validate the retained config.yaml" >&2; exit 1; }
  "$HERMES_PYTHON" "$HERMES_CONFIG_VALIDATOR" "$HERMES_HOME/config.yaml"
}

preflight_destination_types() {
  local path

  for path in \
    /opt \
    /opt/chillspwn \
    /opt/chillspwn/bin \
    /opt/chillspwn/libexec \
    "$PLUGIN_DIR" \
    "$HERMES_SOURCE" \
    "$HERMES_VENV" \
    "$CHILLSPWN_RUNTIME" \
    "$HERMES_HOME" \
    "$HERMES_HOME/skills" \
    "$HERMES_HOME/memories" \
    "$HTB_ROOT" \
    "$HTB_ENGAGEMENT_ROOT" \
    "$ENGAGEMENT_ROOT" \
    "$REPORT_TEMPLATE" \
    "$MCP_ARSENAL_DIR"; do
    if [[ -L "$path" || ( -e "$path" && ! -d "$path" ) ]]; then
      echo "recovery destination directory has an unsafe type: $path" >&2
      exit 1
    fi
  done
  for path in \
    "$PLUGIN_DIR/webapp/.env" \
    "$HERMES_HOME/.env" \
    "$HERMES_HOME/config.yaml" \
    "$BOARD_BOOTSTRAP" \
    "$SKILL_SMOKE" \
    "$MEMORY_BROKER" \
    "$HERMES_CONFIG_VALIDATOR" \
    "$KANBAN_DB" \
    "$GROK_AUTH_PATH" \
    "$MCP_ARSENAL_CONFIG"; do
    if [[ -L "$path" || ( -e "$path" && ! -f "$path" ) ]]; then
      echo "recovery destination file has an unsafe type: $path" >&2
      exit 1
    fi
    if [[ -f "$path" && "$(stat -c '%h' "$path")" != "1" ]]; then
      echo "recovery destination file is multiply linked: $path" >&2
      exit 1
    fi
  done
  if (( ENABLE_SERVICE == 1 || FORCE == 1 )); then
    for path in \
      /etc/systemd/system/chillspwn.service \
      /etc/systemd/system/hermes-gateway.service \
      /etc/systemd/system/chillspwn-memory.service \
      /etc/systemd/system/chillspwn.service.d/warm.conf; do
      if [[ -L "$path" || ( -e "$path" && ! -f "$path" ) ]]; then
        echo "systemd recovery destination has an unsafe type: $path" >&2
        exit 1
      fi
      if [[ -f "$path" && "$(stat -c '%h' "$path")" != "1" ]]; then
        echo "systemd recovery destination is multiply linked: $path" >&2
        exit 1
      fi
    done
  fi
}

refuse_nonforce_collisions() {
  local destination source_skill skill_name
  (( FORCE == 0 )) || return 0

  for destination in \
    "$PLUGIN_DIR" \
    "$HERMES_SOURCE" \
    "$CHILLSPWN_RUNTIME/personas" \
    "$REPORT_TEMPLATE" \
    "$HERMES_HOME/scripts"; do
    if [[ -L "$destination" || ( -e "$destination" && ! -d "$destination" ) ]]; then
      echo "destructive destination has an unsafe type: $destination" >&2
      exit 1
    fi
    if [[ -d "$destination" ]] \
        && find "$destination" -mindepth 1 -print -quit | grep -q .; then
      echo "destructive destination is not empty: $destination (use --force after review)" >&2
      exit 1
    fi
  done

  for destination in \
    "$CHILLSPWN_RUNTIME/skill-config.json" \
    "$HERMES_HOME/SOUL.md" \
    "$HERMES_HOME/cron/jobs.json" \
    "$HERMES_HOME/runtime.env.example" \
    "$BOARD_BOOTSTRAP" \
    "$SKILL_SMOKE" \
    "$MEMORY_BROKER" \
    "$HERMES_CONFIG_VALIDATOR"; do
    if [[ -e "$destination" || -L "$destination" ]]; then
      echo "destructive destination already exists: $destination (use --force after review)" >&2
      exit 1
    fi
  done

  if [[ -L "$HERMES_HOME/skills" ]]; then
    echo "refusing symlinked Hermes skills root: $HERMES_HOME/skills" >&2
    exit 1
  fi
  while IFS= read -r -d '' source_skill; do
    skill_name="${source_skill##*/}"
    destination="$HERMES_HOME/skills/$skill_name"
    if [[ -e "$destination" || -L "$destination" ]]; then
      echo "reviewed skill destination already exists: $destination (use --force after review)" >&2
      exit 1
    fi
  done < <(find "$ROOT/hermes/runtime/skills" -mindepth 1 -maxdepth 1 -print0)

  if (( INSTALL_DEPS == 1 )) && [[ -e "$HERMES_VENV" || -L "$HERMES_VENV" ]]; then
    echo "Hermes venv already exists: $HERMES_VENV (use --force after review)" >&2
    exit 1
  fi
  if (( ENABLE_SERVICE == 1 )); then
    for destination in \
      /etc/systemd/system/chillspwn.service \
      /etc/systemd/system/hermes-gateway.service \
      /etc/systemd/system/chillspwn-memory.service \
      /etc/systemd/system/chillspwn.service.d/warm.conf; do
      if [[ -e "$destination" || -L "$destination" ]]; then
        echo "systemd destination already exists: $destination (use --force after review)" >&2
        exit 1
      fi
    done
  fi
}

capture_and_quiesce_services() {
  local -a units_to_stop=()
  local unit load_state active_state enabled_state

  command -v systemctl >/dev/null 2>&1 \
    || { echo "systemctl is required to check active application writers" >&2; exit 1; }
  SERVICE_LOAD_STATES=()
  SERVICE_ACTIVE_STATES=()
  SERVICE_ENABLED_STATES=()
  PRIOR_RUNNING_UNITS=()

  # Capture every state in memory before stopping either writer or mutating disk.
  for unit in "${SERVICE_UNITS[@]}"; do
    load_state="$(systemctl show --property=LoadState --value "$unit" 2>/dev/null)" \
      || { echo "unable to query systemd unit: $unit" >&2; exit 1; }
    [[ -n "$load_state" ]] || { echo "empty systemd load state for: $unit" >&2; exit 1; }
    active_state="$(systemctl is-active "$unit" 2>/dev/null || true)"
    enabled_state="$(systemctl is-enabled "$unit" 2>/dev/null || true)"
    active_state="${active_state:-unknown}"
    enabled_state="${enabled_state:-unknown}"
    SERVICE_LOAD_STATES+=("$load_state")
    SERVICE_ACTIVE_STATES+=("$active_state")
    SERVICE_ENABLED_STATES+=("$enabled_state")
    case "$active_state" in
      active|activating|reloading)
        PRIOR_RUNNING_UNITS+=("$unit")
        units_to_stop+=("$unit")
        ;;
      deactivating) units_to_stop+=("$unit") ;;
    esac
  done
  SERVICES_CAPTURED=1

  if (( ${#units_to_stop[@]} > 0 )); then
    SERVICES_QUIESCED=1
    systemctl stop "${units_to_stop[@]}"
  fi
  for unit in "${SERVICE_UNITS[@]}"; do
    active_state="$(systemctl is-active "$unit" 2>/dev/null || true)"
    case "$active_state" in
      active|activating|reloading|deactivating)
        echo "systemd writer did not quiesce: $unit ($active_state)" >&2
        exit 1
        ;;
    esac
  done
}

ensure_backup_root() {
  if [[ -z "$BACKUP_ROOT" ]]; then
    BACKUP_ROOT="/root/chillspwn-restore-backups/$(date -u +%Y%m%dT%H%M%SZ)-$$"
  fi
  install -d -o root -g root -m 0700 "$BACKUP_ROOT"
}

write_service_state_manifest() {
  local state_file="$BACKUP_ROOT/service-state.tsv"
  local index

  (( SERVICES_CAPTURED == 1 )) \
    || { echo "service state was not captured before mutation" >&2; exit 1; }
  install -o root -g root -m 0600 /dev/null "$state_file"
  printf 'unit\tload_state\tactive_state\tenabled_state\n' >>"$state_file"
  for index in "${!SERVICE_UNITS[@]}"; do
    printf '%s\t%s\t%s\t%s\n' \
      "${SERVICE_UNITS[$index]}" \
      "${SERVICE_LOAD_STATES[$index]}" \
      "${SERVICE_ACTIVE_STATES[$index]}" \
      "${SERVICE_ENABLED_STATES[$index]}" >>"$state_file"
  done
}

backup_kanban_database() {
  local state_backup_dir="$BACKUP_ROOT/operational-state"
  local db_backup="$state_backup_dir/kanban.db"
  local quick_check links

  [[ -e "$KANBAN_DB" || -L "$KANBAN_DB" ]] || return 0
  [[ ! -L "$KANBAN_DB" && -f "$KANBAN_DB" ]] \
    || { echo "refusing unsafe Mission Board database during backup: $KANBAN_DB" >&2; exit 1; }
  links="$(stat -c '%h' "$KANBAN_DB")"
  [[ "$links" == "1" ]] \
    || { echo "refusing multiply-linked Mission Board database during backup: $KANBAN_DB" >&2; exit 1; }
  command -v sqlite3 >/dev/null 2>&1 \
    || { echo "sqlite3 is required to back up the existing Mission Board" >&2; exit 1; }

  install -d -o root -g root -m 0700 "$state_backup_dir"
  (umask 077; sqlite3 "$KANBAN_DB" ".timeout 30000" ".backup '$db_backup'")
  chmod 0600 "$db_backup"
  quick_check="$(sqlite3 "$db_backup" 'PRAGMA quick_check;')"
  [[ "$quick_check" == "ok" ]] \
    || { echo "Mission Board backup failed SQLite quick_check" >&2; exit 1; }
  (cd "$state_backup_dir" && sha256sum kanban.db >kanban.db.sha256)
  chmod 0600 "$state_backup_dir/kanban.db.sha256"
  printf 'Mission Board online backup validated: %s\n' "$db_backup"
}

activate_services_after_validation() {
  local -a targets=()
  local unit

  (( RESTORE_VALIDATED == 1 )) \
    || { echo "refusing to start services before recovery validation" >&2; exit 1; }
  if (( ENABLE_SERVICE == 1 )); then
    targets=("${SERVICE_UNITS[@]}")
  elif (( ${#PRIOR_RUNNING_UNITS[@]} > 0 )); then
    targets=("${PRIOR_RUNNING_UNITS[@]}")
  fi

  if (( ${#targets[@]} == 0 )); then
    SERVICES_QUIESCED=0
    return 0
  fi
  if ! systemctl start "${targets[@]}"; then
    systemctl stop "${targets[@]}" >/dev/null 2>&1 || true
    echo "service restart failed after validation; requested units were stopped again" >&2
    exit 1
  fi
  for unit in "${targets[@]}"; do
    if ! systemctl is-active --quiet "$unit"; then
      systemctl stop "${targets[@]}" >/dev/null 2>&1 || true
      echo "service failed its post-start active check: $unit" >&2
      exit 1
    fi
  done
  SERVICES_QUIESCED=0
}

smoke_learned_skills() {
  local owner mode

  [[ -x "$SKILL_SMOKE" ]] \
    || { echo "learned-skill smoke helper is missing: $SKILL_SMOKE" >&2; exit 1; }
  owner="$(stat -c '%U:%G' "$HERMES_HOME/skills")"
  mode="$(stat -c '%a' "$HERMES_HOME/skills")"
  [[ "$owner" == "root:chillspwn" && "$mode" == "1770" ]] \
    || { echo "unsafe Hermes skills root: owner=$owner mode=$mode" >&2; exit 1; }
  runuser -u chillspwn -- /usr/bin/env \
    HOME=/root \
    HERMES_HOME="$HERMES_HOME" \
    HERMES_PYTHON="$HERMES_PYTHON" \
    PYTHONPATH="$HERMES_SOURCE" \
    PATH="$HERMES_VENV/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
    "$HERMES_PYTHON" "$SKILL_SMOKE"
}

bootstrap_board() {
  local owner mode links writable_path

  command -v runuser >/dev/null 2>&1 \
    || { echo "runuser is required for Mission Board bootstrap" >&2; exit 1; }
  [[ -x "$HERMES_PYTHON" ]] \
    || { echo "pinned Hermes interpreter is missing: $HERMES_PYTHON" >&2; exit 1; }
  [[ -x "$BOARD_BOOTSTRAP" ]] \
    || { echo "Mission Board bootstrap helper is missing: $BOARD_BOOTSTRAP" >&2; exit 1; }
  if [[ -L "$KANBAN_DB" ]]; then
    echo "refusing symlinked Mission Board database: $KANBAN_DB" >&2
    exit 1
  fi
  if [[ -e "$KANBAN_DB" && ! -f "$KANBAN_DB" ]]; then
    echo "Mission Board database is not a regular file: $KANBAN_DB" >&2
    exit 1
  fi
  if [[ -f "$KANBAN_DB" ]]; then
    owner="$(stat -c '%U:%G' "$KANBAN_DB")"
    [[ "$owner" == "chillspwn:chillspwn" ]] \
      || { echo "refusing Mission Board database not owned by chillspwn: $KANBAN_DB" >&2; exit 1; }
    links="$(stat -c '%h' "$KANBAN_DB")"
    [[ "$links" == "1" ]] \
      || { echo "refusing multiply-linked Mission Board database: $KANBAN_DB" >&2; exit 1; }
  fi

  for writable_path in \
    "$HERMES_HOME" \
    "$HERMES_HOME/state" \
    "$HERMES_HOME/logs" \
    "$CHILLSPWN_RUNTIME/logs" \
    "$CHILLSPWN_RUNTIME/runtime" \
    "$CHILLSPWN_RUNTIME/sessions" \
    "$CHILLSPWN_RUNTIME/session-logs" \
    "$CHILLSPWN_RUNTIME/osint-jobs" \
    "$HTB_ENGAGEMENT_ROOT" \
    "$ENGAGEMENT_ROOT" \
    "$MCP_ARSENAL_RUNTIME"; do
    runuser -u chillspwn -- /usr/bin/test -w "$writable_path" \
      || { echo "chillspwn cannot write required runtime state: $writable_path" >&2; exit 1; }
  done
  runuser -u chillspwn -- /usr/bin/test -r "$PLUGIN_DIR/webapp/server/index.ts" \
    || { echo "chillspwn cannot read the reviewed dashboard source" >&2; exit 1; }
  runuser -u chillspwn -- /usr/bin/env \
    HOME=/root \
    HERMES_HOME="$HERMES_HOME" \
    HERMES_KANBAN_DB="$KANBAN_DB" \
    PYTHONPATH="$HERMES_SOURCE" \
    PATH="$HERMES_VENV/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
    HERMES_PYTHON="$HERMES_PYTHON" \
    "$HERMES_PYTHON" "$BOARD_BOOTSTRAP" --db "$KANBAN_DB"

  [[ -f "$KANBAN_DB" && ! -L "$KANBAN_DB" ]] \
    || { echo "Mission Board bootstrap did not create a regular database" >&2; exit 1; }
  owner="$(stat -c '%U:%G' "$KANBAN_DB")"
  mode="$(stat -c '%a' "$KANBAN_DB")"
  links="$(stat -c '%h' "$KANBAN_DB")"
  [[ "$owner" == "chillspwn:chillspwn" && "$mode" == "600" && "$links" == "1" ]] \
    || { echo "unsafe Mission Board ownership/mode/link count: owner=$owner mode=$mode links=$links" >&2; exit 1; }
}

validate_service_account
preflight_destination_types
refuse_nonforce_collisions
if (( FORCE == 1 && INSTALL_DEPS == 0 )); then
  echo "forced restore requires --install-deps so lock/runtime/build compatibility is revalidated" >&2
  exit 1
fi
preflight_dependency_tools
preflight_grok_binary
preflight_grok_oauth_state
preflight_memory_boundary
preflight_mcp_arsenal_boundary
if [[ -e "$KANBAN_DB" || -L "$KANBAN_DB" ]]; then
  command -v sqlite3 >/dev/null 2>&1 \
    || { echo "sqlite3 is required before quiescing an existing Mission Board" >&2; exit 1; }
fi

capture_and_quiesce_services
if (( FORCE == 1 || SERVICES_QUIESCED == 1 )) \
    || [[ -e "$KANBAN_DB" || -L "$KANBAN_DB" ]]; then
  ensure_backup_root
  write_service_state_manifest
fi
if [[ -e "$KANBAN_DB" || -L "$KANBAN_DB" ]]; then
  backup_kanban_database
fi

if (( FORCE == 1 )); then
  backup_path "$PLUGIN_DIR" "chillspwn/plugin"
  backup_path "$CHILLSPWN_RUNTIME/personas" "chillspwn/runtime/personas"
  backup_path "$CHILLSPWN_RUNTIME/skill-config.json" "chillspwn/runtime/skill-config.json"
  backup_path "$HERMES_SOURCE" "hermes/source"
  backup_path "$HERMES_HOME/SOUL.md" "hermes/runtime/SOUL.md"
  backup_path "$HERMES_HOME/skills" "hermes/runtime/skills"
  backup_path "$HERMES_HOME/scripts" "hermes/runtime/scripts"
  backup_path "$HERMES_HOME/cron/jobs.json" "hermes/runtime/cron-jobs.json"
  backup_path "$GROK_AUTH_DIR" "operational-state/grok-auth"
  backup_path "$MCP_ARSENAL_CONFIG" "operational-state/mcp-arsenal.json"
  backup_path "$REPORT_TEMPLATE" "chillspwn/report-template"
  backup_path "/etc/systemd/system/chillspwn.service" "deployment/systemd/chillspwn.service"
  backup_path "/etc/systemd/system/chillspwn.service.d" "deployment/systemd/chillspwn.service.d"
  backup_path "/etc/systemd/system/hermes-gateway.service" "deployment/systemd/hermes-gateway.service"
  backup_path "/etc/systemd/system/chillspwn-memory.service" "deployment/systemd/chillspwn-memory.service"
  echo "existing source-owned trees backed up to: $BACKUP_ROOT"
fi

validate_service_account
if ! id chillspwn >/dev/null 2>&1; then
  getent group chillspwn >/dev/null 2>&1 || groupadd --system chillspwn
  useradd --system --gid chillspwn --home-dir /nonexistent --shell /usr/sbin/nologin chillspwn
fi
validate_service_account
setfacl -m u:chillspwn:--x /root

# Default engagement roots are operational data, not snapshot-owned content.
# Create them on a clean host without deleting existing engagements, then grant
# the unprivileged service account directory-level access through narrow ACLs.
[[ -d "$HTB_ROOT" ]] || install -d -o root -g root -m 0750 "$HTB_ROOT"
[[ -d "$HTB_ENGAGEMENT_ROOT" ]] || install -d -o root -g root -m 0750 "$HTB_ENGAGEMENT_ROOT"
[[ -d "$ENGAGEMENT_ROOT" ]] || install -d -o root -g root -m 0750 "$ENGAGEMENT_ROOT"
setfacl -m u:chillspwn:--x "$HTB_ROOT"
setfacl -m u:chillspwn:rwx,d:u:chillspwn:rwx "$HTB_ENGAGEMENT_ROOT" "$ENGAGEMENT_ROOT"

install -d -o root -g root -m 0755 /opt/chillspwn /opt/chillspwn/bin /opt/chillspwn/libexec "$HERMES_SOURCE" "$PLUGIN_DIR"
install -d -o root -g chillspwn -m 1770 "$CHILLSPWN_RUNTIME"
install -d -m 0755 "$CHILLSPWN_RUNTIME/personas"
install -d -o chillspwn -g chillspwn -m 0750 \
  "$CHILLSPWN_RUNTIME/logs" \
  "$CHILLSPWN_RUNTIME/runtime" \
  "$CHILLSPWN_RUNTIME/sessions" \
  "$CHILLSPWN_RUNTIME/session-logs" \
  "$CHILLSPWN_RUNTIME/osint-jobs"
install -d -o root -g chillspwn -m 1770 "$HERMES_HOME"
if [[ -L "$HERMES_HOME/skills" ]]; then
  echo "refusing symlinked Hermes skills root: $HERMES_HOME/skills" >&2
  exit 1
fi
install -d -o root -g chillspwn -m 1770 "$HERMES_HOME/skills"
install -d -o root -g root -m 0755 "$HERMES_HOME/scripts"
install -d -o chillspwn -g chillspwn -m 0750 "$HERMES_HOME/cron" "$HERMES_HOME/conversations" "$HERMES_HOME/sessions" "$HERMES_HOME/logs" "$HERMES_HOME/council" "$HERMES_HOME/runtime" "$HERMES_HOME/state"
install -d -o root -g root -m 0700 "$HERMES_HOME/memories"
setfacl -Rb -k "$HERMES_HOME/memories"
chown -hR root:root "$HERMES_HOME/memories"
find -P "$HERMES_HOME/memories" -type d -exec chmod 0700 {} +
find -P "$HERMES_HOME/memories" -type f -exec chmod 0600 {} +
install -d -o chillspwn -g chillspwn -m 0700 "$HERMES_HOME/auth" "$HERMES_HOME/auth/claude" "$HERMES_HOME/auth/codex" "$GROK_AUTH_DIR"
install -d -m 0755 "$REPORT_TEMPLATE"
install_trusted_grok_binary
install_grok_oauth_state

rsync -a --delete --chown=root:root "$ROOT/hermes/source/" "$HERMES_SOURCE/"
rm -rf "$PLUGIN_DIR/webapp/android/app/src/main/assets"
rsync -a --delete --chown=root:root \
  --exclude='webapp/node_modules/' \
  --exclude='webapp/dist/' \
  --exclude='webapp/.env' \
  --exclude='webapp/logs/' \
  --exclude='webapp/runtime-data/' \
  --exclude='webapp/server/runtime/.data/' \
  "$ROOT/chillspwn/plugin/" "$PLUGIN_DIR/"
rsync -a --delete --chown=root:root "$ROOT/chillspwn/runtime/personas/" "$CHILLSPWN_RUNTIME/personas/"
install -m 0644 "$ROOT/chillspwn/runtime/skill-config.json" "$CHILLSPWN_RUNTIME/skill-config.json"
rsync -a --delete --chown=root:root "$ROOT/chillspwn/report-template/" "$REPORT_TEMPLATE/"

# Snapshot source modes may reflect a private host umask. Normalize only real
# directories/files; symlinks are retained but never dereferenced by chmod.
normalize_readonly_tree "$HERMES_SOURCE"
normalize_readonly_tree "$CHILLSPWN_RUNTIME/personas"
normalize_readonly_tree "$REPORT_TEMPLATE"
normalize_readonly_tree "$PLUGIN_DIR"

install -o root -g chillspwn -m 0640 "$ROOT/hermes/runtime/SOUL.md" "$HERMES_HOME/SOUL.md"
while IFS= read -r -d '' source_skill; do
  skill_name="${source_skill##*/}"
  destination_skill="$HERMES_HOME/skills/$skill_name"
  if [[ -e "$destination_skill" || -L "$destination_skill" ]]; then
    skill_owner="$(stat -c '%U' "$destination_skill")"
    [[ "$skill_owner" == "root" ]] \
      || { echo "reviewed/learned skill name collision: $skill_name" >&2; exit 1; }
  fi
done < <(find "$ROOT/hermes/runtime/skills" -mindepth 1 -maxdepth 1 -print0)
rsync -a --chown=root:root "$ROOT/hermes/runtime/skills/" "$HERMES_HOME/skills/"
while IFS= read -r -d '' source_skill; do
  skill_name="${source_skill##*/}"
  destination_skill="$HERMES_HOME/skills/$skill_name"
  chown -hR root:root "$destination_skill"
  normalize_readonly_tree "$destination_skill"
done < <(find "$ROOT/hermes/runtime/skills" -mindepth 1 -maxdepth 1 -print0)
install -d -o root -g chillspwn -m 1770 "$HERMES_HOME/skills"
rsync -a --delete --chown=root:root "$ROOT/hermes/runtime/scripts/" "$HERMES_HOME/scripts/"
normalize_readonly_tree "$HERMES_HOME/scripts"
install -o chillspwn -g chillspwn -m 0600 "$ROOT/hermes/runtime/cron-jobs.json" "$HERMES_HOME/cron/jobs.json"
install -o root -g chillspwn -m 0640 "$ROOT/hermes/runtime/runtime.env.example" "$HERMES_HOME/runtime.env.example"
install -o root -g root -m 0755 "$ROOT/scripts/bootstrap-board.py" "$BOARD_BOOTSTRAP"
install -o root -g root -m 0755 "$ROOT/scripts/smoke-skills.py" "$SKILL_SMOKE"
install -o root -g root -m 0755 "$ROOT/scripts/chillspwn-memory-broker.py" "$MEMORY_BROKER"
install -o root -g root -m 0755 "$ROOT/scripts/validate-hermes-config.py" "$HERMES_CONFIG_VALIDATOR"
validate_memory_boundary

chown -hR root:root "$PLUGIN_DIR" "$CHILLSPWN_RUNTIME/personas"
chown chillspwn:chillspwn "$CHILLSPWN_RUNTIME/skill-config.json"
chmod 0600 "$CHILLSPWN_RUNTIME/skill-config.json"
harden_environment_file "$PLUGIN_DIR/webapp/.env"
harden_environment_file "$HERMES_HOME/.env"
if [[ -f "$HERMES_HOME/config.yaml" ]]; then
  chown chillspwn:chillspwn "$HERMES_HOME/config.yaml"
  chmod 0600 "$HERMES_HOME/config.yaml"
fi

if (( INSTALL_DEPS == 1 )); then
  NEW_VENV="${HERMES_VENV}.new-$$"
  rm -rf "$NEW_VENV"
  UV_PROJECT_ENVIRONMENT="$NEW_VENV" "$UV_BIN" sync \
    --locked --extra all --project "$HERMES_SOURCE" --python python3
  normalize_readonly_tree "$NEW_VENV"
  command -v runuser >/dev/null 2>&1 \
    || { echo "runuser is required to validate the staged Hermes venv" >&2; exit 1; }
  runuser -u chillspwn -- /usr/bin/env \
    HOME=/root \
    HERMES_HOME="$HERMES_HOME" \
    HERMES_PYTHON="$NEW_VENV/bin/python" \
    PYTHONPATH="$HERMES_SOURCE" \
    "$NEW_VENV/bin/python" -c \
      'from hermes_cli import kanban_db; assert callable(kanban_db.init_db)'
  if [[ -e "$HERMES_VENV" ]]; then
    mv "$HERMES_VENV" "${HERMES_VENV}.previous-$(date -u +%Y%m%dT%H%M%SZ)"
  fi
  mv "$NEW_VENV" "$HERMES_VENV"
  (cd "$PLUGIN_DIR/webapp" && "$BUN_BIN" install --frozen-lockfile && "$BUN_BIN" run build)
  chown -hR root:root "$PLUGIN_DIR/webapp/node_modules" "$PLUGIN_DIR/webapp/dist"
  normalize_readonly_tree "$PLUGIN_DIR/webapp/node_modules"
  normalize_readonly_tree "$PLUGIN_DIR/webapp/dist"
fi

validate_hermes_config
harden_mcp_arsenal_boundary
smoke_mcp_arsenal_registry

if (( INSTALL_DEPS == 1 || ENABLE_SERVICE == 1 || FORCE == 1 )); then
  bootstrap_board
  smoke_learned_skills
fi

if (( ENABLE_SERVICE == 1 || ${#PRIOR_RUNNING_UNITS[@]} > 0 )); then
  command -v systemctl >/dev/null || { echo "systemctl is required" >&2; exit 1; }
  for executable in /root/.bun/bin/bun "$HERMES_PYTHON" "$GROK_BIN" sqlite3 weasyprint; do
    if [[ "$executable" == /* ]]; then
      [[ -x "$executable" ]] || { echo "required executable is missing: $executable" >&2; exit 1; }
    else
      command -v "$executable" >/dev/null || { echo "required executable is missing: $executable" >&2; exit 1; }
    fi
  done
fi

if (( ENABLE_SERVICE == 1 || FORCE == 1 )); then
  install -m 0644 "$ROOT/deployment/systemd/chillspwn.service" /etc/systemd/system/chillspwn.service
  install -m 0644 "$ROOT/deployment/systemd/hermes-gateway.service" /etc/systemd/system/hermes-gateway.service
  install -m 0644 "$ROOT/deployment/systemd/chillspwn-memory.service" /etc/systemd/system/chillspwn-memory.service
  install -d -m 0755 /etc/systemd/system/chillspwn.service.d
  install -m 0644 "$ROOT/deployment/systemd/chillspwn.service.d-warm.conf" /etc/systemd/system/chillspwn.service.d/warm.conf
  systemctl daemon-reload
fi
if (( ENABLE_SERVICE == 1 )); then
  systemctl enable "${SERVICE_UNITS[@]}"
fi

RESTORE_VALIDATED=1
if (( FORCE == 1 || ENABLE_SERVICE == 1 || SERVICES_QUIESCED == 1 )); then
  activate_services_after_validation
fi

cat <<'EOF'
Recovery files restored.

Remaining manual steps:
  1. Recreate /root/.hermes/.env from an encrypted credential source.
  2. Configure Hermes providers and tools.
  3. Re-authenticate Claude, Codex, Grok, and MCP integrations.
  4. Restore databases/history only from a consistent encrypted state backup.
  5. Enable the service when validation is complete.
EOF
