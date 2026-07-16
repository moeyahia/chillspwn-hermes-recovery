# Information architecture

## Primary navigation

1. Overview
2. Missions
3. Live Operations
4. Guided Workspace
5. Decisions
6. Intelligence
7. Agents
8. Second Brain
9. Learning
10. Observability
11. Reports
12. System

## Canonical routes

| Route | Purpose |
| --- | --- |
| `/` | Command Center Overview |
| `/missions` | Mission portfolio |
| `/missions/new` | Two-journey mission entry |
| `/missions/new/autonomous` | Autonomous contract composer |
| `/missions/new/guided` | Guided mission creation |
| `/missions/:missionId` | Mission workspace |
| `/missions/:missionId/runs/:runId` | Run workspace |
| `/live` and `/live/:runId` | Autonomous operations |
| `/guided/:missionId` | Guided workspace |
| `/decisions` | Guided decisions, Autonomous exceptions, admin approvals |
| `/intelligence/evidence` | Evidence vault |
| `/intelligence/findings` | Findings |
| `/intelligence/artifacts` | Artifacts |
| `/agents` and `/agents/:agentId` | Agent fleet and profile |
| `/brain`, `/brain/graph`, `/brain/inbox` | Second Brain surfaces |
| `/brain/nodes/:memoryNodeId` | Memory node provenance and history |
| `/brain/vault` | Obsidian connection and conflicts |
| `/learning` | Learning Lab |
| `/observability` | Health, traces, semantic events, logs |
| `/reports` | Reports and exports |
| `/system/connections` | Providers and MCP |
| `/system/policies` | Authorization and tool policies |
| `/system/settings` | Product settings |
The public `/legacy` shell has been removed. Historical unversioned API reads
remain available for migration/reconciliation only; their mutation and
execution paths are default-off behind the explicit rollback switch.

Legacy `/approvals` redirects to `/decisions`. Provider-specific and internal mode pages are secondary System controls, never primary journey choices.
