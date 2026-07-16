import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  hasHermesCredentialProvider,
  readHermesCredentialProviderNames,
} from "../HermesCredentialReadiness";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(value: unknown): { root: string; path: string } {
  const root = mkdtempSync(join(tmpdir(), "hermes-readiness-"));
  roots.push(root);
  const path = join(root, "auth.json");
  writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
  return { root, path };
}

describe("Hermes credential readiness metadata", () => {
  test("returns only non-empty canonical provider identities", () => {
    const { path } = fixture({
      credential_pool: {
        "openai-codex": [{ opaque: "must-not-be-returned" }],
        openrouter: { account: { opaque: true } },
        empty: [],
      },
    });
    const providers = readHermesCredentialProviderNames(path);
    expect([...providers].sort()).toEqual(["openai-codex", "openrouter"]);
    expect(hasHermesCredentialProvider(providers, "openai-codex")).toBe(true);
    expect(hasHermesCredentialProvider(providers, "codex", "missing")).toBe(false);
    expect(JSON.stringify([...providers])).not.toContain("must-not-be-returned");
  });

  test("fails closed for writable, malformed, oversized, missing, and symlinked files", () => {
    const writable = fixture({ credential_pool: { openrouter: [{}] } });
    chmodSync(writable.path, 0o622);
    expect(readHermesCredentialProviderNames(writable.path).size).toBe(0);

    const malformed = fixture("not-an-object");
    expect(readHermesCredentialProviderNames(malformed.path).size).toBe(0);

    const target = fixture({ credential_pool: { openrouter: [{}] } });
    const link = join(target.root, "linked-auth.json");
    symlinkSync(target.path, link);
    expect(readHermesCredentialProviderNames(link).size).toBe(0);
    expect(readHermesCredentialProviderNames(join(target.root, "missing.json")).size).toBe(0);
  });
});
