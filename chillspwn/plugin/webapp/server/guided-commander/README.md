# Guided Commander backend

This module is the durable, database-backed conversational control plane for a
Guided mission. Mount `createGuidedCommanderRouter()` after authentication and
bounded JSON parsing, and inject a `GuidedCommanderPort` whose declared kind is
`planning_only` and whose tool-execution support is `false`.

The production server injects `GrokGuidedCommanderPort`, which calls the
installed Grok ACP client through its OAuth session. It requires a plain JSON
object, rejects markdown fences and unknown fields (including tool calls), and
uses the isolated planning profile with no MCP or execution surface.

The boundary deliberately exposes no executor, tool registry, approval
mutation, or plan mutation callback. Every contextual request is bound to the
current mission, run, represented step, and SHA-256 action fingerprint. The
provider may explain, recommend, interpret, or compare approaches; it cannot
advance or execute the step.

## HTTP surface

- `GET /api/v2/guided/:missionId/commander/transcript?runId=...`
- `POST /api/v2/guided/:missionId/commander/explain-more`
- `POST /api/v2/guided/:missionId/commander/show-next-step`
- `POST /api/v2/guided/:missionId/commander/interpret-result`
- `POST /api/v2/guided/:missionId/commander/use-another-approach`
- `POST /api/v2/guided/:missionId/commander/remember`
- `POST /api/v2/guided/:missionId/commander/do-not-remember`

Every mutation requires an `Idempotency-Key`. Conversation messages, context
packs, provider turns, evidence provenance, append-only run events, and audit
records are written to the canonical SQLite database.

## Interpretation versus exact-step state changes

`commander/interpret-result` is planning-only. It retains bounded, redacted,
unverified text evidence, persists the Commander's interpretation as an
append-only evidence-chain event, and exposes that reviewed observation from
canonical evidence state after reconnect. It never attests success, completes
the represented step, or advances the run.

Consequential state changes remain on the exact Guided decision boundary:

- `POST /api/v2/guided-decisions/:decisionId/manual-result` requires the
  current action fingerprint, exact canonical parameters, and the unconsumed
  interpreted evidence ID. After explicit operator attestation it creates an
  immutable verified derivative linked to the original observation, completes
  only that represented step, and advances execution. The original evidence
  remains immutable and unverified.
- `POST /api/v2/guided-decisions/:decisionId/skip` creates no action or
  evidence. It records the reason, marks only the current represented step as
  skipped, checkpoints progress, and moves to the next dependency-eligible
  decision or real outcome evaluation.
- `POST /api/v2/guided-decisions/:decisionId/stop` cancels the whole run and
  open work from the current exact-step control.

Skip and Stop require a reason plus both `expectedFingerprint` and the exact
canonical `expectedParameters` shown on the decision card. Stale or changed
steps fail closed before either control mutates the run. Both controls append
operator events and journey-bound audit records; neither fabricates execution
or evidence.

## Text-result ingestion limit

`interpret-result` currently accepts bounded UTF-8 text in a JSON request. The
accepted media types are plain text, JSON, CSV, and XML, with a 128 KiB limit.
Authentication-like values are redacted before model interpretation and before
any extracted text is retained. The original text is content-addressed by
SHA-256 and then discarded; the evidence record explicitly states that raw
content was not retained.

Multipart and binary uploads remain intentionally outside this module. They
must be implemented through the artifact upload boundary with streaming size
limits, media sniffing, malware scanning, storage isolation, and an immutable
artifact hash before their extracted text is passed here by evidence ID.
