# Configuration

## Sources and precedence

ChillsPwn reads server configuration from inherited environment variables. For local Bun runs, copy `.env.example` to `.env`; Bun loads that development file. The integrated recovery deployment lets systemd read two optional root-only files before dropping to `User=chillspwn`: legacy `/opt/chillspwn/plugin/webapp/.env` first and canonical `/root/.hermes/.env` second, so canonical values take precedence. The server does not reopen either file at runtime.

Never place production values in the repository. Keep environment files, provider auth files, MCP credentials, certificates, and engagement configuration outside the checkout. API-secret environment files must be `root:root` mode `0600`, have no extended ACL, and be unreadable and unwritable by `chillspwn`. Refreshable CLI OAuth stores are a different class: they must be narrowly service-owned when the provider must replace tokens atomically.

Both integrated application services run the root-owned structural validator before startup:

```bash
/root/hermes-venv/bin/python /opt/chillspwn/libexec/validate-hermes-config.py \
  --allow-missing /root/.hermes/config.yaml
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

Enable one capability at a time and verify audit events, approvals, workspace roots, and provider behavior.

## Filesystem scope

`ALLOWED_WORKSPACE_ROOTS` accepts comma- or colon-separated absolute roots and is the single source for:

- file-browser roots and gated file writes;
- engagement listing, creation, report discovery, and engagement working-directory resolution;
- the workspace roots passed to interactive Claude as `--add-dir`; and
- the parent roots under which detached OSINT output directories may be created.

The default is exactly `/root/htb/boxes` and `/root/engagements`. The combined recovery helper creates both as root-owned operational-data directories and grants `chillspwn` narrow access through directory/default ACLs. It does not infer or provision custom entries from the private environment file. Before configuring a custom root, create it as a real non-symlink directory, make it readable/writable/traversable by `chillspwn`, and verify that new children inherit usable access. The runtime selects the first configured root that exists and is writable for new engagement/OSINT output.

Do not add `/root`, the repository checkout, protected reusable memory, provider-auth directories, or reviewed code/template trees. Real-path containment and no-follow writes reject traversal and symlink escapes, but a needlessly broad configured root still grants a needlessly broad capability.

## Provider configuration

- `OPENROUTER_API_KEY`: server-side only; leave blank when unused.
- `GEMINI_API_KEY`: consumed by the external Hermes Python orchestrator for the current direct Gemini API path.
- `GROK_BIN`: reviewed absolute Grok executable; the integrated deployment uses root-owned `/opt/chillspwn/bin/grok`.
- `GROK_HOME`: mutable Grok CLI state directory; the integrated deployment uses `/root/.hermes/chillspwn/grok`.
- `GROK_AUTH_PATH`: refreshable OAuth auth-file path; the integrated deployment uses `/root/.hermes/auth/grok/auth.json`.

Claude and Codex authentication is owned by their installed CLI/Hermes execution path. The integrated units isolate their state under `/root/.hermes/auth/claude` and `/root/.hermes/auth/codex`. Keep every provider credential out of the client bundle.

Direct provider subprocess environments and individual Council lanes are built from provider-aware allowlists. The Council launcher itself still receives the inputs required for its configured multi-provider lanes. These controls reduce accidental cross-provider secret inheritance, but all provider children currently share the `chillspwn` UID with the dashboard. A compromised child may still inspect same-UID process state where host `/proc` policy permits it or access OAuth stores readable by that UID. Separate provider identities and a credential broker are required for strong provider-to-provider isolation.

## Runtime paths and memory mediation

The integrated units set:

- `CHILLSPWN_STATE_DIR=/root/.hermes/chillspwn`
- `CHILLSPWN_SESSIONS_DIR=/root/.hermes/chillspwn/sessions`
- `CHILLSPWN_PERSONAS_DIR=/root/.hermes/chillspwn/personas`
- `CHILLSPWN_MEMORY_GUARD=required`
- `CHILLSPWN_MEMORY_SOCKET=/run/chillspwn-memory/broker.sock`

Reusable memory under `/root/.hermes/memories` is `root:root` and not directly accessible to the dashboard or provider children. The root-owned `chillspwn-memory.service` exposes only validated additive writes and policy-filtered `safe-read` over its group-restricted Unix socket. Whole-file replacement, deletion, restoration, and arbitrary paths are not available to the service account.

## Runtime and delegation

The tracked `.env.example` documents planning, managed-run, OpenRouter gate, memory/reporting, specialist routing, session lifecycle, MCP, and approval variables with their secure or current defaults.

Important enforcement distinctions:

- `ENFORCE_CHILLSPWN_NO_HANDS` defaults to `true` and keeps the commander coordination-only.
- `ENFORCE_CHILLSPWN_DELEGATION` and `REQUIRE_SPECIALIST_ASSIGNMENT` are separate rollout controls.
- `APPROVAL_MODE=human` is the safest initial setting.
- OpenRouter gating should move from `off` to `dry-run` before `enforce`.
- MCP should move from `disabled` to `dry-run` before `enabled`.

## Capacitor

Capacitor packages `dist/` by default. `CAPACITOR_SERVER_URL` is for intentional live-reload development only and should be an HTTPS URL on trusted infrastructure. `CAPACITOR_ALLOW_MIXED_CONTENT` defaults to `false`.

The native Android project source is retained for recovery. Generated Gradle output and `android/app/src/main/assets/` are ignored; rebuild the web client and run `bunx cap sync android` to recreate them. No supported mobile release process is currently tested in CI.

## MCP vendor keys

`.env.mcp.example` lists optional variable names for vulnerability-intelligence, OSINT, cloud-account, Active Directory, and SSH integrations. It contains no values. Per-engagement target credentials should not be stored globally.

## Configuration review

Before restarting a service:

1. Validate that no environment file is tracked: `git check-ignore -v .env`.
2. Confirm the environment file is a single-link regular file owned by `root:root`, mode `0600`, with no extended ACL.
3. Confirm `sudo -u chillspwn test ! -r <environment-file>` and `test ! -w <environment-file>` both succeed.
4. Run the Hermes configuration validator without printing the configuration.
5. Review non-loopback exposure and dashboard authentication.
6. Review every enabled risky feature and approval mode.
7. Restart all affected units and inspect `/api/health`, `chillspwn-memory.service`, dashboard logs, and gateway logs.
