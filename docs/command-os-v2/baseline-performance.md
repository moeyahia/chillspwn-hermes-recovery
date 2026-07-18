# Baseline performance and validation

Status: reproducible source/build baseline from authoritative `main` at `343f6ac5a05f7286a0d66aee8c5dbd6e78a41aee`, measured 2026-07-16 in the isolated worktree. It is not yet a browser or production-load baseline.

## Measurement environment

- Bun 1.3.14, frozen `bun.lock`
- Node v24.15.0
- Python 3.13.12
- worktree `/root/chillspwn-command-os-v24`
- application `chillspwn/plugin/webapp`
- no production credentials, live engagement data, or provider turns invoked

## Validation results

| Check | Result |
| --- | --- |
| Server entry build | pass; 71 modules, ~0.71 MB |
| Server TypeScript | pass |
| Client TypeScript | pass |
| Bun unit/integration tests | 593 pass, 0 fail; 2,138 expectations across 72 files; ~2.56s |
| OpenRouter gate portable integration | 34/34 pass |
| Mission Board MCP portable regression | 17/17 pass |
| Production Vite build | pass; 66 modules; 37 files; 2,767,919 bytes; 2.47s |

The worktree remained clean after dependency install and baseline checks.

## Bundle observations

| Asset/chunk | Raw | Gzip |
| --- | ---: | ---: |
| Initial JS | 214,079 bytes | 67.26 KB |
| Legacy global CSS | 63.57 KB | 13.05 KB |
| Terminal route | 342.96 KB | 87.33 KB |
| Chat route | 76.50 KB | 23.13 KB |

The initial JS is below the proposed V2 250 KB gzip ceiling, but that does not establish user-perceived performance. Terminal is the largest observed lazy chunk and should remain isolated from V2. The two applications must never cross-download one another's bundles.

## Source concentration indicators

| File | Lines | Performance/reliability implication |
| --- | ---: | --- |
| `src/App.tsx` | 1,173 | shell/session refresh and broad page composition share one component |
| `src/index.css` | 2,040 | global style evaluation and accumulated specificity risk |
| `src/pages/ChatPage.tsx` | 3,949 | high render/state/WebSocket responsibility concentration |
| `src/pages/AgentCockpitPage.tsx` | 657 | dense run state and control surface |
| `src/pages/MissionBoardPage.tsx` | 147 | simple but polls every eight seconds |
| `server/index.ts` | 9,878 | many domains share one process/module lifecycle |

The shell also refreshes session navigation every five seconds. System and API Monitor have SSE, and chat/terminal use WebSocket, so legacy is a mixed polling/streaming model rather than wholly polling-driven.

## What is not yet measured

No versioned Playwright/Cypress project exists at this HEAD. The following remain pending and must not be inferred from build speed:

- FCP, LCP, INP, CLS, long tasks, and route-interaction timing;
- browser startup with real API latency and authenticated session restore;
- Chrome/Edge, Firefox, WebKit, Android, iPhone, tablet, and 200% zoom behavior;
- accessibility scan and keyboard/focus performance;
- CPU/memory/idle animation cost and hidden-tab behavior;
- 100,000-event or large evidence/log rendering;
- provider/MCP latency, event throughput, reconnect storms, and database query latency;
- memory leak/long-session behavior;
- legacy p75 CPU, memory, latency, capacity, and error-rate under concurrent V2 load.

Production/live browser measurement was intentionally not run from the isolated source audit because it would require operational state and authenticated process paths. That work belongs in an isolated characterization environment with disposable data.

## Reproduction

From `chillspwn/plugin/webapp`:

```bash
bun install --frozen-lockfile
bun run check:server-entry
bun run typecheck
bun run typecheck:client
bun test ./server ./src/lib
python3 integration/test_or_gate_client.py
python3 integration/test_board_mcp_server.py
bun run build
```

Record the exact Git SHA, environment, command exit status, build manifest, and artifacts with each rerun. Release candidates must not use retry to hide flakiness.

## V2 budgets and comparison method

V2 targets are p75 FCP ≤1.0s desktop/1.5s mobile, LCP ≤1.8s desktop/2.5s mobile, INP ≤150ms desktop/200ms mobile, CLS ≤0.05, initial JS ≤250 KB gzip where practical, and ordinary route chunks ≤150 KB gzip. Live local state changes target ≤500ms.

These are gates, not current results. Measure with a fixed machine profile, cold/warm cache separation, at least representative sample counts, and archived traces. Compare legacy alone against legacy plus V2 using identical fixture load. The preview passes resource isolation only when approved legacy p75 latency, CPU, memory, provider/MCP capacity, and event throughput regress by no more than 5%.

Required next artifacts:

1. versioned bundle analyzer output for both applications;
2. legacy browser trace/screenshots and Web Vitals by supported viewport;
3. API/WebSocket/SSE latency and reconnect baseline;
4. idle and active CPU/memory profile;
5. concurrent legacy/V2 quota-isolation report;
6. large-list/event/database/Brain/Vault benchmarks when those V2 features exist.

No soak, preview acceptance window, performance exception, or cutover approval has been completed.
