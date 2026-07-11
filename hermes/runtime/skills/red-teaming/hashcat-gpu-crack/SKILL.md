---
name: hashcat-gpu-crack
description: "Crack password hashes on the host's dual NVIDIA RTX 2080 Ti GPUs instead of the CPU-only Kali VM. Streams the model-provided wordlist over an SSH tunnel into remote hashcat (pipe mode), so ONLY that wordlist is ever used — no defaults, no potfile shortcuts, no stale lists. Use for any NTLM/NetNTLMv2/Kerberos/bcrypt/WPA/etc. cracking."
version: 1.0.0
author: chillspwn
license: MIT
platforms: [linux]
metadata:
  hermes:
    tags: [hashcat, gpu, cracking, password, hashes, ntlm, netntlmv2, kerberoast, asrep, bcrypt, wpa, crack, rockyou, rtx2080ti, ssh-tunnel, credential-access, post-exploitation, john, lm, sha512crypt, keepass, crack-hash, crack-password, mode-detect]
    related_skills: [kali-arsenal, htb-ad-dc-gmsa-dll-privesc, htb-webapp-container-git-privesc, htb-it-ot-nifi-opcua-privesc]
---

# Hashcat GPU Crack — Remote Cracking on the Host's RTX 2080 Ti GPUs

## TL;DR — use this WHENEVER you need to crack a hash
This Kali VM has **no usable GPU**. Cracking on it (john/CPU hashcat) is painfully slow.
The Windows host on the host-only network has **2× NVIDIA GeForce RTX 2080 Ti** and
`hashcat v7.1.2`. There is an SSH tunnel to it. **Always crack through the GPU host** using
the wrapper below — never burn time CPU-cracking locally.

```bash
gpu-crack -m <hashcat_mode> -H <hashfile> -w <wordlist> [-o cracked.txt]
```

The wrapper lives at:
- `/root/.hermes/skills/red-teaming/hashcat-gpu-crack/gpu-crack.sh`
- also on `$PATH` as **`gpu-crack`** (symlink in `/usr/local/bin`)

## Infrastructure (verified working 2026-05-29)
| Item | Value |
|------|-------|
| GPU host | `mhmde@192.168.56.1` (Windows, host-only net) |
| SSH key | `~/.ssh/id_ed25519_winhost` |
| hashcat | `D:\Tools\hashcat-7.1.2\hashcat.exe` (v7.1.2) |
| GPUs | 2× NVIDIA GeForce RTX 2080 Ti (OpenCL backend; CUDA SDK not installed — OpenCL is fine) |
| Hash staging dir | `D:\hccjobs\` (transient, per-job, auto-cleaned) |

Override defaults with env vars: `WINHOST`, `WINHOST_KEY`, `WINHC_DIR`.

## The hard rules this skill enforces (Mr. Wong's requirement)
> hashcat must rely **only** on the wordlist the model provides, and must never
> mistakenly process a separate/default/stale wordlist.

The wrapper guarantees this **structurally**, not by convention:

1. **Wordlist is streamed over SSH stdin → hashcat runs in pure pipe mode** (`Guess.Base=Pipe`).
   hashcat is handed **no dictionary path**, so it can only ever consume the exact candidates
   piped in. A separate wordlist file on the host is physically unreachable by the run.
2. **`--potfile-disable` is always set** → a previously-cracked hash is never silently returned
   from the potfile; every run genuinely processes the provided wordlist.
3. **No defaults** → the wrapper refuses to run without explicit `-m`, `-H`, **and** `-w`.
   There is no fallback wordlist anywhere on the host (rockyou is intentionally *not* staged).
4. **Per-job isolation** → the hash file goes to a unique `D:\hccjobs\job_<ts>_<pid>.hash`,
   its byte size is verified against the local copy (aborts on mismatch), and both the hash
   and the result file are deleted on exit. Nothing leaks between jobs.

**The model picks/builds the wordlist on Kali and the wrapper ships it.** rockyou lives at
`/usr/share/wordlists/rockyou.txt`; SecLists at `/usr/share/seclists`. Use whatever fits the
target — a custom list, a CeWL scrape, a generated mask-list — it gets streamed as-is.

## Usage

```bash
# NTLM hashes (e.g. from secretsdump / NTDS.dit), rockyou
gpu-crack -m 1000 -H ntlm.txt -w /usr/share/wordlists/rockyou.txt -o loot/cracked.txt

# Kerberoast TGS-REP
gpu-crack -m 13100 -H kerb.txt -w /usr/share/wordlists/rockyou.txt

# AS-REP roast
gpu-crack -m 18200 -H asrep.txt -w /usr/share/wordlists/rockyou.txt

# NetNTLMv2 (Responder captures)
gpu-crack -m 5600 -H netntlm.txt -w /usr/share/wordlists/rockyou.txt

