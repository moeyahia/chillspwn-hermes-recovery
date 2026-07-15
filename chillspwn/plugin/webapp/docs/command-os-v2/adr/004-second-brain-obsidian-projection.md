# ADR-004: The Second Brain is canonical in SQLite and projected to Obsidian

Status: Accepted
Date: 2026-07-15

## Context

Operators need transparent, editable, portable memory, while mission execution
needs transactional scope enforcement, provenance, versioning, and forgetting.
A filesystem note cannot reliably provide both roles by itself.

## Decision

Memory nodes, edges, sources, versions, candidates, suppressions, Context Packs,
and usage audits are canonical in SQLite. An optional Obsidian vault is a
versioned human-readable projection and import surface using YAML and stable
`[[wikilinks]]`.

## Consequences

- Vault writes are atomic, sandboxed, and conflict-aware.
- Operator and agent authorship remain distinct.
- Forgetting removes content, retrieval state, derived edges, and projections.
- A vault sync failure cannot corrupt or block canonical mission state.
