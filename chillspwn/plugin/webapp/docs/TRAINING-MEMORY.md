# Training Memory — box-agnostic verified attack chains

The goal of authorized lab work is **not just to complete a target** — it is to train the agent on
**verified, evidence-backed attack lessons** it can reuse on future runs. This document defines the
memory taxonomy and how lessons feed planning.

## The taxonomy (read this first)

- **Evidence is NOT memory.** A captured artifact (scan output, a file, a screenshot) is proof of
  one event on one target. It is stored as an `EvidenceItem` / artifact and **referenced** by id.
- **A hypothesis is NOT verified learning.** `type: "hypothesis"` is an untrusted guess. It is
  **never** injected into trusted planning context — not even when an operator "verifies" the row
  (a verified hypothesis is still a hypothesis).
- **A generic finding is NOT a reusable lesson.** A finding is an observation about one target.
- **A Verified Attack Lesson IS the reusable training unit.** Distilled, operator-approved,
  evidence-referenced, secret-free knowledge: technique, prerequisites/signals, steps that worked,
  reuse guidance, and anti-reuse warnings.

## The AttackLesson model

`category: "verified_attack_lesson"` (a dedicated model + store under
`runtime/training/lessons.json`, distinct from generic `MemoryItem`s). Key fields: `title`,
`techniqueName`, `techniqueCategory` (recon / web / smb / ldap / active_directory / kerberos /
winrm / linux_privesc / windows_privesc / credentials / pivoting / post_exploitation /
defensive_detection), `summary`, `prerequisites`, `observedSignals`, `stepsThatWorked`,
`toolsUsed`, `references`, `evidenceIds`, `sourceRunId`/`sourceStepIds`, `verificationMethod`,
`outcome`, `confidence`, `reuseGuidance`, `antiReuseWarnings`, `failedAttempts`, `scope`
(lab/project/global), `status` (proposed/verified/rejected/stale), `verifiedAt`/`verifiedBy`.

**Secrets must never become reusable memory.** On propose, lesson text is scanned:
- **flags, hashes (md5/sha/NTLM), private keys → REJECTED** (no reuse value; store an evidence
  reference instead);
- **credentials / tokens (`password: …`, api keys, bearer, PEM) → REDACTED** in place.
Store **evidence reference IDs, not secrets.**

**Preserve the attack chain, not the box identity.** Reusable text must use placeholders such as
`<TARGET_HOST>`, `<DOMAIN>`, `<USER_REF>`, `<CREDENTIAL_REF>`, and `<LHOST>`. It must not contain a
box name/URL, literal target IP/domain/user, credential, flag/hash, or engagement path. Helpful
references are technique-level official/vendor documentation, tool documentation, advisories,
general research, reusable exploit repositories, or generic local playbooks—not box walkthroughs.
Opaque run/evidence IDs remain available for provenance without being presented as execution steps.

## Lifecycle (the model can never self-trust)

`propose` → always `proposed`. `approve` → `verified` (the **only** path to trusted), and it
**refuses** a lesson that is not promotable (no evidence/run provenance, contains target identity
or a secret, or an `attack_chain` lacks prerequisites/signals, ordered steps, tools, validation, or
a reusable reference).
`reject` / `stale` move it out of the planning feed. REST:
`POST /api/training-memory/lessons/propose`, `GET /api/training-memory/lessons[?status=…]`,
`POST /api/training-memory/lessons/:id/{approve,reject,stale}` (gated by `ENABLE_TRAINING_MEMORY`,
default on). Reviewable in the cockpit "Training memory" section (approve/reject/stale, evidence
count, "▶ in planning" indicator).

## Post-session full playbooks

The structured lesson above is the reviewed planning index. The post-session learner also creates
the full on-demand execution playbook under Hermes skills. Each completed provider transcript,
including Grok ACP, is exported to the conversation archive; every 30 minutes the no-agent
`ChillsPwn Continuous Learning` job reviews one stable transcript with Claude subscription/OAuth
usage and writes only additive outputs:

- cross-target provider/tool/environment facts or durable user preferences may enter flat memory;
- repeatable attacks become technique-named skills with Prerequisites/Signals, Ordered Attack
  Chain, Command Templates, Validation, Failure Recovery, Cleanup, and real non-box References;
- deterministic preflight replaces surviving target values with placeholders, scans the whole plan
  before the first write, and makes retries exact-content idempotent;
- a transcript is marked processed only after all proposed reusable content persists safely. A
  rejection or write failure leaves it retryable and never advances its MCP offset.

The cron stores its retry/offset state and success markers under
`${CHILLSPWN_LEARN_STATE_DIR:-$HERMES_HOME/state/chillspwn-learning}` and detached reviewer output
under `${CHILLSPWN_LEARN_LOG_DIR:-$HERMES_HOME/logs}`. These directories must be owned by the
service account; the recovery install does not depend on root-owned `$HERMES_HOME/scripts` files.

Reviewed/bundled skill files are immutable to the service account. Automated learning creates
distinct top-level, service-owned skills and may patch only skills whose `.usage.json` provenance
is `created_by: agent`. A name collision or patch request against a reviewed skill fails safely and
remains retryable; it never rewrites the reviewed recovery snapshot. The skills root and `.archive`
may be group-writable/sticky so the service can manage its own new children without gaining write
access to root-owned reviewed children.

Existing historical memory is not silently deleted or rewritten by this additive path. New
automated writes follow the box-agnostic policy; historical cleanup remains an explicit operator
review task.

