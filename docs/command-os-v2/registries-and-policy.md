# Command OS V2.4 registries and policy

Status: implemented pure-domain foundation, 2026-07-16.

The registry layer turns runtime capability manifests into inspectable product choices. React components must not maintain independent lists of agents, tools, MCP servers, models, action classes, evidence types, deliverables, templates, or failure meanings. The canonical catalog supplies stable product semantics; live manifests supply operational truth and readiness.

Implementation:

- `server/domain/catalog-ids.ts`
- `server/domain/source-manifest-adapters.ts`
- `server/domain/action-class-registry.ts`
- `server/domain/evidence-type-registry.ts`
- `server/domain/deliverable-registry.ts`
- `server/domain/mission-template-registry.ts`
- `server/domain/model-readiness.ts`
- `server/domain/failure-taxonomy.ts`

Tests are under `tests/unit/domain/`. The isolated domain run currently passes 25 tests with 184 assertions. This is domain evidence, not an end-to-end release claim.

## Registry ownership and versioning

The registry boundary has two inputs:

1. Stable canonical IDs, labels, explanations, risk semantics, and safe platform defaults owned by V2 domain code.
2. Supplied runtime manifests for risk classes, evidence kinds, capabilities, tools, MCP servers, agents, providers, and provider models.

Persisted contracts must store the canonical ID, resolved policy state, source (`platform_default`, `preset`, or `operator_override`), registry/schema version, and the runtime projection or manifest hash used at preflight. Display labels may change without changing IDs. Removing or changing the meaning of an ID requires an explicit compatibility migration.

The adapter fails closed on:

- duplicate manifest IDs;
- unknown action, evidence, or deliverable IDs;
- tools referring to unknown risk classes or MCP servers;
- MCP servers referring to unknown tools;
- agents referring to unknown capabilities, tools, providers, or models;
- empty manifest IDs.

## Dynamic runtime projection

### Supplied manifest fields

| Source | Fields used by readiness and mapping |
| --- | --- |
| Runtime risk class | Stable ID, label, and explicit action-class IDs. |
| Runtime evidence kind | Stable ID, label, and explicit evidence-type IDs. |
| Capability | Stable ID, label, action-class IDs, optional evidence-type IDs, and optional deliverable IDs. |
| Tool | Stable ID, availability, local policy enforcement, whether a model is required, action/evidence/deliverable IDs, runtime risk IDs, MCP binding, and dependency health. |
| MCP server | Stable ID, health state (`healthy`, `degraded`, `offline`, `unconfigured`), and tool IDs. |
| Agent | Stable ID, availability, capability IDs, direct action-class IDs, tool IDs, deliverable IDs, and exact provider/model references. |
| Provider | Stable ID, authentication, health, catalog observation time, and models. |
| Provider model | Exact model ID, display name, tool-calling and structured-output support, declared enforcement, compatible action classes, disclosure classes, context limit, and supported reasoning efforts. |

Mappings are explicit. The adapter does not guess that a tool is capable because its label contains a keyword.

### Capability availability

| State | Meaning |
| --- | --- |
| `supported` | At least one mapped agent and tool exist, and at least one mapped agent plus one dependency/MCP-ready tool are available. |
| `unavailable` | The mapping exists, but all mapped agents, tools, dependencies, or required MCP paths are currently unavailable. |
| `unsupported` | The supplied runtime has no complete agent-and-tool mapping for the canonical class. |

For each action class, the projection records runtime risk IDs, all and available agents, all and available tools, MCP servers, provider/model references, enforced provider/model references, locally enforced tools, produced evidence types, enforcement readiness, and plain readiness reasons.

`enforcementReady` requires an available locally policy-enforced tool and either:

- an authenticated, healthy, tool-calling, structured-output `enforced_executor` compatible with the action class; or
- a locally enforced tool explicitly declared not to require a model.

This projection answers technical readiness. Provider disclosure compatibility is checked separately for the mission’s required disclosure class.

## Exactly two journeys

The canonical journey set is exactly:

- `autonomous`
- `guided`

No third journey is accepted. Internal capabilities such as asking, explaining, observing, approval handling, provider routing, or manual command entry do not become journey values.

In Autonomous:

