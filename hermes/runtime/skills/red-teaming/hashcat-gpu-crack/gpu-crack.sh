#!/usr/bin/env bash
#
# gpu-crack.sh — ChillsPwn / Hermes remote GPU hashcat cracker
# ============================================================
# Cracks authorized hashes on an explicitly configured remote GPU host over
# SSH instead of relying on a CPU-only local runtime.
#
# RESILIENCE GUARANTEES (by design, not by convention):
#   1. The model's wordlist is STREAMED over SSH stdin -> hashcat runs in pure
#      pipe mode (Guess.Base=Pipe). hashcat is given NO dictionary path, so it
#      can ONLY ever consume the exact candidates piped in. It is physically
#      impossible for it to read a stale/default/separate wordlist on the host.
#   2. --potfile-disable is ALWAYS set, so a previously-cracked hash is never
#      silently returned from the potfile — every run actually processes the
#      provided wordlist against every hash.
#   3. NO DEFAULTS. The script hard-refuses to run unless -m, -H, and -w are all
#      given explicitly. There is no fallback wordlist anywhere.
#   4. The hash file is uploaded to a UNIQUE per-job path under D:\hccjobs, its
#      byte size is verified against the local file, and it is deleted on exit.
#      Nothing from one job can leak into another.
#
# USAGE:
#   gpu-crack.sh -m <mode> -H <hashfile> -w <wordlist> [-o <local_outfile>] [-- <extra hashcat args>]
#   <producer> | gpu-crack.sh -m <mode> -H <hashfile> -w -          # read wordlist from stdin
#
# EXAMPLES:
#   # NTLM with rockyou (model picks the list; it is streamed, not staged)
#   gpu-crack.sh -m 1000 -H ntlm.txt -w /usr/share/wordlists/rockyou.txt
#
#   # Kerberoast (mode 13100)
#   gpu-crack.sh -m 13100 -H tgs.txt -w /usr/share/wordlists/rockyou.txt
#
#   # Apply rules: pre-expand locally (pipe mode can't use -r) and stream the result
#   hashcat --stdout -r /usr/share/hashcat/rules/best64.rule /usr/share/wordlists/rockyou.txt \
#     | gpu-crack.sh -m 1000 -H ntlm.txt -w -
#
# ENV OVERRIDES:
#   WINHOST_KEY   dedicated SSH private-key path (required; no default)
#   WINHOST       SSH destination in user@host form (required; no default)
#   WINHC_DIR     remote directory containing hashcat.exe (required; no default)
#
# EXIT CODES:  0 = at least one hash cracked   1 = exhausted (nothing cracked)
#              2 = usage / validation error    >2 = transport/remote error
set -uo pipefail

KEY="${WINHOST_KEY:-}"
HOST="${WINHOST:-}"
HCDIR="${WINHC_DIR:-}"
SSH=(ssh    -i "$KEY" -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new)  # crack call only (needs piped stdin)
SSHN=(ssh -n -i "$KEY" -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new) # helpers: -n so they DON'T eat the wordlist on stdin
SCP=(scp    -i "$KEY" -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new)

# Strip the unavoidable NVIDIA/OpenCL/post-quantum banner noise from remote output.
NOISE='post-quantum|store now|may need to be upgraded|openssh.com/pq|This session may be vulnerable|wrongdriver|If you are using WSL2|Users must not install|For all details:|docs.nvidia.com|TLDR;|developer.nvidia.com|^[[:space:]]*Linux ->|Follow the installation|deb \(local\)|Failed to initialize NVIDIA RTC|CUDA SDK Toolkit|required for proper device|Falling back to OpenCL|Successfully initialized the NVIDIA|^\*\* WARNING'
filt() { grep -avE "$NOISE"; }

die()  { echo "[gpu-crack] ERROR: $*" >&2; exit 2; }
log()  { echo "[gpu-crack] $*" >&2; }

[[ -n "$HOST" ]] || die "WINHOST is required (user@host); no destination default is allowed."
[[ -n "$KEY" ]] || die "WINHOST_KEY is required; no private-key default is allowed."
[[ -r "$KEY" && -f "$KEY" ]] || die "WINHOST_KEY must name a readable regular file."
[[ -n "$HCDIR" ]] || die "WINHC_DIR is required; no remote Hashcat path default is allowed."

MODE="" ; HASHFILE="" ; WORDLIST="" ; OUTFILE="" ; EXTRA=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    -m) MODE="${2:-}"; shift 2 || die "-m needs a value";;
    -H) HASHFILE="${2:-}"; shift 2 || die "-H needs a value";;
    -w) WORDLIST="${2:-}"; shift 2 || die "-w needs a value";;
    -o) OUTFILE="${2:-}"; shift 2 || die "-o needs a value";;
    -r) die "rules (-r) cannot run in pipe mode. Pre-expand locally and stream it:
        hashcat --stdout -r <rule> <wordlist> | $(basename "$0") -m $MODE -H $HASHFILE -w -";;
    --) shift; EXTRA=("$@"); break;;
    -h|--help) sed -n '2,40p' "$0"; exit 0;;
    *) die "unknown argument: $1";;
  esac
done

