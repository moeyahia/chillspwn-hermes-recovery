# Data and migrations

## Data locations

ChillsPwn intentionally stores operational state outside the repository. Principal locations include:

- `COMMAND_OS_DB_PATH=/var/lib/chillspwn/command-os-v2.sqlite` for canonical V2 mission, event, evidence, memory, lesson, and audit state;
- `CHILLSPWN_VAULT_ROOT=/var/lib/chillspwn/brain-vaults` for the synchronized Obsidian-compatible projection;
- `CHILLSPWN_STATE_DIR=/var/lib/chillspwn/state` for compatibility runtime state, logs, artifacts, reports, and UI data;
- `CHILLSPWN_PERSONAS_DIR=/opt/chillspwn/plugin/webapp/server/agents/personas` for reviewed deployed personas;
- `CHILLSPWN_SESSIONS_DIR` (default: the `sessions` child of `CHILLSPWN_STATE_DIR`) for ChillsPwn sessions;
- the `osint-jobs` child of `CHILLSPWN_STATE_DIR` for detached OSINT job snapshots and worker logs;
- `HERMES_HOME=/var/lib/chillspwn/hermes` for Hermes mutable state and configuration;
- the ordered `ALLOWED_WORKSPACE_ROOTS` for engagements, reports, and OSINT output artifacts.

Historical phase documents may mention `~/.claude/chillspwn` or
`/root/.hermes`; those are migration sources, not the maintained V2 runtime
layout.

OSINT job control state is not trusted merely because it was written previously. Rehydration revalidates the job ID and structured fields, resolves the recorded output directory beneath the current workspace allowlist, rejects symlinks and traversal, and uses bounded no-follow reads for state, stdout tails, and artifacts. Changing `ALLOWED_WORKSPACE_ROOTS` can therefore make an older job intentionally unavailable until its output is moved through an operator-reviewed migration.

These locations may contain credentials, target details, proof artifacts, raw model traffic, and personal information. They are not source code and must not be staged, archived with the repository, or used as public fixtures.

## SQLite contract

Command OS owns a versioned SQLite schema and migration directory, enables WAL,
foreign keys, and a busy timeout, and uses prepared repositories and explicit
transactions. The legacy Hermes Kanban database remains a compatibility/import
source during controlled migration; it is not canonical V2 authority.

## JSON and JSONL stores

Legacy JSON, JSONL, Markdown, artifact directories, and Kanban SQLite are imported
idempotently with source hashes and provenance. Originals remain untouched
through cutover and rollback. New mission and Second Brain state is canonical in
the V2 database; the vault is a versioned projection/import surface. There is no
root memory-broker dependency in the hardened unit graph.

## Backup

Stop or quiesce the dashboard, gateway, migration, and vault writers before an
offline restore. Use SQLite's backup mechanism rather than copying a live file:

```bash
sqlite3 /var/lib/chillspwn/command-os-v2.sqlite \
  ".backup '/secure-backup/command-os-v2.sqlite'"
```

Backups can contain sensitive engagement data. Encrypt them, restrict access, define retention, and keep them outside the Git worktree.

## Deployment migration checklist

1. Record the application commit, Bun version, and deployed unit definitions.
2. Back up the board with SQLite's online backup API and hash it; back up other external stores consistently and encrypt them.
3. Build and validate the candidate release before service interruption, including `bun run check:server-entry`.
4. Inspect startup schema changes, memory-policy changes, and provider path changes in the candidate diff.
5. Quiesce `chillspwn.service`, `hermes-gateway.service`, migration, and vault writers before migration.
6. Deploy and review both service states, health, logs, canonical database reads/writes, memory scope/forgetting, vault sync, and a non-destructive session flow.
7. Retain the prior build and state backup until validation completes.

## Rollback

Rolling back code may not roll back additive schema changes or rewritten JSON. Restore code first only when the prior version tolerates the current data shape. Otherwise stop the service and restore the matching, encrypted state backup.

## Future migration standard

A maintainable standalone distribution should introduce:

- one declared owner for the base schema;
- ordered, transactional migration files;
- a schema-version table;
- forward and compatibility tests;
- documented backup and rollback behavior for every migration;
- sanitized fixtures that contain no engagement or credential data.
