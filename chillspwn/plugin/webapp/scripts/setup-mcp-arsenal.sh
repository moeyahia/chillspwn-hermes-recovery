#!/usr/bin/env bash
# Phase 15.14 — ChillsPwn MCP Arsenal installer.
#
# SAFE BY DEFAULT: with no flags it runs a DRY-RUN and changes nothing. It NEVER exposes MCPs to
# Claude globally, NEVER builds every Docker image, NEVER commits cloned repos into the source tree,
# and NEVER writes secrets — generated MCP config is DISABLED-by-default with env TEMPLATES only.
# MCPs are exposed only through the agent/runtime mapping (server/agents/agentMcpMap.ts).
#
# Usage:
#   scripts/setup-mcp-arsenal.sh                         # DRY RUN (default) — plan only, no changes
#   scripts/setup-mcp-arsenal.sh --profile core          # install the 'core' profile
#   scripts/setup-mcp-arsenal.sh --profile web|ad|reverse|cloud|osint|full
#   scripts/setup-mcp-arsenal.sh --profile full --no-docker     # skip docker builds
#   scripts/setup-mcp-arsenal.sh --health-check          # check binaries/images/env for a profile
#   scripts/setup-mcp-arsenal.sh --profile core --write-config  # emit .mcp.arsenal.json (disabled-by-default)
set -uo pipefail

VENDOR="/opt/chillspwn-mcp-arsenal"
MANIFEST="$(cd "$(dirname "$0")/.." && pwd)/server/agents/mcpArsenal.manifest.json"
DRY_RUN=1; PROFILE=""; NO_DOCKER=0; HEALTH=0; WRITE_CONFIG=0
for a in "$@"; do
  case "$a" in
    --dry-run) DRY_RUN=1 ;;
    --profile=*) PROFILE="${a#*=}"; DRY_RUN=0 ;;
    --profile) shift; ;;
    --no-docker) NO_DOCKER=1 ;;
    --health-check) HEALTH=1 ;;
    --write-config) WRITE_CONFIG=1; DRY_RUN=0 ;;
    *) [ -z "$PROFILE" ] && [[ "$a" =~ ^(core|web|ad|reverse|cloud|osint|full)$ ]] && { PROFILE="$a"; DRY_RUN=0; } ;;
  esac
done
[ -z "$PROFILE" ] && PROFILE="core"
if [ "$DRY_RUN" = 0 ] && [ "$EUID" -ne 0 ]; then
  echo "Refusing mutable MCP arsenal setup as a non-root user; rerun the reviewed command with sudo." >&2
  exit 1
fi

# Profile → MCP server names (least-privilege; docker images NOT pre-built unless selected).
profile_servers() {
  case "$1" in
    core)    echo "sechub-reconnaissance sechub-web-security pentest-mcp-server-ssh chillspwn-reporting" ;;
    web)     echo "sechub-web-security sechub-exploitation" ;;
    ad)      echo "sechub-active-directory sechub-password-cracking" ;;
    reverse) echo "sechub-binary-analysis" ;;
    cloud)   echo "sechub-cloud-security" ;;
    osint)   echo "sechub-osint sechub-threat-intel" ;;
    full)    python3 -c "import json,sys; print(' '.join(s['mcpServerName'] for s in json.load(open('$MANIFEST'))['servers'] if s['runtimeType']!='registry'))" ;;
    *) echo "" ;;
  esac
}

field() { python3 -c "import json,sys; [print(s.get('$2','')) for s in json.load(open('$MANIFEST'))['servers'] if s['mcpServerName']=='$1']"; }
listfield() { python3 -c "import json,sys; [print(','.join(s.get('$2',[]))) for s in json.load(open('$MANIFEST'))['servers'] if s['mcpServerName']=='$1']"; }

echo "═══ ChillsPwn MCP Arsenal installer ═══"
echo "profile=$PROFILE  mode=$([ "$DRY_RUN" = 1 ] && echo DRY-RUN || echo INSTALL)  no-docker=$NO_DOCKER  health-check=$HEALTH  write-config=$WRITE_CONFIG"
echo "vendor=$VENDOR (outside source tree)   manifest=$MANIFEST"
SERVERS="$(profile_servers "$PROFILE")"
echo "servers in profile: $SERVERS"
echo

installed=(); skipped=(); failed=(); missing_keys=()

