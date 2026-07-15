#!/usr/bin/env bun
import { existsSync, lstatSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import {
  createDatabaseConnection,
  createTimestampedBackup,
} from "../db";
import { MemoryRepository } from "../memory";
import { redactLegacyText } from "../migration/SecretSafety";
import { ObsidianVaultBridge } from "./ObsidianVaultBridge";
import { VaultPathPolicy } from "./VaultPathPolicy";

interface Args {
  readonly command: string;
  readonly values: Map<string, string>;
  readonly flags: Set<string>;
}

function argumentsFor(argv: readonly string[]): Args {
  const [command = "help", ...rest] = argv;
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]!;
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) flags.add(key);
    else { values.set(key, next); index += 1; }
  }
  return { command, values, flags };
}

function required(args: Args, key: string): string {
  const value = args.values.get(key);
  if (!value?.trim()) throw new Error(`--${key} is required`);
  return value;
}

function vaultRoot(args: Args): string {
  const configured = args.values.get("vault-root") ?? process.env.CHILLSPWN_VAULT_ROOT;
  if (!configured) throw new Error("--vault-root or CHILLSPWN_VAULT_ROOT is required");
  return resolve(configured);
}

function connectionId(database: ReturnType<typeof createDatabaseConnection>, requested?: string): string {
  if (requested) return requested;
  const rows = database.prepare("SELECT id FROM vault_connections ORDER BY updated_at DESC LIMIT 2").all() as Array<{ id: string }>;
  if (rows.length !== 1) throw new Error("--connection is required unless exactly one vault is connected");
  return rows[0]!.id;
}

function markdownFiles(policy: VaultPathPolicy, root: string): string[] {
  const results: string[] = [];
  const visit = (folder: string): void => {
    const absolute = folder ? policy.resolveRelative(root, folder) : root;
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error("Symbolic links are not permitted in managed vaults");
      const relativePath = folder ? `${folder}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if ([".obsidian", ".chillspwn", "Attachments"].includes(entry.name)) continue;
        visit(relativePath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) results.push(relativePath);
    }
  };
  visit("");
  return results.sort();
}

function usage(): string {
  return `ChillsPwn Obsidian bridge CLI

Usage:
  bun run server/vault/cli.ts import --db PATH --vault-root ROOT [--connection ID] [--path NOTE] [--actor ID]
  bun run server/vault/cli.ts export --db PATH --vault-root ROOT [--connection ID] [--zip] [--actor ID]
  bun run server/vault/cli.ts sync-verify --db PATH --vault-root ROOT [--connection ID]

SQLite remains canonical. Import creates a verified DB backup first, inbox notes
remain candidates, conflicts are never overwritten, and .obsidian is ignored.
`;
}

export async function runVaultCli(argv = process.argv.slice(2)): Promise<number> {
  const args = argumentsFor(argv);
  if (args.command === "help" || args.flags.has("help")) { process.stdout.write(usage()); return 0; }
  const databasePath = resolve(required(args, "db"));
  if (!existsSync(databasePath)) throw new Error("Canonical database does not exist; run db:migrate first");
  const database = createDatabaseConnection({ filename: databasePath, fileMustExist: true });
  try {
    const policy = new VaultPathPolicy(vaultRoot(args));
    const bridge = new ObsidianVaultBridge(database, new MemoryRepository(database), policy);
    const id = connectionId(database, args.values.get("connection"));
    const actor = args.values.get("actor")?.trim() || "operator:cli";
    const connection = bridge.requireConnection(id);
    if (relative(policy.allowedRoot, connection.vaultPath).startsWith("..")) throw new Error("Connected vault is outside --vault-root");

    if (args.command === "import") {
      bridge.assertVaultSyncAllowed();
      const backup = await createTimestampedBackup(database, args.values.get("backup-dir") ? resolve(args.values.get("backup-dir")!) : resolve(dirname(databasePath), "backups"), "before-obsidian-import");
      const paths = args.values.get("path") ? [required(args, "path")] : markdownFiles(policy, connection.vaultPath);
      const results = paths.map((path) => bridge.syncChangedPath(id, path, actor));
      process.stdout.write(`${JSON.stringify({ backup, processed: paths.length, results }, null, 2)}\n`);
      return 0;
    }
    if (args.command === "export") {
      bridge.assertVaultSyncAllowed();
      const lifecycleStatuses = bridge.projectionLifecycleStatuses();
      const placeholders = lifecycleStatuses.map(() => "?").join(",");
      const rows = database.prepare(`
        SELECT id FROM memory_nodes WHERE lifecycle_status IN (${placeholders}) ORDER BY updated_at DESC
      `).all(...lifecycleStatuses) as Array<{ id: string }>;
      const results = rows.map((row) => bridge.exportNode(id, row.id));
      const portable = args.flags.has("zip") ? await bridge.createPortableExport(id, rows.map((row) => row.id), actor) : undefined;
      process.stdout.write(`${JSON.stringify({ exported: results.length, conflicts: results.filter((item) => item.status === "conflict").length, ...(portable ? { portable: { ...portable, archivePath: relative(policy.allowedRoot, portable.archivePath) } } : {}) }, null, 2)}\n`);
      return results.some((item) => item.status === "conflict") ? 2 : 0;
    }
    if (args.command === "sync-verify") {
      const result = bridge.verifyConnection(id);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return result.healthy ? 0 : 2;
    }
    throw new Error(`Unknown vault command: ${args.command}`);
  } finally {
    database.close();
  }
}

if (import.meta.main) {
  runVaultCli().then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`Obsidian bridge failed: ${redactLegacyText(error instanceof Error ? error.message : String(error), 1_000)}\n`);
    process.exitCode = 1;
  });
}
