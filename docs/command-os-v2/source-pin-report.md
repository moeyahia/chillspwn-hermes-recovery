# Command OS V2.4 source pin

Status: **verified**
Report verified at: `2026-07-16T08:46:54Z`
Authority: latest committed GitHub default branch, not a recovery archive or local deployment tree.

## Authoritative repository

| Field | Verified value |
|---|---|
| Repository | `git@github.com:moeyahia/chillspwn-hermes-recovery.git` |
| GitHub repository | `https://github.com/moeyahia/chillspwn-hermes-recovery` |
| Default branch | `main` |
| Pinned HEAD | `343f6ac5a05f7286a0d66aee8c5dbd6e78a41aee` |
| Commit timestamp | `2026-07-14T20:49:58-04:00` |
| Commit subject | `Merge pull request #1 from moeyahia/agent/refresh-chillspwn-repository` |
| Implementation branch | `feat/command-os-v2-4-parallel` |
| Implementation worktree | `/root/chillspwn-command-os-v24` |
| Tracked status at pin | Clean |

The source was fetched through authenticated SSH access. The default-branch
HEAD above was checked independently with Git and treated as the only code
authority for this program.

## Recovery provenance

`SOURCE-MANIFEST.md` records that this repository began as a curated,
squashed disaster-recovery snapshot. It does not contain the original source
repositories' complete history.

- Snapshot creation: `2026-07-11T14:39:35Z`.
- ChillsPwn source refresh: `2026-07-15T05:02:52Z`.
- Hermes upstream: `git@github.com:NousResearch/hermes-agent`, version `0.14.0`,
  base `4d2df86281551614056baba8300bea6d04d5396c`.
- Recovered ChillsPwn webapp base:
  `f626be547a9c06cf772159b7162b8fcc4ccade80` on
  `phase-19-board-session-lifecycle`.
- The refresh retained selected current source and deliberately excluded
  unselected engagement data, logs, generated output, authentication stores,
  and tool artifacts.
- `bun.lock` is the authoritative legacy web lockfile.

These values establish provenance; they do not override the pinned GitHub
HEAD.

The accelerated live-integration candidate was subsequently assembled on
branch `deploy/command-os-v24-live` in `/root/chillspwn-v24-hybrid`. The pinned
default-branch commit above remains the audited source baseline; the exact live
candidate commit is recorded by the immutable release directory and deployment
receipt at cutover.

## Application paths and V2 disposition

- Protected legacy application: `chillspwn/plugin/webapp`.
- Legacy server: `chillspwn/plugin/webapp/server/index.ts` and additive modules
  beneath the same server tree.
- Legacy browser entry: `chillspwn/plugin/webapp/src/main.tsx` and
  `chillspwn/plugin/webapp/src/App.tsx`.
- Canonical logo at pin: `chillspwn/plugin/webapp/public/Logo.svg`.
- Logo SHA-256:
  `0a3dfd69f74a00d41bb0cb20d6af1097dffa265d4c1e54c9228fe4b55f85c955`.
- Parallel Command OS at pinned `main`: **not present**.
- `/api/v2` surface at pinned `main`: **not present**.
- Selected greenfield location:
  `chillspwn/plugin/command-os-v2`.

The selected V2 location is a sibling application. It does not import the
legacy App, pages, window manager, browser stores, or global CSS.

## Baseline result references

The exact architecture, route, storage, test, build, bundle, and browser
measurements recorded against this pin are in:

- `current-state-audit.md`
- `legacy-compatibility-contract.md`
- `legacy-interaction-inventory.md`
- `baseline-performance.md`

No default-route switch or production cutover is authorized by this pin.

## Autoresearch concept-source pin

The Research Lab design also treats the external concept source as pinned
provenance rather than as vendored or executable product code.

| Field | Verified value |
|---|---|
| Repository | `https://github.com/karpathy/autoresearch` |
| Default branch | `master` |
| Reviewed HEAD | `228791fb499afffb54b46200aca536f79142f117` |
| Commit timestamp | `2026-03-25T17:07:37-07:00` |
| Commit subject | `Merge pull request #342 from kaizen-38/feat/bug-fix` |
| Verification date | `2026-07-16` |

The remote symbolic HEAD and object ID were verified with `git ls-remote`,
then the exact object was fetched shallowly and inspected locally. The result
matches the prompt's prior analysis baseline. No source from that repository
is copied into Command OS; only its bounded-experiment principles are adapted.
