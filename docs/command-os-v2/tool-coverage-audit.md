# Command OS V2 tool coverage audit

Date: 2026-07-18 UTC
Scope: configured MCP registry, exact live schemas, reviewed implementation
canaries, policy mappings, and callable V2 provider routes.
Safety: zero engagement targets and zero public-LLM calls.

## Current result

**PASS for the currently exposed V2 tool surface: 18/18.**

This is a bounded tool-validation gate, not a product release or cutover pass.
The complete Command OS release gate remains closed.

This result describes the most recent completed aggregate audit. Production
runtime consumption of that evidence is a separate fail-closed boundary. The
new bridge is implemented and package-tested, and its final bundle has been
published. Post-deployment consumption and health remain pending below.

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

- public NVD: `nvd_canary_78502c6b667e30d0158ab217179c0ac6`
  — 2 exposed bindings;
- VulnIntel CVE:
  `vulnintel_cve_canary_fca6382af68fc1efef73f7628c5ff1bb`
  — 8 exposed bindings;
- Pentest Recon:
  `pentest_recon_canary_6ca0bf23292ad7c176865b0fe33be149`
  — 8 exposed bindings.

The single callable provider route also passes its success and typed
rate-limit, unavailable-provider, and missing-authentication coverage: 1/1.
The run contacted no engagement target and sent no context to a public LLM.

## Production runtime evidence bridge

The aggregate audit now accepts `--write-runtime-evidence=<absolute-path>`.
It refuses publication unless the exact route/schema reconciliation, every
exposed tool's safe-success and deterministic-failure evidence, and provider
coverage all pass. A successful publication contains the self-verifying NVD,
VulnIntel, and Pentest Recon receipts in one versioned, integrity-bound bundle.

Production expects a root-owned, service-group-readable file at
`/var/lib/chillspwn-attestations/command-os-v2-tool-evidence.json`. Publication
uses a same-directory `0600` temporary file, `fsync`, root/service-group
ownership, final mode `0640`, atomic rename, and parent-directory `fsync`. The
runtime accepts only a regular, non-symlink file in a trusted-owner,
non-group/world-writable, non-symlink parent directory.

Loading repeats receipt integrity and freshness checks and independently
recomputes each installed server-asset hash and the live registry-config hash.
Only an exact match for a currently live-attested route enters the executable
denominator. A missing or invalid bundle, a stale or future-dated receipt,
permissions/ownership failure, tampering, changed server asset, changed
registry, or absent route leaves that route uncovered and execution
fail-closed. A receipt for a disabled route is retained only as ignored audit
input; it cannot expose a tool.

Startup also warms the existing bounded provider/MCP attestation caches so
readiness can distinguish `probing` from unavailable. Scheduling a probe is
not authority: execution remains unavailable until the fresh provider/MCP
attestation and the persisted per-tool evidence both validate.

### Final publication and live-consumption receipt

| Check | Status |
|---|---|
| Exact aggregate after bridge changes | **PASS — 18/18 tools, 1/1 provider, zero route/config blockers** |
| Published bundle ID | `runtime_tool_evidence_b502fc8be05cf1c182e766aae93b7de4` |
| Published file SHA-256 | `451c84db23174eb24ca719f1d9c4d8d484ebf9c6533493ede8aa369f363bc0d5` |
| Root owner / service group / `0640` | **PASS — `root:chillspwn`, `0640`, 53,685 bytes** |
| Runtime accepted routes | **PENDING — live health check** |
| Runtime fully covered tools | **PENDING — must equal 18/18** |
| Runtime route/config blockers | **PENDING — must equal 0** |
| Provider route readiness | **PENDING — post-startup warm-up** |

The exact runtime-consumption values remain pending until the candidate service
has loaded this bundle and exposed its health projection.

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

The root-run production publication form is:

```bash
install -d -o root -g chillspwn -m 0750 /var/lib/chillspwn-attestations
bun run scripts/command-os-v2/audit-v2-tool-coverage.ts \
  --allow-docker \
  --local-vulnintel-canary \
  --live-pentest-recon-canary \
  --live-public-nvd-canary \
  --write-runtime-evidence=/var/lib/chillspwn-attestations/command-os-v2-tool-evidence.json
```

This command performs only the documented loopback/disposable local canaries
and the bounded read-only NVD authority calls. It must not receive or derive an
engagement target. The writer will not replace the runtime bundle if the
aggregate is non-releasable.

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
