# Schema-7 to schema-9 immutable release rehearsal

Date: 2026-07-15

Status: passed in isolated state; production was not changed

Evidence root: `/root/chillspwn-schema8-rehearsal/20260715T222555Z`

This is the current-checksum successor to the superseded historical schema-8
bridge rehearsal. It started from the exact release referenced by
`/opt/chillspwn/plugin`, copied that release, added only current migration 8 and
its mechanical index registration, then exercised the exact current candidate
through migration 9. It did not migrate canonical data, change a symlink,
restart a service, read provider credentials, or authorize promotion.

## Guarded identities

| Item | Recorded identity |
| --- | --- |
| Live schema-7 release | `/opt/chillspwn/releases/20260715T132305Z-candidate/plugin` |
| Live content-tree SHA-256 | `2164e0d2ab7a26d7414e87e71638b9e2dfe712b48ffcedafdbcda8b774550a27` |
| Candidate Git HEAD | `9949ce8ee11ac195bbbf9f7f6bfd5fdc43aaa1a8` |
| Candidate branch | `feat/command-os-v2` |
| Candidate source-tree SHA-256 | `821953911bcf88704af2075035a31797bed30f30d2c7bd2fcc4fe2c5c4427388` |
| Candidate built-tree SHA-256 | `a4e7c7f7868c58322115a1c9e65aabd3659b3be4b583eb7692b0002e1cf43281` |
| Schema-8 bridge tree SHA-256 | `019f466caab0f64b9a1e287b90a679fda547310886fc6325d053e952d9f03074` |
| Migration-8 source SHA-256 | `947ad0775a942e9f3ec07332ffc1ea655ad041f59928f2574ee13db62395ff34` |
| Migration-8 database checksum | `0fc53a1511203d0e4caee2f0325ddeda56526d331aea7ca5560c8d0379a4e82c` |
| Migration-9 source SHA-256 | `0f52a3e3aea9b776a9f317354110be8d1233cdeff176017cc925124be8dd21fa` |
| Migration-9 database checksum | `648c053467249def8c869033099be268bea20d982d9b30f4d83310dc903eaa06` |

The candidate worktree was intentionally dirty and its complete status was
recorded in protected evidence. This rehearsal binds the exact source and built
identities above; any later source change or differently identified promotion
artifact requires a new rehearsal.

## Immutable bridge artifact

The bridge was copied from the live schema-7 release and its delta allowlist
contained exactly:

```text
webapp/server/db/migrations/008_follow_up_context.ts
webapp/server/db/migrations/index.ts
```

The bridge archive is mode `0444`:

```text
/root/chillspwn-schema8-rehearsal/20260715T222555Z/artifacts/chillspwn-schema8-bridge-20260715T222555Z.tar.gz
SHA-256 7f247c6cecee09c504ffae0c5d1865147544c187df1ececd6ec9df2f0a3ac36f
```

A fresh extraction matched the packaged bridge manifest and started cleanly
against a copied schema-8 database. The historical bridge archive remains
superseded and must not be used.

## Measured sequence

1. The exact live schema-7 code created a disposable database and a synthetic
   Guided mission canary.
2. The bridge applied migration 8 once; the second migration invocation applied
   nothing.
3. The bridge started twice at schema 8 and shut down cooperatively.
4. The current candidate applied migration 9 once; the second invocation
   applied nothing.
5. The candidate started twice at schema 9 and shut down cooperatively.
6. The schema-8 bridge rejected the schema-9 database with the expected unknown
   migration error, and before/after SQL dumps were identical.
7. The mode-`0600` schema-8 pre-candidate backup passed SQLite quick and foreign
   key checks and preserved the canary.
8. That backup was restored to a separate database and was logically identical
   to the retained backup. The bridge started successfully at schema 8.
9. The candidate migrated that restored copy forward to schema 9 and started
   successfully.
10. A fresh bridge archive extraction started against another copy of the
    retained schema-8 backup.

All 15 recorded database checkpoints passed `PRAGMA quick_check`, foreign-key
validation, exact migration count/version, and canary verification. The bridge
and candidate snapshots each passed server, client, and E2E type checking plus
the production build.

Seven isolated startup ports were used: `48516`, `36689`, `48821`, `39482`,
`51844`, `53369`, and `35642`. Every process group shut down cooperatively and
all seven ports were listener-free at completion.

## Production non-interference

Before and after values were identical:

```text
ActiveState=active
SubState=running
MainPID=1425345
NRestarts=0
```

The live source content manifest, `/opt/chillspwn/plugin` symlink text, resolved
target, service PID/state, and restart count were unchanged. Every process used
an empty environment with isolated HOME, state, database, vault, session,
workspace, and temporary paths. Provider paths were unavailable, provider key
variables were empty, MCP and security tools were disabled, and ports 3131 and
3132 were forbidden.

## Reproduction and evidence verification

Run only from a stable reviewed worktree:

```bash
bun run test:rehearsal:schema7-to-schema9:safety
bun run test:rehearsal:schema7-to-schema9
```

The fail-closed gate covers missing confirmation, redirected evidence output,
symlinked run roots, the live plugin passed as a startup artifact, writes outside
the run root, unsupported schema versions, a non-schema-7 source, and static
production mutation commands. The passing safety record is:

```text
/root/chillspwn-schema8-rehearsal/safety-test-20260715T222546Z-78059/results.tsv
```

Verify sealed evidence without displaying file contents:

```bash
cd /root/chillspwn-schema8-rehearsal/20260715T222555Z
sha256sum --check --quiet CHECKSUMS.sha256
sha256sum --check --quiet CHECKSUMS.sha256.sha256
```

Both checksum commands passed after the rehearsal. `summary.json`,
`REHEARSAL.md`, database checkpoint records, build logs, migration CLI results,
startup health payloads, source manifests, and the immutable archive remain
under the mode-`0700` evidence root.

## Promotion boundary

This result closes the missing current-checksum isolated rehearsal evidence. It
does not approve production migration or deployment. Before any real cutover:

- require the selected release artifact to match the recorded candidate
  identity, or repeat the rehearsal after any source/build change;
- verify the archive checksum selected for the maintenance window;
- quiesce writers and take matching canonical schema-7/schema-8 backups under
  the approved deployment plan;
- retain the schema-8 bridge while schema 9 is active;
- require explicit operator approval before service, symlink, or database
  changes.
