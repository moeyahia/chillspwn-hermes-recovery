# Schema-8 compatibility bridge rehearsal

> [!CAUTION]
> **SUPERSEDED — DO NOT USE THIS ARTIFACT OR EXECUTE THE COMMANDS BELOW.**
> Migration 008 now intentionally includes branch/snapshot tables and no
> longer has the source/database checksum recorded in this historical
> rehearsal. The archive, extracted bridge, release ID, checksums, and command
> examples in this document are incompatible with the current candidate. The
> production database remains on schema 7 and was never opened by this bridge.
> Before any schema-8 promotion, build a fresh immutable bridge from the exact
> live schema-7 release plus the **final** migration 008 and repeat the complete
> schema 7 → bridge → final candidate, bridge/candidate restart, integrity,
> health, rollback-boundary, and residual-listener rehearsal. Assign the new
> artifact and evidence a new immutable identity.
>
> That replacement isolated rehearsal passed on 2026-07-15. Its distinct
> current-checksum artifact, provenance, schema 7→8→9 path, rollback evidence,
> and non-interference checks are recorded in
> [`schema-7-to-9-release-rehearsal.md`](schema-7-to-9-release-rehearsal.md).
> This historical archive remains superseded.

Rehearsal date: 2026-07-15 UTC

Evidence root: `/root/chillspwn-schema8-rehearsal/20260715T143836Z`

Production changes made by this rehearsal: **none**

This record preserves measured evidence for an earlier additive schema-8 bridge
and is historical only. That bridge was the exact deployed schema-7 application
with the then-current `008_follow_up_context.ts` and its ordered registration.
It did not expose or call the follow-up feature, but it does not contain the
final migration definition required by the current candidate.

The current candidate also contains migration 9. Its separate synthetic
schema-8→9 boundary evidence is recorded in
[`schema-9-guided-decision-rehearsal.md`](schema-9-guided-decision-rehearsal.md).
That newer rehearsal does not supersede or repair this historical schema-7→8
provenance record.

## Historical source and artifact identity — superseded

Exact live source observed before and after rehearsal:

```text
/opt/chillspwn/releases/20260715T132305Z-candidate/plugin
```

The active and previous symlinks remained:

```text
/opt/chillspwn/plugin          -> /opt/chillspwn/releases/20260715T132305Z-candidate/plugin
/opt/chillspwn/plugin.previous -> /opt/chillspwn/releases/20260715T130435Z-candidate/plugin
```

Immutable bridge directory:

```text
/root/chillspwn-schema8-rehearsal/20260715T143836Z/artifacts/chillspwn-schema8-bridge-20260715T143836Z/plugin
```

Portable archive:

```text
/root/chillspwn-schema8-rehearsal/20260715T143836Z/artifacts/chillspwn-schema8-bridge-20260715T143836Z.tar.gz
```

Identity and integrity values:

| Item | SHA-256 / value |
| --- | --- |
| Archive, 77,460,474 bytes | `cec471671804cbec99089c1cd9bbe0c6485ace646e6e3652e6eaa6bf040bae5d` |
| Live source content-tree identity, 11,144 files | `ca9a45659959cc5abc959f57ba2bc9f23ee94d13e6f546cdbbae5e51463bfd4c` |
| Bridge content-tree identity, 11,145 files | `5382e6e03eb3aa80400b784431c2c7334a2776f936eeb889c1b675357677c3f5` |
| Live migration index | `ab213e05b93c7cd1519708ba3bfb638675f722932b89328210cf811e6bc26514` |
| Bridge migration index | `b42c48e843438c816410fa84faf6c96fc594d8040c5301539c03e3f5847af43a` |
| Migration 008 source | `68d399cdf4534e9c5a70afe52109c3df163002ef8b1858bd9b1c03082d707d3e` |
| Migration 008 database checksum | `7502d36ae80fb2e9398af9b0b6d2346eb9262afed6e38e89a02bc845c7dd545c` |
| Approved migration-index diff | `45901ad655cc2fdf1b1de9439d46c31655595643750b5234ecad8033a6615c42` |
| Unchanged bridge `server/index.ts` | `477be43edc6f6a6037fbfe63fc4aacb17df5e5c7ea28989d4b6439d16b9a5549` |
| Unchanged bridge `dist/index.html` | `cb7ebc1a868f7266988432d9672af2979f020b23c9be22113d62b78cbf7b692b` |
| Symlink manifest, 30 links | `8de166d3dfb7860809f5836e70f05ac17396012d4bf3838138feaa25c6caa06a` |

