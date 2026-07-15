# Security Policy

Treat this repository as confidential and keep GitHub visibility set to **private**. It is a source and configuration recovery snapshot, not an approved location for credentials, engagement evidence, or operational state.

## Supported versions

| Version | Supported |
|---|---|
| Current `main` branch | Yes |
| Historical recovery tags | Recovery reference only |
| Unmaintained forks or exported snapshots | No |

Security fixes target the current default branch. Historical tags are immutable recovery points and may retain issues fixed later.

## Reporting a vulnerability

Do not disclose an unpatched vulnerability in a public issue, discussion, pull request, chat log, screenshot, or demonstration environment.

Use GitHub private vulnerability reporting when it is enabled for this repository. If it is unavailable, contact the repository owner through a pre-established private channel and ask for a secure reporting path. Do not include exploit details in the initial public contact.

Include:

- the affected commit or recovery tag;
- the affected component and configuration;
- clear reproduction steps or a minimal proof of concept;
- expected and actual behavior;
- impact and realistic attack prerequisites;
- whether credentials, target data, or personal information may be exposed;
- suggested remediation, if known; and
- a safe contact method for follow-up.

Use synthetic fixtures and redact logs. Never attach real provider credentials, keys, client data, targets, loot, or third-party personal information. If a credential may have been exposed, revoke or rotate it immediately; deleting a file or commit does not make the credential safe.

## Recovery repository boundary

Never add:

- `.env*` other than sanitized `*.example` templates, `auth.json*`, OAuth tokens, cookies, or CLI authentication directories;
- SSH/private keys, PFX/P12/JKS/keystore files, Kerberos caches, password databases, cloud credentials, or VPN profiles;
- `state.db`, `kanban.db`, SQLite WAL/SHM files, conversations, memories, sessions, or raw provider logs;
- exploit artifacts, loot, scans, client reports, target-specific notes, or unsanitized screenshots; or
- dependencies, build output, caches, generated Android web assets, or downloaded binaries unless a documented recovery requirement justifies them.

Before every push, run:

```bash
./scripts/verify-snapshot.sh
gitleaks dir . --redact --no-banner
```

The repository's Gitleaks allowlists cover reviewed upstream fixtures and documentation. Treat a zero result as one signal, not proof: inspect the exact staged diff and run an independent verifier such as TruffleHog when available.

If operational state must be backed up, stop or quiesce writers, make consistent database snapshots, encrypt the archive client-side to a recovery key held off the server, and upload only ciphertext. Keep the decryption key off the server and outside this repository.

## Recovered-host secret and process boundary

The reviewed systemd units read the optional legacy `/opt/chillspwn/plugin/webapp/.env` first and canonical `/root/.hermes/.env` second, then run the application as `chillspwn`. Both files must be single-link regular files owned by `root:root`, mode `0600`, with no extended ACL; the service identity must be unable to read or write them. The application consumes inherited values and must not reopen either file. Both application units run the root-owned Hermes configuration validator before startup; it rejects duplicate keys and common literal-secret structures without printing values.

Direct provider children and individual Council lanes receive provider-aware environment subsets; the multi-provider Council launcher still holds the inputs required to create those lanes. This reduces accidental cross-provider credential inheritance but is not strong process isolation because the dashboard and provider children share one UID. Same-UID `/proc` access and service-readable refreshable OAuth stores remain residual risks. Use separate provider service identities and a credential broker if the deployment requires provider-to-provider isolation.

Reusable memory is a separate root-only boundary. The `chillspwn` identity must not traverse `/root/.hermes/memories`; normal dashboard and gateway access goes through `chillspwn-memory.service` and its group-restricted Unix socket. Do not work around broker failures by weakening memory permissions.

`ALLOWED_WORKSPACE_ROOTS` is also a cross-cutting execution boundary: it governs file routes, engagement APIs and working directories, interactive Claude workspace access, and OSINT output. Keep the default `/root/htb/boxes` and `/root/engagements` unless a narrower or separately provisioned root is required. Never add all of `/root`, provider authentication, protected memory, reviewed source, or the repository checkout.
