# Command OS V2 rollback and coexistence

Status: preview isolation, database backup/restore primitives, and an immutable
V2 static-artifact pointer rollback are proven on disposable stores and
processes. Default-route cutover and one-command full production rollback are
not authorized or rehearsed yet.

## Preview rollback

1. Set `COMMAND_OS_V2_KILL_SWITCH=true` and restart only the V2 service.
2. Confirm `/api/v2/*` returns the explicit V2-disabled response.
3. Verify the legacy process, routes, database/files, storage keys, and primary
   browser workflow remain unchanged.
4. Preserve the V2 database, artifacts, event history, and audit records for
   diagnosis; do not rewrite them into legacy stores.
5. Restore a V2 database only while the V2 service is stopped and only from a
   checksum-verified backup.

The wired commands are `db:verify`, `db:backup`, and `db:restore`. A disposable
backup/restore/quick-check cycle has passed. This is not yet a production data
rollback rehearsal.

## Immutable V2 static-artifact handoff

The isolated V2 application now has a versioned static-release store and CLI:

- [StaticArtifactReleaseStore.ts](../../chillspwn/plugin/command-os-v2/server/static-release/StaticArtifactReleaseStore.ts)
- [cli.ts](../../chillspwn/plugin/command-os-v2/server/static-release/cli.ts)

Use absolute paths carrying a `command-os-v2` namespace. The release root and
built `dist` source must be disjoint and must not traverse legacy, `webapp`, or
symlinked paths. A bounded handoff is:

```bash
export COMMAND_OS_V2_STATIC_RELEASE_ROOT=/srv/chillspwn/command-os-v2-static-releases
export COMMAND_OS_V2_STATIC_RELEASE_ID=20260717T0514Z-<exact-build-id>

bun run release:static:stage \
  --root "$COMMAND_OS_V2_STATIC_RELEASE_ROOT" \
  --release-id "$COMMAND_OS_V2_STATIC_RELEASE_ID" \
  --dist /absolute/path/to/command-os-v2/dist

bun run release:static:verify \
  --root "$COMMAND_OS_V2_STATIC_RELEASE_ROOT" \
  --release-id "$COMMAND_OS_V2_STATIC_RELEASE_ID"

bun run release:static:activate \
  --root "$COMMAND_OS_V2_STATIC_RELEASE_ROOT" \
  --release-id "$COMMAND_OS_V2_STATIC_RELEASE_ID"

bun run release:static:pin \
  --root "$COMMAND_OS_V2_STATIC_RELEASE_ROOT"
```

Staging copies only regular files into a same-filesystem temporary directory,
writes a sorted per-file SHA-256 manifest and aggregate digest, verifies the
complete copy, makes the release tree read-only, and atomically renames it to
`releases/<release-id>`. Symlinks, special files, unsafe relative paths,
unmanifested files, partial copies, changed source files, reused release IDs,
and legacy-owned roots fail closed. Activation verifies the selected manifest
before atomically replacing `state/active.json`; the exact previous release ID
and manifest digest remain in that pointer and the prior version directory is
retained.

When `COMMAND_OS_V2_SERVE_STATIC=true` and
`COMMAND_OS_V2_STATIC_RELEASE_ROOT` is configured, `server/index.ts` reads the
pointer once during startup and pins the exact verified version directory.
`express.static` and the SPA fallback use that immutable directory—not the
mutable pointer or a shared serving directory. Changing the pointer while the
process runs cannot change its files. A deliberate V2 process restart is
required to pin a newly activated release. Missing, malformed, partial, extra,
or hash-mismatched active content refuses startup before the listener opens.

### Pointer-only rollback

The one-command static rollback is:

```bash
bun run release:static:rollback \
  --root "$COMMAND_OS_V2_STATIC_RELEASE_ROOT"
```

Rollback first verifies the currently active manifest and the exact prior
manifest digest recorded in the pointer. It then atomically swaps only the V2
static pointer and preserves both version directories. A running process stays
pinned to its existing directory; restart only the isolated V2 process when it
is appropriate to adopt the rolled-back pointer.

This command does **not** change the legacy route, reverse proxy, API/backend,
database, migrations, workers, queues, provider/MCP state, control-plane
ownership, active runs, or service lifecycle. It is not the full cutover
rollback described below and must never be presented as one.

### Focused evidence

- [StaticArtifactReleaseStore.test.ts](../../chillspwn/plugin/command-os-v2/server/static-release/__tests__/StaticArtifactReleaseStore.test.ts):
  `7` tests passed with `47` assertions. This covers atomic version staging,
  complete manifest verification, exact process pins, prior retention,
  verified rollback, tamper/partial/extra-file refusal, unsafe filesystem
  entries, and the CLI's static-only scope warning.
- [StaticServerHandoff.integration.test.ts](../../chillspwn/plugin/command-os-v2/server/static-release/__tests__/StaticServerHandoff.integration.test.ts):
  `1` real-process integration test passed with `12` assertions in `878 ms`.
  The standalone V2 server served release A, continued serving A after the
  pointer activated B, pinned and served B after graceful restart, and exited
  nonzero before listening after active B was tampered.
- `bun run typecheck` passed both TypeScript configurations after the focused
  process test.

## Cutover prerequisites

Before the default route may change:

- freeze and back up legacy and V2 stores;
- complete source-hash reconciliation and quarantine review;
- prove no run has concurrent control-plane ownership;
- drain active work or checkpoint it into an explicitly classified state;
- run the no-retry full browser matrix, legacy compatibility, migration,
  restart, backup, restore, visual, accessibility, performance, and soak gates;
- record human release approval and the rollback owner/window.

## One-command rollback design

The production deployment command must atomically restore the legacy entry
route/origin, stop or kill-switch V2 mutations, preserve post-cutover V2 data,
and emit an audit record. It must not reverse-import V2 state into fragile
legacy files. Runs created under V2 remain V2-owned and visible read-only while
their recovery is decided explicitly.

After rollback:

- verify legacy health and critical journeys;
- verify V2 has no active workers, leases, subscribers, or orphan processes;
- reconcile every run and terminal event;
- retain both code and data through the documented rollback window;
- investigate before any new cutover attempt.

## Current blockers

The deployment switch, signed rollback artifact, full service/data rollback,
ownership-transfer rehearsal, post-cutover reconciliation, and human sign-off
do not yet exist. Therefore the legacy application remains the only default and
no cutover claim is valid. The verified static pointer is a necessary bounded
primitive, not closure of these blockers.