An `rsync --checksum --dry-run` comparison found no content difference outside
the two approved migration paths. The source tree is 218,646,371 bytes and the
bridge is 218,647,649 bytes; the exact 1,278-byte delta is the 1,182-byte new
migration plus the 96-byte index registration. The final bridge is root-owned
and read-only (`0555` directories and non-executable files `0444`).

## Build evidence

The isolated bridge passed:

- server TypeScript;
- client TypeScript;
- E2E TypeScript;
- server-entry bundle: 172 modules, 1.68 MB;
- production client build: 97 modules.

The production client output was then restored byte-for-byte from the exact
live release so the final bridge changes only the two approved migration paths.
The final read-only artifact was started once more after packaging and remained
healthy.

The full candidate snapshot used for the compatibility sequence is preserved
at:

```text
/root/chillspwn-schema8-rehearsal/20260715T143836Z/candidate/plugin
```

Its content-tree identity is
`5340ba1427c58df749d00696db54722af5a9c40856302c1a84bcc47057ca5b3f`.
It was captured from branch `feat/command-os-v2` at repository HEAD
`9949ce8ee11ac195bbbf9f7f6bfd5fdc43aaa1a8` with the then-current uncommitted
candidate worktree. It passed all three TypeScript checks, a 177-module server
bundle, and a 99-module client build. Because implementation is continuing, the
final reviewed/committed candidate must repeat this compatibility sequence; the
historical bridge identity was valid only while the live release and migration
008 remained unchanged. Migration 008 has since changed, so this bridge identity
is no longer eligible for use.

## Database expansion evidence

The exact live schema-7 CLI created an isolated database and a canary Guided
mission. Its pre-bridge image is:

```text
/root/chillspwn-schema8-rehearsal/20260715T143836Z/state/schema7-before-bridge.sqlite
SHA-256 0bdd956830d6dc24d0f5218e352340ce77a6d00faa2278b9ba33f61538cbfa2f
```

The first bridge migration invocation:

- created a backup with the exact same SHA-256 as the schema-7 image;
- applied exactly version 8, `follow_up_run_context_selections`;
- reported schema 8, WAL, foreign keys enabled, and integrity `ok`.

The second bridge invocation created a schema-8 backup but applied no
migrations. The canary mission remained unchanged, the new table and both
immutable triggers existed, `quick_check` returned `ok`, and
`foreign_key_check` returned no rows.

## Process compatibility sequence

The servers received a strict credential-free environment, disabled terminal,
proxy, file-write, security-tool, and MCP execution, and used only isolated
state. No provider authentication path or production state was inherited.

One copied schema-8 database was used for this sequence:

| Order | Artifact | Port | Result |
| ---: | --- | ---: | --- |
| 1 | Full candidate snapshot | 34282 | healthy, schema 8, clean shutdown |
| 2 | Compatibility bridge | 34283 | healthy, schema 8, clean shutdown |
| 3 | Full candidate snapshot | 34284 | healthy, schema 8, clean shutdown |
| 4 | Final read-only bridge package | 34285 | healthy, schema 8, clean shutdown |
| 5 | Fresh extraction of the portable archive | 34286 | archive comparison identical; healthy, schema 8, clean shutdown |

Every health response reported database healthy, event stream healthy, zero
pending outbox rows, and migration 8. After the sequence the canary mission was
intact, all eight migration rows were present once, `quick_check` was `ok`,
`foreign_key_check` returned no rows, and none of the isolated ports or process
groups remained active.

The portable archive was extracted into a throwaway directory, compared
recursively (including symlink targets) with the packaged directory, started on
port 34286, and removed only after clean shutdown. This verifies the archive,
not merely the pre-archive directory.

