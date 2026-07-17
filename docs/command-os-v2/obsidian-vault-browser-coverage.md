# Obsidian Vault browser coverage

Status: **focused implementation evidence — not release or cutover approval**
Evidence date: `2026-07-17` UTC.

This report covers the isolated Command OS V2.4 Vault lifecycle. Every browser
fixture uses the Playwright-managed V2 database and a unique directory beneath
the run-specific Vault root. It does not read or mutate the operator-visible
service, its database, its active Vault, legacy UI state, or credentials.

## Real lifecycle exercised

The focused Vault browser suite now drives these mounted UI and `/api/v2`
contracts end to end:

- candidate path write/read/rename/delete proof, verified connection, canonical
  connection readback, and reload persistence;
- fail-closed traversal denial followed by a deliberate safe-path retry;
- scoped export of three real canonical memory nodes to Markdown/YAML notes;
- an operator edit made in the projected note, imported through the UI and
  persisted as a new canonical memory version;
- a later canonical correction synchronized back into the Vault;
- portable ZIP creation, prospective browser-download authorization, exact ZIP
  delivery, magic-byte, byte-count, and SHA-256 verification against the
  durable authorization record;
- tracked-note disclosure plus exact sanitized `obsidian://` Vault and note
  link generation;
- two real concurrent canonical/Vault edits, one resolved with **Keep database
  version** and one with **Keep vault version**, with SQLite and file readback;
- a persisted degraded connection recovered only after the real bounded
  filesystem round trip succeeds;
- an existing connected Vault repaired and reindexed through separate,
  authority-audited mutations with durable intent and completion receipts;
- malformed, duplicate-ID, symlink, concurrent-change, permission, offline,
  ambiguous-retry, and bounded-FTS failure cases that stop safely without
  importing or deleting operator content;
- canonical sync state, conflict resolution, health, and connection status
  preserved after page reload.

These are not decorative fixtures. The fixture creates only the minimum
non-sensitive canonical memory inputs and the represented external note edits.
All connection, health, projection, import, synchronization, conflict,
resolution, archive, and delivery actions use the production V2 UI and API.

## Defects closed by the slice

The browser flow exposed a real snapshot-contract defect: open conflict rows
were queried without `relative_path`. Runtime response validation therefore
rejected a successful post-sync snapshot and the UI misleadingly continued to
show zero conflicts. The V2 projection now includes the path and a contract
test rejects any future path-less conflict.

Mutation success previously triggered a fire-and-forget refresh. A fast stale
read could therefore be accepted after export, import, sync, health recovery,
or conflict resolution. The query layer now exposes a canonical `reconcile`
operation; Vault mutations await it before reporting success.

## Executed evidence

All commands use retries `0`.

| Scope | Result | Report |
|---|---:|---|
| Chromium 1440 — all six hardened journeys | **6/6 passed** | `test-results/results/vault-chromium-20260717-r4.json` |
| Firefox 1440 — all six hardened journeys | **6/6 passed** | `test-results/results/vault-firefox-20260717-r2.json` |
| WebKit 1440 — all six hardened journeys | **6/6 passed** | `test-results/results/vault-webkit-20260717-r2.json` |
| Vault response contract unit tests | **3 passed, 8 assertions** | Console result retained in implementation session |
| Post-mutation query reconciliation unit test | **1 passed, 5 assertions** | Console result retained in implementation session |
| Final V2 package gate containing the Vault hardening | **645/645 passed, 0 failed, 9,206 assertions, 121 files** | `/tmp/v2-check-obsidian-final-20260717T0353Z.log` |
| Protected legacy regression after the final V2 gate | **593/593 Bun tests, 34/34 + 17/17 Python integrations, type checks, and production build passed** | `/tmp/legacy-check-obsidian-final-20260717T0356Z.log` |
| Interaction-manifest validation | **19 validator tests passed inside the package gate** | Same package-gate log |
| Browser and E2E TypeScript | Pass | Console result retained in implementation session |
| Canonical empty-Brain Inbox route, Chromium/Firefox/WebKit | **3/3 passed** | `test-results/results/brain-global-empty-three-engine-final-20260717.json` |

The preceding diagnostic
`test-results/results/vault-flows-firefox-webkit-20260716.json` remains retained:
WebKit exposed an engine download-navigation cancellation after an exact
verified download, while Firefox delayed a closed EventSource failure across a
represented reload. The shared audit now binds the exact provisional-cancel
request to the already observed and verified Playwright download, and binds
explicit stream closes to exact page, document URL, and request ordinals. The
unchanged native lifecycle first passed 2/2 in
`test-results/results/vault-browser-audit-repair-r2-20260716.json`, then the
complete 10-test Firefox/WebKit rerun passed in
`test-results/results/vault-flows-firefox-webkit-final-20260716.json`. The exact
pre-hardening source then passed 15/15 across Chromium, Firefox, and WebKit.
The hardened source subsequently passed 18/18 across those engines in the
three reports above. No browser was replaced with API-only delivery and no
broad network-error waiver was added.

## Interaction inventory

Ten mounted Vault groups were added to the executable manifest: connected
health, synchronize, export, import, portable archive creation, portable
download, note-state disclosure, native deep links, keep-database resolution,
and keep-Vault resolution. They map to three focused test IDs in addition to the
existing candidate-path and verified-connect journeys.

The manifest currently contains 479 groups, including 371 fixture-required
groups. This denominator is a source inventory, not a release-matrix claim.

