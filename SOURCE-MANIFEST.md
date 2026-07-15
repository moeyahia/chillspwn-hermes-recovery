# Source manifest

Initial recovery snapshot created: `2026-07-11T14:39:35Z`

ChillsPwn application source refreshed: `2026-07-15T05:02:52Z`

## Hermes Agent

- Live source: an operator-provided local/shared Hermes Agent checkout (deployment path intentionally omitted)
- Upstream: `git@github.com:NousResearch/hermes-agent`
- Version: `0.14.0`
- Branch at capture: `main`
- Base commit: `4d2df86281551614056baba8300bea6d04d5396c`
- Current tracked working files were captured, not merely the base commit.
- Ignoring shared-folder line-ending noise, the live checkout had four modified files with 34 insertions and 4 deletions.
- The untracked custom `skills/red-teaming/cve-researcher/` skill was explicitly included.

## Chillspwn

- Recovered webapp source: `/opt/chillspwn/plugin/webapp`
- Branch at capture: `phase-19-board-session-lifecycle`
- Base commit: `f626be547a9c06cf772159b7162b8fcc4ccade80`
- No remote was configured in the original checkout.
- The July 15 refresh selected 245 current source files from tracked and non-ignored working-tree content. It includes the Grok ACP commander boundary, process/session lifecycle repairs, attack-chain memory changes, current tests, application documentation, and sanitized repository-maintenance files.
- Ignored or unselected engagement data, logs, generated output, authentication stores, and tool artifacts were deliberately excluded.
- The stale npm lockfile was removed; `bun.lock` is the authoritative web dependency lock.
- Deployment-specific QR/prototype files and generated Android web assets were removed. The retained Android native project is regenerated from the sanitized `dist/` build with Capacitor.
- Outer plugin files, active personas, Hermes-linked skills, reporting templates, and systemd deployment files remain from the curated recovery snapshot unless explicitly noted.
- Recovery helpers include root-only systemd environment-file enforcement, a startup validator that rejects literal credentials in the untracked live Hermes `config.yaml` without printing values, provider-specific child environments, and a root-owned broker for validated reusable-memory access.
- The integrated deployment comprises `chillspwn-memory.service`, `chillspwn.service`, and `hermes-gateway.service`. The application units use isolated Claude, Codex, and Grok state paths; Grok is launched from the root-owned absolute `/opt/chillspwn/bin/grok` while its refreshable OAuth file remains service-owned under `/root/.hermes/auth/grok`.

## Snapshot model

This repository began as a fresh, squashed disaster-recovery snapshot and does not contain either source repository's original `.git` directory or history. Dated recovery tags preserve earlier private snapshots; later commits refresh selected components. The base commit identifiers above provide upstream provenance while the files on the current default branch are the authoritative maintained recovery state.
