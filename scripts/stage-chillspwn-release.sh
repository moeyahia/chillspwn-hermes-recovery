#!/usr/bin/env bash

set -euo pipefail

umask 027

EXPECTED_LOGO_SHA256="0a3dfd69f74a00d41bb0cb20d6af1097dffa265d4c1e54c9228fe4b55f85c955"
DEFAULT_MAX_FILE_BYTES=$((50 * 1024 * 1024))

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(realpath -e "$SCRIPT_DIR/..")"
PLUGIN_SOURCE="$REPO_ROOT/chillspwn/plugin"
REVIEWED_RUNTIME="$REPO_ROOT/hermes/runtime"

declare -Ar REVIEWED_LINK_TARGETS=(
  ["chillspwn/plugin/agents/chillspwn.md"]="hermes/runtime/SOUL.md"
  ["chillspwn/plugin/skills/ad-dc-gmsa-dll-privesc"]="hermes/runtime/skills/red-teaming/attack-chain-playbooks"
  ["chillspwn/plugin/skills/attack-chain-playbooks"]="hermes/runtime/skills/red-teaming/attack-chain-playbooks"
  ["chillspwn/plugin/skills/council-of-ais"]="hermes/runtime/skills/red-teaming/council-of-ais"
  ["chillspwn/plugin/skills/cve-researcher"]="hermes/runtime/skills/red-teaming/cve-researcher"
  ["chillspwn/plugin/skills/dogfood"]="hermes/runtime/skills/dogfood"
  ["chillspwn/plugin/skills/github-vuln-scan"]="hermes/runtime/skills/pentest-engagement-ops"
  ["chillspwn/plugin/skills/godmode"]="hermes/runtime/skills/red-teaming/godmode"
  ["chillspwn/plugin/skills/hashcat-gpu-crack"]="hermes/runtime/skills/red-teaming/hashcat-gpu-crack"
  ["chillspwn/plugin/skills/it-ot-nifi-opcua-privesc"]="hermes/runtime/skills/red-teaming/it-ot-nifi-opcua-privesc"
  ["chillspwn/plugin/skills/kali-arsenal"]="hermes/runtime/skills/red-teaming/kali-arsenal"
  ["chillspwn/plugin/skills/kali-pentest-explainer-lane"]="hermes/runtime/skills/red-teaming/kali-pentest-explainer-lane"
  ["chillspwn/plugin/skills/kali-tool-audit"]="hermes/runtime/skills/pentest-engagement-ops"
  ["chillspwn/plugin/skills/network-attack-surface-mapping"]="hermes/runtime/skills/pentest-engagement-ops"
  ["chillspwn/plugin/skills/pentest-engagement-ops"]="hermes/runtime/skills/pentest-engagement-ops"
  ["chillspwn/plugin/skills/pentest-report-pdf"]="hermes/runtime/skills/pentest-engagement-ops"
  ["chillspwn/plugin/skills/pineapple"]="hermes/runtime/skills/wireless/pineapple"
  ["chillspwn/plugin/skills/pineapple-operations"]="hermes/runtime/skills/wireless/pineapple"
  ["chillspwn/plugin/skills/robin"]="hermes/runtime/skills/robin"
  ["chillspwn/plugin/skills/webapp-container-git-privesc"]="hermes/runtime/skills/red-teaming/attack-chain-playbooks"
  ["chillspwn/plugin/skills/wifi-pineapple-operations"]="hermes/runtime/skills/wireless/pineapple"
  ["chillspwn/plugin/skills/windows-pentest-operations"]="hermes/runtime/skills/red-teaming/windows-pentest-operations"
  ["chillspwn/plugin/skills/yuanbao"]="hermes/runtime/skills/yuanbao"
)

usage() {
  cat <<'EOF'
Usage:
  stage-chillspwn-release.sh --destination ABSOLUTE_PATH [--build] [--dry-run]
  stage-chillspwn-release.sh --destination ABSOLUTE_PATH --verify-only

Options:
  --destination PATH  Required absolute, canonical destination. It must not
                      exist for staging. Its parent must be root-owned and not
                      writable by group or other.
  --build             In the isolated staging tree, install from bun.lock with
                      --frozen-lockfile and build the webapp. This is never
                      implied.
  --dry-run           Validate source, source map, destination parent and logo,
                      but do not create or copy anything.
  --verify-only       Verify an existing root-owned release tree without
                      changing it.
  --help              Show this help.

Environment:
  CHILLSPWN_RELEASE_BUN             Root-controlled Bun binary used by --build.
                                    Default: /opt/chillspwn-runtime/bin/bun
  CHILLSPWN_RELEASE_MAX_FILE_BYTES  Maximum regular-file size. Default: 50 MiB.
EOF
}

