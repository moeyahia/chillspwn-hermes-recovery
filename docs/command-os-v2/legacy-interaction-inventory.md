# Legacy interaction inventory

Status: source-derived initial inventory at `343f6ac5a05f7286a0d66aee8c5dbd6e78a41aee`. This is the characterization seed for the legacy regression suite, not the V2 interaction manifest.

## Shell and navigation

`src/App.tsx` is a 1,173-line composition root. Although comments still reference earlier window concepts, the current rendered branch is a unified shell with a command bar, grouped tablet rail, phone bottom tabs, grouped phone drawer, session list, and persona sheet. It does not use a route library for the 21 main surfaces. A hash adapter opens a small number of application destinations.

### Registered application surfaces

| Group | ID | Label | Source page | Primary behavior to characterize |
| --- | --- | --- | --- | --- |
| Operate | `chat` | COMMS | `ChatPage.tsx` | session chat, provider/model, composer, tool activity, reconnect/restore |
| Operate | `cockpit` | AGENT COCKPIT | `AgentCockpitPage.tsx` | run creation, plan, approval mode, state/evidence inspection |
| Operate | `missionboard` | MISSION BOARD | `MissionBoardPage.tsx` | specialist lanes and eight-second refresh |
| Operate | `council` | COUNCIL | `CouncilPage.tsx` | council state, mode/settings, summon, complete, assessment |
| Operate | `terminal` | TERMINAL | `TerminalPage.tsx` | terminal start/input/resize/stop over `/ws` |
| Operate | `engagements` | ENGAGEMENTS | `EngagementsPage.tsx` | list/create engagement, report generation/status |
| Agents | `personas` | IDENTITIES | `PersonasPage.tsx` | persona listing/details |
| Agents | `skills` | ARSENAL | `SkillsPage.tsx` | skill listing and configuration |
| Agents | `memory` | NEURAL CORE | `MemoryPage.tsx` | broker-backed memory view |
| Agents | `delegation` | DISPATCH | `DelegationPage.tsx` | delegation provider/model configuration |
| Agents | `kanban` | KANBAN (LEGACY) | `KanbanPage.tsx` | board columns/cards, create/update actions |
| Intel | `osint` | OSINT | `OsintPage.tsx` | job configuration, start, status, report/download |
| Intel | `reports` | REPORTS | `ReportsPage.tsx` | list, generate missing, view/download/PDF |
| Intel | `files` | PROJECT FILES | `ProjectFilesPage.tsx` | allowed-root browse/read/write |
| Intel | `cli-sessions` | CLI SESSIONS | `CliSessionsPage.tsx` | list/history and resume into COMMS |
| Configuration | `settings` | CONFIG | `SettingsPage.tsx` | persona/provider/model and helper settings |
| Configuration | `cron` | SCHEDULER | `CronPage.tsx` | list/create/edit/delete jobs |
| Configuration | `system` | SYSTEM | `SystemPage.tsx` | stats/process/disk/network and stream interval |
| Logs | `llm-logs` | LLM LOGS | `LlmLogsPage.tsx` | engagement/provider filter and raw-call inspection |
| Logs | `api-logs` | API MONITOR | `ApiLogsPage.tsx` | session/event filters, SSE, details, Ask AI |
| Logs | `logs` | SYS LOG | `LogsPage.tsx` | log source/read behavior |

### Global controls

- Menu opens the grouped navigation drawer.
- Logo is rendered from the original `/Logo.svg`.
- Live/idle chip reflects current session state.
- Persona chip opens the persona sheet; each persona choice changes active persona and closes the sheet.
- Tablet/desktop rail entries select an application.
- Phone bottom tabs expose COMMS, BOARD, COUNCIL, OPS, and MORE.
- Drawer backdrop closes the drawer; drawer entries select and close.
- Session rail supports `+ New`, show/hide closed sessions, open, rename, save by Enter/blur, cancel rename by Escape, delete → `del`, and cancel delete → `keep`.
- Session list refreshes every five seconds; page visibility/reconnect behavior must be characterized.

