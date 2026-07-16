# ADR-001: Exactly two user-facing journeys

Status: Accepted
Date: 2026-07-15

## Context

The recovered product exposed provider, chat, approval, and orchestration modes
as if they were separate user outcomes. That made authorization and progress
hard to understand.

## Decision

The durable `Mission` and every `Run` declare exactly one public journey:
`autonomous` or `guided`. Provider modes remain internal routing details.
Autonomous derives authority from a versioned contract and never enters a
routine user-wait state after launch. Guided requires one visible exact-step
decision before consequential work.

## Consequences

- Journey is present on events, checkpoints, evaluations, reports, and audits.
- Legacy state names are migration inputs, not public product vocabulary.
- Journey conversion requires a versioned amendment or a new run.
- Provider capability never creates a third journey.
