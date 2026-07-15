# ADR-005: Provider execution stays behind the ChillsPwn boundary

Status: Accepted
Date: 2026-07-15

## Context

OAuth-backed provider CLIs are valuable, but a direct provider command is a
black box with respect to ChillsPwn scope, delegation, evidence, and tool policy.
ACP improves session control but does not itself enforce product authorization.

## Decision

Grok, Codex, Claude, and compatible provider paths may plan, explain, critique,
or synthesize through adapters. Consequential execution is dispatched only as a
normalized assignment through the specialist/MCP boundary after journey,
contract, exact-step, target, tool, and no-hands checks. The canonical Commander
SOUL is projected into provider planning context.

## Consequences

- Provider OAuth usage can be retained without treating provider output as
  authorization.
- A provider path unable to enforce the boundary cannot be advertised as an
  Autonomous executor.
- Commander direct-tool exceptions are explicit, policy-bound, and audited.
- Provider repair turns may fix bounded schema errors but cannot widen scope or
  silently replay failed work.
