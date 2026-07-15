# Run supervisor

The RunSupervisor is deterministic infrastructure, not a prompt convention.

## Responsibilities

- validate journey-aware state transitions;
- claim and renew run/assignment/action leases;
- checkpoint durable transitions and material results;
- calculate action fingerprints and progress signatures;
- detect repetition, alternating cycles, equivalent replans, lost heartbeat, ignored results, and no-progress windows;
- classify errors and apply bounded retry/backoff;
- enforce time, token, cost, tool, retry, replan, storage, and concurrency budgets;
- operate provider/tool/worker circuit breakers;
- choose bounded recovery, reassignment, or safe stop;
- propagate cancellation and verify child cleanup;
- recover nonterminal runs deterministically after restart.

## Default bounds

Defaults are configurable by action class and contract. A safe baseline is two transient retries, three materially identical fingerprints in a rolling window, two automatic replans, and evaluation after three completed actions without progress.

Authorization/policy denials, operator rejection, invalid unchanged arguments, deterministic missing dependencies, destructive ambiguity, and identical failed plans are not retried.

## Journey behavior

Autonomous recovers inside contract or safe-stops. It never enters `waiting_guided_decision` after launch. Guided explains failure, proposes one recovery and alternatives, then waits on one explicit durable decision.
