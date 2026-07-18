# Preview and soak report

Status: **formal soak not completed**. On 2026-07-17 the operator temporarily
authorized an accelerated deployment without the isolation/preview wait, then
explicitly restored the legacy application as the working service on port
`3131` and moved Command OS V2 to preview port `3132`. That operational history
does not convert the 72-hour soak or seven-day acceptance window into a pass;
both remain unclaimed release evidence.

## Current preview hardening checkpoint

The candidate now includes a fail-closed bridge from the exact tool audit to a
root-owned runtime evidence bundle, plus nonblocking startup warm-up for the
provider and eligible MCP route attestations. The hybrid package gate is green
at **1,361 Bun tests and 0 failures**. The independent V2 package gate is green
at **723 tests and 0 failures**. This proves the source-level bridge and
its negative cases; it is not proof that the running preview has consumed a
new bundle.

The final aggregate has now passed at 18/18 exposed tools and 1/1 provider route
with zero route/config blockers. It published bundle
`runtime_tool_evidence_b502fc8be05cf1c182e766aae93b7de4`, SHA-256
`451c84db23174eb24ca719f1d9c4d8d484ebf9c6533493ede8aa369f363bc0d5`, as
`root:chillspwn` mode `0640`. Accepted runtime route/tool counts and post-warm-up
provider/MCP health remain **PENDING** until copied from the actual deployed
service, not a fixture. Formal soak timing begins only against an identified
immutable candidate after those health checks pass.

## Prerequisites not yet satisfied

- zero static and dynamic interaction-manifest gaps;
- full no-retry browser matrix and approved visual baselines;
- final accessibility, security, performance, migration, restart, and rollback
  evidence;
- production execution adapter and all-agent Brain hook proof;
- immutable Research Lab harness or explicit continued fail-closed status;
- empty P0/P1/P2/UI-blocking defect list;
- legacy regression and coexistence performance within the approved budget.

## Required automated soak

The release candidate must run at least 72 hours with repeated Autonomous and
Guided fixtures, event reconnects/gap repair, process restarts, cancellation,
failure/recovery, graph use, Vault sync/conflicts, report/evidence export, and
concurrent legacy load. It must record browser/server errors, orphan processes,
lease health, event latency, memory growth, database integrity, queue depth,
provider/MCP quotas, and legacy performance delta.

## Required preview window

After the soak, the default seven-day preview acceptance window must complete
without an unresolved release-scope defect. Any fix resets the relevant
validation and requires the full release matrix again. No retry may mask
flakiness.

No preview/soak pass or release readiness is claimed in the current worktree.
