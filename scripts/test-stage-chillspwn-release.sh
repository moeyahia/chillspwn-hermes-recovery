#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
STAGER="$ROOT/scripts/stage-chillspwn-release.sh"
TEST_ROOT="$(mktemp -d /tmp/chillspwn-release-stage-test.XXXXXX)"

cleanup() {
  rm -rf --one-file-system -- "$TEST_ROOT"
}
trap cleanup EXIT INT TERM

chmod 0700 "$TEST_ROOT"
mkdir -m 0700 "$TEST_ROOT/dry-run-parent"

"$STAGER" --destination "$TEST_ROOT/dry-run-parent/plugin" --dry-run >/dev/null
[[ ! -e "$TEST_ROOT/dry-run-parent/plugin" ]]

"$STAGER" --destination "$TEST_ROOT/plugin" >/dev/null
[[ -f "$TEST_ROOT/plugin/webapp/package.json" ]]
[[ -f "$TEST_ROOT/plugin/webapp/public/Logo.svg" ]]
[[ -f "$TEST_ROOT/plugin/agents/chillspwn.md" && ! -L "$TEST_ROOT/plugin/agents/chillspwn.md" ]]
[[ -d "$TEST_ROOT/plugin/skills/council-of-ais" && ! -L "$TEST_ROOT/plugin/skills/council-of-ais" ]]
cmp -s "$TEST_ROOT/plugin/agents/chillspwn.md" "$ROOT/hermes/runtime/SOUL.md"
cmp -s \
  "$TEST_ROOT/plugin/skills/council-of-ais/SKILL.md" \
  "$ROOT/hermes/runtime/skills/red-teaming/council-of-ais/SKILL.md"

[[ ! -e "$TEST_ROOT/plugin/webapp/node_modules" ]]
[[ ! -e "$TEST_ROOT/plugin/webapp/dist" ]]
[[ ! -e "$TEST_ROOT/plugin/webapp/playwright-report" ]]
[[ ! -e "$TEST_ROOT/plugin/webapp/test-results" ]]
if find "$TEST_ROOT/plugin" \( -name '__pycache__' -o -name '*.pyc' -o -name '*.mcp' -o -name '*.bak*' \) -print -quit | grep -q .; then
  echo "isolated stage retained excluded runtime/cache material" >&2
  exit 1
fi

"$STAGER" --destination "$TEST_ROOT/plugin" --verify-only >/dev/null

touch "$TEST_ROOT/plugin/auth.json"
chmod 0600 "$TEST_ROOT/plugin/auth.json"
if "$STAGER" --destination "$TEST_ROOT/plugin" --verify-only >/dev/null 2>&1; then
  echo "verify-only accepted an unsafe auth filename" >&2
  exit 1
fi
rm -f "$TEST_ROOT/plugin/auth.json"

chmod g+w "$TEST_ROOT/plugin/webapp/package.json"
if "$STAGER" --destination "$TEST_ROOT/plugin" --verify-only >/dev/null 2>&1; then
  echo "verify-only accepted group-writable output" >&2
  exit 1
fi
chmod g-w "$TEST_ROOT/plugin/webapp/package.json"

ln -s /etc/hosts "$TEST_ROOT/plugin/external-target"
if "$STAGER" --destination "$TEST_ROOT/plugin" --verify-only >/dev/null 2>&1; then
  echo "verify-only accepted an external symlink" >&2
  exit 1
fi
rm -f "$TEST_ROOT/plugin/external-target"

mkdir -p "$TEST_ROOT/plugin/webapp/node_modules/example/dist"
touch "$TEST_ROOT/plugin/webapp/node_modules/example/dist/tsconfig.tsbuildinfo"
"$STAGER" --destination "$TEST_ROOT/plugin" --verify-only >/dev/null

touch "$TEST_ROOT/plugin/webapp/tsconfig.tsbuildinfo"
if "$STAGER" --destination "$TEST_ROOT/plugin" --verify-only >/dev/null 2>&1; then
  echo "verify-only accepted application-generated TypeScript build metadata" >&2
  exit 1
fi
rm -f "$TEST_ROOT/plugin/webapp/tsconfig.tsbuildinfo"

cp "$TEST_ROOT/plugin/webapp/package.json" "$TEST_ROOT/plugin/webapp/public/Logo.svg"
if "$STAGER" --destination "$TEST_ROOT/plugin" --verify-only >/dev/null 2>&1; then
  echo "verify-only accepted a changed logo" >&2
  exit 1
fi
cp "$ROOT/chillspwn/plugin/webapp/public/Logo.svg" "$TEST_ROOT/plugin/webapp/public/Logo.svg"
chmod 0644 "$TEST_ROOT/plugin/webapp/public/Logo.svg"

"$STAGER" --destination "$TEST_ROOT/plugin" --verify-only >/dev/null
printf 'isolated release staging test passed\n'