# ---- NO DEFAULTS: every core parameter must be explicit ----
[[ -n "$MODE" ]]     || die "-m <hashcat mode> is required (no default)."
[[ "$MODE" =~ ^[0-9]+$ ]] || die "-m must be a numeric hashcat mode (e.g. 1000, 13100, 22000)."
[[ -n "$HASHFILE" ]] || die "-H <hashfile> is required."
[[ -n "$WORDLIST" ]] || die "-w <wordlist> is required (no default wordlist — the model must provide its own)."
[[ -r "$HASHFILE" && -s "$HASHFILE" ]] || die "hashfile missing/empty/unreadable: $HASHFILE"

# Wordlist source: a real file (validate it) or '-' / /dev/stdin (stream the caller's stdin).
if [[ "$WORDLIST" == "-" || "$WORDLIST" == "/dev/stdin" ]]; then
  WL_SRC="stdin"
  WL_DESC="<stdin stream>"
else
  [[ -r "$WORDLIST" && -s "$WORDLIST" ]] || die "wordlist missing/empty/unreadable: $WORDLIST"
  WL_SRC="$WORDLIST"
  WL_DESC="$WORDLIST ($(grep -c '' "$WORDLIST") lines)"
fi

# ---- preflight: reach the host + confirm hashcat is present ----
"${SSHN[@]}" "$HOST" "cd /d $HCDIR && hashcat.exe --version" >/dev/null 2>&1 \
  || { echo "[gpu-crack] ERROR: cannot reach $HOST or hashcat not found at $HCDIR" >&2; exit 3; }

# ---- upload hash file to a UNIQUE per-job path, verify byte-for-byte, auto-clean ----
JOB="job_$(date +%Y%m%d_%H%M%S)_$$"
REMOTE_HASH_BS="D:\\hccjobs\\${JOB}.hash"   # backslash form for cmd
REMOTE_HASH_FS="D:/hccjobs/${JOB}.hash"     # forward-slash form for scp
REMOTE_OUT_BS="D:\\hccjobs\\${JOB}.out"     # hashcat --outfile (cracked results land here)
cleanup() { "${SSHN[@]}" "$HOST" "del /q /f ${REMOTE_HASH_BS} ${REMOTE_OUT_BS} 2>nul" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM

"${SSHN[@]}" "$HOST" "if not exist D:\\hccjobs mkdir D:\\hccjobs" >/dev/null 2>&1
"${SCP[@]}" "$HASHFILE" "$HOST:$REMOTE_HASH_FS" </dev/null >/dev/null 2>&1 || { echo "[gpu-crack] ERROR: hash upload (scp) failed" >&2; exit 3; }

local_bytes=$(wc -c < "$HASHFILE" | tr -d ' ')
remote_bytes=$("${SSHN[@]}" "$HOST" "for %I in (${REMOTE_HASH_BS}) do @echo %~zI" 2>/dev/null | tr -dc '0-9')
[[ "$local_bytes" == "$remote_bytes" ]] \
  || { echo "[gpu-crack] ERROR: hash upload size mismatch (local=$local_bytes remote=${remote_bytes:-?}) — aborting to avoid cracking a stale/partial file" >&2; exit 3; }

n_hashes=$(grep -c '' "$HASHFILE")
log "job=$JOB  mode=$MODE  hashes=$n_hashes  wordlist=$WL_DESC  host=$HOST"
log "streaming wordlist via stdin (hashcat Guess.Base=Pipe, --potfile-disable) — only these candidates will be tried"

# ---- run: stream wordlist over stdin; remote hashcat gets NO dict arg => pure pipe mode ----
# Cracked results are captured via --outfile on the host (clean hash:plain lines), NOT by parsing
# stdout — pipe mode prints a full status screen even under --quiet, which is unsafe to grep.
REMOTE_CMD="cd /d $HCDIR && hashcat.exe -m $MODE -a 0 ${REMOTE_HASH_BS} --potfile-disable --quiet --outfile ${REMOTE_OUT_BS} --outfile-format 1,2 ${EXTRA[*]}"
tmp_log="$(mktemp)"
if [[ "$WL_SRC" == "stdin" ]]; then
  cat - | "${SSH[@]}" "$HOST" "$REMOTE_CMD"
else
  cat "$WL_SRC" | "${SSH[@]}" "$HOST" "$REMOTE_CMD"
fi > "$tmp_log" 2>&1
rc=$?

# Read cracked creds straight from the remote outfile (only hash:plain lines, no banner noise).
cracked="$("${SSHN[@]}" "$HOST" "type ${REMOTE_OUT_BS} 2>nul" 2>/dev/null | tr -d '\r' | grep -avE '^[[:space:]]*$' || true)"

echo "------------------------------------------------------------"
if [[ -n "$cracked" ]]; then
  echo "[gpu-crack] CRACKED $(printf '%s\n' "$cracked" | grep -c '') hash(es):"
  printf '%s\n' "$cracked"
  [[ -n "$OUTFILE" ]] && { printf '%s\n' "$cracked" > "$OUTFILE"; log "saved cracked creds -> $OUTFILE"; }
  rc=0
else
  echo "[gpu-crack] no hashes cracked with this wordlist (hashcat status: $(grep -aoE 'Status\.+: [A-Za-z]+' "$tmp_log" | head -1 | sed 's/.*: //'))."
  # surface real transport/remote errors (not the benign exhausted case)
  if (( rc > 1 )); then echo "[gpu-crack] remote stderr/stdout tail:"; filt < "$tmp_log" | tail -5; fi
fi
echo "------------------------------------------------------------"
rm -f "$tmp_log"
exit "$rc"
