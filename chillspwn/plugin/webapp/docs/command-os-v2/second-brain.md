# Second Brain

The Second Brain is a user-owned graph over operator preferences, Missions, Runs, plans, agents, tools, tactics, techniques, decisions, evidence links, findings, failures, recoveries, evaluations, reports, and verified lessons.

## Lifecycle

`candidate`, `confirmed`, `verified`, `disputed`, `stale`, `superseded`, `forgotten`.

Personal inferences are candidates unless an explicit consent policy permits promotion for that preference class. Mission facts backed by immutable evidence may be recorded automatically with provenance. Lessons use their separate review gate.

## Retrieval

Retrieval combines exact properties, FTS5, bounded graph neighborhoods, recency, scope, verified-lesson filtering, and optional semantic embeddings. Reranking respects confirmation, confidence, engagement, journey, agent/tool scope, expiry, exclusions, and context budget.

Every use creates a Context Pack containing retrieved, used, ignored, relevance, influence summary, and later correction. `Context used` and `Show memory path` expose evidence-based influence without exposing hidden chain-of-thought.

## Graph UI

The implemented canvas progressively loads a bounded neighborhood, groups nodes
into semantic clusters, highlights the shortest explanatory path from the root,
and provides global, local, mission, and operator views. It supports title/type/
lifecycle/sensitivity filtering, pan/zoom/fit, progressive labels, a node
inspector, and an accessible table alternative. The API bounds progressive
segments to protect query and rendering latency.

The specified attack-path and lesson/failure views, edge/engagement/date/
confidence controls, named saved views, shareable filter deep links, persistent
pinned positions, and full saved-layout model are not implemented yet. Bounded
layout now runs in a dedicated worker; new requests supersede stale work and the
worker is terminated with the canvas. Database/API queries have a 50,000-node
fixture, but populated large-graph browser acceptance remains outstanding.

The populated browser acceptance fixture is deliberately small and real: it
writes eight canonical nodes and five typed edges to an isolated SQLite
database, renders them through the production graph API and canvas, and exposes
the accessible list alternative. The same journey versions an operator
correction, performs complete forgetting, and verifies that the forgotten node
is absent from its prior Context Pack and the global graph. This proves the
functional lifecycle and retrieval boundary; it does not claim 50,000-node
browser rendering or migrated production content.

## Obsidian bridge acceptance

The opt-in isolated physical-filesystem smoke now passes against a fresh
temporary vault. It exercises a heterogeneous canonical graph, Markdown/YAML
projection, stable aliases, native `[[wikilinks]]`, a content-addressed
mission-artifact attachment, operator edit import with version history,
concurrent-change conflict detection, explicit merge resolution, synchronized
forgetting, retrieval removal, and cleanup. It never reads deployment
configuration or an operator vault.

The final smoke exported 10 heterogeneous nodes and eight edges as 10 YAML/
wikilink notes plus one canonical attachment. It imported an operator edit over
versions 1/2, merged a conflict over versions 1/2/3, then verified forgetting
changed retrieval from one match to zero and removed the projection.

This closes the functional disposable-vault acceptance gap. Incremental sync of
a 50,000-note physical vault, sustained watcher behavior, production-vault
permissions, and a production-vault rollback remain separate performance and
operational gates.

## Transparency status

Context Packs are canonical and visible from Guided Commander messages,
memory-node usage history, Autonomous Completion Review, and reports. The
populated browser suite verifies that `Context used` opens the persisted pack
and that `Show memory path` deep-links to the graph. Universal entry points from
every Autonomous decision, action, and plan remain to be completed.

Guided presentation adaptation is implemented through a focused fail-closed
profile derived only from confirmed Context Pack preferences. Automated tests
verify changes to explanation depth, terminology, pace, and evidence
presentation while authorization and safety remain unchanged. The populated
browser suite separately verifies versioned correction and forgetting changing
future retrieval. What remains unverified is a later live-provider response
whose wording or plan selection changes after that correction/forgetting cycle;
no such deployed-provider result is claimed here.

Reusable-memory ingestion also fails closed on secret-like content. Immutable
evidence remains in its dedicated lifecycle and memory links to validated
canonical mission artifacts rather than embedding arbitrary attachment paths or
credential material.

The final quiet 50,000-node/49,999-edge benchmark passed: hybrid retrieval p95
was 0.499 ms, local 250-node expansion p95 was 115.972 ms, expanded 500-node
retrieval p95 was 109.505 ms, global 250-node retrieval p95 was 116.635 ms, and
bounded 500-node canvas layout p95 was 0.439 ms. These database/API/worker
measurements do not substitute for a populated 50,000-node browser or physical
50,000-note vault test.