- `pre_authorized` resolves to `execute_inside_contract`, but launch is blocked unless that class is supported and enforcement-ready;
- `guided_only` resolves to `safe_stop_or_choose_in_scope_alternative`, never a routine operator wait;
- `prohibited` resolves to `deny_prohibited`.

In Guided, policy defines what may be represented or must never be proposed. Exact-step authorization and normalized parameters still belong to the Guided decision boundary; a `pre_authorized` registry state does not create standing multi-step authority.

## Action Class Registry

### Policy states

| ID | Meaning |
| --- | --- |
| `pre_authorized` | Autonomous may execute inside normalized scope, budgets, provider/tool policy, and the signed contract. |
| `prohibited` | The class may not execute in this mission. |
| `guided_only` | It may be represented as a Guided decision; Autonomous must use an alternative or safe-stop. |
| `inherited_default` | Input-only instruction to resolve from the preset or platform default. No built registry leaves this state unresolved. |

A class has one state, so it cannot be both allowed and prohibited. Supported Autonomous classes always resolve to one enforceable state. An operator override has precedence over a preset only when mandatory safety rules permit it.

### Canonical action classes

The following table is generated here from the implemented definition values and was checked against the exported domain objects.

| Canonical ID | Class | Risk | Platform default | Default evidence | Destructive/disruptive guard |
| --- | --- | --- | --- | --- | --- |
| `passive_intelligence_osint` | Passive intelligence and OSINT | low | `pre_authorized` | `asset_discovery_proof` | No |
| `dns_domain_certificate_discovery` | DNS, domain, and certificate discovery | low | `pre_authorized` | `dns_certificate_record` | No |
| `active_host_discovery` | Active host discovery | moderate | `guided_only` | `asset_discovery_proof` | No |
| `port_service_enumeration` | Port and service enumeration | moderate | `guided_only` | `port_service_scan_result`, `service_version_fingerprint` | No |
| `os_technology_fingerprinting` | Operating-system and technology fingerprinting | moderate | `guided_only` | `os_platform_fingerprint`, `service_version_fingerprint` | No |
| `web_crawling_page_capture` | Web crawling and page capture | moderate | `guided_only` | `http_exchange`, `web_page_capture` | No |
| `web_content_endpoint_discovery_fuzzing` | Web content and endpoint discovery | high | `guided_only` | `endpoint_discovery_result`, `http_exchange` | No |
| `vulnerability_configuration_assessment` | Vulnerability and configuration assessment | moderate | `guided_only` | `configuration_snapshot`, `finding_reproduction` | No |
| `cve_intelligence_applicability_validation` | CVE intelligence and applicability validation | low | `pre_authorized` | `cve_applicability`, `service_version_fingerprint` | No |
| `credential_password_hash_assessment` | Credential, password, and hash assessment | high | `guided_only` | `session_command_outcome`, `finding_reproduction` | No |
| `authentication_testing` | Authentication testing | high | `guided_only` | `http_exchange`, `session_command_outcome` | No |
| `exploit_validation` | Exploit validation | high | `guided_only` | `exploit_validation_result`, `finding_reproduction` | No |
| `command_session_execution` | Command and session execution | high | `guided_only` | `session_command_outcome` | No |
| `target_file_write` | Target file upload or write | high | `guided_only` | `hashed_file_artifact`, `generated_script_validation` | No |
| `privilege_escalation` | Privilege escalation | critical | `guided_only` | `privilege_access_proof`, `exploit_validation_result` | No |
| `lateral_movement_pivoting` | Lateral movement and pivoting | critical | `guided_only` | `privilege_access_proof`, `session_command_outcome` | No |
| `active_directory_identity_operations` | Active Directory and identity operations | high | `guided_only` | `identity_ad_graph`, `privilege_access_proof` | No |
| `cloud_container_kubernetes_assessment` | Cloud, container, and Kubernetes assessment | high | `guided_only` | `cloud_container_scan`, `configuration_snapshot` | No |
| `reverse_engineering_binary_analysis` | Reverse engineering and binary analysis | moderate | `guided_only` | `binary_analysis`, `hashed_file_artifact` | No |
| `fuzzing_crash_discovery` | Fuzzing and crash discovery | high | `guided_only` | `binary_analysis`, `finding_reproduction` | No |
| `data_access_impact_validation` | Data-access impact validation | critical | `guided_only` | `privilege_access_proof`, `finding_reproduction` | No |
| `persistence` | Persistence | critical | `prohibited` | `session_command_outcome`, `finding_reproduction` | Yes |
| `cleanup_restoration` | Cleanup and restoration | high | `guided_only` | `session_command_outcome`, `configuration_snapshot` | No |
| `denial_of_service_disruption` | Denial of service or disruption | critical | `prohibited` | `session_command_outcome`, `finding_reproduction` | Yes |
| `destructive_modification` | Destructive data or system modification | critical | `prohibited` | `session_command_outcome`, `finding_reproduction` | Yes |
| `local_report_artifact_generation` | Local report and artifact generation | low | `pre_authorized` | `hashed_file_artifact`, `chain_of_custody` | No |

