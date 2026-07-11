# HTB Training Memory — verified attack lessons (8.2)

The goal of authorized HTB/lab work is **not just to solve a box** — it is to train the agent on
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
`toolsUsed`, `evidenceIds`, `sourceRunId`/`sourceStepIds`/`sourceBoxOrLab`, `verificationMethod`,
`outcome`, `confidence`, `reuseGuidance`, `antiReuseWarnings`, `failedAttempts`, `scope`
(lab/project/global), `status` (proposed/verified/rejected/stale), `verifiedAt`/`verifiedBy`.

**Secrets must never become reusable memory.** On propose, lesson text is scanned:
- **flags, hashes (md5/sha/NTLM), private keys → REJECTED** (no reuse value; store an evidence
  reference instead);
- **credentials / tokens (`password: …`, api keys, bearer, PEM) → REDACTED** in place.
Store **evidence reference IDs, not secrets.**

## Lifecycle (the model can never self-trust)

`propose` → always `proposed`. `approve` → `verified` (the **only** path to trusted), and it
**refuses** a lesson that is not promotable (no evidence/run provenance, or contains a secret).
`reject` / `stale` move it out of the planning feed. REST:
`POST /api/training-memory/lessons/propose`, `GET /api/training-memory/lessons[?status=…]`,
`POST /api/training-memory/lessons/:id/{approve,reject,stale}` (gated by `ENABLE_TRAINING_MEMORY`,
default on). Reviewable in the cockpit "Training memory" section (approve/reject/stale, evidence
count, "▶ in planning" indicator).

## What managed planning injects (and excludes)

Managed planning (`POST /api/runs/managed-chat`) prepends, in order:
1. **`VERIFIED TRAINING LESSONS`** — verified, non-stale attack lessons (technique, when to
   consider, prerequisites/signals, reuse guidance, anti-reuse warnings, evidence ref IDs).
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
