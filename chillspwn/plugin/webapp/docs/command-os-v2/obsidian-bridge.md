# Obsidian vault bridge

SQLite remains canonical. The vault is an explicitly authorized, local-first Markdown projection and candidate import surface.

## Note contract

Each note carries stable ID, type, lifecycle, scope, confidence, sensitivity, timestamps, author, version, retention, and source IDs in YAML frontmatter. Relationships use `[[wikilinks]]`; stable aliases protect identity across title changes.

## Synchronization

- allowlisted vault root and no-follow path validation;
- safe filenames and atomic writes;
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

## Current limitations and release gates

- The CLI creates a verified database backup before import. A general backup
  before every destructive conflict-resolution path has not been proven.
- The watcher is incremental and low-priority, but a physical 50,000-note vault
  benchmark has not been run.
- Standards-compatible YAML, wikilinks, portable ZIP, real attachment bytes, and
  the filesystem edit/conflict/resolve cycle pass; native Obsidian application
  rendering has not been manually exercised in this acceptance run.
- Production-vault permissions, sustained watcher behavior, and a physical
  vault rollback rehearsal remain operational gates before selecting a real
  operator vault.
