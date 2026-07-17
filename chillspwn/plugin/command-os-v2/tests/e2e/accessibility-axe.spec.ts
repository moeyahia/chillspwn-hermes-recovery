import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import { expect, test, type Page, type TestInfo } from "./support/playwright";
import { createBrainGraphFixture } from "./support/brainGraphFixture";
import { createBrainHomeInboxFixture } from "./support/brainHomeInboxFixture";
import { createBrainVaultFixture } from "./support/brainVaultFixture";
import {
  createDecisionsIntelligenceFixture,
  type DecisionsIntelligenceFixture,
} from "./support/decisionsIntelligenceFixture";
import { createFailureDiagnosisFixture } from "./support/failureDiagnosisFixture";
import { canonicalFixtureNamespace } from "./support/fixtureNamespace";
import {
  createMissionPortfolioFixture,
  type MissionPortfolioFixture,
} from "./support/missionPortfolioFixture";
import {
  createOperationalListsFixture,
  type OperationalListsFixture,
} from "./support/operationalListsFixture";
import { createPlanChangeFixture } from "./support/planChangeFixture";
import {
  createRunInterventionRecoveryFixture,
  type RunInterventionRecoveryFixture,
} from "./support/runInterventionRecoveryFixture";
import { createSystemFixture } from "./support/systemFixture";

interface AccessibilityInventory {
  readonly schemaVersion: number;
  readonly wcagTags: string[];
  readonly states: readonly {
    readonly id: string;
    readonly route: string;
    readonly surface: string;
    readonly kind: "primary-initial" | "material";
    readonly fixture: string;
  }[];
}

const accessibilityInventory = JSON.parse(readFileSync(
  new URL("../accessibility-state-inventory.json", import.meta.url),
  "utf8",
)) as AccessibilityInventory;
const WCAG_TAGS = accessibilityInventory.wcagTags;

interface AxeFinding {
  readonly id: string;
  readonly impact: string | null;
  readonly help: string;
  readonly helpUrl: string;
  readonly targets: readonly string[];
  readonly summaries: readonly string[];
}

interface PrimaryRouteCase {
  readonly state: string;
  readonly path: string;
  readonly heading: string;
  readonly ready: (page: Page) => Promise<void>;
}

let portfolioFixture: MissionPortfolioFixture;
let operationalFixture: OperationalListsFixture;
let intelligenceFixture: DecisionsIntelligenceFixture;
let guidedWaitingFixture: RunInterventionRecoveryFixture;

function compactFindings(
  findings: readonly {
    readonly id: string;
    readonly impact?: string | null;
    readonly help: string;
    readonly helpUrl: string;
    readonly nodes: readonly {
      readonly target: unknown;
      readonly failureSummary?: string;
    }[];
  }[],
): readonly AxeFinding[] {
  return findings.map((finding) => ({
    id: finding.id,
    impact: finding.impact ?? null,
    help: finding.help,
    helpUrl: finding.helpUrl,
    targets: finding.nodes.map((node) => JSON.stringify(node.target)),
    summaries: finding.nodes.map((node) => node.failureSummary ?? "No failure summary was supplied."),
  }));
}

function inventoryState(state: string) {
  const entry = accessibilityInventory.states.find((candidate) => candidate.id === state);
  if (!entry) throw new Error(`Accessibility state ${state} is absent from the machine-readable inventory`);
  return entry;
}

async function waitForLoadedSurface(page: Page): Promise<void> {
  await expect(
    page.locator("main#command-os-content .os-state-panel"),
    "Canonical route queries must leave their transient loading presentation before axe scans the named state",
  ).toHaveCount(0, { timeout: 20_000 });
}

async function assertWcagAa(page: Page, testInfo: TestInfo, state: string): Promise<void> {
  const inventory = inventoryState(state);
  const results = await new AxeBuilder({ page })
    .withTags(WCAG_TAGS)
    .analyze();
  const violations = compactFindings(results.violations);
  const incomplete = compactFindings(results.incomplete);
  await testInfo.attach(`axe-${state}.json`, {
    body: Buffer.from(JSON.stringify({
      state,
      inventory,
      actualUrl: page.url(),
      tags: WCAG_TAGS,
      testedAt: results.timestamp,
      passes: results.passes.length,
      inapplicable: results.inapplicable.length,
      violations,
      incomplete,
      limitation: "Automated axe results complement, but do not replace, keyboard, screen-reader, native zoom, and manual WCAG review.",
    }, null, 2)),
    contentType: "application/json",
  });
  expect(
    violations,
    `${state} must have no automated WCAG 2.x A/AA violations. See the attached axe result for exact selectors and remediation links.`,
  ).toEqual([]);
}