Evidence health responses and bounded credential-free server logs are under
`evidence/`. The reusable harness is
`harness/startup-rehearsal.sh`. Isolated database copies and backups remain
under `state/`; they contain only the synthetic canary and must never be
substituted for a production backup.

At the end of rehearsal both live services still had zero restarts, the active
symlinks were unchanged, and live `/api/v2/health` remained healthy on schema 7.

## Historical production command examples — forced abort, do not execute

These command examples are retained only to explain what the historical
rehearsal evaluated. Every shell block now exits immediately. Do not remove the
abort, substitute paths, reuse the old checksum, or treat the examples as a
promotion runbook. Generate and review new commands only after the final
migration-008 checksum and fresh bridge identity exist.

### 1. Verify and install the immutable bridge

```bash
set -euo pipefail
echo 'ABORT: superseded schema-8 bridge; build and rehearse a fresh final-checksum bridge' >&2
exit 64

ARCHIVE=/root/chillspwn-schema8-rehearsal/20260715T143836Z/artifacts/chillspwn-schema8-bridge-20260715T143836Z.tar.gz
ARCHIVE_SHA=cec471671804cbec99089c1cd9bbe0c6485ace646e6e3652e6eaa6bf040bae5d
EXPECTED_LIVE=/opt/chillspwn/releases/20260715T132305Z-candidate/plugin
BRIDGE_RELEASE=/opt/chillspwn/releases/20260715T143836Z-schema8-bridge
CANONICAL_DB=/var/lib/chillspwn/command-os-v2.sqlite
BACKUP_DIR=/var/lib/chillspwn/backups/schema8-bridge-20260715T143836Z

test "$(readlink -f /opt/chillspwn/plugin)" = "$EXPECTED_LIVE"
printf '%s  %s\n' "$ARCHIVE_SHA" "$ARCHIVE" | sha256sum -c -
test ! -e "$BRIDGE_RELEASE"

STAGE=$(mktemp -d /opt/chillspwn/releases/.schema8-bridge.XXXXXX)
trap 'rm -rf -- "$STAGE"' EXIT
tar -xzf "$ARCHIVE" -C "$STAGE"
install -d -o root -g root -m 0755 "$BRIDGE_RELEASE"
cp -a "$STAGE/chillspwn-schema8-bridge-20260715T143836Z/plugin" \
  "$BRIDGE_RELEASE/plugin"
chown -R root:root "$BRIDGE_RELEASE"
find "$BRIDGE_RELEASE" -type d -exec chmod a-w,go+rx {} +
find "$BRIDGE_RELEASE" -type f -exec chmod a-w,go+r {} +

sha256sum "$BRIDGE_RELEASE/plugin/webapp/server/index.ts" \
  "$BRIDGE_RELEASE/plugin/webapp/server/db/migrations/index.ts" \
  "$BRIDGE_RELEASE/plugin/webapp/server/db/migrations/008_follow_up_context.ts"
```

Expected hashes, in order, are:

```text
477be43edc6f6a6037fbfe63fc4aacb17df5e5c7ea28989d4b6439d16b9a5549
b42c48e843438c816410fa84faf6c96fc594d8040c5301539c03e3f5847af43a
68d399cdf4534e9c5a70afe52109c3df163002ef8b1858bd9b1c03082d707d3e
```

### 2. Stop writers, back up schema 7, and apply only migration 8

