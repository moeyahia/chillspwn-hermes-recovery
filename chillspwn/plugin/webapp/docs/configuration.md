# Configuration

## Sources and precedence

ChillsPwn reads server configuration from inherited environment variables. For local Bun runs, copy `.env.example` to `.env`; Bun loads that development file. The hardened deployment lets systemd read root-owned `/etc/chillspwn/chillspwn.env` and, for the gateway, `/etc/hermes-gateway.env` before dropping to `User=chillspwn`. The processes do not reopen those files at runtime.

Never place production values in the repository. Keep environment files, provider auth files, MCP credentials, certificates, and engagement configuration outside the checkout. API-secret environment files must be `root:root` mode `0600`, have no extended ACL, and be unreadable and unwritable by `chillspwn`. Refreshable CLI OAuth stores are a different class: they must be narrowly service-owned when the provider must replace tokens atomically.

When a Hermes YAML configuration is installed, run the root-controlled
structural validator as a pre-deployment gate:

```bash
/opt/chillspwn-runtime/hermes-venv/bin/python \
  /opt/chillspwn/libexec/validate-hermes-config.py \
  --allow-missing /var/lib/chillspwn/hermes/config.yaml
```

It rejects duplicate YAML keys, literal values under credential fields, URL-embedded credentials, and selected high-confidence credential patterns without printing the values. Environment references such as `${OPENROUTER_API_KEY}` are permitted. This is a structural guard, not proof that arbitrary free-form text contains no disguised secret.

## Network and authentication

| Variable | Secure default | Purpose |
|---|---:|---|
| `CHILLSPWN_BIND` | `127.0.0.1` | HTTP and WebSocket bind address |
| `CHILLSPWN_PORT` | `3131` | HTTP and WebSocket port |
| `DASHBOARD_TOKEN` | empty | Shared token for non-loopback clients |
| `CHILLSPWN_ALLOW_UNSAFE_NO_AUTH` | `false` | Explicitly bypass exposed-host auth; avoid in persistent deployments |

If the bind address is non-loopback and no token is configured, startup fails closed. Prefer loopback behind an SSH tunnel or a private reverse proxy. Never put a real token in a URL copied to logs or documentation.

## Risky feature gates

The following default to `false`:

- `ENABLE_TERMINAL`
- `ENABLE_PROXY`
- `ENABLE_FILE_WRITE`
- `ENABLE_SECURITY_TOOLS`
- `ENABLE_MCP_ARSENAL`
- `ENABLE_OPENROUTER_RUNTIME_GATING`
- `ENABLE_RUNTIME_MANAGED_CHAT`
- `ENABLE_LEGACY_EXECUTION_API`

Enable one capability at a time and verify audit events, approvals, workspace roots, and provider behavior.

`ENABLE_LEGACY_EXECUTION_API` is a rollback-only compatibility switch. When it
is `false` (the default), historical unversioned `GET`/`HEAD` APIs remain
readable for migration and reconciliation, while unversioned REST mutations,
`/proxy`, legacy chat/terminal WebSocket commands, queued-board dispatch,
detached OSINT rehydration, and legacy startup writers are disabled. Canonical
`/api/v2` Autonomous and Guided mutations are unaffected. Setting the switch to
`true` makes readiness visibly degraded and emits a startup warning; remove the
opt-in immediately after the reviewed rollback task.

## Filesystem scope

`ALLOWED_WORKSPACE_ROOTS` accepts comma- or colon-separated absolute roots and is the single source for:

- file-browser roots and gated file writes;
- engagement listing, creation, report discovery, and engagement working-directory resolution;
- the workspace roots passed to interactive Claude as `--add-dir`; and
- the parent roots under which detached OSINT output directories may be created.

The production value is exactly
`/var/lib/chillspwn/workspaces/htb/boxes,/var/lib/chillspwn/workspaces/engagements`.
Tracked systemd mount units bind existing `/root/htb/boxes` and
`/root/engagements` data to those service paths. Install and verify the mounts
before either service starts. Before configuring any additional root, create a
real non-symlink directory, make it readable/writable/traversable by
`chillspwn`, and repeat the path-boundary review.

Do not add `/root`, the repository checkout, protected reusable memory, provider-auth directories, or reviewed code/template trees. Real-path containment and no-follow writes reject traversal and symlink escapes, but a needlessly broad configured root still grants a needlessly broad capability.

`CHILLSPWN_REPORT_TEMPLATE_DIR` is a separate reviewed-code boundary for the
canonical report generator, templates, and logo assets. It must be an absolute,
non-root path and defaults to `/opt/chillspwn/report-template`. Production must
install that tree as root-owned and non-writable by the service identity; never
place it inside an engagement root or mutable provider state.

## Provider configuration

