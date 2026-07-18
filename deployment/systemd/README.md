# Command OS V2 preview systemd deployment

This directory's preview procedure is intentionally limited to the isolated
Command OS V2 service on port 3132. It does not promote, restart, reconfigure,
or otherwise operate the legacy application.

## Absolute preview boundary

Use only:

- service: `chillspwn-command-os-v2-preview.service`;
- active code symlink: `/opt/chillspwn/plugin-command-os-v2`;
- retained prior symlink: `/opt/chillspwn/plugin.previous-command-os-v2`;
- database: `/var/lib/chillspwn/command-os-v2.sqlite`;
- preview state: `/var/lib/chillspwn/state-v2-preview`;
- V2 Vault root: `/var/lib/chillspwn/brain-vaults`;
- preview log: `/var/log/chillspwn/command-os-v2-preview.log`;
- default preview listener: port 3132.

During preview, **never modify `/opt/chillspwn/plugin` and never stop, restart,
reload, enable, disable, or deploy through `chillspwn.service`**. Those names
belong to the legacy production application on port 3131. Generic plugin
promotion, generic restore helpers, and any command that changes the legacy
symlink are outside this runbook.

The preview unit starts
`server/command-os-v2-preview-entry.ts`. That entry evaluates the kill switch
before importing the hybrid application, so a killed preview does not open the
database, initialize workers/providers/MCP/Vault services, or load legacy
runtime modules.

## Unit contract

Install and verify only the preview unit:

```bash
install -o root -g root -m 0644 \
  deployment/systemd/chillspwn-command-os-v2-preview.service \
  /etc/systemd/system/chillspwn-command-os-v2-preview.service
systemd-analyze verify \
  /etc/systemd/system/chillspwn-command-os-v2-preview.service
systemctl daemon-reload
```

The unit runs as the unprivileged `chillspwn` account, clears supplementary
groups/capabilities, enables `NoNewPrivileges`, applies separate CPU/IO/memory
weights, and uses V2-namespaced state and database paths. Docker MCP execution
is disabled. Do not weaken those boundaries to make a tool pass.

## Trusted recon tools

The V2-only trusted directory is
`/usr/local/libexec/chillspwn-command-os-v2/bin`. It contains exactly the
capability-free, hash-pinned Nmap copy and the reviewed `httpx-toolkit` wrapper
that forces update checks off. It is absent from legacy and preview-global
PATHs; only the exact reviewed Pentest Recon child can receive it.

After staging reviewed source, install or verify it as root from the staged
V2 webapp:

```bash
./scripts/command-os-v2/manage-trusted-tool-shims.sh install
./scripts/command-os-v2/manage-trusted-tool-shims.sh check
```

The current isolated Pentest canary passes all 8/8 exposed bindings.
`runHashcat`, `subfinderEnum`, `httpxProbe`, and `nucleiScan` remain suppressed;
the wrapper is not an egress sandbox. Removing the private bundle uses
`manage-trusted-tool-shims.sh remove` and does not change global binaries.

## Stage an immutable preview release

Stage from a root-owned checkout into a new release directory. The destination
must not exist:

```bash
RELEASE_ID=<utc-timestamp>-command-os-v2-<exact-revision>
RELEASE_ROOT=/opt/chillspwn/releases/$RELEASE_ID

install -d -o root -g root -m 0755 "$RELEASE_ROOT"
./scripts/stage-chillspwn-release.sh \
  --destination "$RELEASE_ROOT/plugin" \
  --dry-run
./scripts/stage-chillspwn-release.sh \
  --destination "$RELEASE_ROOT/plugin" \
  --build
./scripts/stage-chillspwn-release.sh \
  --destination "$RELEASE_ROOT/plugin" \
  --verify-only
```

The stager never changes an active symlink or service. Validate the staged
schema, logo hash, build, unit, and V2-only trusted-tool check before promotion.

## Promote only the preview

Before promotion, record the legacy service PID, start timestamp, and restart
counter for a post-operation noninterference check. Do not issue any command to
that service.

Stop only the preview service, create and verify a timestamped V2 database
backup, then atomically switch only the V2 symlinks. The previous target must
remain retained for static rollback. Use a same-directory temporary symlink and
`mv -T` so readers never observe a partial pointer.

```bash
systemctl stop chillspwn-command-os-v2-preview.service

# Run db:backup and db:verify from the staged V2 webapp while the preview is
# quiescent. Record the backup path and SHA-256 before changing the pointer.

NEW_TARGET="$RELEASE_ROOT/plugin"
OLD_TARGET=$(readlink -f /opt/chillspwn/plugin-command-os-v2)

ln -sfn "$OLD_TARGET" /opt/chillspwn/.previous-command-os-v2.next
mv -Tf /opt/chillspwn/.previous-command-os-v2.next \
  /opt/chillspwn/plugin.previous-command-os-v2
ln -sfn "$NEW_TARGET" /opt/chillspwn/.plugin-command-os-v2.next
mv -Tf /opt/chillspwn/.plugin-command-os-v2.next \
  /opt/chillspwn/plugin-command-os-v2

systemctl start chillspwn-command-os-v2-preview.service
```

Poll the JSON V2 readiness endpoint on port 3132 until it is healthy, then
require consecutive healthy samples. Verify the preview PID/restart counter,
database/schema, event stream, Vault health, and tool disposition. Finally,
verify the recorded legacy PID, start timestamp, and restart counter are
unchanged and its critical workflow still works.

If preview startup or readiness fails, stop only the preview, point
`/opt/chillspwn/plugin-command-os-v2` back to the retained previous target,
and start only the preview. Do not restore the database merely for a code/static
rollback; database restoration requires a stopped preview, an explicit
compatibility decision, and a checksum-verified backup.

## Kill switch

Set `COMMAND_OS_V2_KILL_SWITCH=true` for the preview environment and restart
only:

```bash
systemctl restart chillspwn-command-os-v2-preview.service
```

The preview entry returns a structured 503 for all requests without
initializing V2 dependencies. Confirm the legacy application remains unchanged.
Clear the flag and restart the same preview service to re-enable V2.

## Cutover status

This procedure is preview promotion only. It does not change the default route
and is not formal cutover evidence. The full browser matrix, migration and
restore rehearsal, 72-hour soak, preview acceptance window, rollback rehearsal,
zero-defect review, and explicit human sign-off remain required.