```bash
set -euo pipefail
echo 'ABORT: superseded schema-8 bridge; build and rehearse a fresh final-checksum bridge' >&2
exit 64

# First use the product controls to block launches and safely resolve all
# nonterminal runs. Record that evidence before stopping either writer.
systemctl stop chillspwn.service hermes-gateway.service
! systemctl is-active --quiet chillspwn.service
! systemctl is-active --quiet hermes-gateway.service
if lsof "$CANONICAL_DB" "$CANONICAL_DB-wal" "$CANONICAL_DB-shm" 2>/dev/null; then
  echo 'A canonical database writer is still active; aborting.' >&2
  exit 1
fi

install -d -o chillspwn -g chillspwn -m 0700 "$BACKUP_DIR"
(
  cd "$BRIDGE_RELEASE/plugin/webapp"
  runuser -u chillspwn -- /opt/chillspwn-runtime/bin/bun run \
    server/db/cli.ts migrate --db "$CANONICAL_DB" --backup-dir "$BACKUP_DIR"
)

sqlite3 "$CANONICAL_DB" \
  "SELECT version,name,checksum FROM schema_migrations ORDER BY version; PRAGMA quick_check; PRAGMA foreign_key_check;"
test "$(sqlite3 "$CANONICAL_DB" 'PRAGMA quick_check')" = ok
test -z "$(sqlite3 "$CANONICAL_DB" 'PRAGMA foreign_key_check')"
test "$(sqlite3 "$CANONICAL_DB" 'SELECT MAX(version) FROM schema_migrations')" = 8
test "$(sqlite3 "$CANONICAL_DB" 'SELECT COUNT(*) FROM schema_migrations WHERE version=8')" = 1
test "$(sqlite3 "$CANONICAL_DB" "SELECT checksum FROM schema_migrations WHERE version=8")" = \
  7502d36ae80fb2e9398af9b0b6d2346eb9262afed6e38e89a02bc845c7dd545c
```

Record the exact path and SHA-256 of the CLI-created schema-7 backup before
continuing. Do not infer it from a timestamp.

### 3. Atomically promote and bake the bridge

```bash
set -euo pipefail
echo 'ABORT: superseded schema-8 bridge; build and rehearse a fresh final-checksum bridge' >&2
exit 64

OLD_RELEASE=$(readlink -f /opt/chillspwn/plugin)
test "$OLD_RELEASE" = "$EXPECTED_LIVE"
rm -f /opt/chillspwn/plugin.previous.next /opt/chillspwn/plugin.next
ln -s "$OLD_RELEASE" /opt/chillspwn/plugin.previous.next
mv -Tf /opt/chillspwn/plugin.previous.next /opt/chillspwn/plugin.previous
ln -s "$BRIDGE_RELEASE/plugin" /opt/chillspwn/plugin.next
mv -Tf /opt/chillspwn/plugin.next /opt/chillspwn/plugin

systemctl start hermes-gateway.service
systemctl start chillspwn.service
curl -fsS http://127.0.0.1:3131/api/v2/health | \
  jq -e '.status == "healthy" and .database.healthy == true and .database.currentMigration == 8'
systemctl show chillspwn.service hermes-gateway.service \
  -p ActiveState -p SubState -p MainPID -p NRestarts --no-pager
```

Keep the bridge serving for the approved bake period. Verify current journeys,
event replay, checkpoints, database integrity, and absence of ghost work. Do
not promote the full candidate until the bridge is explicitly accepted.

### 4. Promote the full candidate after bridge acceptance

Install the final committed candidate at its own immutable release path and run
the complete release gate again. Then:

```bash
set -euo pipefail
echo 'ABORT: superseded schema-8 bridge; build and rehearse a fresh final-checksum bridge' >&2
exit 64

BRIDGE_RELEASE=/opt/chillspwn/releases/20260715T143836Z-schema8-bridge
FINAL_CANDIDATE=/opt/chillspwn/releases/REPLACE_WITH_FINAL_CANDIDATE_ID/plugin
test -d "$FINAL_CANDIDATE/webapp"
test "$(readlink -f /opt/chillspwn/plugin)" = "$BRIDGE_RELEASE/plugin"

systemctl stop chillspwn.service hermes-gateway.service
rm -f /opt/chillspwn/plugin.previous.next /opt/chillspwn/plugin.next
ln -s "$BRIDGE_RELEASE/plugin" /opt/chillspwn/plugin.previous.next
mv -Tf /opt/chillspwn/plugin.previous.next /opt/chillspwn/plugin.previous
ln -s "$FINAL_CANDIDATE" /opt/chillspwn/plugin.next
mv -Tf /opt/chillspwn/plugin.next /opt/chillspwn/plugin
systemctl start hermes-gateway.service
systemctl start chillspwn.service
curl -fsS http://127.0.0.1:3131/api/v2/health | \
  jq -e '.status == "healthy" and .database.currentMigration == 8'
```