- `OPENROUTER_API_KEY`: server-side only; leave blank when unused.
- `GEMINI_API_KEY`: consumed by the external Hermes Python orchestrator for the current direct Gemini API path.
- `GROK_BIN`: reviewed absolute Grok executable; the integrated deployment uses root-owned `/opt/chillspwn/bin/grok`.
- `GROK_HOME`: mutable Grok CLI state directory; production uses `/var/lib/chillspwn/grok-home`.
- `GROK_AUTH_PATH`: refreshable OAuth auth-file path; production uses `/var/lib/chillspwn/grok-auth/auth.json`.
- `GROK_COMMANDER_BUN`: root-controlled Bun used by the Grok commander hook; production uses `/opt/chillspwn-runtime/bin/bun`.
- `GROK_COMMANDER_PYTHON`: root-controlled Python interpreter for the two reviewed local commander MCP processes; defaults to `/usr/bin/python3`.
- `GROK_COMMANDER_MCP_SCRIPT_DIR`: absolute reviewed directory containing the packaged board and conversation MCP entry points. Production normally uses the immutable release copy.

`CHILLSPWN_GROK_ROLE` is an internal per-child marker set by the runtime after
policy selection. Operators must not configure or persist it. `CHILLSPWN_MEM_CLI`
selects only the legacy compatibility helper used by old chat surfaces; it is
not the Command OS memory store and must point to reviewed local code when that
compatibility surface is enabled.

Claude and Codex authentication is owned by their installed CLI/Hermes execution path. The integrated units isolate their service-owned state under `/var/lib/chillspwn/claude` and `/var/lib/chillspwn/codex`. Keep every provider credential out of the client bundle.

Direct provider subprocess environments and individual Council lanes are built from provider-aware allowlists. The Council launcher itself still receives the inputs required for its configured multi-provider lanes. These controls reduce accidental cross-provider secret inheritance, but all provider children currently share the `chillspwn` UID with the dashboard. A compromised child may still inspect same-UID process state where host `/proc` policy permits it or access OAuth stores readable by that UID. Separate provider identities and a credential broker are required for strong provider-to-provider isolation.

## Runtime paths and memory mediation

The integrated units set:

- `CHILLSPWN_STATE_DIR=/var/lib/chillspwn/state`
- `CHILLSPWN_SESSIONS_DIR=/var/lib/chillspwn/state/sessions`
- `CHILLSPWN_PERSONAS_DIR=/opt/chillspwn/plugin/webapp/server/agents/personas`
- `COMMAND_OS_DB_PATH=/var/lib/chillspwn/command-os-v2.sqlite`
- `CHILLSPWN_VAULT_ROOT=/var/lib/chillspwn/brain-vaults`
- `HERMES_HOME=/var/lib/chillspwn/hermes`

Command OS V2 memory is canonical in SQLite and projected to the configured
Obsidian-compatible vault under explicit memory scope, lifecycle, consent, and
forgetting rules. The hardened units have no root memory-broker dependency.
Do not set the legacy `CHILLSPWN_MEMORY_*` variables in production.

## Runtime and delegation

The tracked `.env.example` documents planning, managed-run, OpenRouter gate, memory/reporting, specialist routing, session lifecycle, MCP, and approval variables with their secure or current defaults.

Important enforcement distinctions:

- `ENFORCE_CHILLSPWN_NO_HANDS` defaults to `true` and keeps the commander coordination-only.
- `ENFORCE_CHILLSPWN_DELEGATION` and `REQUIRE_SPECIALIST_ASSIGNMENT` are separate rollout controls.
- `APPROVAL_MODE=human` is the safest initial setting.
- OpenRouter gating should move from `off` to `dry-run` before `enforce`.
- MCP should move from `disabled` to `dry-run` before `enabled`.
- `MCP_ARSENAL_ALLOW_DOCKER=false` is mandatory for this host contract; Docker
  socket access is root-equivalent.

## Capacitor

Capacitor packages `dist/` by default. `CAPACITOR_SERVER_URL` is for intentional live-reload development only and should be an HTTPS URL on trusted infrastructure. `CAPACITOR_ALLOW_MIXED_CONTENT` defaults to `false`.

The native Android project source is retained for recovery. Generated Gradle output and `android/app/src/main/assets/` are ignored; rebuild the web client and run `bunx cap sync android` to recreate them. No supported mobile release process is currently tested in CI.

## MCP vendor keys

`.env.mcp.example` lists optional variable names for vulnerability-intelligence, OSINT, cloud-account, Active Directory, and SSH integrations. It contains no values. Per-engagement target credentials should not be stored globally.

## Configuration review

Before restarting a service:

1. Validate that no environment file is tracked: `git check-ignore -v .env`.
2. Confirm each environment file is a single-link regular file owned by `root:root`, mode `0600`, with no extended ACL.
3. Confirm `sudo -u chillspwn test ! -r <environment-file>` and `test ! -w <environment-file>` both succeed.
4. Run the Hermes configuration validator without printing the configuration.
5. Review non-loopback exposure and dashboard authentication.
6. Review every enabled risky feature and approval mode.
7. Verify the workspace mounts, restart the two application units, and inspect
   `/api/health`, `/api/v2/health`, dashboard logs, and gateway logs.
8. Confirm `chillspwn` has no supplementary groups, sudo permission, or Docker
   socket access.
