# Command OS V2 information architecture

Status: implemented as an isolated, route-split V2 shell; release navigation is
not cut over from legacy.

## Product boundary

The primary persistent object is a Mission. A Run is one execution attempt,
and the journey is exactly `autonomous` or `guided`. Conversation is a
mission-linked surface, never the owner of execution state.

The global shell has one top bar, one collapsible navigation rail, a content
canvas, notification and command-palette overlays, and contextual feature
drawers. It does not import the legacy window manager or chat shell.

## Primary navigation and canonical routes

| Area | Canonical route(s) | Purpose |
|---|---|---|
| Overview | `/` | Readiness, active work, attention, Brain, learning, and system truth |
| Missions | `/missions`, `/missions/new`, `/missions/:missionId` | Portfolio, two-journey intake, and durable mission workspace |
| Runs | `/missions/:missionId/runs/:runId` | Summary, plan, live/guide, intelligence, Brain, learning, and history |
| Live Operations | `/live`, `/live/:runId` | Autonomous observation, progress, recovery, and technical drill-down |
| Guided Workspace | `/guided`, `/guided/:missionId` | Explain–recommend–choose–observe–interpret collaboration |
| Decisions | `/decisions` | Guided decisions, safe stops, and administrative approvals |
| Intelligence | `/intelligence/evidence`, `/findings`, `/artifacts` plus stable ID routes | Logs, observations, candidates, verified evidence, findings, and artifacts |
| Agents | `/agents`, `/agents/:agentId` | Fleet health, capability, assignment, model, and history |
| Second Brain | `/brain`, `/graph`, `/inbox`, `/nodes/:id`, `/vault`, `/control` | Memory graph, lifecycle review, provenance, privacy, and Vault sync |
| Learning | `/learning`, `/learning/lessons/:id` | Evaluations, lessons, comparisons, and bounded Research Lab |
| Observability | `/observability` | Correlated semantic events, traces, logs, health, and raw detail |
| Reports | `/reports`, `/reports/:reportId` | Evidence-linked deliverables and secure export |
| System | `/system/connections`, `/policies`, `/settings` | Runtime connections, authorization policy, and V2 settings |
| Manual | `/manual` | Operator documentation |

`/approvals` is a V2-only compatibility redirect to `/decisions`.
`/intelligence` redirects to the canonical evidence route. Unknown routes show
an explicit V2 not-found surface; generated internal links are release-gated by
the route crawl.

## Journey entry and workspace rules

- `/missions/new` always shows both journeys; no provider or runtime mode is a
  third top-level choice.
- Autonomous intake uses a registry-backed contract, readiness review, and one
  launch action. Its live surface is observational unless the operator pauses,
  cancels, or creates a reviewed amendment.
- Guided intake can begin with authorization plus target. Each consequential
  action is represented by an exact decision and persisted independently of
  transcript rendering.
- A mission can own multiple runs. Terminal runs are not overwritten by a new
  attempt.
- Evidence, findings, attempts, assets, plans, Context Packs, and reports use
  stable resource routes rather than transcript offsets.

## Responsive behavior

The desktop two-column shell collapses to a drawer-based navigation at smaller
widths. Context rails become drawers or sheets. Critical pause, cancel, guided
decision, and recovery actions retain 44 CSS-pixel targets. Graph content has a
list alternative. The release gate still requires the full configured browser
and viewport matrix; the present Chromium checkpoint is not cross-browser
approval.
