# Active Obsidian-compatible Vault connection evidence

Verified at 2026-07-16 22:55 UTC against the operator-visible integrated
`chillspwn.service` on `127.0.0.1:3131` (deployed API schema `2.1`, database
schema `7`). This is operational evidence for the currently deployed integrated
release, not evidence that the isolated Command OS V2.4 application was
deployed or a V2.4 release-gate claim.

## Selected Vault and safety boundary

- Canonical SQLite store: `/var/lib/chillspwn/command-os-v2.sqlite`
- Enforced Vault sandbox: `/var/lib/chillspwn/brain-vaults`
- Connected operator Vault: `/var/lib/chillspwn/brain-vaults/ChillsPwn-Brain`
- Display name: `ChillsPwn Second Brain`
- Connection ID: `vault_b1bfa728-3271-4ad1-8e4a-220096e56a73`
- Permission granted: `2026-07-16T22:52:11.107Z`
- Last synchronized: `2026-07-16T22:52:21.157Z`

The running service was already confined to `/var/lib/chillspwn/brain-vaults`.
Reconfiguring or restarting the protected service merely to place the Vault under
`/root` would have widened this change and risked the live legacy-compatible
process. The existing narrow sandbox was therefore retained. The Vault itself is
mode `0700`, owned by the `chillspwn` service account. No `.obsidian` directory or
settings were created or changed.

The process runs as `chillspwn` from the immutable integrated release at
`/opt/chillspwn/releases/20260716T065047Z-user-manual-corrected-5f9531e/plugin/webapp`.
The standalone V2.4 worktree is separate, expects database schema `11`, and has
providers/MCP deliberately unavailable. It must not replace this service or be
pointed at this live database. Controlled V2.4 verification requires either a
schema-7-compatible backport to this exact release baseline or an independently
provisioned V2.4 service and database.

## Backup and filesystem proof

Before the connection mutation, SQLite's native online backup API created:

`/var/lib/chillspwn/backups/obsidian-connect-20260716/command-os-pre-vault-connect-20260716T224900Z.sqlite`

- Size: `7,057,440,768` bytes
- Mode: `0600`
- SHA-256: `cac639f299ad3af8e52f32d667fec6f26fcdc3c71bb43e9239a1c86d9ff94707`
- `PRAGMA integrity_check`: `ok`
- Foreign-key violations: `0`

The strengthened V2.4 `VaultPathPolicy.verifyRoundTrip` first proved write, read,
rename, and delete. A second round trip as the live `chillspwn` service account
proved the same four operations at `2026-07-16T22:53:23.787Z`. Both checks left
zero `.chillspwn-health-*` entries.

The first API connection attempt failed atomically because the root-run preflight
had created the new candidate directory as `root:root` mode `0700`, while the live
service runs as `chillspwn`. The trace was
`55b73379-8a53-49e7-9549-0d5b1662dff3`; the transaction created no connection
row. Ownership was corrected only on the new candidate directory, and the same
idempotent API request then succeeded. No direct SQL connection, code change, or
service restart was used.

## API, database, and projection readback

The real mutation path was:

- `POST /api/v2/brain/vault/connect` with explicit filesystem permission and a
  stable idempotency key.
- `POST /api/v2/brain/vault/export` with the persisted connection ID and a stable
  idempotency key.
- `GET /api/v2/brain/vault` for canonical connection and sync-state readback.
- `GET /api/v2/brain/summary` for the operator-facing health projection.

Readback proves:

- Connection status: `connected`
- Brain summary Vault status: `connected`
- Connections: `1`
- Eligible canonical notes exported: `3`
- Sync rows with status `synced`: `3`
- Sync rows with a recorded error: `0`
- API sync rows marked needs review: `0` (the deployed 2.1 API does not
  classify the dangling relationship link below as a sync conflict)
- Vault conflicts: `0`
- All three on-disk SHA-256 values match both `vault_content_hash` and
  `database_content_hash` in `vault_sync_state`.

Projected notes:

- `70 Lessons/autonomous-run-evaluation--mem_eval_18329a68f167ab7ae963d89d3b854495.md`
- `70 Lessons/guided-run-evaluation--mem_eval_37398ab7bb60e655bb97c4592c8fb435.md`
- `70 Lessons/guided-run-evaluation--mem_eval_fd5881d056e0f862f5fc0fa7b76d7635.md`

