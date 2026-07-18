import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Database } from "bun:sqlite";
import { seedSecondBrainScaleFixtures } from "./seed-brain-scale";
import { seedCanonicalE2eFixtures } from "./seed-canonical";
import { seedObservabilityScaleFixtures } from "./seed-observability-scale";
import { E2E_LIVE_ATTESTATION_FIXTURE_TOKEN } from "../../../server/app/E2eLiveAttestationFixture";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const isolatedRoot = mkdtempSync(join(tmpdir(), "chillspwn-command-os-e2e-"));
const home = join(isolatedRoot, "home");
const hermesHome = join(home, ".hermes");
const stateRoot = join(isolatedRoot, "state");
const workspace = join(isolatedRoot, "workspace");
const commandOsDatabase = join(stateRoot, "command-os-v2.sqlite");

for (const directory of [home, hermesHome, stateRoot, workspace]) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
}

// The compatibility server expects Hermes' empty Kanban schema to exist at
// startup. Create schema only—never rows—so legacy reconciliation is quiet and
// every product assertion still reads exclusively from real empty stores.
const legacyBoard = new Database(join(hermesHome, "kanban.db"));
legacyBoard.exec(`
  CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT,
    assignee TEXT,
    status TEXT NOT NULL,
    priority INTEGER DEFAULT 0,
    created_by TEXT,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    completed_at INTEGER,
    workspace_kind TEXT NOT NULL DEFAULT 'scratch',
    result TEXT,
    worker_pid INTEGER,
    last_failure_error TEXT,
    current_run_id INTEGER,
    model_override TEXT,
    max_retries INTEGER,
    session_id TEXT
  );
  CREATE TABLE task_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    status TEXT NOT NULL,
    claim_lock TEXT,
    claim_expires INTEGER,
    worker_pid INTEGER,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    outcome TEXT,
    summary TEXT,
    error TEXT
  );
  CREATE TABLE task_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    payload TEXT,
    created_at INTEGER NOT NULL
  );
`);
legacyBoard.close();

const enabledFixtureProfiles = [
  process.env.CHILLSPWN_E2E_SEED_CANONICAL === "1" ? "populated" : null,
  process.env.CHILLSPWN_E2E_BRAIN_SCALE === "1" ? "brain-scale" : null,
  process.env.CHILLSPWN_E2E_OBSERVABILITY_SCALE === "1" ? "observability-scale" : null,
].filter((profile): profile is string => profile !== null);
if (enabledFixtureProfiles.length > 1) {
  throw new Error(
    `E2E fixture profiles require separate isolated databases: ${enabledFixtureProfiles.join(", ")}`,
  );
}

if (process.env.CHILLSPWN_E2E_BRAIN_SCALE === "1") {
  console.log("[e2e-only:brain-scale] preparing isolated 50,000-node browser profile");
  seedSecondBrainScaleFixtures(commandOsDatabase);
} else if (process.env.CHILLSPWN_E2E_OBSERVABILITY_SCALE === "1") {
  console.log("[e2e-only:observability-scale] preparing isolated 100,000-event browser profile");
  seedObservabilityScaleFixtures(commandOsDatabase);
} else if (process.env.CHILLSPWN_E2E_SEED_CANONICAL === "1") {
  seedCanonicalE2eFixtures(commandOsDatabase);
}

// The E2E host must never inherit live operator credentials. Build its
// environment from a tiny process allowlist instead of trying to enumerate all
// possible secret variable names.
const childEnvironment: NodeJS.ProcessEnv = {
  PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
  LANG: process.env.LANG || "C.UTF-8",
  LC_ALL: process.env.LC_ALL || "C.UTF-8",
  TZ: process.env.TZ || "Etc/UTC",
  NODE_ENV: "test",
  TMPDIR: isolatedRoot,
};
if (process.env.CI) childEnvironment.CI = process.env.CI;