die() {
  printf 'release staging refused: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command is unavailable: $1"
}

is_within() {
  local child="$1"
  local parent="$2"
  [[ "$child" == "$parent" || "$child" == "$parent/"* ]]
}

assert_root_controlled_directory() {
  local path="$1"
  local label="$2"
  local mode

  [[ -d "$path" && ! -L "$path" ]] || die "$label must be a real directory: $path"
  [[ "$(stat -c '%u' "$path")" == "0" ]] || die "$label must be owned by root: $path"
  mode="$(stat -c '%a' "$path")"
  (( (8#$mode & 0022) == 0 )) || die "$label must not be writable by group or other: $path"
}

assert_root_controlled_file() {
  local path="$1"
  local label="$2"
  local mode

  [[ -f "$path" && ! -L "$path" ]] || die "$label must be a regular non-symlink file: $path"
  [[ "$(stat -c '%u' "$path")" == "0" ]] || die "$label must be owned by root: $path"
  mode="$(stat -c '%a' "$path")"
  (( (8#$mode & 0022) == 0 )) || die "$label must not be writable by group or other: $path"
}

validate_reviewed_sources() {
  local link rel raw_target expected_rel actual_real expected_real nested untracked bad
  local -A seen_links=()
  local -A checked_targets=()

  assert_root_controlled_directory "$REPO_ROOT" "repository root"
  assert_root_controlled_directory "$PLUGIN_SOURCE" "plugin source"
  assert_root_controlled_directory "$REVIEWED_RUNTIME" "reviewed runtime source"

  # Audit only release-eligible source entries. Dependency/build/cache trees are
  # intentionally regenerated or excluded below and may be owned by the
  # unprivileged build user without weakening the immutable staged release.
  bad="$(find "$PLUGIN_SOURCE" -xdev \
    \( -type d \
       \( -name node_modules -o -name dist -o -name 'dist-*' -o -name build \
          -o -name coverage -o -name htmlcov -o -name playwright-report \
          -o -name test-results -o -name logs -o -name sessions \
          -o -name conversations -o -name shell_snapshots -o -name __pycache__ \
          -o -name .pytest_cache -o -name .cache -o -name .ruff_cache \
          -o -name .mypy_cache -o -name .gradle \) -prune \) \
    -o \( ! -type l \( ! -user root -o -perm /022 \) -print -quit \) \
    2>/dev/null || true)"
  [[ -z "$bad" ]] || die "plugin source is not root-controlled: ${bad#"$REPO_ROOT"/}"

  [[ "$(git -C "$REPO_ROOT" rev-parse --show-toplevel)" == "$REPO_ROOT" ]] \
    || die "script is not running from the reviewed repository root"

  python3 - "$REPO_ROOT" "$PLUGIN_SOURCE" <<'PY'
import os
import sys
from pathlib import Path

repo = Path(sys.argv[1]).resolve(strict=True)
plugin = Path(sys.argv[2]).resolve(strict=True)
excluded = {
    plugin / "webapp" / "node_modules",
    plugin / "webapp" / "dist",
    plugin / "webapp" / "dist-revamp",
    plugin / "webapp" / "playwright-report",
    plugin / "webapp" / "test-results",
}

def contained(path: Path) -> bool:
    try:
        return os.path.commonpath((str(repo), str(path))) == str(repo)
    except ValueError:
        return False

for current, dirnames, filenames in os.walk(plugin, topdown=True, followlinks=False):
    current_path = Path(current)
    # Dependency trees are excluded from the staged source and rebuilt from
    # the lockfile. Apply that rule to every sibling application, not only the
    # original webapp, so package-manager .bin links cannot enter the reviewed
    # application-symlink inventory.
    dirnames[:] = [
        name for name in dirnames
        if name != "node_modules" and current_path / name not in excluded
    ]
    for name in [*dirnames, *filenames]:
        path = current_path / name
        try:
            resolved = path.resolve(strict=True)
        except OSError:
            print(f"release staging refused: source path cannot be resolved: {path.relative_to(repo)}", file=sys.stderr)
            raise SystemExit(1)
        if not contained(resolved):
            print(f"release staging refused: source realpath leaves repository: {path.relative_to(repo)}", file=sys.stderr)
            raise SystemExit(1)
PY

  while IFS= read -r -d '' link; do
    rel="${link#"$REPO_ROOT"/}"
    raw_target="$(readlink -- "$link")"
    [[ "$raw_target" != /* ]] || die "absolute source symlink is forbidden: $rel"
    expected_rel="${REVIEWED_LINK_TARGETS[$rel]:-}"
    [[ -n "$expected_rel" ]] || die "unreviewed source symlink is forbidden: $rel"
    git -C "$REPO_ROOT" ls-files --error-unmatch -- "$rel" >/dev/null 2>&1 \
      || die "source symlink is not tracked: $rel"

    actual_real="$(realpath -e -- "$link")"
    expected_real="$(realpath -e -- "$REPO_ROOT/$expected_rel")"
    [[ "$actual_real" == "$expected_real" ]] \
      || die "source symlink does not match the reviewed source map: $rel"
    is_within "$actual_real" "$REVIEWED_RUNTIME" \
      || die "source symlink leaves the reviewed runtime tree: $rel"
    seen_links["$rel"]=1
  done < <(
    find "$PLUGIN_SOURCE" \
      \( -type d -name node_modules \
         -o -path "$PLUGIN_SOURCE/webapp/node_modules" \
         -o -path "$PLUGIN_SOURCE/webapp/dist" \
         -o -path "$PLUGIN_SOURCE/webapp/dist-revamp" \
         -o -path "$PLUGIN_SOURCE/webapp/playwright-report" \
         -o -path "$PLUGIN_SOURCE/webapp/test-results" \) -prune \
      -o -type l -print0
  )

  for rel in "${!REVIEWED_LINK_TARGETS[@]}"; do
    [[ -n "${seen_links[$rel]:-}" ]] || die "reviewed source-map link is missing: $rel"
    expected_rel="${REVIEWED_LINK_TARGETS[$rel]}"
    [[ -n "${checked_targets[$expected_rel]:-}" ]] && continue
    checked_targets["$expected_rel"]=1
    expected_real="$(realpath -e -- "$REPO_ROOT/$expected_rel")"
    is_within "$expected_real" "$REVIEWED_RUNTIME" \
      || die "reviewed target leaves hermes/runtime: $expected_rel"
    [[ ! -L "$REPO_ROOT/$expected_rel" ]] \
      || die "reviewed target itself must not be a symlink: $expected_rel"

    nested="$(find "$REPO_ROOT/$expected_rel" -type l -print -quit 2>/dev/null || true)"
    [[ -z "$nested" ]] || die "nested symlink is forbidden in reviewed target: ${nested#"$REPO_ROOT"/}"
    bad="$(find "$REPO_ROOT/$expected_rel" -xdev \
      \( ! -user root -o -perm /022 \) -print -quit 2>/dev/null || true)"
    [[ -z "$bad" ]] || die "reviewed target is not root-controlled: ${bad#"$REPO_ROOT"/}"
    bad="$(find "$REPO_ROOT/$expected_rel" -xdev \
      ! -type f ! -type d -print -quit 2>/dev/null || true)"
    [[ -z "$bad" ]] || die "reviewed target contains a special file: ${bad#"$REPO_ROOT"/}"
    untracked="$(git -C "$REPO_ROOT" ls-files --others --exclude-standard -- "$expected_rel" | head -n 1)"
    [[ -z "$untracked" ]] || die "reviewed target contains an untracked file: $untracked"
  done

  [[ "$(sha256sum "$PLUGIN_SOURCE/webapp/public/Logo.svg" | awk '{print $1}')" == "$EXPECTED_LOGO_SHA256" ]] \
    || die "source Logo.svg hash does not match the invariant"
}

normalize_release_modes() {
  local root="$1"

  find "$root" -xdev -type d -exec chmod 0755 {} +
  find "$root" -xdev -type f -perm /111 -exec chmod 0755 {} +
  find "$root" -xdev -type f ! -perm /111 -exec chmod 0644 {} +
}

verify_release_tree() {
  local root="$1"
  local max_bytes="$2"

  python3 - "$root" "$max_bytes" "$EXPECTED_LOGO_SHA256" <<'PY'
import hashlib
import os
import stat
import sys
from pathlib import Path

root = Path(sys.argv[1]).resolve(strict=True)
max_bytes = int(sys.argv[2])
expected_logo = sys.argv[3]
root_device = root.stat().st_dev
errors: list[str] = []
files = 0
total_bytes = 0
symlinks = 0

unsafe_exact = {
    ".env", "auth.json", "active_sessions.json", "state.db", "kanban.db",
    "conversation.mcp", "client-logs.jsonl", "llm_raw.jsonl",
}
unsafe_dirs = {
    "__pycache__", ".pytest_cache", ".cache", ".ruff_cache", ".mypy_cache",
    "coverage", "htmlcov", "playwright-report", "test-results", "logs",
    "sessions", "conversations", "shell_snapshots", ".secrets",
}
unsafe_suffixes = {
    ".db", ".sqlite", ".sqlite3", ".log", ".out", ".jsonl", ".mcp",
    ".pem", ".key", ".p12", ".pfx", ".jks", ".keystore", ".crt",
    ".cer", ".csr", ".keytab", ".kirbi", ".ovpn", ".kdbx", ".pcap",
    ".pcapng", ".pyc", ".tsbuildinfo",
}
archive_suffixes = (".zip", ".tar", ".tar.gz", ".tgz", ".gz", ".7z", ".rar")

def relative(path: Path) -> str:
    try:
        return path.relative_to(root).as_posix() or "."
    except ValueError:
        return "[outside-release]"

def contained(path: Path) -> bool:
    try:
        return os.path.commonpath((str(root), str(path))) == str(root)
    except ValueError:
        return False

for current, dirnames, filenames in os.walk(root, topdown=True, followlinks=False):
    current_path = Path(current)
    entries = [current_path / name for name in [*dirnames, *filenames]]
    for path in entries:
        rel = relative(path)
        parts = Path(rel).parts
        in_vendor = len(parts) >= 3 and parts[:3] == ("webapp", "node_modules", parts[2])
        try:
            info = path.lstat()
        except OSError as exc:
            errors.append(f"cannot stat {rel}: {exc.__class__.__name__}")
            continue

        if info.st_uid != 0 or info.st_gid != 0:
            errors.append(f"non-root ownership: {rel}")
        if not stat.S_ISLNK(info.st_mode) and info.st_mode & 0o022:
            errors.append(f"group/other-writable entry: {rel}")
        if info.st_dev != root_device:
            errors.append(f"entry crosses a filesystem boundary: {rel}")

        if stat.S_ISLNK(info.st_mode):
            symlinks += 1
            try:
                target = path.resolve(strict=True)
            except OSError:
                errors.append(f"broken symlink: {rel}")
                continue
            if not contained(target):
                errors.append(f"symlink leaves release: {rel}")
            continue

        try:
            resolved = path.resolve(strict=True)
        except OSError:
            errors.append(f"cannot resolve {rel}")
            continue
        if not contained(resolved):
            errors.append(f"realpath leaves release: {rel}")

        name = path.name.lower()
        if path.is_dir():
            if name in unsafe_dirs and not in_vendor:
                errors.append(f"unsafe runtime/output directory: {rel}")
            continue
        if not path.is_file():
            errors.append(f"special file is forbidden: {rel}")
            continue

        files += 1
        total_bytes += info.st_size
        if info.st_size > max_bytes:
            errors.append(f"file exceeds size limit: {rel}")

        safe_env_example = name == ".env.example" or (name.startswith(".env.") and name.endswith(".example"))
        if name.startswith(".env") and not safe_env_example:
            errors.append(f"environment file is forbidden: {rel}")
        if name in unsafe_exact:
            errors.append(f"runtime/auth filename is forbidden: {rel}")
        # Some published npm packages legitimately contain TypeScript's
        # incremental-build metadata. It is inert vendor input, but the same
        # suffix remains forbidden everywhere in application/runtime paths.
        vendor_tsbuildinfo = in_vendor and name.endswith(".tsbuildinfo")
        if any(name.endswith(suffix) for suffix in unsafe_suffixes) and not vendor_tsbuildinfo:
            errors.append(f"sensitive/generated filename is forbidden: {rel}")
        if not in_vendor and (
            any(name.endswith(suffix) for suffix in archive_suffixes)
            or ".bak" in name
            or ".pre-phase" in name
            or name.endswith((".orig", "~"))
        ):
            errors.append(f"backup/archive filename is forbidden: {rel}")

logo = root / "webapp" / "public" / "Logo.svg"
if not logo.is_file() or logo.is_symlink():
    errors.append("canonical Logo.svg is missing or is a symlink")
else:
    digest = hashlib.sha256(logo.read_bytes()).hexdigest()
    if digest != expected_logo:
        errors.append("canonical Logo.svg hash mismatch")

if errors:
    for error in errors[:50]:
        print(f"release verification error: {error}", file=sys.stderr)
    if len(errors) > 50:
        print(f"release verification error: {len(errors) - 50} additional errors", file=sys.stderr)
    raise SystemExit(1)

print(f"verified_files={files} verified_bytes={total_bytes} internal_symlinks={symlinks}")
PY
}

DESTINATION=""
DO_BUILD=0
DRY_RUN=0
VERIFY_ONLY=0

while (( $# > 0 )); do
  case "$1" in
    --destination)
      (( $# >= 2 )) || die "--destination requires a value"
      DESTINATION="$2"
      shift 2
      ;;
    --build)
      DO_BUILD=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --verify-only)
      VERIFY_ONLY=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
done

[[ "$EUID" == "0" ]] || die "run as root so the release remains root-owned"
[[ -n "$DESTINATION" ]] || die "--destination is required"
[[ "$DESTINATION" == /* ]] || die "destination must be absolute"
[[ "$DESTINATION" != *$'\n'* ]] || die "destination contains a newline"
(( ! (DO_BUILD && DRY_RUN) )) || die "--build and --dry-run cannot be combined"
(( ! (DO_BUILD && VERIFY_ONLY) )) || die "--build and --verify-only cannot be combined"
(( ! (DRY_RUN && VERIFY_ONLY) )) || die "--dry-run and --verify-only cannot be combined"

MAX_FILE_BYTES="${CHILLSPWN_RELEASE_MAX_FILE_BYTES:-$DEFAULT_MAX_FILE_BYTES}"
[[ "$MAX_FILE_BYTES" =~ ^[1-9][0-9]*$ ]] || die "CHILLSPWN_RELEASE_MAX_FILE_BYTES must be a positive integer"

for command in git realpath stat find sha256sum awk python3; do
  require_command "$command"
done

DESTINATION="${DESTINATION%/}"
DESTINATION_PARENT="$(dirname -- "$DESTINATION")"
DESTINATION_NAME="$(basename -- "$DESTINATION")"
[[ "$DESTINATION_NAME" != "." && "$DESTINATION_NAME" != ".." && -n "$DESTINATION_NAME" ]] \
  || die "destination basename is unsafe"
DESTINATION_PARENT_REAL="$(realpath -e -- "$DESTINATION_PARENT")"
[[ "$DESTINATION" == "$DESTINATION_PARENT_REAL/$DESTINATION_NAME" ]] \
  || die "destination must use a canonical, non-symlink parent path"
assert_root_controlled_directory "$DESTINATION_PARENT_REAL" "destination parent"
is_within "$DESTINATION" "$REPO_ROOT" && die "destination must be outside the source repository"

if (( VERIFY_ONLY )); then
  [[ -d "$DESTINATION" && ! -L "$DESTINATION" ]] || die "verify-only destination must be a real directory"
  [[ "$(realpath -e -- "$DESTINATION")" == "$DESTINATION" ]] || die "verify-only destination is not canonical"
  verify_release_tree "$DESTINATION" "$MAX_FILE_BYTES"
  printf 'release verification passed: %s\n' "$DESTINATION"
  exit 0
fi

[[ ! -e "$DESTINATION" && ! -L "$DESTINATION" ]] || die "destination already exists"
validate_reviewed_sources

if (( DRY_RUN )); then
  printf 'release staging dry-run passed: destination=%s reviewed_links=%d logo_sha256=%s\n' \
    "$DESTINATION" "${#REVIEWED_LINK_TARGETS[@]}" "$EXPECTED_LOGO_SHA256"
  exit 0
fi

require_command rsync
require_command mktemp
require_command mv

STAGING="$(mktemp -d "$DESTINATION_PARENT_REAL/.${DESTINATION_NAME}.staging.XXXXXX")"
cleanup() {
  if [[ -n "${STAGING:-}" && -d "$STAGING" ]]; then
    rm -rf --one-file-system -- "$STAGING"
  fi
}
trap cleanup EXIT INT TERM
chmod 0755 "$STAGING"

RSYNC_EXCLUDES=(
  --include='.env.example'
  --include='.env.*.example'
  --exclude='.env'
  --exclude='.env.*'
  --exclude='node_modules/'
  --exclude='dist/'
  --exclude='dist-*/'
  --exclude='build/'
  --exclude='coverage/'
  --exclude='htmlcov/'
  --exclude='playwright-report/'
  --exclude='test-results/'
  --exclude='logs/'
  --exclude='sessions/'
  --exclude='conversations/'
  --exclude='shell_snapshots/'
  --exclude='__pycache__/'
  --exclude='.pytest_cache/'
  --exclude='.cache/'
  --exclude='.ruff_cache/'
  --exclude='.mypy_cache/'
  --exclude='android/.gradle/'
  --exclude='android/build/'
  --exclude='android/app/build/'
  --exclude='android/app/src/main/assets/'
  --exclude='auth.json*'
  --exclude='active_sessions.json*'
  --exclude='state.db*'
  --exclude='kanban.db*'
  --exclude='conversation.mcp'
  --exclude='*.db'
  --exclude='*.db-wal'
  --exclude='*.db-shm'
  --exclude='*.sqlite*'
  --exclude='*.log'
  --exclude='*.out'
  --exclude='*.jsonl'
  --exclude='*.mcp'
  --exclude='*.pem'
  --exclude='*.key'
  --exclude='*.p12'
  --exclude='*.pfx'
  --exclude='*.jks'
  --exclude='*.keystore'
  --exclude='*.crt'
  --exclude='*.cer'
  --exclude='*.csr'
  --exclude='*.keytab'
  --exclude='*.kirbi'
  --exclude='*.ovpn'
  --exclude='*.kdbx'
  --exclude='*.pcap'
  --exclude='*.pcapng'
  --exclude='*.pyc'
  --exclude='*.tsbuildinfo'
  --exclude='*.bak*'
  --exclude='*.pre-phase*'
  --exclude='*.orig'
  --exclude='*.tmp*'
  --exclude='*~'
  --exclude='*.zip'
  --exclude='*.tar'
  --exclude='*.tar.gz'
  --exclude='*.tgz'
  --exclude='*.gz'
  --exclude='*.7z'
  --exclude='*.rar'
  --exclude='*.sarif'
  --exclude='.gitleaks-report.json'
)

rsync -aL --no-devices --no-specials "${RSYNC_EXCLUDES[@]}" "$PLUGIN_SOURCE/" "$STAGING/"

chown -R root:root "$STAGING"
normalize_release_modes "$STAGING"
verify_release_tree "$STAGING" "$MAX_FILE_BYTES"

if (( DO_BUILD )); then
  BUN_BIN="${CHILLSPWN_RELEASE_BUN:-/opt/chillspwn-runtime/bin/bun}"
  [[ "$BUN_BIN" == /* ]] || die "CHILLSPWN_RELEASE_BUN must be absolute"
  BUN_BIN="$(realpath -e -- "$BUN_BIN")"
  assert_root_controlled_file "$BUN_BIN" "release Bun"
  assert_root_controlled_directory "$(dirname "$BUN_BIN")" "release Bun parent"
  BUILD_HOME="$STAGING/.build-home"
  install -d -o root -g root -m 0700 "$BUILD_HOME"
  (
    cd "$STAGING/webapp"
    env -i HOME="$BUILD_HOME" PATH="$(dirname "$BUN_BIN"):/usr/bin:/bin" CI=1 \
      "$BUN_BIN" install --frozen-lockfile
    env -i HOME="$BUILD_HOME" PATH="$(dirname "$BUN_BIN"):/usr/bin:/bin" CI=1 \
      "$BUN_BIN" run build
  )
  rm -rf --one-file-system -- "$BUILD_HOME"
fi

chown -R root:root "$STAGING"
normalize_release_modes "$STAGING"
verify_release_tree "$STAGING" "$MAX_FILE_BYTES"
mv -- "$STAGING" "$DESTINATION"
STAGING=""
trap - EXIT INT TERM

printf 'release staged successfully: destination=%s build=%s logo_sha256=%s\n' \
  "$DESTINATION" "$([[ "$DO_BUILD" == "1" ]] && printf yes || printf no)" "$EXPECTED_LOGO_SHA256"
