# Wordlist Assets (Phase 17)

Specialists use wordlists by **path + metadata + suitability** — their CONTENTS are never read into a
model prompt or runtime memory, never committed to the repo.

## Where they live
`/opt/chillspwn-assets/wordlists/` (outside the source tree, never committed). Manifest (metadata only):
`server/assets/wordlistAssets.manifest.json` — repos SecLists, assetnote/wordlists, david-palma/wordlists
(commits pinned via `ls-remote`; **nothing downloaded** during inventory).

## Why contents are never injected
Wordlists are 10K–millions of lines (multi-GB). Feeding them to an LLM is impossible + pointless — the
fuzzer/cracker reads the FILE. The agent only needs the path, size, category, use-case, and recommended
tool. `WordlistAssetManager` enforces this: `list()`/`select()` return metadata + `-w <path>` args only.

## Selecting wordlists
`GET /api/assets/wordlists?agent=&category=&profile=` (inventory) and
`GET /api/assets/wordlists/select?taskType=&tech=&protocol=&speed=&depth=&risk=&agent=` →
`{ selectedWordlists, reason, commandPathArgs:["-w <path>"], estimatedSize, caution }`.
Profiles: quick · balanced · deep · api · cloud · extensions · raft · directory · subdomain · usernames ·
passwords · parameters · backup-config · technology-specific.

## Large / breach datasets
`isLarge`/`isBreachData` lists are **disabled by default**, **never auto-downloaded**, and selection
flags them `requiresApproval`. Breach data (rockyou, darkweb, assetnote multi-GB) is authorized
lab/password-audit ONLY — entries are never printed and never stored as memory.

## Agent → wordlist mapping
ReconScout (DNS/subdomain, assetnote subdomain/API) · WebBreaker (Web-Content/raft, API/cloud paths,
backup/config/extensions, params) · CredSmith (usernames/passwords + Probable + passphrase, authorized
audit only) · SecretHunter (sensitive file/path/config) · OSINTSeeker (public discovery, no breach dumps
without authorization) · ReportSmith (references metadata, never embeds lists) · ChillsPwn (chooses
strategy + routes; does not fuzz/crack directly).

## Install / update / disable
`scripts/setup-security-assets.sh --dry-run --profile wordlists-core|web|api` then
`--profile wordlists-core --metadata-only --write-config`. Default metadata-only/no-large. Update a repo:
`git -C /opt/chillspwn-assets/wordlists/<repo> pull`. Disable: remove from manifest or leave undownloaded.
