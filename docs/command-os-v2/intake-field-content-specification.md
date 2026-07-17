# Command OS V2.4 intake field and content specification

Status: registry-backed product contract, 2026-07-16. This document describes the required intake behavior and distinguishes it from the integration that exists today. Canonical IDs and current pure-domain rules were verified against:

- `chillspwn/plugin/command-os-v2/server/domain/catalog-ids.ts`
- `chillspwn/plugin/command-os-v2/server/domain/action-class-registry.ts`
- `chillspwn/plugin/command-os-v2/server/domain/evidence-type-registry.ts`
- `chillspwn/plugin/command-os-v2/server/domain/deliverable-registry.ts`
- `chillspwn/plugin/command-os-v2/server/domain/mission-template-registry.ts`
- `chillspwn/plugin/command-os-v2/server/domain/model-readiness.ts`
- `chillspwn/plugin/command-os-v2/server/domain/source-manifest-adapters.ts`

The V2 intake is a contract builder, not a collection of blank text areas. The operator supplies authorization and target scope. Templates, registries, confirmed preferences, and live runtime manifests supply safe defaults. Every generated value remains visible and editable before launch, but no generated value may add a target.

## Minimal launch contract

The only information that must be authored or deliberately supplied by the operator is:

1. `journey`: exactly `autonomous` or `guided`.
2. A fresh authorization acknowledgement for this mission.
3. At least one target or environment reference supplied by the operator.

The supported target types are exactly `host`, `cidr`, `url`, `domain`, `cloud_account`, `scope_file`, `engagement`, and `lab_environment` in the registry foundation. A template may configure behavior only within these supplied targets. It may never add, broaden, infer, or silently normalize a new target into authorization.

The resolved API contract still needs non-empty values for items such as title, objective, success criteria, deliverables, budgets, and action policy. “Optional” below means optional for the operator: the intake resolver must generate the resolved value before preflight rather than send an incomplete contract.

## Exactly two journeys

| Journey ID | Entry label | Promise | Intake consequence | Runtime consequence |
| --- | --- | --- | --- | --- |
| `autonomous` | Go Autonomous | ChillsPwn plans, delegates, executes, recovers, validates, and reports inside one reviewed contract. | Build and hash a complete enforceable contract before launch. | A `guided_only` action must cause an in-scope alternative or safe stop. It must not create a routine approval wait. A `prohibited` action is denied. |
| `guided` | Start Guided Mission | ChillsPwn explains one bounded next step, waits for a deliberate choice, interprets the result, records it, and advances. | Keep intake lightweight; expose the structured contract as secondary detail. | Every consequential agent-run action requires a represented exact-step decision. |

`ask`, `direct`, `observe`, provider-specific paths, and approval strategies are not journeys. The domain validator rejects them. Provider choice, explanation, observation, and administrative approval are capabilities inside one of the two journeys.

## Content rules for every control

Every field or structured control must provide:

- a plain-language label and one-sentence purpose;
- at least one realistic example for free text;
- an explicit `Optional` marker when the operator can rely on a generated value;
- the resolved default and its source: platform, template, confirmed preference, runtime recommendation, or operator override;
- `Why is this needed?` help for authorization, policy, evidence, memory, provider disclosure, and budgets;
- inline correction guidance, never a generic “Invalid input” message;
- preserved state across steps, refresh, back/forward navigation, and draft restoration;
- a final review diff that identifies every inferred value;
- a stable accessible name, keyboard operation, focus behavior, and 44×44 CSS-pixel target.

Free text is appropriate for the human objective, an optional title, notes, and a custom criterion or deliverable. Known action classes, evidence types, deliverables, templates, target types, provider/model choices, risk states, and safe stops must be structured controls.

## Shared intake fields