The V2.4 Obsidian parser successfully read all three notes, including YAML stable
IDs, lifecycle state, mission scope, source IDs, authorship, aliases, and tags.
The projection contains one `[[wikilink]]`. It points from the verified Autonomous
evaluation to a candidate lesson that is correctly excluded by the active
confirmed-and-verified projection policy. This leaves one unresolved native
Obsidian link in the older deployed 2.1 projection. Current V2.4 source filters
out excluded lifecycle targets in `ObsidianVaultBridge.renderNode`; that behavior
must be reverified after the controlled V2.4 deployment.

## Browser verification

Chromium loaded `/brain/vault` with HTTP 200 and showed:

- `ChillsPwn Second Brain`
- `Connected`
- path label `ChillsPwn-Brain`
- `Tracked notes 3`
- `Needs review 0`
- three `synced` rows
- `Vault conflicts 0`

The browser check recorded no console errors and no required-request failures.
An independent 390×844 touch-layout readback also showed the connected Vault,
three tracked notes, zero conflicts, no console errors, and zero horizontal
overflow.
The captured operator-visible state is
[obsidian-vault-connected-20260716.png](evidence/obsidian-vault-connected-20260716.png).

## Remaining release distinction

The deployed API schema 2.1 does not expose the dedicated
`POST /api/v2/brain/vault/health-check` route added in current V2.4 source, so the
live health proof above used the V2.4 path policy plus a service-account round
trip. This is sufficient to establish the active connection now, but it is not a
substitute for rerunning the V2.4 health-check API, projection-link, browser, and
restart persistence tests on an isolated compatible deployment. No live service
restart or database migration is authorized by this evidence.

## Subsequent readback and empty-state regression

A fresh read-only check at `2026-07-17T00:52:38.980Z` again returned HTTP 200
from the live integrated service and reported database integrity `ok`, WAL,
foreign keys enabled, zero pending outbox events, one connected Vault, three
`synced` projection rows, and zero conflicts. The three projected Markdown files
were still present beneath the same service-owned `0700` Vault root.

The isolated V2.4 UI now also owns a deterministic canonical-empty graph fixture
instead of depending on whichever records earlier browser workers happened to
leave in the database. Its `Open Memory Inbox` keyboard route passed in Chromium,
Firefox, and WebKit (3/3, retries disabled):
`test-results/results/brain-global-empty-three-engine-final-20260717.json`
(SHA-256
`be7051a711c630c278c56a221d7f6e0b72da01391b194d8d451306e3409c54aa`).

The then-current 455-group manifest was enforced across all 13 configured
projects in
`test-results/results/manifest-enforced-all13-r2-20260717.json` (13/13,
212,154.33 ms, retries/skips/flaky/unexpected all zero; SHA-256
`1ecafd20cfa71fdb7bb4654ebc8dd4de92af860617941669da91466014e4f026`).
Persistent-navigation projects matched 868/868 rendered controls and
compact/reflow projects matched 582/582, with zero missing, unresolved, or stale
groups. This establishes that both connected and deterministic-empty Brain
entry points are represented in the current source inventory; it does not close
the material-state, visual, accessibility, restart, soak, deployment, or cutover
gates.

A final live read-only verification at `2026-07-17T01:35:34.234Z` found
`chillspwn.service` active. `GET /api/v2/health` returned HTTP 200 with healthy
API schema `2.1`; `GET /api/v2/brain/vault` returned HTTP 200 with Vault and sync
enabled, the same connected connection ID, three sync-state rows, and zero
conflicts. The Brain summary reported one connected Vault, zero conflicts, and
healthy database and FTS status. The Vault root remained mode `0700`, all three
notes remained mode `0600`, ownership remained `chillspwn:chillspwn`, and no
`.chillspwn-health-*` file remained on disk.

## Operator-requested live confirmation — 2026-07-17

A further read-only confirmation completed at `2026-07-17T02:21:57.404Z`
after the operator reported that no active Obsidian Vault was visible:

- `chillspwn.service`: `active`;
- `GET /api/v2/health`: HTTP 200, `status: healthy`, SQLite integrity `ok`,
  WAL enabled, foreign keys enabled, migration `7`, zero pending outbox rows;
