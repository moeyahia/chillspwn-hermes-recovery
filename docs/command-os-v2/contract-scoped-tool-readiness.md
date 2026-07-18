# Contract-scoped tool readiness

Date: 2026-07-18 UTC
Status: **implemented and verified for the currently exposed tool subset; the
overall product cutover gate remains closed**.

## Decision

Autonomous mission preflight evaluates tool evidence against the exact
intersection of:

- action classes pre-authorized by the signed mission contract;
- specialists selected in that contract;
- tools mapped by the canonical runtime capability manifest;
- bindings live-attested for those specialists; and
- bindings available behind local policy enforcement.

An unvalidated tool outside that intersection does not block a mission. A
dispatchable sibling inside it does. Global health continues to report the
complete configured surface, and Guided preserves its represented manual-step
path when agent execution is unavailable.

## Current readiness evidence

The combined registry-driven gate passes all **18/18 exposed bindings** across
four exact servers:

- Pentest Recon: 8/8;
- VulnIntel CVE: 8/8;
- public NVD: 2/2;
- binary analysis: 0 exposed; all 32 configured bindings remain deliberately
  unavailable despite complete schema attestation.

The exact receipts and registry totals are in
[tool-coverage-audit.md](./tool-coverage-audit.md). Deliberately suppressed
bindings are never counted as successes. The product cutover gate remains
closed for browser-matrix, preview, soak, rollback, and human-sign-off work
outside this bounded tool gate.

## Fail-closed rules

Preflight blocks when:

- the canonical capability manifest or validation inventory is unavailable;
- an allowed action class or selected specialist is absent from the registry;
- the selected team has no mapped, available, locally enforced binding for a
  required class;
- ownership cannot be mapped to one exact live server/tool registration; or
- a dispatchable binding in the signed intersection lacks current schema,
  safe implementation success, or deterministic failure evidence.

Configured `intentionally_unavailable` bindings remain in complete vendor
surface attestation but are removed from the exposed subset. Current examples
are `runHashcat`, `subfinderEnum`, `httpxProbe`, `nucleiScan`, the two unsafe
VulnIntel aggregate bindings, and every binary-analysis binding. They cannot be
selected or dispatched by the planner.

## Trusted recon bundle

`pentest-mcp-recon::nmapScan` readiness and child-process execution use the
same `trustedNmapExecutionBundleStatus` predicate. The installed V2-only bundle
contains a capability-free Nmap copy and a no-update `httpx-toolkit` wrapper.
It verifies exact hashes, root ownership and modes, exact directory contents,
atomic provenance, and every ancestor through `/`.

The private bin directory is absent from legacy and global preview PATHs and is
added only to the exact reviewed child. The installer/check and isolated canary
have passed. `httpxProbe` and `nucleiScan` still remain suppressed because
their implementations attempted resolver egress inside the isolated fixture;
the wrapper does not pretend to be an egress sandbox.

## Full TCP authority

Ordinary Nmap requests remain capped at 1,024 ports. The sole exception is an
exact 1–65,535 TCP Connect selection backed by a one-use Autonomous capability
binding the action/fingerprint, mission/run/control plane, plan/version/step,
assignment/agent, target, arguments hash, contract hash/version, action class,
non-destructive policy, and finite remaining budgets.

Issuance and consumption are append-only, hash-linked audit records protected
from UPDATE/DELETE and serialized with `BEGIN IMMEDIATE`. The bridge atomically
revalidates canonical authority and consumes the exact record before applying
the exception. Forgery, replay, races, stale scope, Guided or legacy ownership,
or missing/exhausted budget state fail closed.

## Focused verification

Tests cover:

- scoped contracts ignoring unrelated unavailable bindings;
- a missing or unvalidated sibling inside the signed class/team blocking;
- intentionally unavailable bindings remaining suppressed while full vendor
  surfaces are pinned;
- shared policy/executor trusted-bundle verification and drift rejection;
- direct or forged full-range requests remaining capped;
- Guided, legacy, stale, mismatched, or unbudgeted capability refusal;
- immutable audit receipt enforcement and one winner under concurrent consume;
- missing/rejecting verifier refusal; and
- registry-driven combined coverage of every exposed binding.

Current tool readiness does not waive mission authorization, provider/MCP
health, target reachability, contract budgets, or any other launch invariant.