| Field | Purpose | Control and example | Resolved default | Operator requirement |
| --- | --- | --- | --- | --- |
| Journey | Select the execution contract. | Two visible cards: **Go Autonomous** and **Start Guided Mission**. | Confirmed preferred journey when memory consent permits; otherwise show both with neither hidden. | Required deliberate selection. Only `autonomous` or `guided` is valid. |
| Authorization acknowledgement | Confirm the supplied targets and represented actions are authorized. | Checkbox with the normalized target summary: “I confirm I am authorized to assess `https://portal.example.test`.” | Never inherited or preselected. | Always required and fresh for each mission. |
| Target or environment | Establish the only scope a template may operate inside. | Typed chips or imported scope: `10.10.10.0/24`, `web-01`, `https://portal.example.test`, cloud project `lab-project-7`. | No target is generated. Type detection may suggest a type but must show it. | At least one included target or environment reference is required. |
| Template | Supply an objective pattern and safe recommended defaults. | Registry cards: Safe Recon, External Web Assessment, Internal Network Assessment, Active Directory Lab, Cloud Read-Only, Full Authorized Lab Compromise, Custom. | Recommend from target type, but use `safe_recon` when no stronger evidence exists. Never apply a broader template silently. | Optional. Selection does not grant authorization. |
| Engagement | Isolate memory, history, retention, and imported context. | Existing engagement picker, for example `eng_customer_portal_q3`. | New isolated engagement when none is selected. | Optional unless `engagement_memory` is selected. |
| Environment classification | Tune safe defaults without changing target scope. | Client, internal lab, CTF/HTB, cloud sandbox, or local fixture. | Conservative client-like handling until explicitly classified. | Optional; lab-only policy requires an explicit disposable-lab classification. |
| Data classification | Control storage and public-provider disclosure. | Public, internal, private, confidential, regulated, or secret according to system policy. | `private` / local-only behavior until a policy says otherwise. | Optional to edit; a conservative resolved value is mandatory. |
| Excluded targets | Name systems that must never be touched. | Exclusion chips such as `payments.example.test` or `10.10.10.5/32`. | Empty. | Optional, but included and excluded normalized targets must not overlap. |
| Engagement window | Bound when actions may run. | UTC-aware range with rendered local zone, for example `2026-07-18 09:00–17:00 UTC`. | Mission budget and current authorization window. | Optional unless authorization is time-bound. |
| Save draft | Preserve intake independently of mission launch. | `Save draft`, automatic local draft, and `Discard draft`. | Namespaced V2 draft storage. | Optional action; data loss on step changes or refresh is forbidden. |

## Autonomous contract fields

### Outcome

| Field | Purpose | Example or choices | Resolved default | Operator requirement |
| --- | --- | --- | --- | --- |
| Mission title | Human-readable dashboard, report, Vault, and search label. Stable IDs do not change when it is edited. | `Q3 External Web Assessment — Customer Portal` | Generate from template label, primary target label, and date. | Optional to author; resolved title must be non-empty. |
| Authorized objective | State the outcome, not a command dump. It cannot broaden target scope. | Safe Recon’s implemented pattern: “Map the supplied authorized scope, identify reachable assets and services, validate important fingerprints, and produce evidence-backed reconnaissance outputs without destructive actions.” | Selected template’s versioned `objectivePattern`. | Optional to author; show the generated interpretation before launch. |
| Success criteria | Define evaluation targets and partial completion. | Chips such as “All supplied targets are discovered or explicitly reported unreachable” and “Every verified finding is linked to required evidence.” | Selected template’s versioned criteria. | Optional to author. Custom chips may be added, removed, or marked not applicable. At least one resolved criterion is required. |
| Final deliverables | Define the output package. | Checklist backed by the 15 canonical deliverable IDs; see `registries-and-policy.md`. | Template recommendations, filtered by live producer readiness. | Optional to select. Unsupported items show why and a compatible alternative; at least one resolved deliverable is required. |

### Authorization and normalized scope