Risk labels above are stable product semantics. The runtime projection also attaches actual runtime risk-class IDs; both are shown so the UI can explain the product category and the enforcing runtime classification.

### Destructive policy

The canonical destructive-policy IDs are:

- `prohibited`
- `validate_without_executing`
- `bounded_lab_only`

An override that tries to pre-authorize a destructive/disruptive class is forced back to `prohibited` unless the policy is `bounded_lab_only`, at least one bounded destructive target is named, and every named target already exists in authorized scope. A bounded target outside authorization is rejected. No preset supplies target scope.

`validate_without_executing` permits the plan to document a path; it does not pre-authorize the destructive class itself.

### Preset policy deltas

Preset IDs are also the current mission-template IDs. Presets set the following classes to `pre_authorized`; all other classes resolve from their platform defaults.

| Preset | Pre-authorized set |
| --- | --- |
| `safe_recon` | `passive_intelligence_osint`, `dns_domain_certificate_discovery`, `active_host_discovery`, `port_service_enumeration`, `os_technology_fingerprinting`, `cve_intelligence_applicability_validation`, `local_report_artifact_generation` |
| `external_web_assessment` | Safe Recon plus `web_crawling_page_capture`, `web_content_endpoint_discovery_fuzzing`, `vulnerability_configuration_assessment` |
| `internal_network_assessment` | Safe Recon plus `vulnerability_configuration_assessment` |
| `active_directory_lab` | Safe Recon plus `vulnerability_configuration_assessment`, `active_directory_identity_operations` |
| `cloud_read_only` | `passive_intelligence_osint`, `dns_domain_certificate_discovery`, `cloud_container_kubernetes_assessment`, `cve_intelligence_applicability_validation`, `local_report_artifact_generation` |
| `full_authorized_lab_compromise` | Safe Recon plus web crawling, endpoint discovery, vulnerability assessment, credential assessment, authentication testing, exploit validation, command execution, target file write, privilege escalation, lateral movement, Active Directory, cloud/container/Kubernetes assessment, reverse engineering, fuzzing, data-access impact validation, and cleanup/restoration |
| `custom` | No preset additions; platform defaults still apply. |

Even the Full Authorized Lab Compromise preset does not pre-authorize `persistence`, `denial_of_service_disruption`, or `destructive_modification`.

### Autonomous readiness

Every pre-authorized class contributes a launch blocker when:

- its capability availability is not `supported`; or
- no locally enforced compatible executor path is ready.

The registry reports all blockers rather than silently downgrading a requested Autonomous promise. The operator may choose a compatible fallback, change the class to Guided-only or prohibited, repair the dependency, or change the contract. The runtime must re-evaluate readiness at launch and action time.

## Evidence Type Registry

### Canonical evidence types