- `GET /api/v2/brain/vault`: HTTP 200, API schema `2.1`, Vault and sync enabled,
  connection `vault_b1bfa728-3271-4ad1-8e4a-220096e56a73` reported
  `connected`, three `synced` projection rows, and zero conflicts;
- `GET /api/v2/brain/summary`: HTTP 200, one connected Vault, zero conflicts,
  healthy database and FTS, and five persisted Context Packs;
- the Vault root remained `0700` and `chillspwn:chillspwn`; all three Markdown
  notes remained `0600` and `chillspwn:chillspwn`.

Current projected-note SHA-256 values were:

- `53785cd4430f5cbaa58503c525e3b508f793fdd9a2e5abd769e7737281a767a9`
  — Autonomous run evaluation;
- `8fb93a398b9df93bcc0ee289fc8ed8180c3efcd480006bd756c69b9807d87738`
  — Guided run evaluation `mem_eval_37398ab7bb60e655bb97c4592c8fb435`;
- `c84f7dd09c6e63bde358ec1d2dcf65c535e46fd12d1462c4059ee61189249d10`
  — Guided run evaluation `mem_eval_fd5881d056e0f862f5fc0fa7b76d7635`.

This is direct evidence that an active, filesystem-backed Obsidian-compatible
Vault is connected to the currently running integrated Second Brain. It does
not authorize upgrading that protected schema-7 service to the isolated
schema-11 V2.4 codebase.

## Final read-only connection refresh — 2026-07-17 03:39 UTC

The operator-visible service was checked again after the Vault visibility and
recovery hardening. No process restart, database migration, direct SQL write,
or filesystem mutation was performed during this refresh.

- `chillspwn.service` remained `active`.
- `GET /api/v2/health` returned HTTP 200 with API schema `2.1`, database
  migration `7`, integrity `ok`, WAL and foreign keys enabled, and zero pending
  outbox rows.
- `GET /api/v2/brain/vault` returned HTTP 200 with the same connection ID,
  display name `ChillsPwn Second Brain`, status `connected`, three `synced`
  note projections, and zero conflicts.
- `GET /api/v2/brain/summary` returned HTTP 200 with one connected Vault, zero
  conflicts, healthy database and FTS status, and five persisted Context Packs.
- The Vault root remained mode `0700`; all three notes remained mode `0600`;
  every path remained owned by `chillspwn:chillspwn`; no temporary
  `.chillspwn-health-*` entry remained.
- The three note hashes remained
  `53785cd4430f5cbaa58503c525e3b508f793fdd9a2e5abd769e7737281a767a9`,
  `8fb93a398b9df93bcc0ee289fc8ed8180c3efcd480006bd756c69b9807d87738`,
  and `c84f7dd09c6e63bde358ec1d2dcf65c535e46fd12d1462c4059ee61189249d10`.

The isolated V2.4 Vault page now renders a named `Active Obsidian Vaults`
region before `Connect another local vault`. Its browser journey asserts both
headings are visible and that the active-region heading is physically above
the setup heading after a verified connection. The focused hardened Vault
suite passed all six lifecycle journeys in each of Chromium, Firefox, and
WebKit (18/18 total, retries disabled). This fixes the source-level discoverability
defect while keeping the protected live schema-7 deployment unchanged.

No Obsidian desktop executable or registered `obsidian://` handler is installed
on this headless service host. The connected directory is nevertheless a real
Obsidian-compatible Vault: native Markdown notes with YAML identities,
attachments/relationship conventions, and `[[wikilinks]]`. Installing or
changing a desktop application's `.obsidian` settings was neither necessary
nor performed.

The server cannot register this path in an operator workstation's native
Obsidian active-Vault list. Opening the generated `obsidian://` link requires
an operator-side Obsidian installation, a registered URI handler, and direct
filesystem access or an explicit mapping to this Vault.

## Read-only continuity check — 2026-07-17 04:22 UTC

The protected integrated service remained `active`. Its public health endpoint
returned HTTP 200 with API schema `2.1`, database migration `7`, integrity
`ok`, WAL mode, foreign keys enabled, and zero pending outbox rows. A read-only
SQLite query as the `chillspwn` service account returned the same connected
Vault identity and path, `3` synced rows, `0` sync errors, `0` rows needing
review, `0` open conflicts, and `5` persisted Context Packs. The Vault root
remained `0700`; all three projected notes remained `0600`; every path remained
owned by `chillspwn:chillspwn`. This check performed no mutation, migration, or
service restart.

