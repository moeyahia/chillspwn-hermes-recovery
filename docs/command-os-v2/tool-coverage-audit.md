# Command OS V2 tool coverage audit

Date: 2026-07-18 UTC
Scope: configured MCP registry, exact live schemas, reviewed implementation
canaries, policy mappings, and callable V2 provider routes.
Safety: zero engagement targets and zero public-LLM calls.

## Current result

**PASS for the currently exposed V2 tool surface: 18/18.**

This is a bounded tool-validation gate, not a product release or cutover pass.
The complete Command OS release gate remains closed.

| Inventory measure | Servers | Bindings/routes |
|---|---:|---:|
| Configured MCP inventory | 19 | 134 |
| Enabled MCP inventory | 4 | 56 |
| Policy mapped | — | 87 total / 18 enabled |
| Intentionally suppressed | — | 38 total / 0 exposed |
| Unmapped | — | 9 total / 0 enabled |
| Exact attested server surfaces | 4 | 18 exposed |
| Fully covered exposed tools | — | 18/18 |
| Callable V2 providers | — | 1/1 covered |

“Suppressed” and “unmapped” never mean passed. They mean the binding has no
production dispatch route. A newly exposed binding fails the gate until exact
schema, safe implementation success, and deterministic failure evidence all
match the current implementation and registry hashes.

## Bound receipts

The passing combined gate used:

- public NVD: `nvd_canary_f07da739f7aedfccb4382783d5138676`
  — 2 exposed bindings;
- VulnIntel CVE:
  `vulnintel_cve_canary_0593e45cd27255be7f1de18845da8b5b`
  — 8 exposed bindings;
- Pentest Recon:
  `pentest_recon_canary_20b1e2402dabaddbba8b363682aa3995`
  — 8 exposed bindings.

The single callable provider route also passes its success and typed
rate-limit, unavailable-provider, and missing-authentication coverage: 1/1.
The run contacted no engagement target and sent no context to a public LLM.

## Exact disposition

### Exposed and covered

- `vulnintel-nvd`: 2/2;
- `vulnintel-cve-mcp`: 8/8;
- `pentest-mcp-recon`: 8/8.

### Schema-attested but suppressed

- `sechub-binary-analysis`: all 32 configured/live schemas match, but 0 tools
  are exposed. The stateful adapter, authorized artifact mount, offline
  containment, and vendor error semantics remain unsuitable for production.
- `vulnintel-cve-mcp::get_cve_summary` and `calculate_risk_score`: suppressed
  because vendor aggregation hides dependency failure/rate-limit semantics.
- Pentest `runHashcat`, `subfinderEnum`, `httpxProbe`, and `nucleiScan`:
  suppressed. The latter two still attempted resolver egress in the isolated
  fixture; the former two lack an acceptable executable/runtime contract.

The registry pins complete reviewed vendor name/schema surfaces even when only
a smaller configured subset is exposed. Unexpected additions, removals, schema
changes, implementation changes, stale receipts, or disposition drift fail
closed.

## Reproduction

From `chillspwn/plugin/webapp`:

```bash
./scripts/command-os-v2/manage-trusted-tool-shims.sh check
bun run test:v2-tool-coverage
```

Individual canaries remain available as:

```bash
bun run audit:v2-tool-coverage:nvd-live
bun run audit:v2-tool-coverage:vulnintel-local
bun run audit:v2-tool-coverage:pentest-live
bun run audit:v2-tool-coverage:binary-live
```

Binary analysis is expected to remain unavailable until its dedicated blockers
are repaired; running its diagnostic canary must not expose its bindings.

## Historical baselines

- The 2026-07-17 baseline reported 34 eligible bindings with 0/34 complete
  implementation evidence. It predated exact disposition records and the
  current canaries.
- Early 2026-07-18 reports described Pentest Nmap as uninstalled, VulnIntel as
  8/10 with the entire route still globally blocked, and binary analysis as a
  32-tool candidate surface. Those were accurate at their timestamps. The
  current registry instead exposes only individually covered bindings and
  suppresses every known blocker.

These historical results remain in Git history and receipt storage for audit;
they are not current readiness evidence.

## Remaining product gate

Passing 18/18 proves only that every binding currently dispatchable by V2 has
the required bound evidence. It does not prove mission authorization,
provider/MCP availability at launch, browser completeness, migration safety,
restart recovery, performance, preview acceptance, soak, rollback, or human
release approval. No default-route cutover is authorized by this result.
