---
name: hashcat-gpu-crack
description: "Crack authorized password hashes on an explicitly configured remote GPU host. Streams the supplied wordlist over SSH into Hashcat pipe mode, with no built-in host, key, tool-path, dictionary, or potfile defaults."
version: 1.0.0
author: chillspwn
platforms: [linux]
metadata:
  hermes:
    tags: [hashcat, gpu, cracking, password-audit, hashes, ntlm, netntlmv2, kerberos, bcrypt, wpa, ssh-tunnel]
    related_skills: [kali-arsenal, pentest-engagement-ops]
---

# Hashcat GPU Crack

Use this skill only for password auditing within an explicitly authorized engagement and only when an approved remote GPU worker has been configured. The skill never supplies a destination, private key, remote tool path, or fallback wordlist.

## Required configuration

Set all three values in the protected service environment, never in Git:

| Variable | Purpose |
|---|---|
| `WINHOST` | SSH destination in `user@host` form |
| `WINHOST_KEY` | Path to the dedicated SSH private key |
| `WINHC_DIR` | Remote directory containing `hashcat.exe` |

The wrapper fails closed when a value is absent or the key is unreadable. Keep private hosts, usernames, key paths, workstation paths, and tunnel details outside this skill.

## Usage

```bash
gpu-crack -m <hashcat_mode> -H <hashfile> -w <wordlist> [-o cracked.txt]
```

The wrapper source is `gpu-crack.sh` beside this file and may be exposed on `$PATH` as `gpu-crack` by the deployment.

Examples with placeholders:

```bash
# NTLM
gpu-crack -m 1000 -H hashes.txt -w candidates.txt -o cracked.txt

# Kerberos TGS-REP
gpu-crack -m 13100 -H tickets.txt -w candidates.txt

# AS-REP
gpu-crack -m 18200 -H asrep.txt -w candidates.txt

# NetNTLMv2
gpu-crack -m 5600 -H captures.txt -w candidates.txt

# WPA-PBKDF2-PMKID/EAPOL
gpu-crack -m 22000 -H handshake.22000 -w candidates.txt
```

## Safety invariants

1. **Explicit inputs only.** Mode, hash file, and wordlist are required. There is no default dictionary.
2. **Candidate isolation.** The supplied candidate stream is sent over SSH stdin; remote Hashcat receives no dictionary path.
3. **No stale potfile result.** `--potfile-disable` is always set.
4. **Per-job staging.** Hash and result files use a unique remote job name and are removed on exit.
5. **Upload validation.** The wrapper compares local and remote hash-file sizes before cracking.
6. **No reusable secret memory.** Plaintext results and hashes belong only in approved evidence storage; lessons retain strategy, not values.

## Rules and masks

Pipe mode cannot apply a remote `-r` rule directly. Generate candidates locally, then stream them:

```bash
hashcat --stdout -r /path/to/rule /path/to/base-wordlist \
  | gpu-crack -m 1000 -H hashes.txt -w -

hashcat --stdout -a 3 '<MASK>' \
  | gpu-crack -m 1000 -H hashes.txt -w -
```

Never pass `-` as the Hashcat hashfile. Hashcat pipe mode reads candidates from stdin; hashes remain in the staged file.

## Common modes

| Mode | Hash type |
|---|---|
| 0 | MD5 |
| 100 | SHA-1 |
| 1400 | SHA-256 |
| 1700 | SHA-512 |
| 1000 | NTLM |
| 3000 | LM |
| 5600 | NetNTLMv2 |
| 5500 | NetNTLMv1 |
| 13100 | Kerberos TGS-REP RC4 |
| 19600 / 19700 | Kerberos TGS-REP AES |
| 18200 | Kerberos AS-REP |
| 1800 | sha512crypt |
| 500 | md5crypt |
| 3200 | bcrypt |
| 7400 | sha256crypt |
| 22000 | WPA-PBKDF2-PMKID/EAPOL |
| 13400 | KeePass |

Use `hashid` or `hashcat --identify` locally when the mode is unknown.

## Exit codes

- `0`: at least one hash was cracked.
- `1`: the supplied candidates were exhausted with no result.
- `2`: usage or local validation failed.
- Greater than `2`: transport or remote execution failed.

## Troubleshooting

- Missing configuration: set `WINHOST`, `WINHOST_KEY`, and `WINHC_DIR` in the protected service environment.
- Connectivity/tool failure: test the configured destination without printing credentials:

  ```bash
  ssh -i "$WINHOST_KEY" "$WINHOST" "cd /d $WINHC_DIR && hashcat.exe -I"
  ```

- Empty candidate stream: verify the local producer before retrying.
- Upload mismatch: retry only after confirming the configured route and available remote disk space.
- No result: treat exhaustion as evidence about that candidate set, not proof that the credential is uncrackable.

Do not include cracked credentials or raw hashes in GitHub issues, logs intended for source recovery, or training memory.