| Canonical ID | Human label | Normally associated action classes |
| --- | --- | --- |
| `asset_discovery_proof` | Host or asset discovery proof | `passive_intelligence_osint`, `active_host_discovery` |
| `port_service_scan_result` | Port and service scan result | `port_service_enumeration` |
| `service_version_fingerprint` | Service and version fingerprint | `port_service_enumeration`, `os_technology_fingerprinting` |
| `os_platform_fingerprint` | OS, kernel, or platform fingerprint | `os_technology_fingerprinting` |
| `dns_certificate_record` | DNS or certificate record | `dns_domain_certificate_discovery` |
| `http_exchange` | HTTP request and response pair | `web_crawling_page_capture`, `authentication_testing` |
| `web_page_capture` | Web-page capture | `web_crawling_page_capture` |
| `endpoint_discovery_result` | Endpoint or content discovery result | `web_content_endpoint_discovery_fuzzing` |
| `configuration_snapshot` | Configuration snapshot | `vulnerability_configuration_assessment`, `cloud_container_kubernetes_assessment` |
| `cve_applicability` | CVE applicability evidence | `cve_intelligence_applicability_validation` |
| `exploit_validation_result` | Exploit-validation result | `exploit_validation`, `privilege_escalation` |
| `session_command_outcome` | Session or command outcome | `command_session_execution`, `cleanup_restoration` |
| `privilege_access_proof` | Privilege or access proof | `privilege_escalation`, `lateral_movement_pivoting`, `data_access_impact_validation` |
| `identity_ad_graph` | Identity or Active Directory graph evidence | `active_directory_identity_operations` |
| `cloud_container_scan` | Cloud, container, or cluster scan evidence | `cloud_container_kubernetes_assessment` |
| `binary_analysis` | Binary-analysis evidence | `reverse_engineering_binary_analysis`, `fuzzing_crash_discovery` |
| `hashed_file_artifact` | File or artifact with hash | `target_file_write`, `local_report_artifact_generation` |
| `generated_script_validation` | Generated-script source and validation | `target_file_write`, `command_session_execution` |
| `finding_reproduction` | Finding reproduction evidence | `vulnerability_configuration_assessment`, `exploit_validation` |
| `chain_of_custody` | Chain-of-custody record | `local_report_artifact_generation` |
| `operator_supplied` | Operator-supplied evidence | Explicitly classified operator input |

Each definition explains what it proves, storage/sensitivity implications, normal action relationships, whether an immutable hash is required, and whether chain of custody is required. The current definitions require both hash and chain of custody for verification.

### Intelligence stages

The canonical stages are:

- `engagement_log`
- `observation`
- `evidence_candidate`
- `verified_evidence`
- `artifact`

An artifact is a stored output. An observation is an attributable parsed statement. Neither is automatically verified evidence.

### Operational input classification

| Input kind | Default stages | Candidate behavior |
| --- | --- | --- |
| `raw_command_output` | `engagement_log` only | Never automatically becomes a candidate, even when it contains a matching string. |
| `structured_scan_result` | `engagement_log`, `artifact`; also `observation` when parsed and attributable | The classifier deliberately does not auto-promote the scan artifact to a candidate. |
| `screenshot` | `artifact` | May become `evidence_candidate` only after every candidate gate passes. |
| `http_exchange` | `engagement_log`; also `observation` when parsed and attributable | Requires a complete request/response pair and every candidate gate. |
| `generated_file` | `artifact` | Not automatically a candidate. A later explicit typed promotion path must classify its claim. |
| `operator_upload` | `artifact` | May become a candidate after every gate and explicit source attribution. |
| `parsed_observation` | `observation` when parsed and attributable | May become a candidate after every gate. |

Candidate gates are all required:

1. The input kind permits candidate promotion.
2. Policy explicitly allows a candidate.
3. Content is parsed.
4. The observation is attributable.
5. At least one provenance source ID exists.
6. An immutable hash exists.
7. An HTTP input has a complete request and response pair.

No classifier path automatically creates `verified_evidence`.

### Candidate verification

Verification requires:

- current stage `evidence_candidate`;
- evidence type matching the selected definition;
- immutable content hash;
- at least one provenance source;
- acquisition time;
- normalized target ID;
- complete chain of custody when required;
- a non-empty verification actor ID.

Finding verification then requires at least one linked verified evidence item and every type required by the immutable finding policy. An item counts only when it has `verified_evidence` stage, a hash, provenance, complete chain of custody, and an attributable verification actor. A raw log, candidate, artifact, or unreviewed “verified” flag cannot satisfy the gate.

## Deliverable Registry

The canonical deliverables are:

| Canonical ID | Label |
| --- | --- |
| `executive_summary` | Executive summary |
| `technical_findings` | Technical findings |
| `network_asset_map` | Network and asset map |
| `osi_application_stack_map` | OSI and application-stack map |
| `attack_path_visualization` | Attack-path visualization |
| `engagement_timeline` | Engagement timeline |
| `evidence_bundle` | Evidence bundle |
| `web_page_screenshot_gallery` | Web-page screenshot gallery |
| `cve_applicability_register` | CVE applicability register |
| `scripts_and_documentation` | Scripts and script documentation |
| `remediation_plan` | Remediation plan |
| `raw_technical_log_export` | Raw technical log export |
| `obsidian_engagement_pack` | Obsidian engagement pack |
| `machine_readable_export` | Machine-readable export |
| `pdf_html_markdown_report` | PDF, HTML, or Markdown report |