const PRIMARY_ROUTES: readonly PrimaryRouteCase[] = [
  {
    state: "overview",
    path: "/",
    heading: "Command Center",
    ready: async (page) => expect(page.getByRole("heading", { level: 2, name: "Active operations", exact: true })).toBeVisible(),
  },
  {
    state: "missions-primary",
    path: "/missions",
    heading: "Missions",
    ready: async (page) => expect(page.getByRole("table", { name: "Filtered mission portfolio", exact: true })).toBeVisible(),
  },
  {
    state: "live-operations-primary",
    path: "/live",
    heading: "Live Operations",
    ready: async (page) => expect(page.locator(".os-operation-list").first()).toBeVisible(),
  },
  {
    state: "guided-workspace-primary",
    path: "/guided",
    heading: "Guided Workspace",
    ready: async (page) => expect(page.locator(".os-operation-list").first()).toBeVisible(),
  },
  {
    state: "decisions-primary",
    path: "/decisions",
    heading: "Decisions",
    ready: async (page) => expect(page.getByRole("heading", { level: 2, name: "Guided exact-step decisions", exact: true })).toBeVisible(),
  },
  {
    state: "intelligence-evidence-primary",
    path: "/intelligence/evidence",
    heading: "Evidence, findings, and artifacts",
    ready: async (page) => expect(page.getByRole("combobox", { name: "Verification", exact: true })).toBeVisible(),
  },
  {
    state: "agents-primary",
    path: "/agents",
    heading: "Agents",
    ready: async (page) => expect(page.getByRole("region", { name: "Agent fleet", exact: true })).toBeVisible(),
  },
  {
    state: "second-brain-primary",
    path: "/brain",
    heading: "Second Brain",
    ready: async (page) => expect(page.getByRole("region", { name: "Memory health", exact: true })).toBeVisible(),
  },
  {
    state: "learning-primary",
    path: "/learning",
    heading: "Learning Lab",
    ready: async (page) => expect(page.getByRole("combobox", { name: "State", exact: true })).toBeVisible(),
  },
  {
    state: "observability-primary",
    path: "/observability",
    heading: "Observability",
    ready: async (page) => expect(page.getByRole("region", { name: "Trace results", exact: true })).toBeVisible(),
  },
  {
    state: "reports-primary",
    path: "/reports",
    heading: "Reports",
    ready: async (page) => expect(page.getByRole("region", { name: "Report records", exact: true })).toBeVisible(),
  },
  {
    state: "system-connections-primary",
    path: "/system/connections",
    heading: "System",
    ready: async (page) => expect(page.getByRole("heading", { level: 2, name: "MCP servers", exact: true })).toBeVisible(),
  },
] as const;