| Field | Purpose | Example or choices | Resolved default | Operator requirement |
| --- | --- | --- | --- | --- |
| Allowed targets | Establish the included scope used by every action-time check. | Typed chips: URL, domain, host, CIDR, cloud account, scope file, engagement, or lab environment. | Exact copy of the operator-supplied targets. | At least one is required. Deduplication may remove exact equivalents but must not expand scope. |
| Prohibited targets | Add explicit negative scope. | `10.10.10.5/32`, `admin.third-party.example`. | Empty. | Optional. Any overlap is a blocking error with the conflicting values shown. |
| Imported scope file | Add many operator-supplied boundaries with provenance. | Burp scope JSON, newline list, or engagement scope export. | None. | Optional. Preview every parsed target and quarantine malformed rows. |
| Engagement ID | Link the mission to isolated context and history. | `eng_lab_ad_01`. | Selected engagement or a new stable ID. | Optional unless engagement memory is permitted. |
| Time window | Preserve an authorization time constraint. | ISO/UTC range rendered in the user’s zone. | Omit when the authorization has no declared window. | Optional; a supplied window is enforceable. |
| Credential-use constraints | State which supplied credentials may be used, where, and how often. | “Use `cred_ref_12` only against `dc01.lab.test`; no password spraying.” | No credential use. | Optional. Secret values are references, never reusable memory or free-text contract content. |

### Action policy

| Field | Purpose | Choices or example | Resolved default | Operator requirement |
| --- | --- | --- | --- | --- |
| Action policy preset | Resolve known action classes without free text. | `safe_recon`, `external_web_assessment`, `internal_network_assessment`, `active_directory_lab`, `cloud_read_only`, `full_authorized_lab_compromise`, `custom`. | Template’s `actionPolicyPresetId`; fallback `safe_recon`. | Optional. |
| Per-class state | Decide whether a canonical class may execute. | `pre_authorized`, `prohibited`, `guided_only`, or input-only `inherited_default`. | Preset state, then platform default. The built registry never leaves a resolved class as `inherited_default`. | Optional overrides. One class can have exactly one state. |
| Destructive-action policy | Put a separately visible bound around disruptive/destructive behavior. | `prohibited`, `validate_without_executing`, `bounded_lab_only`. | `prohibited`. | Optional. `bounded_lab_only` also requires named bounded targets that are already in allowed scope. |
| Bounded destructive targets | Limit a lab-only exception to exact disposable assets. | `lab-vm-03`; never a newly inferred network. | Empty. | Required only when a destructive/disruptive class is explicitly pre-authorized under `bounded_lab_only`. Every value must already be authorized. |

The current domain marks `persistence`, `denial_of_service_disruption`, and `destructive_modification` as destructive or disruptive and prohibited by platform default. A preset alone cannot enable them. If an invalid pre-authorization is attempted, the builder forces the class to `prohibited` and records a launch blocker.

### Evidence and stops

| Field | Purpose | Example or choices | Resolved default | Operator requirement |
| --- | --- | --- | --- | --- |
| Evidence requirements | Select what the mission should retain for its actions and claims. | Registry checklist such as `http_exchange`, `web_page_capture`, `service_version_fingerprint`, or `cve_applicability`. | Union of selected action-class defaults and template recommendations, filtered by producer readiness. | Optional. An empty operator selection applies defaults. Immutable finding policy remains mandatory. |
| Optional mission safe stops | Stop cleanly on mission-specific conditions. | Structured IDs listed below, with human explanations and thresholds. | Template recommendations. | Optional. Leaving them unchanged does not block launch. |
| Mandatory platform stops | Prevent scope, policy, privacy, integrity, or loop violations. | Outside normalized scope, authorization unavailable, prohibited action, forbidden destructive impact, forbidden provider disclosure, bounded no-progress loop, cancellation, runtime/evaluator integrity failure. | Always enabled and not removable. | Not an editable field. |
| Finding evidence policy | Prevent unsupported verified claims. | Required evidence-type checklist per finding class. | Immutable policy based on finding/action type. | Not weakenable. A mission preference may require more evidence, never less. |

