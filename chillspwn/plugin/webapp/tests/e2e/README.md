# Command OS browser journeys

These tests build and exercise the real production client and local server. The
harness creates fresh temporary HOME, runtime, vault, legacy-schema, and
canonical SQLite paths for each run. It imports no live credentials and inserts
no dashboard fixtures or fake production records.

Run the complete local gate:

```bash
bun run test:e2e
```

Run against an existing build:

```bash
bun run test:e2e:run
```

The two large local profiles are intentionally opt-in so the ordinary browser
gate remains fast. Each creates its own temporary canonical database, refuses
to combine fixture profiles, and starts a credential-isolated server:

```bash
bun run test:e2e:brain-scale
bun run test:e2e:observability-scale
```

The Observability profile persists 100,000 real append-only events plus a small
correlated structured-log set. It verifies first/next API and UI cursors,
duplicate-free pages, trace/event/log semantics, filters, FTS search, bounded
DOM size, scroll responsiveness, browser long tasks, and console/page errors.
The fixture module is imported only by the E2E server harness.

The Playwright configuration uses a compatible installed Chromium executable
when one is available. Otherwise install Playwright-managed Chromium once:

```bash
bunx playwright install chromium
```

Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to an absolute executable path when Chromium
is installed elsewhere. Set `PLAYWRIGHT_BASE_URL` only to test an explicitly
managed server; doing so disables the isolated local web-server lifecycle.

The suite is deliberately serial because it verifies canonical persistence in
one fresh database. Reports and traces are written only on the local test path
and are ignored by Git.