# WPA/WPA2 (hcxpcapngtool → 22000)
gpu-crack -m 22000 -H handshake.22000 -w /usr/share/wordlists/rockyou.txt
```

### Rules / masks (pipe mode can't take `-r` directly)
Pre-expand the candidates **locally** and stream them — still "the model's wordlist", just generated:

```bash
# wordlist + rules
hashcat --stdout -r /usr/share/hashcat/rules/best64.rule /usr/share/wordlists/rockyou.txt \
  | gpu-crack -m 1000 -H ntlm.txt -w -

# pure mask / brute (generate candidates locally, stream them)
hashcat --stdout -a 3 '?u?l?l?l?l?d?d?d' \
  | gpu-crack -m 1000 -H ntlm.txt -w -

# custom list from CeWL / mutations
cewl -d 2 -w site.txt https://target && gpu-crack -m 1000 -H ntlm.txt -w site.txt
```

> For very fast hash modes (MD5/NTLM) + huge generated streams, stdin feed can bottleneck the
> GPUs (the candidate pipe, not the GPU, becomes the limit). For straight dictionary runs that's
> a non-issue. If you ever truly saturate, generate the expanded list to a file first and pass it
> with `-w file` (still streamed, still pipe mode, just buffered).

## Common hashcat modes (quick reference)
| Mode | Hash type |
|------|-----------|
| 0 | MD5 |
| 100 | SHA1 |
| 1400 | SHA-256 |
| 1700 | SHA-512 |
| 1000 | NTLM |
| 3000 | LM |
| 5600 | NetNTLMv2 |
| 5500 | NetNTLMv1 |
| 13100 | Kerberos 5 TGS-REP (Kerberoast, RC4) |
| 19600/19700 | Kerberoast (AES128/AES256) |
| 18200 | Kerberos 5 AS-REP (AS-REP roast) |
| 1800 | sha512crypt `$6$` (Linux /etc/shadow) |
| 500 | md5crypt `$1$` |
| 3200 | bcrypt `$2*$` |
| 7400 | sha256crypt `$5$` |
| 22000 | WPA-PBKDF2-PMKID+EAPOL |
| 13400 | KeePass |

Don't remember a mode? `gpu-crack` rejects non-numeric modes; identify with
`hashid <hash>` / `hashcat --identify <hashfile>` on Kali first, or check
https://hashcat.net/wiki/doku.php?id=example_hashes.

## Exit codes
- `0` — at least one hash cracked (cracked creds printed; saved to `-o` if given)
- `1` — exhausted, nothing cracked with that wordlist (try rules/another list)
- `2` — usage/validation error (missing `-m`/`-H`/`-w`, bad wordlist, etc.)
- `>2` — transport/remote error (tunnel down, hashcat missing, upload size mismatch)

## Manual fallback (if the wrapper is unavailable)
The wrapper just wraps this. Hash goes as a file; **wordlist is piped** (never a remote path):

```bash
# upload hash, stream wordlist, pipe mode, potfile disabled:
scp -i ~/.ssh/id_ed25519_winhost hashes.txt mhmde@192.168.56.1:D:/hccjobs/x.hash
cat /usr/share/wordlists/rockyou.txt | ssh -i ~/.ssh/id_ed25519_winhost mhmde@192.168.56.1 \
  "cd /d D:\Tools\hashcat-7.1.2 && hashcat.exe -m 1000 -a 0 D:\hccjobs\x.hash --potfile-disable --outfile D:\hccjobs\x.out --outfile-format 1,2"
ssh -i ~/.ssh/id_ed25519_winhost mhmde@192.168.56.1 "type D:\hccjobs\x.out"
ssh -n -i ~/.ssh/id_ed25519_winhost mhmde@192.168.56.1 "del /q D:\hccjobs\x.hash D:\hccjobs\x.out"
```

⚠️ **Do NOT use `hashcat.exe -m MODE - wordlist`** (passing `-` as the hashfile). hashcat does
**not** read hashes from stdin via `-`; it parses `-` as a literal hash → `Token length exception`.
The correct stdin direction is the **wordlist/candidates**, with the hash as a file. (Verified.)

## Troubleshooting
- **`cannot reach host or hashcat not found`** → tunnel/host down. Test:
  `ssh -i ~/.ssh/id_ed25519_winhost mhmde@192.168.56.1 "cd /d D:\Tools\hashcat-7.1.2 && hashcat.exe -I"`
- **`hash upload size mismatch`** → partial/failed scp; just re-run (the wrapper aborts rather than
  crack a truncated file).
- **Everything exhausts instantly with 0 H/s** → wordlist stream was empty; check the producer/path.
- **Want to confirm pipe mode** → remote status shows `Guess.Base....: Pipe` (proof no on-disk list used).