The exact optional recommendation IDs currently emitted by versioned templates are:

| ID | Purpose and example condition | Recommended by default for |
| --- | --- | --- |
| `target_identity_mismatch` | Stop when observed identity conflicts with the reviewed target, such as a certificate or cloud account belonging to another organization. | Safe Recon, Internal Network, Cloud Read-Only |
| `target_unreachable` | Stop or close the affected path after the bounded reachability policy is exhausted. | Safe Recon, Internal Network |
| `service_instability_detected` | Stop before continuing traffic when error rate, latency, availability, or lockout signals indicate harm. | Safe Recon, External Web, Internal Network, Active Directory Lab, Full Authorized Lab Compromise |
| `budget_reached` | Stop when a signed time, token, cost, retry, replan, storage, or action ceiling is reached. | Safe Recon, Full Authorized Lab Compromise, Custom |
| `credential_attempt_threshold_reached` | Stop before exceeding the reviewed login, spray, or lockout threshold. | External Web, Active Directory Lab |
| `named_business_process_encountered` | Stop when the run reaches a named sensitive workflow, such as payment or production release processing. | External Web |
| `evidence_insufficient_to_proceed` | Stop when the next action cannot be justified from attributable evidence. | External Web, Cloud Read-Only, Full Authorized Lab Compromise, Custom |
| `required_dependency_unavailable` | Stop when a required MCP server, provider, credential reference, tool, or lab dependency has no safe fallback. | Internal Network, Cloud Read-Only |
| `specified_high_value_objective_achieved` | Stop at the agreed proof boundary instead of continuing after the mission objective is demonstrated. | Active Directory Lab, Full Authorized Lab Compromise |

The V2.4 product contract also requires structured conditions for exploitability remaining ambiguous after a bounded number of materially different alternatives and for encountering a named system. These conditions do not yet have canonical IDs in the implemented template registry; they must be added through a versioned SafeStopRegistry rather than accepted as arbitrary free text.

Each must render as understandable copy, a threshold or condition where relevant, its effect, and resumability. A safe stop is not a generic `blocked` state: it preserves the checkpoint, evidence, artifacts, diagnosis, and valid next actions.

### Budgets and operational policy