The corrected enforced current-inventory crawl
`test-results/results/manifest-current-479-all13-enforced-20260717-r2.json`
passed 13/13 configured projects with zero missing, unresolved, or stale groups
and zero unexpected browser issues. The eight persistent-navigation projects
each applied 478 groups and matched 868/868 rendered controls; the five
compact/reflow projects each applied all 479 groups and matched 582/582. This is
an initial rendered-state inventory only: it does not click every option,
traverse all material hidden/error states, or supply approved screenshot
mappings. It therefore does not replace the focused Vault lifecycle tests or
prove every material Vault state.

## Active operator Vault readback

Separate from the isolated browser fixtures, the operator-visible integrated
service has one real connected Vault at
`/var/lib/chillspwn/brain-vaults/ChillsPwn-Brain`. The live API and UI report
`ChillsPwn Second Brain`, three synchronized Markdown/YAML notes, zero conflicts,
and zero items needing review. The connection was established through the real
mounted API after a service-account filesystem round trip; `.obsidian` was not
modified. Full backup, hash, API, projection, and screenshot receipts are in
[obsidian-vault-connection-evidence.md](obsidian-vault-connection-evidence.md).

The isolated V2.4 source now renders `Active Obsidian Vaults` before the setup
form and renames that form `Connect another local vault` when a connection
exists. The first browser journey asserts both visibility and vertical order,
so a connected Vault cannot be hidden below the initial form without failing
the focused suite.

The protected live projection still has one dangling `[[wikilink]]`: the
verified Autonomous evaluation links to a candidate lesson that the active
confirmed-and-verified projection correctly excludes. Current V2.4 source
filters excluded lifecycle targets, but the protected schema-2.1/schema-7
service has not been upgraded and that live link has not been rewritten or
reverified. This remains a deployment/reconciliation issue, not a reason to
mutate the protected Vault in place.

This live connection belongs to the protected integrated API-schema-2.1,
database-schema-7 service. It is not evidence that standalone V2.4 schema 11 was
deployed, and it does not authorize pointing that app at the live database.

## V2.4 repair and reindex hardening

The first mounted repair/reindex recovery journey passed retry-free on Chromium
1440 (1/1 in 3.5 seconds) and then Firefox/WebKit 1440 (2/2 in 5.7 seconds).
It exercised repair, bounded reindex intent, conflict preservation, static
symlink rejection, and fail-closed offline behavior against disposable
filesystem Vaults and an isolated V2 database.

The first Chromium attempt also exposed a real React Strict Mode lifecycle bug:
the query-provider cleanup suspended the cache during React's development-only
setup/cleanup/setup probe and never resumed it. Vault and Run pages therefore
showed their honest loading states without issuing authoritative reads. Every
provider setup now resumes the cache; the QueryCache lifecycle unit remained
2/2 green and the three-engine Vault retry then passed.

Adversarial review subsequently found content-version/crash safety around
quarantine, an unbounded FTS integrity fallback, ambiguous browser retry
semantics, and duplicate stable-node projections. The hardened implementation
now:

- records a durable mutation intent before filesystem work and reconciles an
  interrupted intent on the next exact idempotent retry;
- obtains no-follow file descriptors, revalidates path identity and content
  hashes, and creates only exact-byte guarded private quarantine copies;
- detaches malformed or duplicate projections without changing the canonical
  memory node or deleting the operator's source note;
- marks every duplicate stable-ID projection detached rather than choosing an
  arbitrary winner, and enforces the no-surviving-duplicate repository
  invariant;
- refreshes only the represented canonical FTS rows within an explicit bound;
  database/index integrity failure safe-stops instead of rebuilding globally;
- exposes exact offline, permission, concurrent-change, and reconciliation
  diagnoses, and never recreates a missing configured Vault path silently;
- reuses the exact idempotency key after a committed mutation whose readback
  failed, so the browser cannot repeat filesystem work ambiguously.

The resulting six-journey browser suite passed 18/18 across Chromium, Firefox,
and WebKit. This accepts the focused implementation slice; it is not a
service-restart, scale/soak, native-desktop, immutable-source, or release gate.

## Explicit unsupported or unproven paths

- V2 repair/reindex API and UI controls and their hardened negative boundaries
  pass the focused 18-test Chromium/Firefox/WebKit slice. A process-kill restart
  harness and long-running concurrent sync soak remain open.
- This slice proves browser reload persistence, not V2 service-process restart
  persistence. A safe process restart cannot be orchestrated inside the shared
  Playwright server lifecycle without a dedicated restart harness.
- A degraded canonical status can be recovered through a real health proof,
  and an absent configured path now produces a mounted, retryable recovery
  diagnosis without recreating the directory. Recovery after restoring that
  path across a service-process restart remains unproven.
- Headless browsers verify the exact sanitized `obsidian://` targets. Launching
  the native application requires an acceptance host with Obsidian installed
  and registered for the protocol; this host has no Obsidian executable or
  registered handler, so native launch remains unproven.
- The malformed-note and duplicate-ID boundaries are covered. Large-Vault,
  forgotten-note deletion, watcher behavior, concurrent mission/sync resource
  isolation, and backup/restore soak remain separate release work.

No item above is represented as implemented by a mock button or synthetic
success response. Cutover remains closed: the required soak and preview window,
native Obsidian acceptance, protected-live link reconciliation, and explicit
human release sign-off have not occurred.
