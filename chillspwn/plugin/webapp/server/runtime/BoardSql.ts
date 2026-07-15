import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from "child_process";

export function quoteBoardSqlText(value: unknown): string {
  return String(value == null ? "" : value).replace(/\0/g, "").replace(/'/g, "''");
}

type ExecFile = (
  file: string,
  args: readonly string[],
  options: ExecFileSyncOptionsWithStringEncoding,
) => string | Buffer;

/** Execute SQLite with a literal argv vector; no request text ever reaches a shell parser. */
export function executeBoardSqlWrite(
  database: string,
  sql: string,
  executor: ExecFile = execFileSync as ExecFile,
): void {
  executor("sqlite3", ["-cmd", ".timeout 5000", database, sql], {
    encoding: "utf-8",
    timeout: 6000,
  });
}