| Field | Purpose | Example or choices | Resolved default | Operator requirement |
| --- | --- | --- | --- | --- |
| Budget preset | Set related limits coherently. | Quick, Standard, Deep, Custom. Canonical IDs are `quick`, `standard`, `deep`, `custom`. | Template value: Safe Recon, External Web, and Cloud Read-Only use `standard`; Internal Network, Active Directory Lab, and Full Authorized Lab Compromise use `deep`; Custom uses `custom`. | Optional. |
| Time budget | Bound wall-clock work. | `60 minutes`. | Current preview form uses 60 minutes until numeric preset mappings are implemented. | Optional to edit; a positive resolved limit is mandatory. |
| Token budget | Bound public-model usage. | `250000`. | Provider/preset recommendation; omitted only if the runtime can enforce a stricter inherited ceiling. | Optional to edit. |
| Cost budget | Bound estimated provider cost. | `25.00`. | Provider/preset recommendation; absence must be explained if exact accounting is unavailable. | Optional to edit. |
| Retry budget | Bound justified transient retries. | `2`. | Current preview default `2`. | Optional to edit; zero is valid. |
| Replan budget | Bound materially different replans. | `2`. | Current preview default `2`. | Optional to edit; zero is valid. |
| Concurrency limit | Prevent resource contention and unsafe parallel action. | `3`. | Current preview default `3`. | Optional to edit; at least one. |
| Evidence storage | Bound immutable evidence metadata/content use. | `64 MiB`. | Current preview default `64 MiB`. | Optional to edit; a positive resolved ceiling is mandatory. |
| Artifact storage | Bound screenshots, scripts, reports, and raw files. | `256 MiB`. | Current preview default `256 MiB`. | Optional to edit; a positive resolved ceiling is mandatory. |
| Tool-call and provider-turn ceilings | Bound runtime actions independently of time and cost. | `500 tool calls`, `200 provider turns`. | Budget preset. | Optional to edit; not yet represented by the current mission request. |
| Screenshot and artifact-size ceilings | Bound capture volume and individual files. | `50 captures`, `25 MiB per artifact`. | Template and storage preset. | Optional to edit; not yet represented separately by the current request. |
| Notification policy | Define operator notifications without creating a runtime dependency. | In-product semantic events, safe stops, completion, failure. | Current enforceable API literal `in_app_only`. | Optional preference; unsupported channels may not appear enforceable. |
| Reporting format | Pin the canonical completion package. | Command OS JSON plus selected derived deliverables. | Current enforceable API literal `command_os_json`. | Derived exports are optional; the canonical local package is mandatory. |
| Data handling policy | Keep canonical evidence and artifacts in the approved data plane. | Local private. | Current enforceable API literal `local_private`. | Not weakenable by a preference. |
| Retention policy | State who controls expiry while preserving audit requirements. | Operator managed. | Current enforceable API literal `operator_managed`. | Optional future schedules; current literal is fixed. |
| Provider policy | Restrict Autonomous execution to enforcing paths. | Automatic enforcing paths only. | Current API literal `automatic_enforcing_only`. | Fixed for Autonomous preview. |
| Tool policy | Restrict tools and targets to the signed allowlist. | Contract allowlist. | Current API literal `contract_allowlist`. | Fixed for Autonomous preview. |

### Team, models, and readiness

| Field | Purpose | Example or choices | Resolved default | Operator requirement |
| --- | --- | --- | --- | --- |
| Specialist pool | Pin which real agents may receive assignments. | Registry recommendations such as reconnaissance, web, Active Directory, cloud, credentials, vulnerability intelligence, or reporting specialists. | Compatible recommended agents from live manifests. | Optional to choose when a safe team can be recommended; the resolved signed pool must contain a compatible specialist for every pre-authorized class. |
| Primary model | Pin the provider and exact model for an agent. | Live catalog entry `provider/model`. | Healthy compatible enforcing recommendation. | Optional override; exact resolved provider/model is mandatory. |
| Fallback model | Provide a policy-compatible alternative. | Another live catalog entry with the same disclosure and enforcement compatibility. | Best compatible fallback, or none with a visible limitation. | Optional. |
| Reasoning effort | Configure supported reasoning intensity. | Low, medium, high when present in the live catalog. | Agent/mission recommendation. | Optional; only display values actually declared by the provider model. |
| Context policy | Limit what Context Pack content the model may receive. | `internal_sanitized`; local-only nodes remain excluded. | Mission data/disclosure policy. | Not weakenable. |
| Model source | Explain inheritance and reproducibility. | `inherited`, `recommended`, `manual_override`, `research_verified`. | `recommended` for generated assignments. | Read-only provenance after resolution. |
| Readiness state | Explain whether the route may execute. | `enforced_executor`, `observe_only_executor`, `advisor_only`, `unavailable`. | Derived from live authentication, health, catalog, tool calling, structured output, action compatibility, and disclosure class. | Read-only. Autonomous pre-authorized work requires `enforced_executor`. |
| Catalog freshness | Prevent stale model assumptions. | “Observed 2026-07-16 10:03 UTC.” | Latest live provider catalog timestamp. | Read-only; stale data is a warning or blocker according to policy. |

Every running assignment must be pinned. Later global provider changes must not silently alter the run.

### Brain context and final review

