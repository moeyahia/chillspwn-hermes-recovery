#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fail=0

snapshot_paths() {
  if git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git -C "$ROOT" ls-files -z
  else
    find "$ROOT" -type f -printf '%P\0'
  fi
}

required=(
  "chillspwn/plugin/.claude-plugin/plugin.json"
  "chillspwn/plugin/webapp/package.json"
  "chillspwn/plugin/webapp/server/index.ts"
  "chillspwn/plugin/webapp/src/pages/ChatPage.tsx"
  "chillspwn/plugin/webapp/android/app/src/main/AndroidManifest.xml"
  "chillspwn/runtime/personas/chillspwn/persona.json"
  "chillspwn/report-template/generate_report.py"
  "hermes/source/pyproject.toml"
  "hermes/source/acp_adapter/entry.py"
  "hermes/runtime/SOUL.md"
  "deployment/systemd/chillspwn.service"
)

for path in "${required[@]}"; do
  if [[ ! -e "$ROOT/$path" ]]; then
    echo "missing required path: $path" >&2
    fail=1
  fi
done

forbidden_name_regex='(^|/)(\.env($|\.)|auth\.json|state\.db|kanban\.db|active_sessions\.json|conversation\.mcp|client-logs\.jsonl|llm_raw\.jsonl)($|\.)|\.(ccache|pfx|p12|jks|keystore)$'
while IFS= read -r -d '' rel; do
  if [[ "$rel" =~ $forbidden_name_regex ]]; then
    echo "forbidden recovery filename: $rel" >&2
    fail=1
  fi
done < <(snapshot_paths)

while IFS= read -r -d '' rel; do
  if [[ -f "$ROOT/$rel" ]] && (( $(stat -c '%s' "$ROOT/$rel") > 50 * 1024 * 1024 )); then
    echo "file exceeds 50 MiB: $rel" >&2
    fail=1
  fi
done < <(snapshot_paths)

if ! grep -Eq 'spawn\("grok", \["-m", model, "--reasoning-effort", "high", "agent", "stdio"\]' "$ROOT/chillspwn/plugin/webapp/server/index.ts"; then
  echo "Grok ACP Expert/high planning path not found" >&2
  fail=1
fi

if ! grep -Eq 'spawn\("grok", \["-m", persona\.model \|\| "grok-4\.5", "--reasoning-effort", "high", "agent", "stdio"\]' "$ROOT/chillspwn/plugin/webapp/server/index.ts"; then
  echo "Grok ACP Expert/high session path not found" >&2
  fail=1
fi

if ! grep -Eq 'delete env\.XAI_API_KEY' "$ROOT/chillspwn/plugin/webapp/server/index.ts"; then
  echo "Grok API-key removal guard not found" >&2
  fail=1
fi

if (( fail != 0 )); then
  exit 1
fi

echo "Snapshot structure and Grok OAuth/Expert guards verified."
