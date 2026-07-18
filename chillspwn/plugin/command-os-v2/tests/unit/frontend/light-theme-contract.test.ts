import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const tokenCss = readFileSync(new URL("../../../src/design-system/tokens/command-os.css", import.meta.url), "utf8");
const featureCss = readFileSync(new URL("../../../src/design-system/tokens/feature-surfaces.css", import.meta.url), "utf8");
const graphCanvas = readFileSync(new URL("../../../src/features/brain/MemoryGraphCanvas.tsx", import.meta.url), "utf8");
const indexHtml = readFileSync(new URL("../../../index.html", import.meta.url), "utf8");
const webManifest = JSON.parse(readFileSync(new URL("../../../public/manifest.webmanifest", import.meta.url), "utf8")) as {
  background_color?: string;
  theme_color?: string;
};
const mirroredTokenCss = readFileSync(new URL("../../../../webapp/src/design-system/tokens/command-os.css", import.meta.url), "utf8");
const mirroredFeatureCss = readFileSync(new URL("../../../../webapp/src/design-system/tokens/feature-surfaces.css", import.meta.url), "utf8");
const mirroredGraphCanvas = readFileSync(new URL("../../../../webapp/src/features/brain/MemoryGraphCanvas.tsx", import.meta.url), "utf8");
const mirroredMain = readFileSync(new URL("../../../../webapp/src/main.tsx", import.meta.url), "utf8");
const mirroredIndexHtml = readFileSync(new URL("../../../../webapp/index.html", import.meta.url), "utf8");
const mirroredBootCss = readFileSync(new URL("../../../../webapp/public/boot.css", import.meta.url), "utf8");
const mirroredWebManifest = JSON.parse(readFileSync(new URL("../../../../webapp/public/manifest.webmanifest", import.meta.url), "utf8")) as {
  background_color?: string;
  theme_color?: string;
};
const playwrightConfig = readFileSync(new URL("../../../playwright.config.ts", import.meta.url), "utf8");

function token(name: string): string {
  const match = tokenCss.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`, "u"));
  if (!match?.[1]) throw new Error(`Theme token --${name} is missing or is not a six-digit color`);
  return match[1];
}

function luminance(hex: string): number {
  const channels = hex.slice(1).match(/../gu)?.map((pair) => Number.parseInt(pair, 16) / 255);
  if (!channels || channels.length !== 3) throw new Error(`Cannot calculate luminance for ${hex}`);
  const [red, green, blue] = channels.map((channel) => (
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return (0.2126 * red!) + (0.7152 * green!) + (0.0722 * blue!);
}

function contrast(first: string, second: string): number {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((left, right) => right - left);
  return (lighter! + 0.05) / (darker! + 0.05);
}

describe("Command OS light technology theme contract", () => {
  test("publishes light browser metadata and removes the former dark-only surfaces", () => {
    expect(indexHtml).toContain('<meta name="theme-color" content="#ffffff" />');
    expect(indexHtml).toContain('<meta name="color-scheme" content="light" />');
    expect(webManifest).toMatchObject({ background_color: "#edf2f1", theme_color: "#ffffff" });
    expect(tokenCss).toContain("color-scheme: light");
    expect(playwrightConfig).toContain('colorScheme: "light"');

    const productionThemeSources = [tokenCss, featureCss, graphCanvas].join("\n").toLowerCase();
    for (const formerDarkSurface of ["#080b0d", "#090d0f", "#0a0e14", "rgba(8,11,13", "rgba(13,17,20"]) {
      expect(productionThemeSources).not.toContain(formerDarkSurface);
    }
  });

  test("keeps the production V2 mirror light and independent from legacy global CSS", () => {
    expect(mirroredTokenCss).toBe(tokenCss);
    expect(mirroredGraphCanvas).toBe(graphCanvas);
    expect(mirroredMain).not.toContain('import "./index.css"');
    expect(mirroredIndexHtml).not.toContain('class="dark"');
    expect(mirroredIndexHtml).not.toContain("bg-slate-950");
    expect(mirroredIndexHtml).toContain('<meta name="color-scheme" content="light" />');
    expect(mirroredWebManifest).toMatchObject({ background_color: "#edf2f1", theme_color: "#ffffff" });
    expect(mirroredBootCss).toContain("#edf2f1");
    expect(mirroredBootCss).not.toContain("#080b0d");

    const mirroredProductionSources = [mirroredTokenCss, mirroredFeatureCss, mirroredGraphCanvas].join("\n").toLowerCase();
    for (const formerDarkSurface of ["#080b0d", "#090d0f", "#0a0e14", "rgba(8,11,13", "rgba(13,17,20"]) {
      expect(mirroredProductionSources).not.toContain(formerDarkSurface);
    }
  });

  test("keeps all compact text and semantic colors AA-readable on operational surfaces", () => {
    const surface = token("os-surface-1");
    const canvas = token("os-canvas");
    for (const foreground of [
      "os-text",
      "os-text-secondary",
      "os-text-muted",
      "os-accent",
      "os-info",
      "os-success",
      "os-warning",
      "os-danger",
      "os-violet",
    ]) {
      expect(contrast(token(foreground), surface), `${foreground} on surface`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token(foreground), canvas), `${foreground} on canvas`).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(token("os-on-accent"), token("os-accent")), "primary action label").toBeGreaterThanOrEqual(4.5);
    expect(contrast(token("os-focus"), surface), "focus indicator").toBeGreaterThanOrEqual(3);
  });

  test("keeps technology cues token-driven and motion optional", () => {
    expect(tokenCss).toContain("--os-accent-bright: #b8f341;");
    expect(tokenCss).toContain("--os-graph-grid:");
    expect(tokenCss).toContain("background-size: 32px 32px, 32px 32px");
    expect(graphCanvas).toContain('color("--os-graph-canvas"');
    expect(graphCanvas).toContain('mission: "--os-graph-node-mission"');
    expect(tokenCss).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