| Field | Purpose | Example or choices | Resolved default | Operator requirement |
| --- | --- | --- | --- | --- |
| Memory scopes | Bound which retained knowledge may be considered. | Current supported values: `confirmed_preferences`, `verified_lessons`, `engagement_memory`. | Confirmed preferences and verified lessons permitted by the operator’s Brain policy; engagement memory only for a selected engagement. | Optional. `engagement_memory` requires an engagement ID. |
| Context node IDs | Select exact inspectable memories for preflight. | `mem_preference_explanation_depth`, `lesson_recon_timeout_01`. | Relevant eligible confirmed/verified nodes; no relevant memory produces an empty selection and explicit explanation. | Optional. IDs require at least one permitted memory scope. |
| Public-provider disclosure summary | Show which context is local-only or sanitized for an external model. | “2 internal-sanitized nodes; 3 local-only nodes excluded.” | Derived from memory sensitivity and provider disclosure policy. | Read-only and mandatory to review when public models are used. |
| Contract version and hash | Bind launch authority to the exact reviewed values. | Version `1`, lowercase SHA-256 digest. | Issued by server preflight. | Required for launch after review; any edit invalidates it. |
| Inferred-values summary | Make generated defaults transparent. | “Title generated from template and target; five evidence defaults inherited.” | Diff from minimal operator input to resolved contract. | Read-only; every inferred value must be inspectable before launch. |
| Readiness limitations | Explain every impossible or degraded promise. | “`web_crawling_page_capture` is unavailable because the mapped MCP server is offline.” | Live projection and preflight. | Every blocker requires impact and direct remediation. |

## Guided intake fields

Guided creation uses the same authorization, scope, registry, evidence, and memory foundations but does not require the operator to complete the Autonomous contract wizard.

| Field | Purpose | Example or choices | Resolved default | Operator requirement |
| --- | --- | --- | --- | --- |
| Authorization acknowledgement | Confirm this target and work are authorized. | “I confirm this Guided mission is authorized.” | Never preselected. | Required. |
| Target or environment | Establish the scope for the first explanation and step. | `https://portal.example.test`, `10.10.10.0/24`, `lab-ad-01`. | No generated target. | At least one is required by the product contract. |
| Mission title | Label durable mission state. | `Guided Customer Portal Review`. | Generate from target, template, and date. | Optional to author; resolved value required. |
| Authorized objective | Tell the guide what the assessment should establish. | External Web template pattern or “Explain and validate the approved login authorization boundary.” | Template pattern tailored only to the supplied target. | Optional to author; the first response must restate the conservative interpretation. |
| Engagement | Scope memory and history. | `eng_customer_portal_q3`. | New isolated engagement or selected existing engagement. | Optional unless engagement memory is used. |
| Explanation depth | Adapt terminology and detail. | `concise`, `balanced`, `deep`. | Confirmed preference when allowed; otherwise `balanced`. | Optional. |
| Execution preference | Decide who runs a represented step. | `manual` or `single_step_agent`. | Confirmed scoped preference when allowed; otherwise `manual`. | Optional. It never grants authority for more than one represented action. |
| Evidence expectations | Add mission-specific evidence preferences. | `Capture complete HTTP request and response pairs for verified web findings.` | Template and action-class evidence defaults. | Optional. Immutable finding policy still applies. |
| Report expectations | Select desired completion outputs. | Technical findings, remediation plan, evidence bundle. | Template deliverables. | Optional; not yet represented in the current Guided request type. |
| Advanced contract | Inspect or tighten action classes, evidence, safe stops, budgets, team, model, and memory. | Collapsible structured registries. | Safe Guided proposal policy. | Optional; never force Guided through the full Autonomous form. |

The first Guided response must state the authorized objective, current phase, proposed path, why it fits, assumptions and uncertainty, one recommended next step, and expected evidence. It must then wait. `single_step_agent` is a preference, not standing authorization: normalized action parameters require a visible decision and any material change requires another decision.

## Default resolution order

Defaults resolve in this order, with the final review recording each source:

1. Non-editable platform authorization, privacy, evidence-integrity, and safe-stop invariants.
2. Exact operator-supplied target and exclusions.
3. Explicit template version; otherwise a conservative template recommendation.
4. Confirmed, permitted, correctly scoped operator preferences.
5. Template action, evidence, deliverable, safe-stop, team-capability, model-requirement, and budget recommendations.
6. Live runtime projection of risk classes, tools, MCP servers, agents, providers, model catalogs, producer availability, and enforcement compatibility.
7. Operator overrides that do not weaken mandatory policy.
8. Server preflight, normalized review, version, and hash.

An unavailable optional specialist or preferred model may be replaced only by a visible compatible fallback. A missing capability that makes a pre-authorized Autonomous class impossible blocks launch. Guided may still explain an unavailable action and recommend a manual or alternative approach when policy permits.

## Validation and recovery copy

Errors identify the exact value, impact, and correction. Required examples:

- “`10.10.10.5/32` appears in both allowed and prohibited targets. Remove it from one list.”
- “Web crawling is pre-authorized, but the mapped MCP server is offline. Test the connection, choose Guided-only, or prohibit this class.”
- “This model is observe-only and cannot enforce Autonomous scope. Use the compatible enforced fallback.”
- “`engagement_memory` requires an engagement ID. Select an engagement or remove that memory scope.”
- “The bounded destructive target `lab-vm-03` is not in authorized scope. Add it through the authorization step or remove the exception.”

No intake error may be rendered only as “Invalid input,” “Blocked,” or “Something went wrong.”

## Known integration gaps

The pure registry foundation and its 25 passing unit tests establish the contract, but the current preview intake is not yet compliant with this specification:

1. `AutonomousContractPage.tsx` still requires operator-authored title, objective, success criteria, deliverables, allowed action classes, and safe stops. Several are blank multiline text areas. It does not consume the template, action, evidence, or deliverable registries.
2. `GuidedMissionCreatePage.tsx` currently requires operator-authored title and objective while marking the target optional. This is the reverse of the minimal launch contract and must be corrected.
3. `server/missions/types.ts` and `server/missions/validation.ts` currently accept arbitrary strings for action classes, evidence requirements, deliverables, and safe stops rather than canonical registry IDs and versioned resolved records.
4. The current request uses destructive policy literals `prohibited | contract_only`; the domain registry uses `prohibited | validate_without_executing | bounded_lab_only`. The API, database, UI, and compatibility adapter need a versioned migration.
5. Structured target chips, target-type records, normalized-scope preview, scope-file import, and public/private mismatch detection are not yet connected to mission creation.
6. Numeric mappings for Quick, Standard, and Deep budgets are not yet a canonical versioned registry. The present preview values are 60 minutes, two retries, two replans, concurrency three, 64 MiB evidence, and 256 MiB artifacts.
7. Tool-call, provider-turn, screenshot-count, per-artifact, and total cost/token accounting are not all represented in the current mission intake payload.
8. Template safe-stop recommendation strings are present, but there is not yet a typed SafeStopRegistry with thresholds, mandatory platform-stop records, or UI controls.
9. Runtime capability projection is not yet the sole source for the intake action/evidence/deliverable matrices. Current readiness code and the new projection need one audited integration boundary.
10. Model readiness types are implemented, but per-agent primary/fallback model controls, disclosure-class review, catalog freshness, and pinned assignment persistence are not yet connected end to end.
11. Evidence classification and verification gates are pure-domain functions; ingestion, database promotion, audit records, report claims, and Intelligence UI mutations still need to call them transactionally.
12. Draft save/restore, inferred-value diff, structured examples, screen-reader validation, mobile wizard behavior, and full interaction-manifest coverage remain release-gated work.

Until these gaps close, the registry tests prove the domain invariants only. They do not prove that the current intake UI or API enforces the complete V2.4 product contract.
