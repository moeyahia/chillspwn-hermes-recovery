#!/usr/bin/env bash
set -euo pipefail

# Root-run, V2-only provisioning for the capability-free Nmap copy and the
# ProjectDiscovery httpx wrapper that forces update checks off. Subfinder stays
# intentionally absent. Nothing here changes global binaries or service PATHs.
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
WEBAPP_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd -P)
MANIFEST="$WEBAPP_ROOT/server/mcp/v2-trusted-tools.json"
ACTION=${1:-check}
[[ $# -eq 0 ]] || shift

[[ $# -eq 0 && "$ACTION" =~ ^(check|install|remove)$ ]] || {
  echo "Usage: $0 {check|install|remove}" >&2
  exit 2
}
[[ -f "$MANIFEST" && ! -L "$MANIFEST" ]] || {
  echo "Trusted-tool manifest is missing or not a regular file: $MANIFEST" >&2
  exit 1
}

manifest_field() {
  local section=$1 key=$2
  python3 - "$MANIFEST" "$section" "$key" <<'PY'
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as handle:
    manifest = json.load(handle)
value = manifest if sys.argv[2] == "root" else manifest["tools"][sys.argv[2]]
result = value[sys.argv[3]]
if not isinstance(result, (str, int)) or isinstance(result, bool):
    raise SystemExit("trusted-tool manifest field has the wrong type")
print(result)
PY
}

PATH_BOUNDARY=$(manifest_field root pathBoundary)
INSTALL_ROOT=$(manifest_field root installRoot)
BIN_PATH=$(manifest_field root binPath)
PROVENANCE_PATH=$(manifest_field root provenancePath)

NMAP_SOURCE=$(manifest_field nmap sourcePath)
NMAP_SOURCE_SHA256=$(manifest_field nmap sourceSha256)
NMAP_DESTINATION=$(manifest_field nmap executablePath)
NMAP_SHA256=$(manifest_field nmap sha256)
NMAP_VERSION=$(manifest_field nmap version)
NMAP_MODE=$(manifest_field nmap mode)

HTTPX_SOURCE=$(manifest_field httpx-toolkit sourcePath)
HTTPX_SOURCE_SHA256=$(manifest_field httpx-toolkit sourceSha256)
HTTPX_WRAPPER_ASSET_RELATIVE=$(manifest_field httpx-toolkit wrapperAsset)
HTTPX_WRAPPER_ASSET="$WEBAPP_ROOT/$HTTPX_WRAPPER_ASSET_RELATIVE"
HTTPX_DESTINATION=$(manifest_field httpx-toolkit executablePath)
HTTPX_SHA256=$(manifest_field httpx-toolkit sha256)
HTTPX_VERSION=$(manifest_field httpx-toolkit version)
HTTPX_MODE=$(manifest_field httpx-toolkit mode)

sha256() { sha256sum -- "$1" | awk '{print $1}'; }
fail() { echo "$*" >&2; return 1; }

validate_configuration() {
  python3 - "$MANIFEST" <<'PY'
import json
import sys
with open(sys.argv[1], "r", encoding="utf-8") as handle:
    manifest = json.load(handle)
if set(manifest.get("tools", {})) != {"httpx-toolkit", "nmap"}:
    raise SystemExit("trusted-tool manifest must contain exactly httpx-toolkit and nmap")
httpx = manifest["tools"]["httpx-toolkit"]
if httpx.get("enforcedOptions") != ["-duc"]:
    raise SystemExit("httpx wrapper must enforce exactly -duc")
PY
  [[ "$PATH_BOUNDARY" == "/usr/local/libexec/chillspwn-command-os-v2" ]] \
    || fail "V2 path boundary must be the exact dedicated install root"
  [[ "$INSTALL_ROOT" == "$PATH_BOUNDARY" && "$BIN_PATH" == "$INSTALL_ROOT/bin" ]] \
    || fail "V2 trusted-tool paths are inconsistent"
  [[ "$PROVENANCE_PATH" == "$INSTALL_ROOT/provenance.json" ]] \
    || fail "V2 provenance path is outside the dedicated install root"
  [[ "$NMAP_SOURCE" == "/usr/lib/nmap/nmap" && "$NMAP_DESTINATION" == "$BIN_PATH/nmap" ]] \
    || fail "Nmap source/destination differs from the reviewed contract"
  [[ "$HTTPX_SOURCE" == "/usr/bin/httpx-toolkit" && "$HTTPX_DESTINATION" == "$BIN_PATH/httpx-toolkit" ]] \
    || fail "httpx source/destination differs from the reviewed contract"
  [[ "$HTTPX_WRAPPER_ASSET_RELATIVE" == "server/mcp/trusted-shims/httpx-toolkit" ]] \
    || fail "httpx wrapper asset differs from the reviewed contract"
  [[ "$NMAP_SOURCE_SHA256" =~ ^[a-f0-9]{64}$ && "$NMAP_SHA256" =~ ^[a-f0-9]{64}$ && "$NMAP_MODE" == "0755" ]] \
    || fail "Reviewed Nmap hash or mode is malformed"
  [[ "$HTTPX_SOURCE_SHA256" =~ ^[a-f0-9]{64}$ && "$HTTPX_SHA256" =~ ^[a-f0-9]{64}$ && "$HTTPX_MODE" == "0755" ]] \
    || fail "Reviewed httpx hash or mode is malformed"
}

verify_root_directory() {
  local directory=$1 mode
  [[ -d "$directory" && ! -L "$directory" ]] \
    || fail "Trusted directory is missing, not a directory, or a symlink: $directory"
  [[ $(stat -c '%u:%g' -- "$directory") == "0:0" ]] \
    || fail "Trusted directory is not root:root: $directory"
  mode=$(stat -c '%a' -- "$directory")
  (( (8#$mode & 8#022) == 0 )) \
    || fail "Trusted directory is group/world writable: $directory"
}

verify_root_chain() {
  local current=$1 parent
  while :; do
    verify_root_directory "$current"
    [[ "$current" == "/" ]] && break
    parent=$(dirname -- "$current")
    [[ "$parent" != "$current" ]] || fail "Trusted directory ancestry is invalid: $current"
    current=$parent
  done
}

verify_source() {
  local source=$1 expected_sha256=$2 label=$3 mode
  [[ -f "$source" && ! -L "$source" ]] \
    || fail "$label source is missing, not regular, or a symlink"
  [[ $(stat -c '%u:%g' -- "$source") == "0:0" ]] \
    || fail "$label source is not root:root"
  mode=$(stat -c '%a' -- "$source")
  (( (8#$mode & 8#022) == 0 )) || fail "$label source is group/world writable"
  [[ $(sha256 "$source") == "$expected_sha256" ]] \
    || fail "$label source hash differs from the reviewed manifest"
}

verify_installed_file() {
  local destination=$1 expected_sha256=$2 expected_mode=$3 label=$4
  [[ -f "$destination" && ! -L "$destination" ]] \
    || fail "Trusted $label is missing, not regular, or a symlink"
  [[ $(stat -c '%u:%g:%a' -- "$destination") == "0:0:${expected_mode#0}" ]] \
    || fail "Trusted $label ownership/mode differs from root:root $expected_mode"
  [[ $(sha256 "$destination") == "$expected_sha256" ]] \
    || fail "Trusted $label hash differs from the reviewed manifest"
  command -v getcap >/dev/null 2>&1 || fail "getcap is unavailable"
  [[ -z $(getcap -n -- "$destination") ]] \
    || fail "Trusted $label has file capabilities"
}

verify_nmap_version() {
  local output
  output=$(env -i HOME=/var/empty LANG=C TZ=UTC PATH=/usr/bin:/bin \
    timeout 5 "$NMAP_DESTINATION" --version 2>&1) \
    || fail "Nmap version command failed"
  [[ "$output" == *"Nmap version $NMAP_VERSION "* ]] \
    || fail "Nmap version differs from the reviewed manifest ($NMAP_VERSION)"
}

verify_httpx_version() {
  local output
  output=$(env -i HOME=/var/empty LANG=C TZ=UTC PATH=/usr/bin:/bin \
    timeout 5 "$HTTPX_DESTINATION" -version 2>&1) \
    || fail "httpx version command failed"
  [[ "$output" == "ProjectDiscovery httpx version v$HTTPX_VERSION (Command OS V2 reviewed wrapper)" ]] \
    || fail "httpx version differs from the reviewed manifest ($HTTPX_VERSION)"
}

verify_destinations() {
  verify_installed_file "$NMAP_DESTINATION" "$NMAP_SHA256" "$NMAP_MODE" "Nmap copy"
  verify_installed_file "$HTTPX_DESTINATION" "$HTTPX_SHA256" "$HTTPX_MODE" "httpx wrapper"
  verify_nmap_version
  verify_httpx_version
}

verify_bin_entries() {
  local entries
  entries=$(find "$BIN_PATH" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)
  [[ "$entries" == $'httpx-toolkit\nnmap' ]] \
    || fail "V2 trusted-tool bin contains missing or unexpected entries: ${entries:-empty}"
}

verify_provenance() {
  [[ -f "$PROVENANCE_PATH" && ! -L "$PROVENANCE_PATH" ]] \
    || fail "V2 trusted-tool provenance is missing or not regular"
  [[ $(stat -c '%u:%g:%a' -- "$PROVENANCE_PATH") == "0:0:644" ]] \
    || fail "V2 trusted-tool provenance is not root:root 0644"
  python3 - "$PROVENANCE_PATH" "$MANIFEST" "$INSTALL_ROOT" "$BIN_PATH" <<'PY'
import hashlib
import json
import sys

path, reviewed_path, install_root, bin_path = sys.argv[1:]
with open(path, "r", encoding="utf-8") as handle:
    document = json.load(handle)
with open(reviewed_path, "rb") as handle:
    reviewed_hash = hashlib.sha256(handle.read()).hexdigest()
with open(reviewed_path, "r", encoding="utf-8") as handle:
    manifest = json.load(handle)
if document.get("schemaVersion") != 1:
    raise SystemExit("provenance schema differs")
if document.get("installRoot") != install_root or document.get("binPath") != bin_path:
    raise SystemExit("provenance install path differs")
if document.get("reviewedManifest", {}).get("sha256") != reviewed_hash:
    raise SystemExit("provenance reviewed-manifest hash differs")
if set(document.get("tools", {})) != set(manifest["tools"]):
    raise SystemExit("provenance tool set differs")
for name, definition in manifest["tools"].items():
    item = document["tools"][name]
    expected = {
        "sourcePath": definition["sourcePath"],
        "sourceSha256": definition["sourceSha256"],
        "executablePath": definition["executablePath"],
        "installedSha256": definition["sha256"],
        "version": definition["version"],
        "mode": definition["mode"],
        "uid": 0,
        "gid": 0,
        "capabilities": [],
    }
    if any(item.get(key) != value for key, value in expected.items()):
        raise SystemExit(f"{name} provenance entry differs")
PY
}

write_provenance() {
  local reviewed_hash temp
  reviewed_hash=$(sha256 "$MANIFEST")
  temp=$(mktemp "$INSTALL_ROOT/.provenance.tmp.XXXXXXXX")
  TEMP_PROVENANCE=$temp
  python3 - "$temp" "$MANIFEST" "$reviewed_hash" "$INSTALL_ROOT" "$BIN_PATH" <<'PY'
import datetime
import json
import os
import sys

path, reviewed_path, reviewed_hash, install_root, bin_path = sys.argv[1:]
with open(reviewed_path, "r", encoding="utf-8") as handle:
    manifest = json.load(handle)
tools = {}
for name, definition in manifest["tools"].items():
    tools[name] = {
        "sourcePath": definition["sourcePath"],
        "sourceSha256": definition["sourceSha256"],
        "executablePath": definition["executablePath"],
        "installedSha256": definition["sha256"],
        "version": definition["version"],
        "mode": definition["mode"],
        "uid": 0,
        "gid": 0,
        "capabilities": [],
    }
document = {
    "schemaVersion": 1,
    "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z"),
    "installRoot": install_root,
    "binPath": bin_path,
    "reviewedManifest": {"path": reviewed_path, "sha256": reviewed_hash},
    "tools": tools,
}
with open(path, "w", encoding="utf-8") as handle:
    json.dump(document, handle, indent=2, sort_keys=True)
    handle.write("\n")
    handle.flush()
    os.fsync(handle.fileno())
PY
  chown root:root -- "$temp"
  chmod 0644 -- "$temp"
  mv -fT -- "$temp" "$PROVENANCE_PATH"
  TEMP_PROVENANCE=
}

validate_configuration

case "$ACTION" in
  check)
    verify_root_chain "$BIN_PATH"
    verify_source "$NMAP_SOURCE" "$NMAP_SOURCE_SHA256" "Nmap"
    verify_source "$HTTPX_SOURCE" "$HTTPX_SOURCE_SHA256" "httpx"
    verify_destinations
    verify_bin_entries
    verify_provenance
    echo "Trusted V2 recon-tool directory is ready: $BIN_PATH"
    ;;
  install)
    [[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "install requires root" >&2; exit 1; }
    verify_source "$NMAP_SOURCE" "$NMAP_SOURCE_SHA256" "Nmap"
    verify_source "$HTTPX_SOURCE" "$HTTPX_SOURCE_SHA256" "httpx"
    verify_source "$HTTPX_WRAPPER_ASSET" "$HTTPX_SHA256" "httpx wrapper asset"
    verify_root_chain "$(dirname -- "$PATH_BOUNDARY")"
    [[ ! -e "$INSTALL_ROOT" || ( -d "$INSTALL_ROOT" && ! -L "$INSTALL_ROOT" ) ]] \
      || fail "V2 trusted-tool install root is not a safe directory"
    install -d -o root -g root -m 0755 -- "$INSTALL_ROOT" "$BIN_PATH"
    verify_root_chain "$BIN_PATH"
    TEMP_NMAP=
    TEMP_HTTPX=
    TEMP_PROVENANCE=
    trap 'rm -f -- "${TEMP_NMAP:-}" "${TEMP_HTTPX:-}" "${TEMP_PROVENANCE:-}"' EXIT
    TEMP_NMAP=$(mktemp "$BIN_PATH/.nmap.tmp.XXXXXXXX")
    TEMP_HTTPX=$(mktemp "$BIN_PATH/.httpx-toolkit.tmp.XXXXXXXX")
    install -o root -g root -m "$NMAP_MODE" -- "$NMAP_SOURCE" "$TEMP_NMAP"
    install -o root -g root -m "$HTTPX_MODE" -- "$HTTPX_WRAPPER_ASSET" "$TEMP_HTTPX"
    setcap -r -- "$TEMP_NMAP" 2>/dev/null || true
    setcap -r -- "$TEMP_HTTPX" 2>/dev/null || true
    [[ $(sha256 "$TEMP_NMAP") == "$NMAP_SHA256" ]] || fail "Staged Nmap hash differs"
    [[ $(sha256 "$TEMP_HTTPX") == "$HTTPX_SHA256" ]] || fail "Staged httpx wrapper hash differs"
    mv -fT -- "$TEMP_NMAP" "$NMAP_DESTINATION"
    TEMP_NMAP=
    mv -fT -- "$TEMP_HTTPX" "$HTTPX_DESTINATION"
    TEMP_HTTPX=
    # Remove only a stale V2-local Subfinder copy from older previews.
    rm -f -- "$BIN_PATH/subfinder"
    verify_destinations
    verify_bin_entries
    write_provenance
    verify_provenance
    trap - EXIT
    echo "Installed and attested V2-only recon tools: $BIN_PATH"
    ;;
  remove)
    [[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "remove requires root" >&2; exit 1; }
    [[ ! -L "$INSTALL_ROOT" && ! -L "$BIN_PATH" ]] \
      || fail "Refusing to remove through a symlinked trusted-tool path"
    if [[ -d "$BIN_PATH" ]]; then
      verify_root_chain "$BIN_PATH"
    else
      verify_root_chain "$(dirname -- "$PATH_BOUNDARY")"
    fi
    rm -f -- "$NMAP_DESTINATION" "$HTTPX_DESTINATION" "$BIN_PATH/subfinder" "$PROVENANCE_PATH"
    rmdir --ignore-fail-on-non-empty -- "$BIN_PATH" "$INSTALL_ROOT" 2>/dev/null || true
    echo "Removed the V2-only trusted recon tools; global binaries were unchanged"
    ;;
esac
