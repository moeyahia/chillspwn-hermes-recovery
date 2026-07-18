# ADR 0001: build Command OS as an isolated sibling application

- Status: accepted
- Date: 2026-07-16

## Context

The authoritative default branch contained the legacy application at
`chillspwn/plugin/webapp` and no parallel Command OS application. An in-place
rewrite would couple V2 routes, CSS, browser state, dependencies, and failure
modes to the production baseline.

## Decision

Create `chillspwn/plugin/command-os-v2` as an independent React/TypeScript/Vite
application with its own package, entry, router, tokens, browser namespaces,
build output, Playwright project, API process, database, event client, and
artifacts. The only visual asset shared is the hash-verified canonical logo.

Stable UI-agnostic contracts may be shared only through explicit audited
boundaries. Legacy pages, components, global CSS, window state, and chat shell
are forbidden imports.

## Consequences

Both applications can run and fail independently. V2 cannot become the default
without the release gate and human approval. Duplicate scaffolding is accepted
in exchange for rollback safety and measurable noninterference.
