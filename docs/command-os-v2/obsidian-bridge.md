# Obsidian Vault bridge

Status: local path policy, Markdown/YAML/wikilink round-trip, atomic projection,
import, incremental sync state, conflict records, watcher, portable ZIP export,
and health verification are implemented. One real operator Vault is now active
in the deployed integrated schema-2.1 service; isolated V2.4 deployment
verification and large-Vault soak
approval remain open.

## Active preview connection

On 2026-07-16 the operator-visible integrated `chillspwn.service` connected
`ChillsPwn Second Brain`
inside its pre-existing `/var/lib/chillspwn/brain-vaults` sandbox. The mutation
used the real `/api/v2/brain/vault/connect` path after a service-account
write/read/rename/delete proof. Browser and API readback show one `connected`
Vault, three synchronized verified notes, zero conflicts, and zero items needing
review. No direct SQL connection, service restart, or `.obsidian` mutation was
used. A verified pre-change online database backup is retained.

The full operational receipt and browser capture are in
[obsidian-vault-connection-evidence.md](obsidian-vault-connection-evidence.md).
This is evidence for the deployed integrated schema-2.1 release, not a claim
that the isolated schema-11 V2.4 application is deployed or release approved.
V2.4 must use a separate service/database or a reviewed schema-compatible
backport; it must not migrate the live schema-7 store in place.

## Authority and filesystem boundary

SQLite remains canonical. A Vault is a human-readable projection and reviewable
import surface. The server accepts a path only beneath one explicitly configured
absolute root. It rejects traversal, absolute escapes, symlink boundaries, and
destination changes. It never edits `.obsidian` settings.

Connection is not reported healthy until a real temporary create/read/rename/
delete round trip succeeds. Writes use private temporary files and atomic
renames. Attachments are bounded, hash-verified, and deduplicated.

## Note contract

Every projected note has stable `id`, domain `type`, lifecycle `status`, scope,
confidence, sensitivity, author, timestamps, source IDs, and tags in YAML.
Relationships use stable `[[wikilinks]]`; title changes do not change identity.
Classification derives from domain type, not from the screen that initiated a
write. Operator edits preserve authorship and version history; new Inbox notes
become reviewable candidates.

Current V2.4 source creates the complete 29-folder domain taxonomy and maps
every current memory-node type exhaustively. It filters relationship links by
live lifecycle policy and per-connection scope, so an excluded candidate or
engagement cannot produce a dangling/disclosing link. Existing synchronized
compact-folder paths remain authoritative through their sync-state record;
V2.4 does not silently move or duplicate those notes, while newly projected
notes use the V2.4 taxonomy. Regression coverage reproduces the one unresolved
candidate link observed in deployed 2.1 and proves it is omitted in V2.4.
Persisted link paths are validated as bounded relative Markdown paths, and
managed headings, aliases, and edge explanations are encoded as reversible
single-line text so operator filenames or memory text cannot inject extra
wikilinks, relationship markers, comments, or lines.

## Sync and conflict handling

Database and Vault content hashes plus versions are stored per note. Identical
replays are idempotent. Divergent edits create an explicit conflict with both
sides retained; neither side is overwritten silently. Malformed, secret-bearing,
or policy-ineligible notes are quarantined. Destructive sync is backup-first.

Portable export includes Markdown and eligible hashed attachments. Deep links
use `obsidian://` only when supported.

## Outstanding release evidence

- controlled V2.4 deployment verification of the dedicated health-check route,
  29-folder taxonomy, lifecycle/scope link filtering, and restart persistence;
- the isolated V2.4 browser slice now passes connection health,
  export/import/synchronize, portable delivery, conflict resolution, degraded
  recovery, and reload persistence across Chromium, Firefox, and WebKit; see
  [Obsidian Vault browser coverage](obsidian-vault-browser-coverage.md);
- repair/reindex has no mounted V2 API or UI contract; filesystem-offline
  recovery and service-process restart persistence still need dedicated
  implementation/harness coverage;
- native Obsidian graph verification on a representative export;
- incremental 50,000-note search/sync benchmark;
- concurrent sync versus active mission resource isolation;
- malformed-note and deletion/forget soak;
- operator-approved filesystem root and backup/restore rehearsal.