## Final operator handoff readback — 2026-07-17 04:43 UTC

A final read-only handoff check again found `chillspwn.service` active. The
public V2 health endpoint returned HTTP 200 with API schema `2.1`, database
migration `7`, integrity `ok`, WAL mode, foreign keys enabled, and zero pending
outbox records. A read-only query executed as the `chillspwn` service account
returned the same connected Vault ID, display name, and canonical path, with
three `synced` projections, zero sync errors, zero review rows, zero open
conflicts, and five persisted Context Packs. The Vault remained mode `0700`,
the three notes remained mode `0600`, ownership remained
`chillspwn:chillspwn`, and all three note hashes were unchanged. No runtime,
database, or filesystem mutation was performed by this readback.

## Read-only connected-Vault continuity — 2026-07-17 05:14 UTC

A fresh read-only continuity check found the live `chillspwn.service` still
`active`. No API mutation, direct SQL write, filesystem change, database
migration, or process restart was performed.

- `GET /api/v2/health` returned HTTP `200` with API schema `2.1`, database
  migration `7`, integrity `ok`, and `0` pending outbox records.
- `GET /api/v2/brain/vault` returned HTTP `200` with exactly one active
  connection, `vault_b1bfa728-3271-4ad1-8e4a-220096e56a73`, in `connected`
  state. Its projection reported `3` synchronized notes, `0` sync errors, and
  `0` conflicts.
- `GET /api/v2/brain/summary` returned HTTP `200` and reported `5` persisted
  Context Packs.
- `/var/lib/chillspwn/brain-vaults/ChillsPwn-Brain` remained mode `0700`; the
  three projected Markdown notes remained mode `0600`; the Vault and notes
  remained owned by `chillspwn:chillspwn`.

This proves continuity of the filesystem-backed, Obsidian-compatible Vault
connected to the live Second Brain. It does not represent native Obsidian
desktop registration: no desktop executable, `.obsidian` configuration, or
registered `obsidian://` handler exists on this headless service host. Native
desktop visibility still requires an operator-side Obsidian installation and
direct filesystem access or an explicit mapping to this Vault.

## Operator-visible API readback — 2026-07-17 05:48 UTC

A fresh read-only request to the exact singular endpoint
`GET /api/v2/brain/vault` returned HTTP `200`, API schema `2.1`, Vault and sync
enabled, and exactly one connection:

- ID: `vault_b1bfa728-3271-4ad1-8e4a-220096e56a73`;
- display name: `ChillsPwn Second Brain`;
- status: `connected`;
- operator-visible path: `ChillsPwn-Brain`;
- native deep-link projection: `obsidian://open?vault=ChillsPwn-Brain`;
- synchronized projections: `3`;
- open conflicts: `0`.

`GET /api/v2/brain/summary` independently reported one connected Vault, zero
conflicts, five persisted Context Packs, and healthy database and FTS state.
The service remained active; the canonical Vault directory remained mode
`0700`, its three Markdown notes remained mode `0600`, and every path remained
owned by `chillspwn:chillspwn`. A read-only SQLite query returned the same
connection, three `synced` rows, zero open conflicts, and five Context Packs.
No mutation, service restart, migration, or direct database write occurred.

## Fresh operator-visible screenshot — 2026-07-17 06:35 UTC

A read-only Chromium navigation to the live integrated service captured
`docs/command-os-v2/evidence/obsidian-vault-live-20260717.png`. The full-page
image visibly shows the filesystem-backed `ChillsPwn-Brain` connection with a
`Connected` status, three tracked notes, zero items needing review, explicit
sync/export/import controls, and zero Vault conflicts. Its SHA-256 is
`9006445488e2c73f126f382d15d8839b70081dadb615fe3de378d3d29aeea77e`.

The current isolated V2.4 source places the named `Active Obsidian Vaults`
region above the connection form so an existing connection is visible before
the operator is offered another Vault. The protected integrated schema-7
service was not redeployed or migrated to obtain this evidence.
