# Archived skill: `htb-webapp-container-git-privesc`

Absorbed into `htb-attack-chain-playbooks` during umbrella-building consolidation. Original SKILL.md body follows.

---

---
name: htb-webapp-container-git-privesc
description: Reusable HTB/pentest workflow for web-app footholds that land in containers, pivot through leaked environment credentials, enumerate localhost-only developer services, and escalate via root-run Git/Gogs services.
version: 1.0.0
author: chillspwn
license: MIT
platforms: [linux]
metadata:
  hermes:
    tags: [htb, kali, web, container, flowise, gogs, git, privesc, localhost-services]
    related_skills: [kali-pentest-explainer-lane, network-attack-surface-mapping, pentest-report-pdf]
---

# HTB Web App Container → Host Pivot → Git Service PrivEsc

## Trigger

Use this skill when a target exposes any combination of:

- Low-code / workflow / AI orchestration apps such as Flowise, n8n, Node-RED, NiFi, Airflow, Jenkins, etc.
- Containerized web application RCE where `id` returns root but host access is still missing.
- Arbitrary file read/write from a web app or tool plugin.
- Secrets in `/proc/self/environ`, app SQLite databases, `.env` files, or service configs.
- Root-run Docker management panels such as Arcane where the app can reach `/var/run/docker.sock` but the foothold user cannot.
- Localhost-only developer services (`127.0.0.1:3000`, `3001`, `8025`, Gogs/Gitea/GitLab, MailHog, admin panels).
- Git services running as root or with repository roots under `/root`.
- Operator/group-owned application volumes such as PrivateBin data/certs that may provide indirect pivots but are not automatically RCE.

## Core Lesson

Do not stop at container root. Treat container RCE as an information and credential pivot into host-only services:

```text
web admin → tool/plugin arbitrary read/write → container RCE
container root → /proc/self/environ + app DB secrets
secret reuse → host SSH user
host user → enumerate localhost-only dev services
root-run Git service → hook/SSH/API/git-wrapper RCE → host root
```

## Workflow

### 1. Establish the app trust boundary

For workflow/AI apps, enumerate available nodes/tools and their sandbox policy before trying generic reverse shells.

Checklist:

```bash
id; hostname; pwd; env
cat /proc/self/cgroup
cat /proc/self/mountinfo | head
cat /proc/self/status | grep -E 'Cap(Eff|Prm|Bnd)'
```

If the app exposes file tools, prove both read and write separately:

```text
Read: /etc/passwd, /proc/self/environ, app database/config
Write: /tmp/<marker>
```

### 2. Prefer allowed-module process-spawn bypasses in Node sandboxes

When direct `child_process`, `process`, `fs`, or `Function` are blocked in a Node sandbox, enumerate allowed externals/builtins. Browser automation libraries are high-value because they spawn child processes internally.

Flowise/NodeVM pattern:

```javascript
const puppeteer = require('puppeteer');
await puppeteer.launch({
  executablePath: '/bin/sh',
  ignoreDefaultArgs: true,
  args: ['-c', 'id > /tmp/rce_proof 2>&1']
});
```

Why it works: the sandbox blocks direct `child_process`, but permitted libraries such as Puppeteer/Playwright can still reach process creation through their own trusted code paths. `ignoreDefaultArgs: true` is important; otherwise Chrome flags are prepended and `/bin/sh` exits with errors like `bad option`.

### 3. Treat container root as pivot, not victory

After app/container RCE:

- Search `/proc/self/environ` and app databases for passwords/API keys.
- Test credential reuse against host SSH users from `/etc/passwd`.
- Keep outputs redacted; log only proof of success (`id`, byte counts, hashes of flags, etc.).
- Attempt container escape only after checking policy.

Container escape sanity checks:

```bash
cat /proc/self/mountinfo | grep -E '/dev/sd|overlay|docker'
ls -la /dev /var/run/docker.sock /run/docker.sock 2>/dev/null
capsh --print 2>/dev/null || true
```

If mountinfo reveals host block devices but `/dev` lacks them, a classic test is `mknod` with the observed major/minor. If it returns `Operation not permitted`, move on quickly to secrets/host pivots instead of burning time.

### 3.5 Root-run Docker manager panels (Arcane pattern)

When a root-run Docker manager such as Arcane is exposed, distinguish **manager access** from **raw Docker socket access**:

