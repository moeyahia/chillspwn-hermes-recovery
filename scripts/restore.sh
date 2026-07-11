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
  --enable-service  install, enable, and restart chillspwn.service
  --force           allow replacement of an existing installation
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

PLUGIN_DIR=/root/.claude/plugins/chillspwn
CHILLSPWN_RUNTIME=/root/.claude/chillspwn
HERMES_HOME=/root/.hermes
HERMES_SOURCE=/opt/chillspwn/hermes-agent
HERMES_VENV=/root/hermes-venv
REPORT_TEMPLATE=/root/report-template

if (( FORCE == 0 )); then
  for destination in "$PLUGIN_DIR" "$HERMES_SOURCE"; do
    if [[ -d "$destination" ]] && find "$destination" -mindepth 1 -print -quit | grep -q .; then
      echo "destination is not empty: $destination (use --force after reviewing it)" >&2
      exit 1
    fi
  done
fi

if ! id chillspwn >/dev/null 2>&1; then
  useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin chillspwn
fi

install -d -m 0755 /opt/chillspwn "$HERMES_SOURCE"
install -d -o chillspwn -g chillspwn -m 0775 /root/.claude /root/.claude/plugins "$PLUGIN_DIR" "$CHILLSPWN_RUNTIME" "$CHILLSPWN_RUNTIME/personas"
install -d -o chillspwn -g chillspwn -m 0700 "$HERMES_HOME"
install -d -o chillspwn -g chillspwn -m 0750 "$HERMES_HOME/skills" "$HERMES_HOME/scripts" "$HERMES_HOME/cron" "$HERMES_HOME/memories" "$HERMES_HOME/conversations" "$HERMES_HOME/sessions" "$HERMES_HOME/logs" "$HERMES_HOME/council"
install -d -m 0755 "$REPORT_TEMPLATE"

rsync -a "$ROOT/hermes/source/" "$HERMES_SOURCE/"
rsync -a "$ROOT/chillspwn/plugin/" "$PLUGIN_DIR/"
rsync -a "$ROOT/chillspwn/runtime/personas/" "$CHILLSPWN_RUNTIME/personas/"
install -m 0644 "$ROOT/chillspwn/runtime/skill-config.json" "$CHILLSPWN_RUNTIME/skill-config.json"
rsync -a "$ROOT/chillspwn/report-template/" "$REPORT_TEMPLATE/"

install -o chillspwn -g chillspwn -m 0600 "$ROOT/hermes/runtime/SOUL.md" "$HERMES_HOME/SOUL.md"
rsync -a --chown=chillspwn:chillspwn "$ROOT/hermes/runtime/skills/" "$HERMES_HOME/skills/"
rsync -a --chown=chillspwn:chillspwn "$ROOT/hermes/runtime/scripts/" "$HERMES_HOME/scripts/"
install -o chillspwn -g chillspwn -m 0600 "$ROOT/hermes/runtime/cron-jobs.json" "$HERMES_HOME/cron/jobs.json"

chown -R chillspwn:chillspwn "$PLUGIN_DIR" "$CHILLSPWN_RUNTIME/personas" "$CHILLSPWN_RUNTIME/skill-config.json"

if command -v setfacl >/dev/null 2>&1; then
  setfacl -m u:chillspwn:--x /root
  if [[ -d /root/.grok ]]; then
    setfacl -R -m u:chillspwn:rX /root/.grok
    setfacl -R -d -m u:chillspwn:rwX /root/.grok
  fi
fi

if (( INSTALL_DEPS == 1 )); then
  command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 1; }
  python3 -m venv "$HERMES_VENV"
  "$HERMES_VENV/bin/python" -m pip install --upgrade pip
  "$HERMES_VENV/bin/pip" install -e "${HERMES_SOURCE}[all]"

  BUN_BIN="$(command -v bun || true)"
  if [[ -z "$BUN_BIN" && -x /root/.bun/bin/bun ]]; then
    BUN_BIN=/root/.bun/bin/bun
  fi
  if [[ -z "$BUN_BIN" ]]; then
    echo "Bun is required; install it, then rerun with --install-deps" >&2
    exit 1
  fi
  (cd "$PLUGIN_DIR/webapp" && "$BUN_BIN" install --frozen-lockfile && "$BUN_BIN" run build)
fi

if (( ENABLE_SERVICE == 1 )); then
  command -v systemctl >/dev/null || { echo "systemctl is required" >&2; exit 1; }
  install -m 0644 "$ROOT/deployment/systemd/chillspwn.service" /etc/systemd/system/chillspwn.service
  install -d -m 0755 /etc/systemd/system/chillspwn.service.d
  install -m 0644 "$ROOT/deployment/systemd/chillspwn.service.d-warm.conf" /etc/systemd/system/chillspwn.service.d/warm.conf
  systemctl daemon-reload
  systemctl enable --now chillspwn.service
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