All flat-memory writers use the same reusable-content validator, including operator-facing `add`
and curator `replace` operations. Session-start, pre-compaction, and learner digest injection use
the guarded `safe-read` path: entries that fail the current policy are omitted instead of being
placed in a model prompt. Restoring a backup is also preflighted as one transaction and is refused
before any copy when either backed-up memory file contains unsafe entries. Audit records retain only
redacted metadata plus content length and SHA-256 fingerprints; they never persist rejected content.

In the recovered service, `CHILLSPWN_MEMORY_GUARD=required` makes Hermes' native `memory` tool send
additions through that validated writer, disables model-facing replace/remove, makes direct
`MemoryStore` mutation fail closed, and filters native system-prompt snapshots through `safe-read`.
Hermes `write_file`/`patch` and ACP filesystem shims also deny writes beneath
`$HERMES_HOME/memories`. If the mediator or its configured Python executable is unavailable, memory
is neither written nor injected through an unvalidated fallback.

### Filesystem mediation boundary

The recovered deployment removes the memory tree from Claude's `--add-dir` list and makes
`$HERMES_HOME/memories` root-only (`root:root`, `0700` directories and `0600` files), so the
dashboard, gateway, delegated specialists, and their terminal/file tools cannot read or mutate raw
entries as the `chillspwn` account. The root-owned `chillspwn-memory` service exposes a Unix socket at
`/run/chillspwn-memory/broker.sock`; its peer group may request only validated `add` and `safe-read`.
The broker accepts no arbitrary command or executable path, reuses the strict CLI internally, passes
entry content over stdin, and is sandboxed with write access limited to the memory tree and its socket.
Replace/remove/restore remain direct root/operator curator operations. If the socket, broker, helper,
or configured Python executable is unavailable, reads and writes fail closed.
An operator performing curation must invoke the CLI as root with broker client mode deliberately
disabled (for example, by unsetting `CHILLSPWN_MEMORY_SOCKET`); service processes must never set the
internal broker flag.

The dashboard's `GET /api/memory` and Memory page expose only broker-filtered `safe-read` output.
The legacy whole-file `PUT /api/memory/:file` endpoint returns `403 MEMORY_MUTATION_MEDIATED`;
the page is intentionally read-only and directs additions to the mediated
CLI. Provider prompt assembly uses this same reader, so an `EACCES`, broker outage, timeout, or
malformed helper response produces empty provider context instead of a raw-file fallback; the
operator-facing GET endpoint reports the outage as `503 MEMORY_BROKER_UNAVAILABLE`.

## What managed planning injects (and excludes)

Normal Claude/OpenRouter/Codex/Grok prompts and managed planning prepend, in order:
1. **`VERIFIED TRAINING LESSONS`** — verified, non-stale attack lessons (technique, when to
   consider, prerequisites/signals, ordered execution steps, tools, validation/outcome, failure
   recovery, technical references, reuse guidance, anti-reuse warnings, and evidence ref IDs).
2. **`VERIFIED MEMORY`** — verified, non-session, **non-hypothesis** memory facts.

**Excluded from planning, always:** hypotheses (verified or not), unverified notes, stale memory,
rejected memory, and any target-specific secret. If hypotheses are surfaced anywhere it is as
**untrusted research notes**, never under "trusted"/"verified".

## Cleaning up the existing ledger — safely

`scripts/training-memory-cleanup.ts` audits existing runtime memory and classifies each entry
(`verified_attack_lesson_candidate` / `hypothesis` / `raw_note` / `target_specific_secret` /
`stale` / `unknown`). **Safe by default — dry-run only.** Hypotheses are **never blindly erased**;
they are marked/quarantined and excluded from planning, preserved for operator review.

```bash
bun scripts/training-memory-cleanup.ts                    # DRY RUN — report only, no mutation
bun scripts/training-memory-cleanup.ts --mode=quarantine  # mark hypotheses/raw-notes/secrets rejected (NO delete)
bun scripts/training-memory-cleanup.ts --mode=promote     # seed PROPOSED lessons from provenance-backed candidates (operator still approves)
bun scripts/training-memory-cleanup.ts --mode=delete --confirm-delete   # DANGEROUS, explicit, not default
```

Promotion only targets entries that have **evidence references + run/step provenance + no secrets**,
and it creates a **proposed** lesson (with a placeholder `techniqueCategory` the operator enriches) —
it never auto-verifies.

## Phase 16 — MCP evidence → lessons
MCP tool output is recorded as Evidence with provenance `sourceToolName = <mcpServer>.<toolName>`
(large output → artifact). A specialist may then PROPOSE a lesson citing those `evidenceIds` and
naming the MCP server/tool in `toolsUsed`. Same rules as always: specialists propose but never approve
their own lessons; verified lessons need evidenceIds + sourceRunId + corroboration; secrets are
redacted; nothing auto-approves.

## Phase 16.1 — lesson counts on the Mission Board
Each specialist Agent Card shows its proposed / verified / failed-attempt lesson counts (from the
per-agent namespace). The board links out to Training Memory / Cockpit for review; specialists still
propose-but-never-approve, and hypotheses are excluded from planning context.

## Phase 17 — strategy/intel lesson kinds
New `kind`s: `wordlist_strategy_lesson`, `hashcat_strategy_lesson`, `vulnerability_intelligence_lesson`
(inject like reusable lessons, NOT the failed-attempt section). Rules unchanged: evidenceIds+sourceRunId+
corroboration; NO secrets/hashes/passwords/full-wordlists/exploit-code/unverified-CVEs. The same
secret-rejection applies — a strategy lesson containing a flag/hash is rejected.
