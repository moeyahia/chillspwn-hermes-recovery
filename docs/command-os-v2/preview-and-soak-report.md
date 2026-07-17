# Preview and soak report

Status: **formal soak not completed**. On 2026-07-17 the operator explicitly
authorized an accelerated live deployment without the isolation/preview wait.
That operational override does not convert the 72-hour soak or seven-day
acceptance window into a pass; both remain unclaimed release evidence.

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
