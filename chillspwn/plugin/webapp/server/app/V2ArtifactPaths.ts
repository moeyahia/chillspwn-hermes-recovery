import { basename, dirname, extname, isAbsolute, join, resolve, sep } from "node:path";

const LEGACY_SEGMENTS = new Set([".hermes", "legacy", "webapp"]);
const LEGACY_DATABASE_NAMES = new Set(["kanban.sqlite", "missions.sqlite", "sessions.sqlite"]);
const V2_NAMESPACE = /(?:^|[-_.])command[-_]?os[-_]?v2(?:$|[-_.])/u;

function normalizedSegments(path: string): readonly string[] {
  return path.toLocaleLowerCase("en-US").split(sep).filter(Boolean);
}

function assertNotLegacyPath(path: string, label: string): void {
  const segments = normalizedSegments(path);
  const file = basename(path).toLocaleLowerCase("en-US");
  if (segments.some((segment) => LEGACY_SEGMENTS.has(segment)) || LEGACY_DATABASE_NAMES.has(file)) {
    throw new Error(`${label} must not reference a legacy application or data namespace`);
  }
}

/**
 * Resolves the immutable source store beneath a visibly V2-owned namespace.
 * A configured override must be absolute and carry the same namespace marker,
 * preventing a typo from placing new source beside legacy files.
 */
export function resolveV2ScriptSourceRoot(
  databasePath: string,
  configuredRoot?: string,
): string {
  if (!isAbsolute(databasePath)) {
    throw new Error("Command OS V2 database path must be absolute before deriving artifact storage");
  }
  const canonicalDatabasePath = resolve(databasePath);
  assertNotLegacyPath(canonicalDatabasePath, "Command OS V2 database path");

  const configured = configuredRoot?.trim();
  if (configured && !isAbsolute(configured)) {
    throw new Error("COMMAND_OS_V2_SCRIPT_SOURCE_ROOT must be an absolute path");
  }
  const databaseStem = basename(
    canonicalDatabasePath,
    extname(canonicalDatabasePath),
  ).replace(/[^A-Za-z0-9._-]/gu, "-") || "canonical";
  const result = resolve(
    configured || join(
      dirname(canonicalDatabasePath),
      "command-os-v2-artifacts",
      databaseStem,
      "script-sources",
    ),
  );
  assertNotLegacyPath(result, "COMMAND_OS_V2_SCRIPT_SOURCE_ROOT");
  if (!normalizedSegments(result).some((segment) => V2_NAMESPACE.test(segment))) {
    throw new Error(
      "COMMAND_OS_V2_SCRIPT_SOURCE_ROOT must include a command-os-v2 namespace segment",
    );
  }
  if (result === canonicalDatabasePath) {
    throw new Error("Script source storage cannot overwrite the Command OS V2 database");
  }
  return result;
}
