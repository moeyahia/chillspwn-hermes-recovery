# Council Provider and Consensus Validation

## Launch reliability

- Record the actual provider, model, authentication mode, timeout, output path, PID, and exit status for each lane.
- A successful process exit is not a successful lane. Count only substantive assessment files that exceed the placeholder threshold and contain the requested sections.
- Relaunch failed lanes individually with a shorter briefing and explicit write deadline instead of restarting successful lanes.
- Use monotonic time for launcher deadlines so VM wall-clock adjustments do not terminate all lanes early.

## Provider authentication verification

Before promising a direct API-backed lane, verify that the required credential variable is present without printing it and that user configuration cannot silently reroute the provider. Log only credential presence/type and the selected provider, never the value.

## Consensus is a hypothesis

A strong majority can still recommend a technically invalid path. One observed failure class was assuming that a server-authentication certificate would necessarily map to an LDAP client identity; live validation returned either an unsupported SASL mechanism or an anonymous bind.

For every council recommendation:

1. List prerequisites and a harmless falsification test.
2. Verify against current local artifacts and live target behavior.
3. Preserve dissent as a risk rather than deleting minority views.
4. Do not claim success until the orchestrator directly verifies the pivotal output.

## Operator-agent guardrail

Execution prompts must state the exact approved path, stop conditions, known dead ends, and permitted fallbacks. If a named step fails with a listed condition, the agent reports and stops instead of improvising into unrelated target changes.

## Evidence

Retain sanitized lane metadata, assessment checksums, validation results, dissent, and final decision rationale. Keep target names, credentials, certificates, hashes, and proof output in the protected engagement workspace.
