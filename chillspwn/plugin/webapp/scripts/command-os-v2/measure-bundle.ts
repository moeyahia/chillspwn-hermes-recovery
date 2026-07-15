import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";

interface AssetMeasurement {
  readonly path: string;
  readonly bytes: number;
  readonly gzipBytes: number;
}

const projectRoot = resolve(import.meta.dir, "../..");
const distRoot = resolve(projectRoot, process.env.COMMAND_OS_DIST_DIR?.trim() || "dist");
const initialJavaScriptBudget = Number(process.env.COMMAND_OS_INITIAL_JS_GZIP_BUDGET || 250 * 1024);
const routeChunkBudget = Number(process.env.COMMAND_OS_ROUTE_CHUNK_GZIP_BUDGET || 150 * 1024);

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function measure(path: string): AssetMeasurement {
  const body = readFileSync(path);
  return {
    path: relative(distRoot, path).replaceAll("\\", "/"),
    bytes: body.byteLength,
    gzipBytes: gzipSync(body, { level: 9 }).byteLength,
  };
}

function assetReferences(html: string, selector: "script" | "modulepreload" | "stylesheet"): string[] {
  const pattern = selector === "script"
    ? /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/giu
    : new RegExp(`<link\\b(?=[^>]*\\brel=["']${selector}["'])[^>]*\\bhref=["']([^"']+)["'][^>]*>`, "giu");
  return [...html.matchAll(pattern)].map((match) => match[1]!).filter((source) => source.startsWith("/"));
}

if (!existsSync(join(distRoot, "index.html"))) {
  throw new Error(`Production build is missing at ${distRoot}. Run \"bun run build\" first.`);
}
if (!Number.isFinite(initialJavaScriptBudget) || initialJavaScriptBudget <= 0 ||
    !Number.isFinite(routeChunkBudget) || routeChunkBudget <= 0) {
  throw new Error("Bundle budgets must be positive byte counts");
}

const html = readFileSync(join(distRoot, "index.html"), "utf8");
const files = walk(distRoot);
const javascript = files.filter((path) => path.endsWith(".js")).map(measure)
  .sort((left, right) => right.gzipBytes - left.gzipBytes);
const css = files.filter((path) => path.endsWith(".css")).map(measure)
  .sort((left, right) => right.gzipBytes - left.gzipBytes);
const initialPaths = new Set([
  ...assetReferences(html, "script"),
  ...assetReferences(html, "modulepreload"),
].map((path) => path.replace(/^\//u, "")));
const initialJavaScript = javascript.filter((asset) => initialPaths.has(asset.path));
const routeChunks = javascript.filter((asset) => !initialPaths.has(asset.path));
const initialJavaScriptGzipBytes = initialJavaScript.reduce((total, asset) => total + asset.gzipBytes, 0);
const largestRouteChunkGzipBytes = routeChunks[0]?.gzipBytes ?? 0;
const failures = [
  ...(initialJavaScriptGzipBytes > initialJavaScriptBudget
    ? [`Initial JavaScript is ${initialJavaScriptGzipBytes} gzip bytes; budget is ${initialJavaScriptBudget}`]
    : []),
  ...(largestRouteChunkGzipBytes > routeChunkBudget
    ? [`Largest deferred chunk is ${largestRouteChunkGzipBytes} gzip bytes; budget is ${routeChunkBudget}`]
    : []),
];

const result = {
  schemaVersion: 1,
  measuredAt: new Date().toISOString(),
  environment: {
    runtime: `Bun ${Bun.version}`,
    platform: `${process.platform}/${process.arch}`,
    productionBuild: relative(projectRoot, distRoot) || ".",
    compression: "node:zlib gzip level 9",
  },
  budgets: {
    initialJavaScriptGzipBytes: initialJavaScriptBudget,
    deferredChunkGzipBytes: routeChunkBudget,
  },
  totals: {
    initialJavaScriptGzipBytes,
    initialJavaScriptBytes: initialJavaScript.reduce((total, asset) => total + asset.bytes, 0),
    largestDeferredChunkGzipBytes: largestRouteChunkGzipBytes,
    allJavaScriptGzipBytes: javascript.reduce((total, asset) => total + asset.gzipBytes, 0),
    allCssGzipBytes: css.reduce((total, asset) => total + asset.gzipBytes, 0),
    javascriptChunkCount: javascript.length,
    deferredChunkCount: routeChunks.length,
  },
  initialJavaScript,
  largestDeferredChunks: routeChunks.slice(0, 15),
  css,
  passed: failures.length === 0,
  failures,
};

const outputPath = process.env.COMMAND_OS_METRICS_OUT?.trim();
if (outputPath) {
  const absolute = resolve(projectRoot, outputPath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (failures.length > 0) process.exitCode = 1;
