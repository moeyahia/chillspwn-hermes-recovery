# Binary-analysis tool canary

Date: 2026-07-18 UTC
Server: `sechub-binary-analysis`
Installed implementation: `radare2-mcp:latest`

## Current disposition

**All 32 configured bindings are intentionally unavailable and 0 are exposed.**

The complete live 32-tool name/schema surface is exact and schema-attested.
That attestation is retained for drift detection; it is not production
execution evidence. The current combined tool gate passes because none of
these blocked bindings can be selected or dispatched, not because the vendor
defects were waived.

The isolated diagnostic canary used a newly compiled, non-sensitive local ELF,
Docker network mode `none`, a read-only root and fixture mount, dropped
capabilities, `no-new-privileges`, bounded resources, and no engagement target,
credential, or public model. The binary was analyzed but never executed.

| Proof | Result |
|---|---:|
| Exact live schema boundary | 32/32 |
| Diagnostic vendor success | 28/32 |
| Diagnostic deterministic error signal | 30/32 |
| Exposed production bindings | 0/0 |

## Why the tools remain unavailable

Vendor defects include:

- `list_files` omits the mounted canary file;
- `list_memory_maps` requires a debugger in an offline static-analysis path;
- `list_methods` emits a malformed Radare2 command;
- `list_decompilers` advertises `pdc`, while `use_decompiler` rejects it;
- `open_file` reports a missing-file failure with `isError=false`; and
- `list_functions` reports a no-open-file failure with `isError=false`.

Production adapter blockers include:

- one MCP process per call, which loses state between `open_file`, analysis,
  inspection, mutations, and close;
- no reviewed, immutable, authorized artifact staging/mount contract; and
- no mandatory offline network containment on the generic Docker start path.

These are production blockers. A schema pass or a diagnostic success cannot
promote a binding.

## Preserved historical receipt

The 2026-07-17 diagnostic evidence remains at:

- `/var/lib/chillspwn/test-evidence/command-os-v2/sechub-binary-analysis-receipt-20260717T162750Z.json`
  (`sha256:9056d6d460a15ef9e580218af5df033d003b4f294ba69f25163d7ccdb6a715ad`)
- `/var/lib/chillspwn/test-evidence/command-os-v2/sechub-binary-analysis-audit-20260717T162750Z.json`
  (`sha256:06df1e82908f52f54995a99a37d401ddd5bc7960be3ca7f296c4c4c33a59dcc8`)

The tested image content hash was
`58af3b409791c415b9a9b16fd87fccad213c9c90fea007ac20b052787f748c84`.
That receipt documents why the registry suppresses this route. It is not an
exposure receipt.

## Reproduction

```bash
cd chillspwn/plugin/webapp
bun run audit:v2-tool-coverage:binary-live
```

The diagnostic command is expected to report implementation blockers. Its
result must not alter the `intentionally_unavailable` disposition.

## Promotion requirements

Promotion requires a dedicated leased per-run analysis session, immutable
authorized artifact staging, a fixed read-only mount, mandatory offline
containment, explicit open/analyze/inspect/close transitions, normalized vendor
errors, repaired or repinned vendor behavior, bounded cancellation/restart,
and a new hash-bound receipt. All 32 safe paths and all 32 deterministic failure
paths must pass through the production adapter before any binding is exposed.

The overall product cutover gate remains closed independently of this route.
