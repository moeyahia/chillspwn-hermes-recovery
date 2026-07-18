# Command OS V2 operational scripts

## Kernel-offline VulnIntel CVE implementation canary

`audit:v2-tool-coverage:vulnintel-local` exercises the ten exact configured
`vulnintel-cve-mcp` FastMCP bindings with deterministic fixtures inside a
read-only, unprivileged Bubblewrap sandbox with a separate network namespace.
It makes no public request and contacts no engagement target or public LLM.

```bash
bun run audit:v2-tool-coverage:vulnintel-local \
  --receipt=/absolute/test-evidence/vulnintel-cve-canary.json
```

The command intentionally exits non-zero while any binding loses a
deterministic failure or applicable 429 category. See
`docs/command-os-v2/vulnintel-cve-tool-canary.md` for the exact 8/10 result and
the two retained implementation blockers.

`test:v2-tool-coverage` is the complete executable release gate. It combines
the kernel-offline VulnIntel fixture, the disposable loopback-only Pentest
Recon canary against the root-provisioned V2-only tool bundle, and the two
read-only public NVD bindings. It never accepts an engagement target. The
inventory-only/report commands remain separate so routine diagnostics do not
silently make public requests.

## Immutable live schema-7 to candidate schema-9 rehearsal

The release rehearsal reads the `/opt/chillspwn/plugin` symlink and its exact
immutable schema-7 release target, copies that target below the protected
`/root/chillspwn-schema8-rehearsal` evidence root, and constructs a schema-8
compatibility bridge by adding only the current migration 8 and its mechanical
index registration. The current candidate index must be exactly that bridge
index plus migration 9.

It uses only disposable databases, state roots, loopback ports, and
credential-free process environments. It proves schema 7→8→9 migration,
idempotent bridge and candidate restarts, mode-0600 backups, the schema-8
bridge's fail-closed schema-9 boundary, restore of the schema-8 backup, forward
migration after rollback, clean server shutdown, and an unchanged live source,
symlink, PID, state, and restart counter. It never restarts or reconfigures the
live service and never reads deployment credentials.

Run the negative safety gate first. The full command requires deliberate
confirmation through the package script and must run only while the candidate
worktree is stable:

```bash
bun run test:rehearsal:schema7-to-schema9:safety
bun run test:rehearsal:schema7-to-schema9
```

A passing isolated rehearsal is evidence for review, not authorization to
promote an artifact, switch a symlink, migrate canonical data, or restart the
service.

## Disposable schema-9 Guided-boundary rehearsal

The schema-9 rehearsal creates its own synthetic schema-8 SQLite database
directly beneath a random `/tmp/chillspwn-schema9-rehearsal.*` directory. It
backs up that fixture, applies only migration 9, checks fail-closed cleanup and
the one-pending-decision constraint, repeats migration startup, verifies the
schema-8 application boundary, and removes the entire workspace on exit.

It accepts no database path, reads no deployment configuration, contacts no
service, and cannot be redirected to the canonical database:

```bash
bun run test:rehearsal:schema9:safety
bun run test:rehearsal:schema9
```

This is database-boundary evidence, not a production migration or service
promotion rehearsal. The historical schema-8 compatibility-bridge tooling and
evidence remain separate because they preserve an earlier live-release
provenance chain.

## Portable performance and comparison gates

The portable gates operate only on generated build artifacts and disposable
SQLite fixtures:

```bash
bun run performance:bundle
bun run performance:runtime
bun run performance:missions
```

`performance:missions` uses two explicitly synthetic canonical evaluation
pairs, one per public journey. It validates metric direction and comparison
scope without loading fixture records into the product or claiming that a live
mission improved. `performance:check` combines these gates with the strict
browser performance/accessibility slice.

## Live Grok restart/resume smoke

`test:live:grok-restart-resume` is an opt-in deployment check, not a portable
CI test. It starts the real server twice against a disposable database, kills
the first process group while a Grok OAuth planning turn is durably in flight,
waits for the lease to expire, and verifies deterministic recovery and exactly
one no-op specialist tool result.

Run it only from a root-controlled installed checkout as the unprivileged
ChillsPwn service account. The account must own its refreshable Grok OAuth file.
Supply the file path, never its contents:

```bash
CHILLSPWN_LIVE_RESTART_CONFIRM=authorized-local-selftest-restart-resume \
CHILLSPWN_LIVE_RESTART_SERVICE_USER=chillspwn \
CHILLSPWN_LIVE_RESTART_PORT=34131 \
GROK_AUTH_PATH=/absolute/service-owned/path/to/grok-auth.json \
bun run test:live:grok-restart-resume
```

The harness rejects UID 0, port 3131, occupied ports, relative authentication
paths, writable/unreviewed assets, and MCP configurations containing anything
other than the no-network selftest asset bound to the existing static
`ReconScout` route `sechub-reconnaissance.quick_scan`. Before the child server
starts, the harness independently verifies the root-controlled config and asset
hash, then supplies a child-only attestation opt-in. The server repeats those
checks before it exposes the deterministic empty input template. It does not
read or print OAuth content.
The temporary HOME, state directory, SQLite database, vault, sessions, and
workspace are removed after graceful shutdown, including failure cleanup.

The portable safety checks are:

```bash
bun test server/command-runtime/__tests__/LiveGrokRestartSmokeSafety.test.ts
```
