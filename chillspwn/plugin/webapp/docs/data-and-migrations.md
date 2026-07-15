# Data and migrations

## Data locations

ChillsPwn intentionally stores operational state outside the repository. Principal locations include:

- `${HERMES_HOME:-$HOME/.hermes}/kanban.db` for the Mission Board;
- `CHILLSPWN_STATE_DIR` (default: the `chillspwn` child of `HERMES_HOME`) for runtime state, logs, artifacts, reports, and UI data;
- `CHILLSPWN_PERSONAS_DIR` (default: the `personas` child of `CHILLSPWN_STATE_DIR`) for deployed personas;
- `CHILLSPWN_SESSIONS_DIR` (default: the `sessions` child of `CHILLSPWN_STATE_DIR`) for ChillsPwn sessions;
- the `osint-jobs` child of `CHILLSPWN_STATE_DIR` for detached OSINT job snapshots and worker logs;
- `${HERMES_HOME:-$HOME/.hermes}` for Hermes configuration, conversations, protected reusable memory, scripts, and provider state;
- the ordered `ALLOWED_WORKSPACE_ROOTS` for engagements, reports, and OSINT output artifacts.

The integrated recovery services set `HERMES_HOME=/root/.hermes` and the ChillsPwn paths under `/root/.hermes/chillspwn`. Historical phase documents may mention `~/.claude/chillspwn`; that is not the maintained recovery layout.

OSINT job control state is not trusted merely because it was written previously. Rehydration revalidates the job ID and structured fields, resolves the recorded output directory beneath the current workspace allowlist, rejects symlinks and traversal, and uses bounded no-follow reads for state, stdout tails, and artifacts. Changing `ALLOWED_WORKSPACE_ROOTS` can therefore make an older job intentionally unavailable until its output is moved through an operator-reviewed migration.

These locations may contain credentials, target details, proof artifacts, raw model traffic, and personal information. They are not source code and must not be staged, archived with the repository, or used as public fixtures.

## SQLite contract

The dashboard expects an existing Hermes database with base tables such as `tasks`, `task_events`, and `task_runs`. Application startup creates `board_columns` and performs limited additive alterations, but it does not bootstrap the complete base schema.

Consequences:

- a blank database is not a supported full setup;
- schema ownership currently spans projects;
- there is no version table or transactional migration directory;
- deployment must verify schema compatibility before restarting.

## JSON and JSONL stores

Runtime modules persist run events, memory proposals, attack lessons, evidence references, artifacts, and related state in external JSON/JSONL stores. Readers may tolerate older shapes, but those implicit upgrades are not a substitute for a versioned migration process.

Reusable flat memory is not an ordinary service-owned JSON/Markdown store in the recovered deployment. `/root/.hermes/memories` is root-only; the dashboard and gateway use `chillspwn-memory.service` for policy-filtered reads and validated additive writes. Operational backups must preserve that ownership boundary, and operator curation must use the root-only CLI path rather than changing permissions for the service account.

## Backup

Stop or quiesce the memory broker, dashboard, and gateway before backing up state. For SQLite, use SQLite's backup mechanism rather than copying a live database file:

```bash
sqlite3 "$HOME/.hermes/kanban.db" ".backup '/secure-backup/kanban.db'"
```

Backups can contain sensitive engagement data. Encrypt them, restrict access, define retention, and keep them outside the Git worktree.

## Deployment migration checklist

1. Record the application commit, Bun version, and deployed unit definitions.
2. Back up the board with SQLite's online backup API and hash it; back up other external stores consistently and encrypt them.
3. Build and validate the candidate release before service interruption, including `bun run check:server-entry`.
4. Inspect startup schema changes, memory-policy changes, and provider path changes in the candidate diff.
5. Quiesce `chillspwn-memory.service`, `chillspwn.service`, and `hermes-gateway.service` before migration.
6. Deploy and review all three service states, health, logs, board reads/writes, broker-mediated memory reads, and a non-destructive session flow.
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