Definitions also record purpose, supported output formats, and sensitivity notes. Runtime manifests attach producer agents and tools. A deliverable is `unsupported` when no producer is declared, `unavailable` when producers exist but none is available, and `supported` when at least one declared producer is available.

The UI may recommend only registry entries. Custom text is an optional annotation, not a replacement for the stable ID used by readiness, reports, and tests.

## Mission Template Registry

All current templates are version `1`, support both canonical journeys, and carry an objective pattern, success criteria, action preset, scope hints, evidence defaults, deliverables, optional safe stops, agent capability recommendations, model requirements, and budget preset.

| Template ID | Label | Action preset | Budget | Optional safe-stop recommendation IDs |
| --- | --- | --- | --- | --- |
| `safe_recon` | Safe Recon | `safe_recon` | `standard` | `target_identity_mismatch`, `target_unreachable`, `service_instability_detected`, `budget_reached` |
| `external_web_assessment` | External Web Assessment | `external_web_assessment` | `standard` | `service_instability_detected`, `credential_attempt_threshold_reached`, `named_business_process_encountered`, `evidence_insufficient_to_proceed` |
| `internal_network_assessment` | Internal Network Assessment | `internal_network_assessment` | `deep` | `service_instability_detected`, `target_identity_mismatch`, `target_unreachable`, `required_dependency_unavailable` |
| `active_directory_lab` | Active Directory Lab | `active_directory_lab` | `deep` | `credential_attempt_threshold_reached`, `specified_high_value_objective_achieved`, `service_instability_detected` |
| `cloud_read_only` | Cloud Read-Only | `cloud_read_only` | `standard` | `target_identity_mismatch`, `required_dependency_unavailable`, `evidence_insufficient_to_proceed` |
| `full_authorized_lab_compromise` | Full Authorized Lab Compromise | `full_authorized_lab_compromise` | `deep` | `specified_high_value_objective_achieved`, `service_instability_detected`, `budget_reached`, `evidence_insufficient_to_proceed` |
| `custom` | Custom | `custom` | `custom` | `budget_reached`, `evidence_insufficient_to_proceed` |

The template application function:

- rejects a journey the template does not support;
- requires at least one supplied target;
- returns a copy of the supplied targets without additions or mutations;
- copies versioned objective, success criteria, evidence, and deliverable recommendations;
- provides an assertion that compares supplied and applied target scope exactly.

The registry reports unsupported recommended actions and unavailable evidence/deliverables from the live projection so the intake can explain fallbacks before launch.

## Model readiness and assignment

Canonical enforcement states:

| State | Meaning and journey use |
| --- | --- |
| `enforced_executor` | Authenticated local runtime can enforce the tool/action boundary. Required for pre-authorized Autonomous execution. |
| `observe_only_executor` | Calls can be observed but the complete action boundary is not enforced. May support represented Guided use; not an Autonomous executor. |
| `advisor_only` | Can plan, explain, critique, or summarize but cannot be represented as an executor. |
| `unavailable` | Authentication or provider health is unavailable. |

Readiness checks exact action compatibility, required disclosure class, tool calling, structured output, authentication, provider health, and catalog timestamp. Missing tool calling, structured output, or action compatibility reduces a path to `advisor_only`. Authentication or health failure produces `unavailable`. Autonomous adds an explicit failure reason for every non-enforced state.

An `AgentModelAssignment` pins:

- agent ID;
- primary provider/model;
- optional fallback provider/model;
- supported reasoning effort when selected;
- context policy;
- prompt-template hash;
- source: `inherited`, `recommended`, `manual_override`, or `research_verified`;
- resolution time;
- `pinned: true`.

An active run must not inherit later global catalog/configuration changes.

## Failure Taxonomy

Runtime components supply exact `(component, code) → category` mappings. Classification does not search raw error strings for keywords. Unknown exact codes remain `unknown`, non-retryable, and preserved for review.

### Bounded transient categories

Only categories explicitly marked transient receive `bounded_transient` retry policy:

