# ADR-003: Reliability is enforced by a deterministic supervisor

Status: Accepted
Date: 2026-07-15

## Context

Prompts alone cannot guarantee bounded retries, prevent repeated actions, close
orphaned children, or recover safely after process loss.

## Decision

A `RunSupervisor` owns validated lifecycle transitions, leases, heartbeats,
budgets, action fingerprints, progress signatures, loop detection, retry
taxonomy, circuit breakers, checkpoints, recovery planning, and cancellation.
Provider responses propose work; they do not bypass this state machine.

## Consequences

- Output without a material evidence/state delta is not progress.
- Only classified transient failures receive bounded automatic retries.
- Autonomous recovers in contract or safe-stops; Guided explains and requests a
  single decision.
- Potentially destructive in-flight work is never blindly replayed on restart.
