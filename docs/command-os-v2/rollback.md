# Command OS V2 rollback and coexistence

Status: **V2 preview containment is implemented; default-route cutover and full
production rollback remain unauthorized and unrehearsed**.

## Noninterference boundary

Preview rollback may operate only on:

- `chillspwn-command-os-v2-preview.service`;
- `/opt/chillspwn/plugin-command-os-v2`;
- `/opt/chillspwn/plugin.previous-command-os-v2`;
- `/var/lib/chillspwn/command-os-v2.sqlite` and its verified V2 backups; and
- V2-namespaced state, artifacts, logs, and Vault projections.

It must never modify `/opt/chillspwn/plugin` or stop, restart, reload, enable,
disable, or deploy through `chillspwn.service`. Those are the legacy production
application boundary. Record the legacy PID, process start timestamp, and
systemd restart counter before a preview operation and prove they are unchanged
afterward.

## Immediate containment: V2 kill switch

The preview unit starts
`server/command-os-v2-preview-entry.ts`. When
`COMMAND_OS_V2_KILL_SWITCH=true`, that entry returns a structured 503 without
importing the hybrid application. SQLite, workers, providers, MCP processes,
Vault watchers, and legacy runtime modules are therefore not initialized.

Put the flag in a drop-in for the preview unit only, reload systemd, and restart
only V2:

```ini
# /etc/systemd/system/chillspwn-command-os-v2-preview.service.d/kill-switch.conf
[Service]
Environment=COMMAND_OS_V2_KILL_SWITCH=true
```

```bash
systemctl daemon-reload
systemctl restart chillspwn-command-os-v2-preview.service
```

Confirm port 3132 returns `command_os_v2_killed`, no V2 workers or database
handles remain, and the legacy PID/restart counter and critical workflow are
unchanged. To re-enable the preview, remove only that drop-in, reload systemd,
and restart only `chillspwn-command-os-v2-preview.service`.

## Preview code-pointer rollback

The active preview pointer is `/opt/chillspwn/plugin-command-os-v2`; the exact
prior target is retained at `/opt/chillspwn/plugin.previous-command-os-v2`.
Pointer rollback is permitted only after the prior artifact and its database
schema compatibility are verified.

Migration `014_runtime_mutation_receipts` is additive and the migration runner
rejects an unknown future schema. A schema-13 binary must therefore not be
blindly restarted against a schema-14 database. When compatibility is not
proven, keep the kill switch active and make an explicit code/data recovery
decision instead of looping restarts.

For a compatible prior release:

1. stop only `chillspwn-command-os-v2-preview.service`;
2. verify the current database and capture its checksum-protected backup;
3. verify the retained prior release manifest and schema compatibility;
4. atomically repoint only `/opt/chillspwn/plugin-command-os-v2` to the retained
   prior target;
5. start only the preview service;
6. require consecutive healthy JSON readiness samples on port 3132; and
7. verify the legacy process identity and workflow did not change.

Do not use generic `/opt/chillspwn/plugin`, restore, or service commands for
this operation.

## Database recovery

The wired V2 commands are `db:verify`, `db:backup`, and `db:restore`.
Restoration is allowed only while the preview is stopped, from a
checksum-verified and integrity-checked backup, after explicitly deciding how
post-backup V2 events will be preserved or reconciled. A code/static failure
alone is not authority to discard newer canonical V2 state.

Migration 014 retains completed mutation responses for deterministic replay and
imports interrupted settings-backed reservations as expired/ambiguous. On
restart, those records require canonical receipt reconciliation; they must not
be converted into fabricated success or blindly repeated.

A disposable backup/restore/quick-check cycle has passed. A production-sized
restore and post-restore mission reconciliation are still release blockers.

## Separate static-store primitive

The standalone V2 package also contains a content-addressed static-release
store with stage, verify, activate, pin, and pointer-only rollback commands.
Focused tests proved immutable manifests and process pinning on disposable
processes. The currently deployed hybrid preview does not use that standalone
static pointer as its service promotion mechanism. This historical bounded
proof must not be represented as the live preview rollback or a full system
rollback.

## Cutover rollback remains pending

Before changing the default route, the program still requires:

- frozen, reconciled legacy and V2 backups;
- proven single control-plane ownership for every run;
- a no-retry browser and legacy-compatibility matrix;
- migration, restart, backup, restore, visual, accessibility, performance, and
  soak gates;
- a signed deployment/rollback artifact and named rollback owner/window; and
- explicit human release approval.

A future production rollback must atomically restore the legacy entry route,
disable V2 mutation, preserve post-cutover V2 data, emit an audit record, and
reconcile every run. It must never reverse-import V2 state into fragile legacy
files. Until that procedure is implemented and rehearsed, the legacy
application remains the default and no cutover claim is valid.