- `transient_network`
- `provider_rate_limited`
- `provider_unavailable`
- `mcp_unavailable`
- `timeout`
- `worker_heartbeat_lost`
- `process_crash`
- `target_unreachable`

Retry remains subject to idempotency, action safety, budget, backoff, and circuit breakers.

### Never automatically retry

- `provider_refused`
- `missing_credential`
- `missing_dependency`
- `observe_only_enforcement_mismatch`
- `scope_policy_denial`
- `authorization_denied`
- `guided_decision_missing`
- `tool_deterministic_error`
- `invalid_input`
- `plan_dependency_unresolved`
- `insufficient_evidence`
- `repeated_no_progress_loop`
- `budget_exhausted`
- `restart_recovery_required`
- `migration_data_integrity`
- `operator_rejection`
- `cancelled`
- `unknown`

Every category has a human label, default human-readable reason, retry policy, and valid recovery actions selected from:

- `test_connection`
- `configure_dependency`
- `configure_credential`
- `use_compatible_fallback`
- `retry_bounded`
- `resume_checkpoint`
- `reassign`
- `amend_plan`
- `skip_step`
- `start_new_run`
- `terminate_gracefully`
- `review_scope`
- `supply_guided_decision`
- `reconcile_data`

A structured diagnosis also carries originating component, failed object, last success and raw-error references when known, retry history, progress made, preserved evidence/artifacts, automatic recovery attempts, objective impact, and exact valid recovery actions.

## Safe-stop policy

Safe stops and failure categories overlap operationally but are not interchangeable. A failure category explains what happened. A safe-stop rule explains why Autonomous must terminate or wait cleanly instead of expanding authority or looping.

Mandatory platform stops remain non-editable:

- target outside normalized scope;
- authorization or policy cannot be verified;
- action crosses a prohibited class;
- destructive/disruptive impact is detected where prohibited;
- secret or confidential data would cross an unapproved provider boundary;
- bounded repeated no-progress loop;
- cancellation;
- runtime, audit, or evaluator integrity failure.

The current template recommendation IDs are documented in the Mission Template Registry table. They are exact strings in the implemented templates, but a typed SafeStopRegistry with threshold schemas has not yet been implemented. Until that exists, an API must not accept arbitrary strings and imply that the runtime enforces them.

## Required transactional integration

Before a primary control can be called complete:

1. Load real runtime manifests and build one projection.
2. Store its version/hash with preflight.
3. Resolve the template and action matrix from that projection.
4. Validate every action/evidence/deliverable ID against the canonical catalog.
5. Enforce destructive-target subset rules.
6. Evaluate per-agent provider/model readiness and disclosure.
7. Generate the complete contract from minimal operator input.
8. Present every inferred value and blocker.
9. Hash and persist the reviewed resolved contract.
10. Revalidate scope, action class, provider/tool health, and control-plane ownership at action time.
11. Route operational inputs through evidence classification and auditable verification gates.
12. Recompute finding validity from linked verified evidence.

The UI is a projection of this contract. Disabled controls alone do not enforce it.

## Known integration gaps

The present pure-domain layer intentionally has no React, database, HTTP, provider, MCP, or legacy dependencies. Integration work remains:

- Current Autonomous and Guided intake components still use required blank free text for values the registries can resolve.
- Current mission API types accept arbitrary action, evidence, deliverable, and safe-stop strings.
- The mission API destructive literals do not yet match the canonical three-state destructive policy.
- A typed, threshold-aware SafeStopRegistry and a numeric BudgetPresetRegistry do not yet exist.
- Runtime manifests still need a single production adapter and manifest/version receipt; fixtures prove the algorithm only.
- Per-agent model selection, assignment pinning, disclosure receipt, and live catalog freshness are not persisted end to end.
- Evidence classifier and finding gates are not yet wired transactionally into ingestion, Intelligence mutations, reports, or the Vault.
- Deliverable producer readiness does not yet launch report/artifact jobs.
- Templates are not yet exposed as registry-backed intake product data.
- Action-time enforcement must integrate the signed resolved registry, normalized target scope, supervisor, and control-plane lease.
- Imported legacy string values need explicit adapters, reconciliation, and quarantine for unknown IDs.
- Interaction-manifest, browser, accessibility, route-crawl, visual, restart, soak, and legacy non-regression evidence remain required.

These gaps are release blockers, not permission to duplicate the catalog in the UI.
