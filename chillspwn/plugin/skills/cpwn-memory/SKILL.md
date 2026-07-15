---
name: cpwn-memory
description: Safely view, search, and add validated shared memory through the guarded ChillsPwn memory CLI.
allowed-tools: [Bash]
---

# ChillsPwn Memory Management

Shared memory lives under `${HERMES_HOME:-$HOME/.hermes}/memories`, but never read, append, edit,
or truncate those files directly. Use the guarded CLI so target identities, credentials, tokens,
literal target URLs/domains, and other non-reusable content cannot enter or leave the reusable
memory path.

In the recovered service the CLI is a client of the root-owned Unix-socket broker. The service
account cannot write the underlying files; if the broker is unavailable, the command fails closed.

Resolve the runtime once:

```bash
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
PYTHON="${HERMES_PYTHON:-python3}"
MEMORY_CLI="${CHILLSPWN_MEM_CLI:-$HERMES_HOME/skills/red-teaming/council-of-ais/scripts/chillspwn_mem.py}"
test -f "$MEMORY_CLI"
```

## Commands

- `/cpwn:memory show` — call both safe readers:

  ```bash
  "$PYTHON" "$MEMORY_CLI" safe-read --target user --format text
  "$PYTHON" "$MEMORY_CLI" safe-read --target memory --format text
  ```

- `/cpwn:memory search <query>` — search only validated output, never the raw files:

  ```bash
  { "$PYTHON" "$MEMORY_CLI" safe-read --target user --format text; \
    "$PYTHON" "$MEMORY_CLI" safe-read --target memory --format text; } | \
    grep -iF -- "<query>"
  ```

- `/cpwn:memory add <fact>` — add a genuinely cross-target fact:

  ```bash
  printf '%s' "<fact>" | \
    "$PYTHON" "$MEMORY_CLI" add --target memory --actor cpwn-memory --stdin
  ```

- `/cpwn:memory user <preference>` — add a reusable operator preference:

  ```bash
  printf '%s' "<preference>" | \
    "$PYTHON" "$MEMORY_CLI" add --target user --actor cpwn-memory --stdin
  ```

The CLI handles the section delimiter, exact-content idempotence, capacity rollover, backup, and a
content-hash-only audit record. Do not add `§` manually.

## Destructive operations

There is no direct `/cpwn:memory clear`. Clearing, replacing, restoring, or removing memory belongs
to the explicit curator workflow with backups and operator confirmation. Never use shell redirection,
`sed -i`, `Edit`, or `Write` against `USER.md`, `MEMORY.md`, `ARCHIVE.md`, or their audit files.
