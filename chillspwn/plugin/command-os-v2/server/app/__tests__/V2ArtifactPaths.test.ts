import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { resolveV2ScriptSourceRoot } from "../V2ArtifactPaths";

describe("V2 artifact path isolation", () => {
  test("derives a stable V2-only absolute source namespace from the canonical database", () => {
    expect(resolveV2ScriptSourceRoot("/var/lib/chillspwn-v2/command-os-v2.sqlite")).toBe(
      "/var/lib/chillspwn-v2/command-os-v2-artifacts/command-os-v2/script-sources",
    );
  });

  test("accepts an explicit absolute V2 namespace and rejects relative or legacy roots", () => {
    const database = resolve("/srv/chillspwn/command-os-v2/data.sqlite");
    expect(resolveV2ScriptSourceRoot(
      database,
      "/srv/chillspwn/command-os-v2-artifacts/script-sources",
    )).toBe("/srv/chillspwn/command-os-v2-artifacts/script-sources");
    expect(() => resolveV2ScriptSourceRoot(database, "relative/script-sources"))
      .toThrow("must be an absolute path");
    expect(() => resolveV2ScriptSourceRoot(
      database,
      "/srv/chillspwn/plugin/webapp/artifacts/command-os-v2",
    )).toThrow("must not reference a legacy application");
    expect(() => resolveV2ScriptSourceRoot(database, "/srv/chillspwn/new-script-store"))
      .toThrow("must include a command-os-v2 namespace segment");
  });
});
