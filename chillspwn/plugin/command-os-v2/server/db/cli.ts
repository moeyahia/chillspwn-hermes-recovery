#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createDatabaseConnection } from "./connection";
import { createTimestampedBackup } from "./backup";
import { getDatabaseHealth } from "./health";
import { migrateDatabase } from "./migrations/runner";

function value(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
}

export async function runDatabaseCli(argv = process.argv.slice(2)): Promise<number> {
  const [command = "help"] = argv;
  if (command === "help" || argv.includes("--help")) {
    process.stdout.write("Usage: bun run server/db/cli.ts migrate --db PATH [--backup-dir DIR]\n");
    return 0;
  }
  if (command !== "migrate") throw new Error(`Unknown database command: ${command}`);
  const configured = value(argv, "db") ?? process.env.COMMAND_OS_DB_PATH;
  if (!configured) throw new Error("--db or COMMAND_OS_DB_PATH is required");
  const path = resolve(configured);
  const existed = existsSync(path);
  const database = createDatabaseConnection({ filename: path });
  try {
    const backup = existed
      ? await createTimestampedBackup(database, resolve(value(argv, "backup-dir") ?? `${dirname(path)}/backups`), "before-schema-migration")
      : undefined;
    const applied = migrateDatabase(database);
    const health = getDatabaseHealth(database);
    process.stdout.write(`${JSON.stringify({ applied, backup, health }, null, 2)}\n`);
    return health.healthy ? 0 : 2;
  } finally { database.close(); }
}

if (import.meta.main) {
  runDatabaseCli().then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`Database migration failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
    process.exitCode = 1;
  });
}
