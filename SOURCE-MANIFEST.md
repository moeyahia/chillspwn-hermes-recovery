# Source manifest

Snapshot created: `2026-07-11T14:39:35Z`

## Hermes Agent

- Live source: `/media/sf_hermes-agent`
- Upstream: `git@github.com:NousResearch/hermes-agent`
- Version: `0.14.0`
- Branch at capture: `main`
- Base commit: `4d2df86281551614056baba8300bea6d04d5396c`
- Current tracked working files were captured, not merely the base commit.
- Ignoring shared-folder line-ending noise, the live checkout had four modified files with 34 insertions and 4 deletions.
- The untracked custom `skills/red-teaming/cve-researcher/` skill was explicitly included.

## Chillspwn

- Live webapp source: `/root/.claude/plugins/chillspwn/webapp`
- Branch at capture: `phase-19-board-session-lifecycle`
- Base commit: `f626be547a9c06cf772159b7162b8fcc4ccade80`
- No remote was configured in the original checkout.
- Fifteen modified tracked files were captured with 554 insertions and 88 deletions, including the Grok ACP integration.
- Seven untracked engagement/tool artifacts were deliberately excluded.
- Outer plugin files, active personas, Hermes-linked skills, Android source, reporting templates, and systemd deployment files were added to make the snapshot independently recoverable.

## Snapshot model

This repository is a fresh, squashed disaster-recovery snapshot. It does not contain either source repository's original `.git` directory or history. The base commit identifiers above provide upstream provenance while the files in this repository are the authoritative captured working state.