Object.assign(childEnvironment, {
  HOME: home,
  HERMES_HOME: hermesHome,
  CHILLSPWN_STATE_DIR: stateRoot,
  CHILLSPWN_SESSIONS_DIR: join(stateRoot, "sessions"),
  COMMAND_OS_DB_PATH: commandOsDatabase,
  CHILLSPWN_VAULT_ROOT: join(stateRoot, "brain-vaults"),
  CHILLSPWN_BIND: "127.0.0.1",
  CHILLSPWN_PORT: process.env.CHILLSPWN_E2E_PORT || "33131",
  DASHBOARD_TOKEN: "",
  CODEX_HOME: join(home, ".codex"),
  CODEX_BIN: join(isolatedRoot, "unavailable", "codex"),
  CLAUDE_CONFIG_DIR: join(isolatedRoot, "unavailable", "claude"),
  CLAUDE_BIN: join(isolatedRoot, "unavailable", "claude-bin"),
  GROK_AUTH_PATH: join(isolatedRoot, "unavailable", "grok-auth.json"),
  GROK_BIN: join(isolatedRoot, "unavailable", "grok"),
  CHILLSPWN_E2E_GUIDED_FIXTURE: "1",
  HERMES_PYTHON: join(isolatedRoot, "unavailable", "python"),
  ALLOWED_WORKSPACE_ROOTS: workspace,
  ENABLE_TERMINAL: "false",
  ENABLE_PROXY: "false",
  ENABLE_FILE_WRITE: "false",
  ENABLE_SECURITY_TOOLS: "false",
  ENABLE_MCP_ARSENAL: "false",
  MCP_ARSENAL_MODE: "disabled",
  MCP_ARSENAL_START_SERVERS: "false",
  ENABLE_SPECIALIST_AGENT_ROUTING: "true",
  ENFORCE_CHILLSPWN_DELEGATION: "true",
  ENFORCE_CHILLSPWN_NO_HANDS: "true",
  ALLOW_CHILLSPWN_DIRECT_TOOLS: "false",
  REQUIRE_SPECIALIST_ASSIGNMENT: "true",
  OPENROUTER_API_KEY: "",
  GEMINI_API_KEY: "",
});

// Only the populated product-journey profile receives a deterministic exact
// attestation. It performs no provider/network work and exists solely to let
// the composer exercise compatible specialist selection. The empty profile
// omits this token and continues to validate real fail-closed readiness.
if (process.env.CHILLSPWN_E2E_SEED_CANONICAL === "1") {
  childEnvironment.CHILLSPWN_E2E_LIVE_ATTESTATION_FIXTURE = E2E_LIVE_ATTESTATION_FIXTURE_TOKEN;
  console.log("[e2e-only:live-attestation] using exact no-network provider/MCP readiness fixture");
}

const server = spawn(process.execPath, ["run", "server/index.ts"], {
  cwd: projectRoot,
  env: childEnvironment,
  stdio: "inherit",
});

let stopping = false;
let killTimer: ReturnType<typeof setTimeout> | undefined;

function cleanup(): void {
  if (killTimer) clearTimeout(killTimer);
  rmSync(isolatedRoot, { recursive: true, force: true });
}

function stop(signal: NodeJS.Signals): void {
  if (stopping) return;
  stopping = true;
  server.kill(signal);
  killTimer = setTimeout(() => server.kill("SIGKILL"), 8_000);
  killTimer.unref();
}

process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));

server.once("error", (error) => {
  cleanup();
  console.error(`[e2e] failed to start the isolated Command OS server: ${error.message}`);
  process.exitCode = 1;
});

server.once("exit", (code, signal) => {
  if (!stopping) {
    // Preserve the disposable database, logs, and Vault projection after an
    // unexpected child exit. Deleting this state here made one-off browser
    // server failures impossible to diagnose because the only correlated
    // evidence disappeared before Playwright reported the first ECONNREFUSED.
    // Normal Playwright teardown still follows the `stopping` branch below
    // and removes the isolated root.
    console.error(
      `[e2e] isolated Command OS server exited unexpectedly (${signal || code}); `
      + `retained diagnostic state at ${isolatedRoot}`,
    );
    process.exitCode = code && code !== 0 ? code : 1;
    return;
  }
  cleanup();
});
