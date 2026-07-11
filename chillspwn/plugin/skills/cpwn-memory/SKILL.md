---
name: cpwn-memory
description: View, search, and manage shared memory (USER.md + MEMORY.md). Shared with Hermes agent.
allowed-tools: [Bash, Read, Edit, Write]
---

# ChillsPwn Memory Management

Memory files are at `~/.hermes/memories/` (shared with Hermes via symlink).

## Commands:
- `/cpwn:memory show` — Display both USER.md and MEMORY.md
- `/cpwn:memory search <query>` — Search across all memory files
- `/cpwn:memory add <fact>` — Append a new fact to MEMORY.md (use § separator)
- `/cpwn:memory user <preference>` — Append a new preference to USER.md
- `/cpwn:memory clear` — Clear MEMORY.md (requires confirmation)

## Format
Facts are separated by `§` (section sign). Each fact is a paragraph. When appending, add `§\n` before the new fact.

## Important
These files are SHARED with Hermes. Changes here affect Hermes too, and vice versa.
