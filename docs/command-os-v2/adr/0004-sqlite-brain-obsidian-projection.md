# ADR 0004: SQLite Brain with an Obsidian-compatible projection

- Status: accepted
- Date: 2026-07-16

## Decision

Keep memory nodes, edges, provenance, versions, Context Packs, lifecycle,
privacy policy, and audit history transactional in SQLite. Expose an optional
local Obsidian-compatible Vault as a synchronized Markdown/YAML/wikilink
projection and reviewable import surface.

Vault writes are path-sandboxed, atomic, hashed, versioned, and conflict-aware.
The Vault never owns active mission state and agents never receive unrestricted
filesystem access; they query the local Brain service for the smallest allowed
context.

## Consequences

Operators receive portable human-readable notes without sacrificing database
transactions. Two-way edits require explicit conflict handling and incremental
sync, and Vault availability cannot be a hidden runtime dependency.
