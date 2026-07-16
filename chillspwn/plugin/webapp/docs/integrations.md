# Integration contracts

## Core versus optional integrations

The frontend build and portable test suite do not require provider credentials. Runtime features become available only when their external contracts are installed for the same operating-system account that runs ChillsPwn.

## Personas and SOUL files

The server loads live personas from `CHILLSPWN_PERSONAS_DIR`, defaulting below the configured ChillsPwn state root:

```text
<CHILLSPWN_PERSONAS_DIR>/<persona-name>/persona.json
```

The integrated units use the root-controlled release path
`/opt/chillspwn/plugin/webapp/server/agents/personas`. Historical phase
documentation may refer to `${HOME}/.claude/chillspwn/personas`; that is a
migration source, not the maintained deployment layout.

Persona Markdown under `server/agents/personas/` is tracked source material, not an automatic deployment mechanism. A fresh checkout without live persona JSON can start, but chat cannot select a persona.

Never publish live persona directories without reviewing them for provider settings, internal paths, user information, and engagement-specific instructions.

## Hermes

OpenRouter, Codex, Gemini, Mission Board compatibility, conversation recall,
reports, and other paths rely on the pinned Hermes environment and explicit
state below `/var/lib/chillspwn/hermes`. Current examples include:

- the OpenRouter orchestration Python entry point;
- Mission Board and conversation MCP servers;
- the Council runner;
- the base Mission Board database schema;
- memory/configuration files and report generators.

These are runtime dependencies, not npm/Bun packages. The outer recovery repository retains reviewed Hermes source/runtime contracts and restores them to their expected host paths. If this webapp subtree is extracted as a standalone repository, those components need a separately versioned dependency or bootstrap mechanism.

## Claude

Claude-backed personas invoke the installed Claude CLI in print/stream mode. Authentication is owned by the CLI and operating-system account. ChillsPwn does not copy Claude credentials into this repository.

The legacy Claude CLI path owns its native tool execution; some dashboard runtime views are observational rather than an enforcement boundary. Consult the security model before enabling risky features.

## OpenRouter

OpenRouter-backed execution requires `OPENROUTER_API_KEY` in the inherited service environment. Leave it unset when unused. The value belongs in the root-owned systemd environment file, not the frontend, repository, Hermes YAML, or a service-readable file.

The optional runtime gate is disabled by default. Roll it out in `dry-run` mode before `enforce`, with fail mode `deny`.

## Codex and Gemini

Current Codex and Gemini flows are mediated by the external Hermes orchestration path rather than a self-contained SDK in this repository. The integrated units isolate Codex state through `CODEX_HOME=/var/lib/chillspwn/codex`. Gemini's current direct Google API path expects `GEMINI_API_KEY` in the inherited ChillsPwn service environment; the external Python orchestrator consumes it. The value must remain server-side and outside Git and Hermes YAML.

## Grok ACP

The Grok path uses the reviewed absolute `grok` CLI as an ACP process over standard input/output. It is designed to draw from the CLI's refreshable OAuth session:

- `GROK_BIN` selects the immutable executable; the integrated deployment uses `/opt/chillspwn/bin/grok`.
- `GROK_HOME` selects the Grok CLI state directory.
- `GROK_AUTH_PATH` may point directly to the OAuth `auth.json` file.
- The credential file is not read into application configuration or copied into the ACP workspace.
- API-key variables are deliberately removed from the commander child environment.

Commander sessions use an isolated HOME/configuration root, a controlled profile, explicitly supplied Mission Board and conversation MCP servers, tool-surface attestation, and a pre-tool guard. Command OS planning sessions use the same canonical no-hands SOUL through a narrower Autonomous/Guided planning projection, run with zero MCP servers, and can only select bindings from the reviewed specialist inventory; the runtime performs the binding and contract checks after the provider returns. The commander is coordination-only, and specialists own execution. The application launches with `--reasoning-effort high`, which is the maintained Expert thinking setting.

The integrated contract supplies root-controlled Bun and Hermes Python under
`/opt/chillspwn-runtime` and configured MCP assets under reviewed absolute
paths. A standalone webapp deployment must provide equivalent immutable files
before Grok commander readiness can pass.

If a planning response is valid JSON but omits a required schema field, the
runtime may request exactly one schema-repair turn. It reports only the safe
field path, never replays or persists the rejected raw response, and accounts
both OAuth provider turns. Secret-like material, policy/scope denial,
unavailable specialist bindings, and Autonomous manual actions fail closed
without a repair turn.

## Provider child-environment boundary

Direct provider processes receive explicit allowlisted environment subsets, so a Claude, Grok, Codex, Gemini, or OpenRouter child does not automatically inherit every other provider's API variables. Individual Council lanes use provider-aware construction, while their multi-provider launcher necessarily holds the inputs needed to create its configured lanes. This is defense in depth only: the dashboard and provider children still share the `chillspwn` UID, so host `/proc` policy and service-readable OAuth stores can permit same-UID access. Strong mutual isolation requires separate service identities and a credential broker.

## Second Brain

Command OS V2 memory is canonical in
`/var/lib/chillspwn/command-os-v2.sqlite` and projected under
`/var/lib/chillspwn/brain-vaults`. Retrieval, context-pack use, lifecycle,
engagement isolation, correction, and forgetting are database-mediated. The
hardened deployment does not require the legacy root memory broker.

## MCP Arsenal

The MCP bridge is off by default. Its safe activation sequence is:

1. Install and review the MCP server separately.
2. Configure an allowlisted arsenal manifest outside the repository.
3. Set `ENABLE_MCP_ARSENAL=true` and `MCP_ARSENAL_MODE=dry-run`.
4. Review health, proposed calls, output limits, and approval behavior.
5. Set `MCP_ARSENAL_MODE=enabled` only after validation.

Auto-started servers have separate opt-in flags. Docker-backed MCP is disabled
for the hardened host because Docker socket access is root-equivalent. Vendor
API-key names are listed in `.env.mcp.example`; values belong only in the
service secret store.

## Reports and assets

Report generation depends on templates, Python scripts, WeasyPrint, and engagement files. The outer recovery repository retains sanitized report templates, while engagement inputs remain external. The reviewed template tree is selected through `CHILLSPWN_REPORT_TEMPLATE_DIR` and defaults to the root-controlled `/opt/chillspwn/report-template`; it is intentionally separate from mutable engagement roots. Optional wordlists, binaries, and MCP assets may be installed under `/opt/chillspwn-*`; the setup scripts inventory or describe some resources but are not complete idempotent installers.

## Readiness checklist

Before enabling a persona, verify:

- its live persona JSON and SOUL source exist;
- the selected provider CLI/service authenticates as the service account;
- the required Hermes entry point exists;
- the Mission Board database is writable and has its base schema;
- credential files are mode `0600` or stricter;
- risky features and approval policy match the deployment;
- logs and engagement roots are outside the Git worktree.
