#!/usr/bin/env bun
import { resolve } from "node:path";
import {
  checkDatabaseIntegrity,
  createDatabaseConnection,
  createTimestampedBackup,
} from "../db";
import { LegacyMigrationService, restoreMigrationBackup } from "./LegacyMigrationService";
import { redactLegacyText } from "./SecretSafety";

interface ParsedArguments {
  readonly command: string;
  readonly values: Map<string, string[]>;
  readonly flags: Set<string>;
}

function parseArguments(argv: readonly string[]): ParsedArguments {
  const [command = "help", ...rest] = argv;
  const values = new Map<string, string[]>();
  const flags = new Set<string>();
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]!;
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) {
      flags.add(key);
      continue;
    }
    values.set(key, [...(values.get(key) ?? []), next]);
    index += 1;
  }
  return { command, values, flags };
}

function required(args: ParsedArguments, key: string): string {
  const value = args.values.get(key)?.at(-1);
  if (!value) throw new Error(`--${key} is required`);
  return resolve(value);
}

function help(): string {
  return `ChillsPwn Command OS legacy migration

Usage:
  bun run server/migration/cli.ts migrate --db PATH --source PATH [--source PATH] --output DIR [--dry-run] [--resume ID]
  bun run server/migration/cli.ts verify --db PATH
  bun run server/migration/cli.ts backup --db PATH --output DIR
  bun run server/migration/cli.ts reconcile --db PATH --migration-id ID
  bun run server/migration/cli.ts restore --db PATH --backup PATH --sha256 HASH --service-stopped

Safety:
  migrate creates a verified database backup and protected source backup before import.
  --dry-run performs discovery/hashing only and never changes the database.
  restore refuses to run without --service-stopped.
`;
}

async function main(argv = process.argv.slice(2)): Promise<number> {
  const args = parseArguments(argv);
  if (args.command === "help" || args.flags.has("help")) {
    process.stdout.write(help());
    return 0;
  }
  if (args.command === "migrate") {
    const roots = args.values.get("source") ?? [];
    if (!roots.length) throw new Error("At least one --source path is required");
    const result = await new LegacyMigrationService({
      databasePath: required(args, "db"),
      sourceRoots: roots.map((root) => resolve(root)),
      outputDirectory: required(args, "output"),
      dryRun: args.flags.has("dry-run"),
      ...(args.values.get("resume")?.at(-1) ? { resumeMigrationId: args.values.get("resume")!.at(-1)! } : {}),
    }).run();
    process.stdout.write(`${JSON.stringify({ migrationId: result.migrationId, reportPath: result.reportPath, counts: result.report.counts }, null, 2)}\n`);
    return 0;
  }
  if (args.command === "verify") {
    const database = createDatabaseConnection({ filename: required(args, "db"), readonly: true, fileMustExist: true });
    try {
      const integrity = checkDatabaseIntegrity(database);
      const foreignKeys = database.pragma("foreign_key_check") as unknown[];
      process.stdout.write(`${JSON.stringify({ integrity, foreignKeyViolations: foreignKeys.length }, null, 2)}\n`);
      return integrity.ok && foreignKeys.length === 0 ? 0 : 2;
    } finally { database.close(); }
  }
  if (args.command === "backup") {
    const database = createDatabaseConnection({ filename: required(args, "db"), readonly: true, fileMustExist: true });
    try {
      const result = await createTimestampedBackup(database, required(args, "output"), "command-os-manual");
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return 0;
    } finally { database.close(); }
  }
  if (args.command === "reconcile") {
    const database = createDatabaseConnection({ filename: required(args, "db"), readonly: true, fileMustExist: true });
    try {
      const migrationId = args.values.get("migration-id")?.at(-1);
      if (!migrationId) throw new Error("--migration-id is required");
      const row = database.prepare(`
        SELECT report_json, report_hash FROM legacy_migration_reconciliation WHERE migration_id = ?
      `).get(migrationId) as { report_json: string; report_hash: string } | undefined;
      if (!row) throw new Error(`No reconciliation report exists for ${migrationId}`);
      process.stdout.write(`${JSON.stringify({ reportHash: row.report_hash, report: JSON.parse(row.report_json) }, null, 2)}\n`);
      return 0;
    } finally { database.close(); }
  }
  if (args.command === "restore") {
    const sha256 = args.values.get("sha256")?.at(-1);
    if (!sha256 || !/^[a-f0-9]{64}$/iu.test(sha256)) throw new Error("--sha256 must be a 64-character SHA-256");
    await restoreMigrationBackup({
      databasePath: required(args, "db"),
      backupPath: required(args, "backup"),
      expectedSha256: sha256.toLowerCase(),
      serviceStopped: args.flags.has("service-stopped"),
    });
    process.stdout.write("Database restored and checksum verified.\n");
    return 0;
  }
  throw new Error(`Unknown command: ${args.command}`);
}

if (import.meta.main) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`Migration failed: ${redactLegacyText(error instanceof Error ? error.message : String(error), 1_000)}\n`);
    process.exitCode = 1;
  });
}

export { main as runMigrationCli };
