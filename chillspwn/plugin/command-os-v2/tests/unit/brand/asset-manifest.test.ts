import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface BrandManifest {
  readonly schemaVersion: string;
  readonly provenance: {
    readonly generator: string;
  };
  readonly assets: ReadonlyArray<{
    readonly id: string;
    readonly kind: string;
    readonly selected?: boolean;
    readonly sourcePrompt: string;
    readonly tool: string;
    readonly source: { readonly path: string; readonly width: number; readonly height: number; readonly bytes: number };
  }>;
}

const manifestPath = resolve(import.meta.dirname, "../../../public/brand-v2/manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as BrandManifest;

describe("Higgsfield brand asset provenance", () => {
  test("records the authenticated Higgsfield provenance and generated sources", () => {
    expect(manifest.schemaVersion).toBe("1.0");
    expect(manifest.provenance.generator).toBe("Higgsfield MCP");
    expect(manifest.assets.length).toBeGreaterThan(3);
    for (const asset of manifest.assets) {
      expect(asset.source.path.startsWith("source/")).toBe(true);
      expect(asset.source.width).toBeGreaterThan(0);
      expect(asset.source.height).toBeGreaterThan(0);
      expect(asset.source.bytes).toBeGreaterThan(0);
      expect(asset.tool).toContain("Higgsfield MCP");
    }
  });

  test("keeps the required three low-cost direction prompts text- and logo-free", () => {
    const directions = manifest.assets.filter(({ kind }) => kind === "research-moodboard");
    expect(directions.map(({ id }) => id)).toEqual([
      "moodboard-graphite-command-intelligence",
      "moodboard-precision-operations",
      "moodboard-calm-autonomous-systems",
    ]);
    expect(directions.filter(({ selected }) => selected)).toHaveLength(1);
    for (const direction of directions) {
      expect(direction.source.width / direction.source.height).toBeCloseTo(16 / 9, 2);
      expect(direction.sourcePrompt).toContain("text-free");
      expect(direction.sourcePrompt).toContain("logo-free");
      expect(direction.sourcePrompt.toLocaleLowerCase("en-US")).not.toContain("watermark");
    }
  });
});
