import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import {
  locateClaudeSessionFile,
  readClaudeSessionOrigin,
  resolveClaudeResumeSource,
  resolveTrustedClaudeResumeCwd,
} from "../CliSessionSource";

let root: string;
let projects: string;
let workspaces: string;
let dashboard: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "chillspwn-cli-source-"));
  projects = join(root, "projects");
  workspaces = join(root, "workspaces");
  dashboard = join(root, "dashboard-app");
  mkdirSync(projects);
  mkdirSync(workspaces);
  mkdirSync(dashboard);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function sessionFile(project: string, id: string, records: unknown[]): string {
  const directory = join(projects, project);
  mkdirSync(directory, { recursive: true });
  const file = join(directory, `${id}.jsonl`);
  writeFileSync(file, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
  return file;
}

describe("trusted Claude CLI resume sources", () => {
  test("uses the first authoritative JSONL cwd, preserving hyphens", () => {
    const id = "019f506f-da43-7d22-8970-caeaea1e6c95";
    const cwd = join(workspaces, "client-alpha-box");
    const later = join(workspaces, "later");
    mkdirSync(cwd);
    mkdirSync(later);
    const file = sessionFile("-ambiguous-project-name", id, [
      { type: "queue-operation" },
      { sessionId: id, cwd },
      { sessionId: id, cwd: later },
    ]);
    expect(readClaudeSessionOrigin(file, id)).toBe(cwd);
    expect(resolveClaudeResumeSource({ projectsDir: projects, sessionId: id, allowedWorkspaceRoots: [workspaces], dashboardCwd: dashboard }).cwd).toBe(cwd);
  });

  test("allows workspace descendants and exact dashboard cwd only", () => {
    const child = join(workspaces, "engagement");
    const dashboardChild = join(dashboard, "untrusted-child");
    mkdirSync(child);
    mkdirSync(dashboardChild);
    expect(resolveTrustedClaudeResumeCwd(child, [workspaces], dashboard)).toBe(child);
    expect(resolveTrustedClaudeResumeCwd(dashboard, [workspaces], dashboard)).toBe(dashboard);
    expect(() => resolveTrustedClaudeResumeCwd(dashboardChild, [workspaces], dashboard)).toThrow();
  });

  test("fails closed for mismatches, missing origins, symlinks, and duplicates", () => {
    const id = "session-safe-1";
    const cwd = join(workspaces, "engagement");
    mkdirSync(cwd);
    const file = sessionFile("one", id, [{ sessionId: "different", cwd }, { malformed: true }]);
    expect(() => readClaudeSessionOrigin(file, id)).toThrow();
    expect(dirname(locateClaudeSessionFile(projects, id))).toContain("one");

    const outside = join(root, "outside");
    mkdirSync(outside);
    expect(() => resolveTrustedClaudeResumeCwd(outside, [workspaces], dashboard)).toThrow();

    const symlinkCwd = join(root, "cwd-link");
    symlinkSync(cwd, symlinkCwd, "dir");
    expect(() => resolveTrustedClaudeResumeCwd(symlinkCwd, [workspaces], dashboard)).toThrow();

    sessionFile("two", id, [{ sessionId: id, cwd }]);
    expect(() => locateClaudeSessionFile(projects, id)).toThrow("ambiguous");

    const fileLinkId = "file-link-1";
    const fileLinkDir = join(projects, "links");
    mkdirSync(fileLinkDir);
    symlinkSync(file, join(fileLinkDir, `${fileLinkId}.jsonl`));
    expect(() => locateClaudeSessionFile(projects, fileLinkId)).toThrow("not found");

    const projectLinkId = "project-link-1";
    const externalProject = join(root, "external-project");
    mkdirSync(externalProject);
    writeFileSync(join(externalProject, `${projectLinkId}.jsonl`), "{}\n");
    symlinkSync(externalProject, join(projects, "project-link"), "dir");
    expect(() => locateClaudeSessionFile(projects, projectLinkId)).toThrow("not found");
  });
});
