#!/usr/bin/env bash
# Phase 17 — ChillsPwn security-asset setup (wordlists + hashcat assets + CVE-intel MCPs).
#
# SAFE BY DEFAULT: metadata-only, no-large, NO multi-GB downloads, NO breach-data auto-download.
# It NEVER feeds wordlist/rule contents anywhere, NEVER commits assets to the repo, NEVER prints
# secrets. Assets live in /opt/chillspwn-assets (outside the source tree).
#
# Usage:
#   scripts/setup-security-assets.sh --dry-run --profile wordlists-core
#   scripts/setup-security-assets.sh --dry-run --profile hashcat-core
#   scripts/setup-security-assets.sh --dry-run --profile vuln-intel
#   scripts/setup-security-assets.sh --profile wordlists-core --metadata-only --write-config
#   scripts/setup-security-assets.sh --profile hashcat-rules --metadata-only --write-config
#   scripts/setup-security-assets.sh --profile vuln-intel --write-config --health-check
# Profiles: wordlists-core wordlists-web wordlists-api hashcat-core hashcat-rules vuln-intel full
set -uo pipefail

ASSETS="/opt/chillspwn-assets"
SRC="$(cd "$(dirname "$0")/.." && pwd)/server"
WL_MANIFEST="$SRC/assets/wordlistAssets.manifest.json"
HC_MANIFEST="$SRC/assets/hashcatAssets.manifest.json"
VI_MANIFEST="$SRC/assets/vulnIntelMcp.manifest.json"
DRY_RUN=1; PROFILE=""; NO_LARGE=1; METADATA_ONLY=1; WRITE_CONFIG=0; HEALTH=0
for a in "$@"; do case "$a" in
  --dry-run) DRY_RUN=1 ;;
  --profile=*) PROFILE="${a#*=}"; DRY_RUN=0 ;;
  --profile) ;;
  --no-large) NO_LARGE=1 ;;
  --allow-large) NO_LARGE=0 ;;
  --metadata-only) METADATA_ONLY=1 ;;
  --download) METADATA_ONLY=0 ;;
  --write-config) WRITE_CONFIG=1; DRY_RUN=0 ;;
  --health-check) HEALTH=1 ;;
  *) [ -z "$PROFILE" ] && [[ "$a" =~ ^(wordlists-core|wordlists-web|wordlists-api|hashcat-core|hashcat-rules|vuln-intel|full)$ ]] && { PROFILE="$a"; DRY_RUN=0; } ;;
esac; done
[ -z "$PROFILE" ] && PROFILE="wordlists-core"

echo "═══ ChillsPwn security-asset setup ═══"
echo "profile=$PROFILE  mode=$([ "$DRY_RUN" = 1 ] && echo DRY-RUN || echo SETUP)  metadata-only=$METADATA_ONLY  no-large=$NO_LARGE  write-config=$WRITE_CONFIG  health-check=$HEALTH"
echo "assets dir=$ASSETS (outside source tree; never committed)"
echo

py() { python3 -c "$1" "$@"; }

case "$PROFILE" in
  wordlists-core|wordlists-web|wordlists-api|full)
    echo "── WORDLISTS (metadata from $WL_MANIFEST):"
    python3 - "$WL_MANIFEST" "$PROFILE" "$NO_LARGE" <<'PY'
import json,sys
m=json.load(open(sys.argv[1])); prof=sys.argv[2]; nolarge=sys.argv[3]=="1"
cat={"wordlists-core":{"directory","subdomain"},"wordlists-web":{"directory","extensions","backup-config","parameters","technology-specific"},"wordlists-api":{"api","cloud"},"full":None}[prof]
for w in m["wordlists"]:
    if cat and w["category"] not in cat: continue
    if nolarge and (w["isLarge"] or w["isBreachData"]):
        print(f"   SKIP (large/breach, --no-large): {w['assetId']} [{w['category']}] ~{w['approxSizeBytes']//1024}KB"); continue
    print(f"   {w['assetId']:42s} [{w['category']:14s}] ~{w['approxSizeBytes']//1024}KB  path={w['localPath']}")
PY
    [ "$METADATA_ONLY" = 0 ] && echo "   (download requested) — operator must: git sparse-checkout the specific subdir into $ASSETS/wordlists (NO full multi-GB clone)" || echo "   metadata-only: nothing downloaded."
    ;;
esac
case "$PROFILE" in
  hashcat-core|hashcat-rules|full)
    echo "── HASHCAT ASSETS (metadata from $HC_MANIFEST):"
    python3 - "$HC_MANIFEST" "$PROFILE" "$NO_LARGE" <<'PY'
import json,sys
m=json.load(open(sys.argv[1])); prof=sys.argv[2]; nolarge=sys.argv[3]=="1"
if prof in ("hashcat-core","full"):
  for w in m["baseWordlists"]:
    if nolarge and (w["isLarge"] or w["isBreachData"]): print(f"   SKIP (large/breach): {w['assetId']}"); continue
    print(f"   wordlist {w['assetId']:30s} style={w['passwordStyle'][:24]:24s} mode={w['bestAttackMode']}")
if prof in ("hashcat-rules","full"):
  for r in m["rules"]:
    print(f"   rule     {r['assetId']:30s} family={r['ruleFamily']:22s} expansion~{r['estimatedExpansionFactor']} risk={r['riskCost']}")
PY
    echo "   metadata-only: nothing downloaded. Cracking is AUTHORIZED-LAB only; secrets never stored."
    ;;
esac
case "$PROFILE" in
  vuln-intel|full)
    echo "── CVE/VULN-INTEL MCPs (from $VI_MANIFEST):"
    python3 - "$VI_MANIFEST" <<'PY'
import json,sys,os
m=json.load(open(sys.argv[1]))
for s in m["servers"]:
    keys=s.get("requiredEnv",[]); missing=[k for k in keys if not os.environ.get(k)]
    print(f"   {s['mcpServerName']:28s} [{s['runtimeType']:6s}] docker={s['requiresDocker']} keys={keys or 'none'} missing={missing or 'none'} enabled={s['enabledByDefault']}")
PY
    if [ "$HEALTH" = 1 ]; then
      echo "   health-check (binaries):"
      for b in node python3; do command -v "$b" >/dev/null && echo "     ✓ $b" || echo "     ✗ MISSING $b"; done
      echo "     (CVE MCP tools/list health requires the vendor repos cloned to $ASSETS/vuln-intel)"
    fi
    ;;
esac

if [ "$WRITE_CONFIG" = 1 ]; then
  echo; echo "── --write-config: would merge enabled, dependency-satisfied assets into the MCP arsenal config"
  echo "   (CVE MCPs default DISABLED; enable per-server after providing keys / local cve-search)."
  echo "   Wordlist/hashcat assets are referenced by the asset managers (not MCP servers) — no MCP config entry needed."
fi

echo; echo "═══ summary ═══"
echo "downloaded: $([ "$METADATA_ONLY" = 1 ] && echo 'NONE (metadata-only)' || echo 'on-demand sparse only')"
echo "large/breach datasets: DISABLED by default (require --allow-large + explicit operator approval)"
echo "NEXT: assets are used by PATH/METADATA via /api/assets/* and the asset managers. Contents are NEVER"
echo "      read into prompts/memory. CVE MCPs stay disabled until keys / local cve-search are provided."
