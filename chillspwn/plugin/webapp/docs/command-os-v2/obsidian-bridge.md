# Obsidian vault bridge

SQLite remains canonical. The vault is an explicitly authorized, local-first Markdown projection and candidate import surface.

## Note contract

Each note carries stable ID, type, lifecycle, scope, confidence, sensitivity, timestamps, author, version, retention, and source IDs in YAML frontmatter. Relationships use `[[wikilinks]]`; stable aliases protect identity across title changes.

## Synchronization

- allowlisted vault root and no-follow path validation;
- safe filenames, individually fsynced writes, no-clobber publication, and
  containing-directory fsync;
- bounded, cancellable bulk export with durable per-note resume and current-version skips;
- debounced incremental watcher;
- three-way conflict detection using DB version, last-synced hash, and current-file hash;
- side-by-side operator resolution;
- malformed-note quarantine;
- no modification of `.obsidian` settings;
- portable ZIP export and optional `obsidian://` deep links.

Operator-authored inbox notes import as candidates. Agent-authored notes retain agent identity and their correct candidate/verified state. Raw credentials, authentication data, confidential payloads, and unrestricted evidence are never projected.

Focused tests cover YAML/wikilink round-trip, sandboxing, concurrent-edit
conflicts, quarantine, forgotten-note removal, a private standards-compatible ZIP,
path-safe deep links, watcher debounce, and immediate watcher shutdown when the
operator disables sync.

All mutating vault routes now bind idempotent replay to the creating actor and a
normalized memory-access fingerprint, then rerun current route/resource
authorization before returning a cached response. Revoked scope therefore does
not turn an old idempotency key into a data oracle.

Portable archive authorization is retained as private server metadata containing
the creator, access fingerprint, connection/archive identity, exact node IDs,
byte size, SHA-256, and creation time. Both replay and download revalidate the
owner, current access to every non-forgotten node in bounded 500-ID SQL batches,
the vault connection, the server-managed file, byte size, and streaming hash.
The SHA-256 is calculated through a bounded file stream immediately before the
response begins. The download is a server-derived no-store `application/zip` attachment with CSP
`sandbox`, same-origin CORP, no-referrer, and no-sniff. Unknown, unauthorized,
scope-revoked, forgotten-node, or tampered archives return a generic 404 without
disclosing the archive identity. The focused memory/vault slice passed 60 tests
with 495 expectations; server TypeScript and the server-entry bundle gate passed.

Attachment handling is canonical rather than a loose filesystem copy. Imports
validate allowed types, size, regular-file/no-symlink status, mission scope, and
SHA-256; bytes are stored by content hash, deduplicated, projected atomically,
referenced with stable artifact IDs, versioned through edits/conflicts, and
included in the portable ZIP with its provenance manifest.

The isolated physical acceptance smoke exported 10 heterogeneous nodes and
eight edges as 10 YAML/`[[wikilink]]` notes plus a canonical attachment. It
imported an operator edit across versions 1/2, detected and explicitly merged a
conflict across versions 1/2/3, then forgot a node and verified retrieval changed
from one match to zero and the note projection was removed.

The opt-in physical 50,000-note profile is documented in
[`obsidian-scale-acceptance.md`](obsidian-scale-acceptance.md). The exact
`exportNodes` path projected and reconciled all 50,000 canonical notes in
47,007.20 ms with zero failures or conflicts. Incremental operator edit,
candidate import, conflict/merge, source-hash invariants, cancellation, and
cleanup also passed.

## Current limitations and release gates

- The CLI creates a verified database backup before import. A general backup
  before every destructive conflict-resolution path has not been proven.
- The 50,000-note incremental profile passed, but native recursive watch was
  unavailable because this host's inotify-instance quota was exhausted. The
  measured run used a bounded two-path physical stat adapter and performed no
  full-tree rescan; native-inotify and sustained watcher acceptance remain open.
- Full first-time bridge projection now meets its 600,000 ms budget. The prior
  O(n²) attempt remains recorded historically; the passing run depends on the
  unpromoted schema-8 partial sync-state lookup index and must follow the normal
  migration/rehearsal gate before production use.
- Standards-compatible YAML, wikilinks, portable ZIP, real attachment bytes, and
  the filesystem edit/conflict/resolve cycle pass; native Obsidian application
  rendering has not been manually exercised in this acceptance run.
- The exact 50,000-note first-time bridge export is not a 50,000-note portable
  ZIP measurement; a portable archive of that size remains an explicit scale
  gate.
- Archive authorization, size, and SHA-256 are verified immediately before
  streaming, but there is no cross-process lock around the brief hash-then-send
  window. The archive directory is server-managed; deployments whose threat
  model includes a same-UID writer should add an archive lease or serve a
  verified immutable file descriptor.
- Production-vault permissions, sustained watcher behavior, and a physical
  vault rollback rehearsal remain operational gates before selecting a real
  operator vault.