- Check service context first: systemd `User=`, `WorkingDirectory=`, env vars, and default DB path resolution. A relative SQLite DSN like `file:data/arcane.db` resolves under the service working directory, often `/root/data/arcane.db` for root-run services.
- Enumerate public routes from source/OpenAPI. In Arcane/Huma, the auth middleware enforces auth only when the route operation declares `Security`; operations without `Security` are intentionally or accidentally public.
- Arcane `/api/templates/fetch?url=<url>` is a useful SSRF/reachability oracle: it performs an unrestricted HTTP GET, but expects registry-shaped JSON. Treat JSON unmarshal errors as proof of reachability, not as exploit failure.
- Do not assume Docker TCP is exposed. Test `127.0.0.1:2375`, but if refused and settings show `unix:///var/run/docker.sock`, you still need valid Arcane auth or socket permissions.
- JWT-default-secret testing needs a valid user UUID. Arcane verifies token claims by loading the user from DB, so random UUIDs fail even if the secret is default.
- API-key rows usually contain Argon2 hashes plus prefixes; recover raw keys from creation responses/logs/env, not from hashes.

### 4. After host SSH, enumerate localhost-only services

Run host-side enumeration as the pivot user:

```bash
ss -lntup
ps auxww | egrep -v '\[[^]]+\]'
find /opt /srv /var/www /var/backups /var/mail -maxdepth 4 -type f -printf '%m %u %g %p\n' 2>/dev/null
find /etc/nginx /etc/systemd/system /lib/systemd/system -maxdepth 3 -type f \
  \( -name '*.conf' -o -name '*.service' -o -name '*.env' \) -readable -print 2>/dev/null
```

Probe loopback services from the host context:

```bash
for p in 3000 3001 8025; do
  echo "--- $p"
  curl -sS -i --max-time 4 http://127.0.0.1:$p/ | sed -n '1,80p'
done
```

### 5. Prioritize root-run Git services

High-risk signals:

```text
/opt/gogs/gogs/gogs web          # running as root
User=root in systemd service
RUN_USER = root in app.ini
repository root = /root/...      # e.g. /root/gogs-repositories
registration enabled
localhost-only Gogs/Gitea on 3000/3001
```

For Gogs/Gitea-style services:

1. Read config/version if possible.
2. Identify DB and repository paths.
3. Try credential reuse only briefly.
4. Check registration and CAPTCHA.
5. If authenticated, attempt repository hooks, deploy keys, API token creation, or known git-wrapper/SSH argument injection CVEs.

Gogs-specific checks:

```bash
/opt/gogs/gogs/gogs --version
sed -n '1,220p' /opt/gogs/gogs/custom/conf/app.ini 2>/dev/null
searchsploit gogs
```

For Gogs `<= 0.13.x`, check both SSH-wrapper CVEs and HTTP/API repository-content CVEs. Do **not** stop at CVE-2024-39930 if `START_SSH_SERVER=false`: that only rules out the built-in SSH-server branch, not API symlink-write issues.

High-value Gogs `<= 0.13.3` check: **CVE-2025-8110 PutContents symlink write**. If Gogs runs as root, an authenticated normal user can create a repo containing a symlink such as `link_to_config -> .git/config`, then use the contents API to write through that symlink. A practical root path is to write a malicious Git config with `core.sshCommand` containing a constrained command such as `cp /root/root.txt /tmp/root.txt.chillspwn; chmod 0644 /tmp/root.txt.chillspwn`, then trigger a Git operation as the root-run Gogs process. Gogs may return HTTP 500 during the trigger; verify target-side artifacts before declaring failure. See `references/gogs-cve-2025-8110-putcontents.md`.

Critical branch point for Gogs SSH exploits:

- `START_SSH_SERVER = true`: Gogs' built-in SSH server is in-path; CVE-2024-39930-style argument injection is worth testing.
- `START_SSH_SERVER = false` with `DISABLE_SSH = false`: system OpenSSH handles auth and typically forces `gogs serv` from `authorized_keys`. Uploaded keys may authenticate as the OS `RUN_USER` (even `root`), but arbitrary SSH commands are constrained by `SSH_ORIGINAL_COMMAND` parsing and repository lookup. Do not keep hammering built-in-SSH PoCs after confirming this branch; pivot to `gogs serv` parser/source review, hook permissions, migration/import paths, session forgery, DB write primitives, or kernel/local LPE.

Root-run Gogs dead-end checks to run and record quickly:

```text
hooks: /<owner>/<repo>/settings/hooks/git requires admin or allow_git_hook
editor traversal: tree_path/NewTreeName may be normalized into repo-local paths
symlink read: raw symlink to /root/root.txt may return 500/blocked rather than contents
migration: local path and ext:: imports often return "not allowed to import local repositories" for normal users
SSH forced command: uploaded keys may authenticate as OS root but still be constrained by gogs serv parsing
```

Do not spend multiple waves on these dead ends after source-confirming them. In root-run Gogs `0.13.3`, prioritize CVE-2025-8110 PutContents symlink-write testing before kernel LPE fallbacks.