For the historical artifact pair only, this was the point at which an
application-only rollback from that candidate to that bridge was safe because
both knew the same historical schema-8 migration name and checksum. That claim
does not apply to the current candidate.

## Historical rollback command examples — forced abort, do not execute

### During the bridge bake window

The old schema-7 application cannot open a schema-8 database. The historical
example below illustrated a paired application/database restore from a matching
schema-7 backup; it is forced to abort and is not a current runbook:

```bash
set -euo pipefail
echo 'ABORT: superseded schema-8 bridge; build and rehearse a fresh final-checksum bridge' >&2
exit 64

CANONICAL_DB=/var/lib/chillspwn/command-os-v2.sqlite
EXPECTED_LIVE=/opt/chillspwn/releases/20260715T132305Z-candidate/plugin
SCHEMA7_BACKUP=/absolute/path/recorded-from-the-bridge-cli.sqlite
SCHEMA7_SHA=REPLACE_WITH_RECORDED_SHA256
INCIDENT=/var/lib/chillspwn/backups/schema8-bridge-rollback-$(date -u +%Y%m%dT%H%M%SZ)

systemctl stop chillspwn.service hermes-gateway.service
install -d -o chillspwn -g chillspwn -m 0700 "$INCIDENT"
printf '%s  %s\n' "$SCHEMA7_SHA" "$SCHEMA7_BACKUP" | sha256sum -c -

# Preserve every schema-8 file before restoring. Never delete or reverse a
# migration row in place.
for source in "$CANONICAL_DB" "$CANONICAL_DB-wal" "$CANONICAL_DB-shm"; do
  if test -e "$source"; then mv "$source" "$INCIDENT/$(basename "$source")"; fi
done
install -o chillspwn -g chillspwn -m 0600 "$SCHEMA7_BACKUP" "$CANONICAL_DB.restore"
sqlite3 "$CANONICAL_DB.restore" 'PRAGMA quick_check; PRAGMA foreign_key_check;'
test "$(sqlite3 "$CANONICAL_DB.restore" 'SELECT MAX(version) FROM schema_migrations')" = 7
mv "$CANONICAL_DB.restore" "$CANONICAL_DB"

rm -f /opt/chillspwn/plugin.next
ln -s "$EXPECTED_LIVE" /opt/chillspwn/plugin.next
mv -Tf /opt/chillspwn/plugin.next /opt/chillspwn/plugin
systemctl start hermes-gateway.service
systemctl start chillspwn.service
curl -fsS http://127.0.0.1:3131/api/v2/health | \
  jq -e '.status == "healthy" and .database.currentMigration == 7'
```

Reconcile any schema-8-era events or evidence preserved in `$INCIDENT` before
another promotion. Never silently discard newer immutable state.

### From the full candidate back to the accepted bridge

The historical example below illustrated keeping its matching schema-8
database while switching only that application pair. It is forced to abort and
must not be adapted for the current candidate:

```bash
set -euo pipefail
echo 'ABORT: superseded schema-8 bridge; build and rehearse a fresh final-checksum bridge' >&2
exit 64
BRIDGE_RELEASE=/opt/chillspwn/releases/20260715T143836Z-schema8-bridge
systemctl stop chillspwn.service hermes-gateway.service
rm -f /opt/chillspwn/plugin.next
ln -s "$BRIDGE_RELEASE/plugin" /opt/chillspwn/plugin.next
mv -Tf /opt/chillspwn/plugin.next /opt/chillspwn/plugin
systemctl start hermes-gateway.service
systemctl start chillspwn.service
curl -fsS http://127.0.0.1:3131/api/v2/health | \
  jq -e '.status == "healthy" and .database.currentMigration == 8'
```

Do not execute any command in this historical section. Build a new runbook from
the final bridge identity, re-read `rollback.md`, confirm disk headroom for the
canonical database and all sidecars/backups, and record the current
release/database identities. A mismatch is an abort condition, not permission
to adapt old commands in place.