The shell currently uses several clickable `div` elements and Unicode/emoji-like functional glyphs. Regression tests must preserve behavior during preview; V2 will independently use semantic controls and one icon system.

## Transport inventory

| Transport | Current consumers | Compatibility concern |
| --- | --- | --- |
| `/ws` | Chat, Terminal, board socket helper | message types, reconnect, process/session routing, close cleanup |
| `/api/api-events/stream` SSE | API Monitor | filtering, heartbeat, resume/disconnect behavior |
| `/api/system/stream` SSE | System | interval selection and fallback polling |
| HTTP polling | shell sessions (5s), Mission Board (8s), engagement/report jobs, system fallback | cadence and stale-state behavior |
| HTTP request/response | all other pages | route status, payload, errors, loading, refresh |

## API families exercised by the UI

The source exposes these stable families, all under unversioned legacy `/api`:

- health/build/personas/provider model catalogs;
- sessions, restore, live sessions, CLI sessions;
- board/Kanban and run/session mapping;
- runtime flags, approval mode, managed/observed runs, plans, approvals, evidence, artifacts, memory, training, agents, MCP, assets;
- cron, skills, delegation;
- dashboard logs, raw LLM logs, API-event sessions/events/stream/detail/Ask AI;
- system stats/processes/disk/network/stream;
- allowed files roots/list/read/write;
- engagements, files, report generation/status/view;
- reports list/PDF/generation/assets/view/download;
- OSINT create/list/detail/report/download;
- Council state/settings/mode/complete/assessment/summon;
- helper configuration and explanation service.

The exact method/status/payload inventory will be generated into a machine-readable compatibility contract before any shared backend mutation. The existing catch-all route must also be tested so mistyped API URLs cannot masquerade as valid HTML responses.

## High-risk interaction clusters

### Chat/session lifecycle

`ChatPage.tsx` is 3,949 lines and owns WebSocket connection/reconnect, restored sessions, message state, provider switching, managed/observed execution hooks, composer actions, tool cards, CLI resume, and process lifecycle. Minimum states: first session, restored live session, restored dead session, in-flight turn, reconnecting, provider switch, tool event, cancellation, error, and closed session.

### Agent Cockpit

Characterize free-text run inputs, plan creation/approval, approval-mode mutation, pending approvals, evidence lists, observed versus enforced labels, reports, and error/loading states. The current dense form and approval semantics are legacy behavior only; they do not define the V2 Autonomous contract.

### Mission Board and Kanban

Characterize empty/populated lanes, 8-second refresh, blocked/failed cards, board columns, card creation/mutation, and handoff/session links. Do not replace polling inside legacy during the parallel build.

### Evidence/artifacts/reports

Characterize every generated link, missing artifact, archived/blocked run, report view/download, and direct refresh. The current product lacks a complete canonical evidence route crawl; any generated 404 discovered is a defect to record, not a behavior V2 should preserve.

### Files, terminal, and destructive controls

Characterize path-root validation, read/write error messages, terminal lifecycle, process cleanup, cancellation, scope denial, and approval behavior using disposable authorized fixtures. Tests must never point at provider auth, protected memory, client data, or repository code.

## Fixture matrix required for the legacy regression project

- empty and populated session sets, including live/dead/closed sessions;
- each provider family with authenticated calls stubbed at the contract boundary;
- managed enforced, dry-run, and observe-only run labels;
- plan awaiting approval, running, blocked, completed, failed, and cancelled;
- pending/approved/rejected tool call;
- empty/populated Mission Board and Kanban;
- engagement with/no files, evidence, report, and external artifact;
- provider/MCP unavailable and reconnecting states;
- desktop, tablet, Android-size Chromium, and iPhone-size WebKit layouts;
- keyboard-only and 200% zoom critical paths.

## Current coverage state

Source/type/unit/integration/build checks pass, but authoritative HEAD contains no Playwright/Cypress configuration or exhaustive browser interaction manifest. Browser behavior, accessible roles/names, internal hrefs, console errors, network failures, visual baselines, responsive overflow, and focus order therefore remain unproven. The next characterization increment must turn this inventory into stable page models and browser tests without changing legacy behavior.