### 6. CAPTCHA handling for localhost-only services

If registration is blocked by a simple image CAPTCHA on a localhost-only service:

- Fetch the sign-up page and preserve cookies.
- Extract `_csrf`, `captcha_id`, and the CAPTCHA image.
- Transfer only the image out for solving.
- Regenerate any enhanced/thresholded images from the *current* raw CAPTCHA immediately after each fetch. Do not reuse stale enhanced files from a previous CAPTCHA.
- When submitting a human-solved CAPTCHA, use the exact cookie jar, `_csrf`, and `captcha_id` from the same fetch. A failed submit often rotates `captcha_id`; treat the displayed failure page as a new challenge or fetch a clean session.
- If using a human-in-the-loop solve, send the current enhanced image and include a tight status line saying whether the previous answer failed because it was stale or mismatched.
- Submit registration with the original cookie jar and tokens, then verify success by checking for authenticated indicators or API token creation rather than assuming HTTP 200 means success.

Do not restart enumeration from scratch; CAPTCHA is just a small workflow gate. However, keep state discipline: stale image artifacts and rotated CAPTCHA IDs are the common failure mode.

### 6.5 Operator-owned web app volumes (PrivateBin pattern)

If the foothold user is in an operational group with write access to mounted application data:

- Map container mounts through host process `/proc/<pid>/mountinfo` to learn where host paths land inside the container (e.g. PrivateBin `/privatebin-data/data` -> `/srv/data`, certs -> `/etc/ssl/privatebin`).
- Verify execution assumptions before building a payload. Writing `*.php` to a writable data volume may still return `404` or be routed as static/application data; it is not automatic PHP-FPM RCE.
- Group-writable TLS cert/key files are an indirect primitive. Look for privileged reloads, trust relationships, client-certificate validation, or MitM opportunities; do not count them as root without a consumer path.
- For paste/data stores, prioritize application semantics: readable paste shards, salts, config exposure, purge/traffic limiter files, and logs containing paste IDs/keys.

### 7. Evidence and reporting

Save raw evidence under:

```text
/root/htb/boxes/<target>/scans/
/root/htb/boxes/<target>/loot/
/root/htb/boxes/<target>/work/
/root/htb/boxes/<target>/report/
```

Minimum report evidence:

- Initial service/vhost map.
- App authentication/takeover proof.
- Arbitrary read/write proof.
- Container RCE proof and sandbox bypass notes.
- Secret source and SSH pivot proof with secrets redacted.
- Host localhost-service map.
- Git service config showing root execution.
- Root command execution proof and flag retrieval.

## Pitfalls

- Do not confuse container root with host root. Always verify `/proc/1/cgroup`, mountinfo, and host visibility.
- Do not over-invest in reverse shells when in-band command output is easier and more reliable.
- Do not print credentials or flags in chat/logs. Save redacted proof and report flags as `[REDACTED]`.
- Do not waste time on direct sandbox escapes after confirming allowed modules can spawn processes indirectly.
- Do not ignore localhost-only services after SSH pivot; they are often the intended privilege-escalation path.
- Do not assume public registration is unusable because CAPTCHA exists. Fetch/solve/submit with preserved cookies.
- Do not rely on Gogs/Gitea web exposure from Kali if the service is localhost-bound; drive it through SSH remote curl or a local tunnel.
- Do not assume a writable web-app data volume is executable. Prove PHP/static execution with a tiny marker first; if routing returns 404, pivot to app-data semantics instead.
- Do not treat a default JWT secret as sufficient when the app validates token claims against the DB. Recover a real user ID first.
- For SSRF endpoints that parse typed JSON, preserve and analyze parser errors: they often confirm internal reachability even when they do not return body content.

## References

- `references/silentium-flowise-gogs-chain.md` — condensed session-specific notes from a Flowise → container root → SSH `ben` → root-run Gogs privesc path.
- `references/silentium-gogs-privesc-lessons.md` — deeper lessons for root-run Gogs dead ends, `START_SSH_SERVER=false` forced-command behavior, wiki `old_title` `.md` deletion, and kernel-LPE fallback discipline.
- `references/silentium-reset-newip-ops.md` — operational notes for HTB VPN/new-IP resets, stale CAPTCHA handling, and enforcing batched delegation during multi-lane privesc.
- `references/gogs-cve-2025-8110-putcontents.md` — reusable exploitation notes for Gogs <=0.13.3 authenticated PutContents symlink write leading to root-run Git config command execution.
- `references/kobold-arcane-privatebin-pivots.md` — Arcane root-run Docker manager lessons: public template SSRF as a reachability oracle, default-JWT limitations without user UUIDs, and PrivateBin/operator volume pitfalls.