test.describe("automated WCAG 2.2 AA primary-route and material-state gate", () => {
  // The canonical E2E server owns one disposable SQLite path per run ID.
  // Keep fixture mutations and filesystem Vault health checks serial so one
  // state cannot reset or race another state in the same browser project.
  test.describe.configure({ mode: "serial" });
  test.setTimeout(90_000);

  test.beforeAll(({}, testInfo) => {
    portfolioFixture = createMissionPortfolioFixture(
      canonicalFixtureNamespace(testInfo, "axe-primary-portfolio"),
    );
    operationalFixture = createOperationalListsFixture(
      canonicalFixtureNamespace(testInfo, "axe-primary-operational"),
    );
    intelligenceFixture = createDecisionsIntelligenceFixture(
      canonicalFixtureNamespace(testInfo, "axe-primary-intelligence"),
    );
    createBrainHomeInboxFixture(canonicalFixtureNamespace(testInfo, "axe-primary-brain"));
    createSystemFixture(canonicalFixtureNamespace(testInfo, "axe-primary-system"));
    guidedWaitingFixture = createRunInterventionRecoveryFixture(
      "pause_resume",
      canonicalFixtureNamespace(testInfo, "axe-guided-waiting"),
    );
  });

  for (const route of PRIMARY_ROUTES) {
    test(`${route.state} has no axe A/AA violations`, async ({ page }, testInfo) => {
      await page.goto(route.path, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { level: 1, name: route.heading, exact: true })).toBeVisible();
      await route.ready(page);
      await waitForLoadedSurface(page);
      await assertWcagAa(page, testInfo, route.state);
    });
  }

  test("open Command Center command palette has no axe A/AA violations", async ({ page }, testInfo) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 2, name: "Active operations", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Search or run a command", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Command palette", exact: true })).toBeVisible();
    await assertWcagAa(page, testInfo, "overview-command-palette-open");
  });

  test("minimal Autonomous intake has no axe A/AA violations", async ({ page }, testInfo) => {
    await page.goto("/missions/new/autonomous", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", {
      level: 1,
      name: "Launch from a clear boundary, not a blank contract",
      exact: true,
    })).toBeVisible();
    await expect(page.getByRole("group", { name: "Authorization and exact scope", exact: true })).toBeVisible();
    await waitForLoadedSurface(page);
    await assertWcagAa(page, testInfo, "autonomous-intake-scope");
  });

  test("minimal Guided intake has no axe A/AA violations", async ({ page }, testInfo) => {
    await page.goto("/missions/new/guided", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", {
      level: 1,
      name: "Begin with one authorized target",
      exact: true,
    })).toBeVisible();
    await expect(page.getByRole("group", { name: "Authorization and exact scope", exact: true })).toBeVisible();
    await waitForLoadedSurface(page);
    await assertWcagAa(page, testInfo, "guided-intake-scope");
  });

  test("versioned plan workspace has no axe A/AA violations", async ({ page }, testInfo) => {
    const fixture = createPlanChangeFixture(
      "queued_apply",
      canonicalFixtureNamespace(testInfo, "axe-plan-workspace"),
    );
    await page.goto(
      `/missions/${encodeURIComponent(fixture.missionId)}/runs/${encodeURIComponent(fixture.runId)}?tab=plan`,
      { waitUntil: "domcontentloaded" },
    );
    await expect(page.getByRole("heading", { level: 1, name: fixture.missionName, exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Plan change requests", exact: true })).toBeVisible();
    await waitForLoadedSurface(page);
    await assertWcagAa(page, testInfo, "versioned-plan-workspace");
  });

  test("Guided waiting-decision workspace has no axe A/AA violations", async ({ page }, testInfo) => {
    await page.goto(`/guided/${encodeURIComponent(guidedWaitingFixture.missionId)}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1, name: /Run intervention pause-resume/u })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Exact step decision", exact: true })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Exact Guided decision", exact: true })).toBeVisible();
    await waitForLoadedSurface(page);
    await assertWcagAa(page, testInfo, "guided-waiting-decision");
  });

  test("evidence review has no axe A/AA violations", async ({ page }, testInfo) => {
    await page.goto(
      `/intelligence/evidence/${encodeURIComponent(intelligenceFixture.primaryEvidenceId)}`,
      { waitUntil: "domcontentloaded" },
    );
    await expect(page.getByRole("heading", {
      level: 2,
      name: intelligenceFixture.primaryEvidenceSummary,
      exact: true,
    })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Chain of custody", exact: true })).toBeVisible();
    await waitForLoadedSurface(page);
    await assertWcagAa(page, testInfo, "evidence-review");
  });

  test("finding review has no axe A/AA violations", async ({ page }, testInfo) => {
    await page.goto(
      `/intelligence/findings/${encodeURIComponent(intelligenceFixture.primaryFindingId)}`,
      { waitUntil: "domcontentloaded" },
    );
    await expect(page.getByRole("heading", {
      level: 2,
      name: intelligenceFixture.primaryFindingTitle,
      exact: true,
    })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Status", exact: true })).toBeVisible();
    await waitForLoadedSurface(page);
    const findingLinkTargets = await page
      .locator(".os-finding-primary-link, .os-finding-secondary-link > a")
      .evaluateAll((links) => links.map((link) => {
        const bounds = link.getBoundingClientRect();
        return { height: bounds.height, width: bounds.width };
      }));
    expect(findingLinkTargets.length).toBeGreaterThan(0);
    for (const target of findingLinkTargets) {
      expect(target.height).toBeGreaterThanOrEqual(44);
      expect(target.width).toBeGreaterThanOrEqual(44);
    }
    await assertWcagAa(page, testInfo, "finding-review");
  });

  test("Second Brain graph and its accessible table have no axe A/AA violations", async ({ page }, testInfo) => {
    const fixture = createBrainGraphFixture(canonicalFixtureNamespace(testInfo, "axe-brain-graph"));
    const layoutWorkerLoaded = page.waitForResponse((response) =>
      // Vite serves the TypeScript source path in development and a hashed
      // JavaScript asset in the managed-static release profile. Bind to the
      // stable worker stem so the same assertion proves both delivery modes.
      response.url().includes("memoryGraphLayout.worker")
      && response.status() === 200,
    );
    await page.goto(`/brain/graph?engagement=${encodeURIComponent(fixture.engagementId)}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("heading", { level: 1, name: "Memory Graph", exact: true })).toBeVisible();
    const canvas = page.getByRole("application", { name: /^Memory graph with/u });
    await expect(canvas).toHaveAttribute("aria-busy", "false", { timeout: 20_000 });
    await layoutWorkerLoaded;
    await assertWcagAa(page, testInfo, "second-brain-graph-canvas");

    await page.getByRole("button", { name: "Accessible table", exact: true }).click();
    await expect(page.getByRole("table", { name: "Accessible memory graph node list", exact: true })).toBeVisible();
    await assertWcagAa(page, testInfo, "second-brain-graph-table");
  });

  test("connected Obsidian Vault has no axe A/AA violations", async ({ page }, testInfo) => {
    const fixture = createBrainVaultFixture(canonicalFixtureNamespace(testInfo, "axe-connected-vault"));
    await page.goto("/brain/vault", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1, name: "Obsidian Vault", exact: true })).toBeVisible();
    await page.getByLabel("Display name", { exact: true }).fill(fixture.displayName);
    await page.getByLabel("Path inside the allowed root", { exact: true }).fill(fixture.relativePath);
    await page.getByLabel("Grant explicit filesystem permission", { exact: true }).check();
    await page.getByRole("button", { name: "Test write, read, rename, and delete", exact: true }).click();
    await expect(page.getByText("Round-trip verified", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Connect verified vault", exact: true }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Active Obsidian Vaults", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: fixture.relativePath, exact: true })).toBeVisible();
    await waitForLoadedSurface(page);
    await assertWcagAa(page, testInfo, "connected-obsidian-vault");
  });

  test("structured blocked-state recovery has no axe A/AA violations", async ({ page }, testInfo) => {
    const fixture = createFailureDiagnosisFixture(
      "records",
      canonicalFixtureNamespace(testInfo, "axe-failure-diagnosis"),
    );
    await page.goto(`/live/${encodeURIComponent(fixture.runId)}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", {
      level: 2,
      name: "What failed, why, and what can resolve it",
      exact: true,
    })).toBeVisible();
    await expect(page.getByRole("heading", {
      name: "The primary provider remained unavailable after its readiness circuit opened.",
      exact: true,
    })).toBeVisible();
    await waitForLoadedSurface(page);
    await assertWcagAa(page, testInfo, "blocked-run-failure-diagnosis");
  });

  test("Research Lab has no axe A/AA violations", async ({ page }, testInfo) => {
    await page.goto("/learning?view=research", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1, name: "Learning Lab", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Readiness gate", exact: true })).toBeVisible();
    await waitForLoadedSurface(page);
    await assertWcagAa(page, testInfo, "learning-research");
  });

  test("Observability trace review has no axe A/AA violations", async ({ page }, testInfo) => {
    const params = new URLSearchParams({
      view: "traces",
      query: operationalFixture.token,
      traceId: operationalFixture.traceIds[0]!,
      limit: "50",
    });
    await page.goto(`/observability?${params.toString()}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", {
      level: 2,
      name: operationalFixture.traceSummaries[0]!,
      exact: true,
    })).toBeVisible();
    await expect(page.getByLabel("Selected trace detail", { exact: true })).toContainText(operationalFixture.traceIds[0]!);
    await waitForLoadedSurface(page);
    await assertWcagAa(page, testInfo, "observability-trace-review");
  });

  test("report review has no axe A/AA violations", async ({ page }, testInfo) => {
    await page.goto(`/reports/${encodeURIComponent(operationalFixture.reportIds[0]!)}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("heading", {
      level: 2,
      name: operationalFixture.reportTypes[0]!,
      exact: true,
    })).toBeVisible();
    await expect(page.getByText(/Direct download requires a separate authorized artifact-delivery contract\.$/u)).toBeVisible();
    await waitForLoadedSurface(page);
    await assertWcagAa(page, testInfo, "report-review");
  });

  test("System policies have no axe A/AA violations", async ({ page }, testInfo) => {
    await page.goto("/system/policies", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1, name: "System", exact: true })).toBeVisible();
    await expect(page.locator(".os-policy-list .os-card").first()).toBeVisible();
    await waitForLoadedSurface(page);
    await assertWcagAa(page, testInfo, "system-policies");
  });

  test("System settings status has no axe A/AA violations", async ({ page }, testInfo) => {
    await page.goto("/system/settings", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1, name: "System", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", {
      level: 2,
      name: "Configuration is read-only in this API contract",
      exact: true,
    })).toBeVisible();
    await waitForLoadedSurface(page);
    await assertWcagAa(page, testInfo, "system-settings");
  });

  test.afterAll(() => {
    // Keep all fixture variables observably consumed so accidental removal of
    // a primary canonical seed fails TypeScript instead of silently reducing
    // the named state matrix.
    expect(portfolioFixture.primaryMissionId).toBeTruthy();
  });
});