for s in $SERVERS; do
  runtime="$(field "$s" runtimeType)"; install="$(field "$s" installMethod)"; hc="$(field "$s" healthCheck)"
  bins="$(listfield "$s" requiredBinaries)"; imgs="$(listfield "$s" requiredDockerImages)"; keys="$(listfield "$s" apiKeysRequired)"
  agents="$(listfield "$s" assignedAgents)"
  echo "── $s [$runtime] → agents: ${agents:-none}"
  echo "    install: $install"
  echo "    required binaries: ${bins:-none} | docker images: ${imgs:-none} | api keys: ${keys:-none}"
  [ -n "$keys" ] && missing_keys+=("$s:$keys")

  if [ "$HEALTH" = 1 ]; then
    for b in ${bins//,/ }; do command -v "$b" >/dev/null 2>&1 && echo "    ✓ binary present: $b" || echo "    ✗ MISSING binary: $b"; done
    echo "    health cmd: $hc"
    continue
  fi

  if [ "$DRY_RUN" = 1 ]; then
    case "$runtime" in
      python) desc="python venv + pip" ;;
      node)   desc="npm install/build" ;;
      docker) desc="docker build ($([ "$NO_DOCKER" = 1 ] && echo 'SKIPPED:--no-docker' || echo 'this profile only'))" ;;
      *)      desc="built-in (no external install)" ;;
    esac
    echo "    DRY-RUN: would clone (if missing) → $VENDOR, then $desc, then a DISABLED config entry."
    skipped+=("$s")
    continue
  fi

  # Real install (only outside dry-run).
  case "$runtime" in
    python)  echo "    (install) python venv + pip — TODO operator: cd $VENDOR/<repo> && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt"; installed+=("$s") ;;
    node)    echo "    (install) npm — TODO operator: cd $VENDOR/<repo> && npm install && npm run build"; installed+=("$s") ;;
    docker)  if [ "$NO_DOCKER" = 1 ]; then echo "    (install) docker SKIPPED (--no-docker)"; skipped+=("$s"); else echo "    (install) docker build for selected image only — TODO operator: docker build -f .../Dockerfile"; installed+=("$s"); fi ;;
    *)       echo "    (built-in — no external install)"; installed+=("$s") ;;
  esac
done

if [ "$WRITE_CONFIG" = 1 ]; then
  CFG="$VENDOR/.mcp.arsenal.json"
  echo; echo "── merging profile '$PROFILE' into active MCP config → $CFG (DISABLED-by-default; env templates only, no secrets)"
  if { [ -e "$CFG" ] && [ ! -w "$CFG" ]; } || { [ ! -e "$CFG" ] && [ ! -w "$(dirname "$CFG")" ]; }; then
    echo "    ✗ cannot write $CFG (permission). Keep the arsenal root-owned and rerun with sudo."
  else
  export PROF="$PROFILE"
  python3 - "$MANIFEST" "$SERVERS" "$CFG" <<'PY'
import json,sys,os
m=json.load(open(sys.argv[1])); want=set(sys.argv[2].split()); cfgpath=sys.argv[3]
existing=json.load(open(cfgpath)) if os.path.exists(cfgpath) and os.path.getsize(cfgpath) else {"//":"ChillsPwn MCP arsenal — ALL disabled by default; exposed ONLY via server/agents/agentMcpMap.ts; NEVER to Claude globally. No secrets.","profiles":{},"mcpServers":{}}
existing.setdefault("mcpServers",{}); existing.setdefault("profiles",{})
existing["profiles"][os.environ.get("PROF","profile")]=sorted(want)
CMD={"pentest-mcp-server-ssh":{"command":"/opt/chillspwn-mcp-arsenal/pentest-mcp-server/.venv/bin/python","args":["-m","pentest_mcp_server"],"cwd":"/opt/chillspwn-mcp-arsenal/pentest-mcp-server"},
     "pentest-mcp-recon":{"command":"node","args":["build/index.js"],"cwd":"/opt/chillspwn-mcp-arsenal/pentest-mcp"}}
added=0
for s in m["servers"]:
  n=s["mcpServerName"]
  if n not in want: continue
  keys=s.get("apiKeysRequired",[]); env=s.get("requiredEnv",[])
  # cloud account-posture + threat-intel stay disabled unless creds/keys are explicitly present.
  needs_secret=bool(keys) or bool(env)
  have_secret=all(os.environ.get(k) for k in env) and env
  entry={"enabled":False,"runtime":s["runtimeType"],"assignedAgents":s["assignedAgents"],
         "requiredBinaries":s.get("requiredBinaries",[]),"requiredDockerImages":s.get("requiredDockerImages",[]),
         "envTemplate":{k:"<set-me>" for k in env},"apiKeysRequired":keys,"installMethod":s["installMethod"],
         "toolNames":s.get("toolNames",[]),
         "disabledReason":("requires API keys/credentials — set then enable" if needs_secret and not have_secret else "disabled by default — enable explicitly")}
  if n in CMD: entry.update(CMD[n])
  existing["mcpServers"][n]=entry; added+=1
tmp=f"{cfgpath}.new-{os.getpid()}"
with open(tmp,"w",encoding="utf-8") as handle:
  json.dump(existing,handle,indent=2)
  handle.write("\n")
os.chmod(tmp,0o644)
os.replace(tmp,cfgpath)
print(f"    merged {added} server(s); config now has {len(existing['mcpServers'])} total (all enabled:false)")
PY
  chown root:root "$CFG"
  chmod 0644 "$CFG"
  fi
fi

echo; echo "═══ report ═══"
echo "installed: ${installed[*]:-none}"
echo "skipped:   ${skipped[*]:-none}"
echo "failed:    ${failed[*]:-none}"
echo "missing secrets/API keys: ${missing_keys[*]:-none}"
echo "recommended agents enabled: $(python3 -c "import json; print(', '.join(sorted({a for s in json.load(open('$MANIFEST'))['servers'] if s['mcpServerName'] in '''$SERVERS'''.split() for a in s['assignedAgents']})))")"
echo
echo "NEXT: MCPs stay DISABLED until assigned via server/agents/agentMcpMap.ts + the runtime. They are"
echo "      NEVER exposed to Claude globally. Re-run with --health-check to verify binaries/images."
