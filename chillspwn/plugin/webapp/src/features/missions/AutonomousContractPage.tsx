import { type FormEvent, useMemo, useRef, useState } from "react";
import { createMission, fetchOverview, preflightAutonomousMission } from "../../data/api/commandOs";
import { ApiError } from "../../data/api/client";
import { useQuery, useQueryCache } from "../../data/cache/QueryProvider";
import { Button, ButtonLink, Card, ErrorPanel, PageHeader, StatusPill } from "../../design-system/components/Primitives";
import type { AutonomousContextCandidate, AutonomousMissionPreflight, AutonomousMissionRequest } from "../../domain/types/commandOs";
import { useNavigation } from "../../app/router/navigation";
import { lines, optionalPositive, requestKey, safeNextUrl } from "./formUtils";

const STEPS = ["Outcome", "Authorization", "Operating contract", "Team & readiness", "Context", "Review"];

interface FormState {
  title: string;
  objective: string;
  successCriteria: string;
  deliverables: string;
  engagementId: string;
  allowedTargets: string;
  prohibitedTargets: string;
  timeWindow: string;
  authorizationConfirmed: boolean;
  allowedActionClasses: string;
  prohibitedActionClasses: string;
  destructivePolicy: "prohibited" | "contract_only";
  evidenceRequirements: string;
  safeStopConditions: string;
  timeBudgetMinutes: number;
  tokenBudget: string;
  costBudget: string;
  retryBudget: number;
  replanBudget: number;
  concurrencyLimit: number;
  evidenceStorageBudgetMb: number;
  artifactStorageBudgetMb: number;
  specialistAgentIds: string[];
  contextNodeIds: string[];
}

const INITIAL_STATE: FormState = {
  title: "",
  objective: "",
  successCriteria: "",
  deliverables: "",
  engagementId: "",
  allowedTargets: "",
  prohibitedTargets: "",
  timeWindow: "",
  authorizationConfirmed: false,
  allowedActionClasses: "",
  prohibitedActionClasses: "",
  destructivePolicy: "prohibited",
  evidenceRequirements: "",
  safeStopConditions: "",
  timeBudgetMinutes: 60,
  tokenBudget: "",
  costBudget: "",
  retryBudget: 2,
  replanBudget: 2,
  concurrencyLimit: 3,
  evidenceStorageBudgetMb: 64,
  artifactStorageBudgetMb: 256,
  specialistAgentIds: [],
  contextNodeIds: [],
};

function validateStep(step: number, form: FormState): string[] {
  const errors: string[] = [];
  if (step === 0) {
    if (!form.title.trim()) errors.push("Mission title is required.");
    if (!form.objective.trim()) errors.push("Objective is required.");
    if (lines(form.successCriteria).length === 0) errors.push("Add at least one measurable success criterion.");
    if (lines(form.deliverables).length === 0) errors.push("Add at least one final deliverable.");
  }
  if (step === 1) {
    if (!form.authorizationConfirmed) errors.push("You must confirm authorization before launch.");
    if (lines(form.allowedTargets).length === 0) errors.push("Add at least one allowed target or target boundary.");
  }
  if (step === 2) {
    if (lines(form.allowedActionClasses).length === 0) errors.push("Add at least one pre-authorized action class.");
    if (lines(form.safeStopConditions).length === 0) errors.push("Add at least one safe-stop condition.");
    if (!Number.isFinite(form.timeBudgetMinutes) || form.timeBudgetMinutes < 1) errors.push("Time budget must be at least one minute.");
    if (form.retryBudget < 0 || form.replanBudget < 0) errors.push("Retry and replan budgets cannot be negative.");
    if (form.concurrencyLimit < 1) errors.push("Concurrency limit must be at least one.");
    if (!Number.isSafeInteger(form.evidenceStorageBudgetMb) || form.evidenceStorageBudgetMb < 1) errors.push("Evidence storage budget must be at least 1 MiB.");
    if (!Number.isSafeInteger(form.artifactStorageBudgetMb) || form.artifactStorageBudgetMb < 1) errors.push("Artifact storage budget must be at least 1 MiB.");
  }
  if (step === 3 && form.specialistAgentIds.length === 0) {
    errors.push("Select at least one compatible specialist for the signed assignment pool.");
  }
  return errors;
}

export default function AutonomousContractPage() {
  const { navigate } = useNavigation();
  const queryCache = useQueryCache();
  const overview = useQuery("command-os-overview", fetchOverview);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(INITIAL_STATE);
  const [errors, setErrors] = useState<string[]>([]);
  const [submitError, setSubmitError] = useState<Error>();
  const [submitting, setSubmitting] = useState(false);
  const [preflighting, setPreflighting] = useState(false);
  const [preflightError, setPreflightError] = useState<Error>();
  const [contextCandidates, setContextCandidates] = useState<AutonomousContextCandidate[]>([]);
  const [executionPreview, setExecutionPreview] = useState<AutonomousMissionPreflight["execution"]>();
  const [contractReview, setContractReview] = useState<AutonomousMissionPreflight>();
  const idempotencyKey = useRef(requestKey());
  const readinessChecks = overview.data?.readiness.checks.filter((check) => check.journeys.includes("autonomous")) ?? [];
  const readinessBlocked = !overview.data || overview.data.readiness.status === "blocked" || readinessChecks.some((check) => check.status === "fail");

  const selectedContext = useMemo(() => {
    const selected = new Set(form.contextNodeIds);
    return contextCandidates.filter((candidate) => selected.has(candidate.id));
  }, [contextCandidates, form.contextNodeIds]);
  const memoryScopes = useMemo(() => [...new Set([
    selectedContext.some((candidate) => candidate.nodeType === "preference") ? "confirmed_preferences" : undefined,
    selectedContext.some((candidate) => candidate.nodeType === "lesson") ? "verified_lessons" : undefined,
    selectedContext.some((candidate) => candidate.scope.kind === "engagement") ? "engagement_memory" : undefined,
  ].filter((value): value is string => Boolean(value)))], [selectedContext]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setContractReview(undefined);
    setForm((current) => ({ ...current, [key]: value }));
  };
  const request = (review?: AutonomousMissionPreflight["contract"]): AutonomousMissionRequest => ({
    journey: "autonomous",
    launch: true,
    title: form.title.trim(),
    objective: form.objective.trim(),
    successCriteria: lines(form.successCriteria),
    authorization: {
      engagementId: form.engagementId.trim() || undefined,
      allowedTargets: lines(form.allowedTargets),
      prohibitedTargets: lines(form.prohibitedTargets),
      authorizationConfirmed: form.authorizationConfirmed,
      timeWindow: form.timeWindow.trim() || undefined,
    },
    contract: {
      allowedActionClasses: lines(form.allowedActionClasses),
      prohibitedActionClasses: lines(form.prohibitedActionClasses),
      destructivePolicy: form.destructivePolicy,
      evidenceRequirements: lines(form.evidenceRequirements),
      timeBudgetMinutes: form.timeBudgetMinutes,
      tokenBudget: optionalPositive(form.tokenBudget),
      costBudget: optionalPositive(form.costBudget),
      retryBudget: form.retryBudget,
      replanBudget: form.replanBudget,
      concurrencyLimit: form.concurrencyLimit,
      evidenceStorageBudgetBytes: form.evidenceStorageBudgetMb * 1024 * 1024,
      artifactStorageBudgetBytes: form.artifactStorageBudgetMb * 1024 * 1024,
      notificationPolicy: "in_app_only",
      reportingFormat: "command_os_json",
      dataHandlingPolicy: "local_private",
      retentionPolicy: "operator_managed",
      providerPolicy: "automatic_enforcing_only",
      toolPolicy: "contract_allowlist",
      specialistAgentIds: form.specialistAgentIds,
      memoryScopes,
      contextNodeIds: selectedContext.map((candidate) => candidate.id),
      safeStopConditions: lines(form.safeStopConditions),
      deliverables: lines(form.deliverables),
    },
    ...(review ? { contractReview: review } : {}),
  });
  const runPreflight = async (forReview: boolean, discoverTeam = false): Promise<boolean> => {
    setPreflighting(true);
    setPreflightError(undefined);
    try {
      const result = await preflightAutonomousMission(request());
      setContextCandidates(result.context.candidates);
      setExecutionPreview(result.execution);
      if (discoverTeam && form.specialistAgentIds.length === 0 && result.execution.team.recommendedAgentIds.length > 0) {
        setForm((current) => ({
          ...current,
          specialistAgentIds: [...result.execution.team.recommendedAgentIds],
        }));
      }
      if (forReview) setContractReview(result);
      if (result.readiness.status === "blocked") {
        const contextFailures = result.readiness.checks.filter((check) => (
          check.status === "fail" && check.id === "contract_memory_selection"
        ));
        if (contextFailures.length > 0) {
          setForm((current) => ({ ...current, contextNodeIds: [...result.context.selectedNodeIds] }));
          setErrors(contextFailures.map((check) => `${check.label}: ${check.impact}`));
          return false;
        }
      }
      if (!discoverTeam && (
        result.execution.team.selectedAgentIds.length === 0 ||
        result.execution.team.invalidSelectedAgentIds.length > 0 ||
        result.execution.team.effectiveAgentIds.length === 0
      )) {
        setErrors(result.readiness.checks.filter((check) => (
          check.status === "fail" && check.id === "contract_specialist_selection"
        )).map((check) => `${check.label}: ${check.impact}`));
        return false;
      }
      setErrors([]);
      return true;
    } catch (error) {
      setPreflightError(error instanceof Error ? error : new Error("Contract preflight failed"));
      return false;
    } finally {
      setPreflighting(false);
    }
  };
  const continueTo = async (next: number) => {
    const validation = validateStep(step, form);
    setErrors(validation);
    if (validation.length > 0) return;
    if (step === 2 && !(await runPreflight(false, true))) return;
    if (step === 3 && !(await runPreflight(false))) return;
    if (step === 4 && !(await runPreflight(true))) return;
    setStep(next);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const validation = [0, 1, 2].flatMap((item) => validateStep(item, form));
    if (validation.length > 0) {
      setErrors(validation);
      return;
    }
    if (readinessBlocked) {
      setErrors(["Autonomous launch is blocked until every required readiness check passes."]);
      return;
    }
    if (!contractReview || contractReview.readiness.status === "blocked") {
      setErrors(["Run contract preflight again and review the current version and SHA-256 before launch."]);
      return;
    }
    const launchRequest = request(contractReview.contract);
    setSubmitting(true);
    setSubmitError(undefined);
    try {
      const created = await createMission(launchRequest, idempotencyKey.current);
      queryCache.invalidate("command-os-overview");
      navigate(safeNextUrl(created.nextUrl, `/missions/${encodeURIComponent(created.mission.id)}`));
    } catch (error) {
      setSubmitError(error instanceof Error ? error : new Error("Mission creation failed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="os-page os-form-page">
      <PageHeader eyebrow="Autonomous mission contract" title="Define the outcome and operating boundary" description="After launch, this signed contract becomes the complete source of execution authority. Missing readiness blocks launch now, not mid-run." actions={<ButtonLink href="/missions/new" variant="quiet">Change journey</ButtonLink>} />
      <div className="os-step-layout">
        <ol className="os-stepper" aria-label="Autonomous contract steps">
          {STEPS.map((label, index) => <li key={label} className={index === step ? "is-current" : index < step ? "is-complete" : ""} aria-current={index === step ? "step" : undefined}><button type="button" onClick={() => index < step && setStep(index)} disabled={index > step}><span>{index + 1}</span>{label}</button></li>)}
        </ol>
        <form onSubmit={submit} className="os-contract-form">
          <Card>
            {step === 0 && <fieldset><legend>Outcome</legend><p className="os-field-intro">State what success means before defining how the runtime may pursue it.</p>
              <label>Mission title<input value={form.title} onChange={(event) => set("title", event.target.value)} autoComplete="off" required /></label>
              <label>Authorized objective<textarea value={form.objective} onChange={(event) => set("objective", event.target.value)} rows={5} required /></label>
              <label>Measurable success criteria <span>One per line</span><textarea value={form.successCriteria} onChange={(event) => set("successCriteria", event.target.value)} rows={5} required /></label>
              <label>Required final deliverables <span>One per line</span><textarea value={form.deliverables} onChange={(event) => set("deliverables", event.target.value)} rows={4} required /></label>
            </fieldset>}
            {step === 1 && <fieldset><legend>Authorization and scope</legend><p className="os-field-intro">Actions are validated against these boundaries when they execute.</p>
              <label>Engagement ID <span>Optional</span><input value={form.engagementId} onChange={(event) => set("engagementId", event.target.value)} autoComplete="off" /></label>
              <label>Allowed targets and boundaries <span>One per line</span><textarea value={form.allowedTargets} onChange={(event) => set("allowedTargets", event.target.value)} rows={5} required /></label>
              <label>Prohibited targets <span>One per line</span><textarea value={form.prohibitedTargets} onChange={(event) => set("prohibitedTargets", event.target.value)} rows={3} /></label>
              <label>Authorized time window <span>Optional, include time zone</span><input value={form.timeWindow} onChange={(event) => set("timeWindow", event.target.value)} /></label>
              <div className="os-policy-note"><strong>Data handling boundary</strong><p>Evidence and artifacts remain in the local private canonical data plane with operator-managed retention. Preflight does not offer arbitrary handling promises that the runtime cannot enforce.</p></div>
              <label className="os-check-field"><input type="checkbox" checked={form.authorizationConfirmed} onChange={(event) => set("authorizationConfirmed", event.target.checked)} /><span><strong>I confirm this mission is authorized</strong><small>I am permitted to test the targets and action classes described in this contract.</small></span></label>
            </fieldset>}
            {step === 2 && <fieldset><legend>Autonomous operating contract</legend><p className="os-field-intro">The runtime may adapt its plan, but cannot expand these permissions or budgets.</p>
              <label>Pre-authorized action classes <span>One per line</span><textarea value={form.allowedActionClasses} onChange={(event) => set("allowedActionClasses", event.target.value)} rows={4} required /></label>
              <label>Prohibited action classes <span>One per line</span><textarea value={form.prohibitedActionClasses} onChange={(event) => set("prohibitedActionClasses", event.target.value)} rows={3} /></label>
              <label>Destructive-action policy<select value={form.destructivePolicy} onChange={(event) => set("destructivePolicy", event.target.value as FormState["destructivePolicy"])}><option value="prohibited">Prohibited</option><option value="contract_only">Allowed only where explicitly described in this contract</option></select></label>
              <label>Evidence requirements <span>One per line</span><textarea value={form.evidenceRequirements} onChange={(event) => set("evidenceRequirements", event.target.value)} rows={3} /></label>
              <label>Safe-stop conditions <span>One per line</span><textarea value={form.safeStopConditions} onChange={(event) => set("safeStopConditions", event.target.value)} rows={4} required /></label>
              <div className="os-field-grid os-field-grid--three">
                <label>Time budget (minutes)<input type="number" min="1" value={form.timeBudgetMinutes} onChange={(event) => set("timeBudgetMinutes", Number(event.target.value))} /></label>
                <label>Token budget <span>Optional</span><input type="number" min="0" value={form.tokenBudget} onChange={(event) => set("tokenBudget", event.target.value)} /></label>
                <label>Estimated cost limit <span>Optional</span><input type="number" min="0" step="0.01" value={form.costBudget} onChange={(event) => set("costBudget", event.target.value)} /></label>
                <label>Retry budget<input type="number" min="0" max="20" value={form.retryBudget} onChange={(event) => set("retryBudget", Number(event.target.value))} /></label>
                <label>Replan budget<input type="number" min="0" max="20" value={form.replanBudget} onChange={(event) => set("replanBudget", Number(event.target.value))} /></label>
                <label>Concurrency limit<input type="number" min="1" max="32" value={form.concurrencyLimit} onChange={(event) => set("concurrencyLimit", Number(event.target.value))} /></label>
                <label>Evidence storage (MiB)<input type="number" min="1" max="10485760" value={form.evidenceStorageBudgetMb} onChange={(event) => set("evidenceStorageBudgetMb", Number(event.target.value))} /></label>
                <label>Artifact storage (MiB)<input type="number" min="1" max="10485760" value={form.artifactStorageBudgetMb} onChange={(event) => set("artifactStorageBudgetMb", Number(event.target.value))} /></label>
              </div>
              <h3>Enforceable delivery and data policy</h3>
              <dl className="os-review-grid">
                <div><dt>Provider policy</dt><dd>Automatic, enforcing paths only</dd></div>
                <div><dt>Tool policy</dt><dd>Signed action and target allowlists</dd></div>
                <div><dt>Notifications</dt><dd>In-product semantic events only</dd></div>
                <div><dt>Reporting</dt><dd>Scope-checked Command OS JSON bundle</dd></div>
                <div><dt>Data handling</dt><dd>Local private data plane</dd></div>
                <div><dt>Retention</dt><dd>Operator managed; no implied automatic expiry</dd></div>
              </dl>
              <p className="os-policy-note">Only policies enforced by the current runtime are available. Unsupported external notifications, provider paths, report formats, or automatic expiry rules are rejected instead of becoming decorative contract text.</p>
            </fieldset>}
            {step === 3 && <fieldset><legend>Team and readiness</legend><p className="os-field-intro">Provider and specialist selection remains automatic and policy-driven.</p>
              {overview.isLoading && <p role="status">Running readiness checks…</p>}
              {overview.error && <ErrorPanel title="Readiness could not be verified" error={overview.error} onRetry={overview.refresh} />}
              {overview.data && <>
                <div className="os-readiness-summary"><span><strong>{overview.data.readiness.score}</strong>/100</span><div><h3>{overview.data.readiness.status}</h3><p>{readinessChecks.filter((check) => check.status === "fail").length} Autonomous blockers detected.</p></div><StatusPill status={readinessBlocked ? "blocked" : "ready"} /></div>
                <ul className="os-review-list">{readinessChecks.map((check) => <li key={check.id}><StatusPill status={check.status} /><span><strong>{check.label}</strong><small>{check.impact}</small>{check.remediation && check.status !== "pass" && <small>{check.remediation}</small>}</span></li>)}</ul>
                <h3>Inspected enforcing provider paths</h3>
                {!executionPreview || executionPreview.providers.length === 0 ? <p className="os-muted">No canonical provider projection is available. Autonomous launch remains blocked.</p> : <ul className="os-review-list" aria-label="Autonomous enforcing provider paths">{executionPreview.providers.map((provider) => <li key={provider.id}><StatusPill status={provider.compatible ? "ready" : provider.status} /><span><strong>{provider.id}</strong><small>{provider.reason}</small><small>{provider.authenticated ? "Authenticated" : "Not authenticated"} · {provider.enforcesAutonomousBoundary ? "Autonomous boundary enforced" : "Advisory only"} · token accounting {provider.reportsExactTokenUsage ? "exact" : "unavailable"} · cost accounting {provider.reportsExactCostUsage ? "exact" : "unavailable"}</small><small>Checked {new Date(provider.checkedAt).toLocaleString()}</small></span></li>)}</ul>}
                <h3>Signed specialist pool</h3>
                <p className="os-field-intro">The checked specialists become an exact signed allowlist. Planning and execution cannot assign work outside it.</p>
                {!executionPreview || executionPreview.team.candidates.length === 0 ? <p className="os-muted">No projected specialist inventory is available.</p> : <ul className="os-review-list" aria-label="Compatible Autonomous specialists">{executionPreview.team.candidates.map((agent) => <li key={agent.id}>
                  <label className="os-check-field"><input type="checkbox" disabled={!agent.compatible} checked={form.specialistAgentIds.includes(agent.id)} onChange={(event) => set("specialistAgentIds", event.target.checked ? [...form.specialistAgentIds, agent.id] : form.specialistAgentIds.filter((id) => id !== agent.id))} /><span><strong>{agent.displayName}</strong><small>{agent.role} · {agent.status} · ID {agent.id}</small><small>Provider policy: {agent.providerPolicy.defaultProvider ?? "automatic enforcing path"}</small><small>Runnable reviewed tools: {agent.runnableTools.length > 0 ? agent.runnableTools.join(", ") : "none"}</small><small>Allowed: {agent.toolPolicy.allowedTools.length > 0 ? agent.toolPolicy.allowedTools.join(", ") : "none declared"} · denied: {agent.toolPolicy.deniedTools.length > 0 ? agent.toolPolicy.deniedTools.join(", ") : "none"} · approval-gated: {agent.toolPolicy.approvalRequiredTools.length > 0 ? agent.toolPolicy.approvalRequiredTools.join(", ") : "none"}</small>{agent.incompatibilityReasons.map((reason) => <small key={reason}>{reason}</small>)}</span></label>
                  <StatusPill status={agent.compatible ? "ready" : "blocked"} />
                </li>)}</ul>}
                <h3>Reviewed MCP bindings</h3>
                {!executionPreview || executionPreview.tools.length === 0 ? <p className="os-muted">No MCP server is projected for this contract.</p> : <ul className="os-review-list" aria-label="Reviewed MCP bindings">{executionPreview.tools.map((tool) => <li key={tool.id}><StatusPill status={tool.status} /><span><strong>{tool.name}</strong><small>{tool.capabilities.length} capabilities · risk {tool.riskClass} · {tool.startPermitted ? "startup permitted" : "startup denied"}</small><small>Assigned specialists: {tool.assignedAgentIds.length > 0 ? tool.assignedAgentIds.join(", ") : "none"}</small></span></li>)}</ul>}
              </>}
            </fieldset>}
            {step === 4 && <fieldset><legend>Context and memory</legend><p className="os-field-intro">Select exact confirmed preferences and independently verified lessons. Preflight validates and signs these node IDs; the durable Context Pack is created from only those permitted nodes when planning begins.</p>
              {preflighting && <p role="status">Loading eligible canonical memory…</p>}
              {!preflighting && contextCandidates.length === 0 && <p className="os-muted">No eligible confirmed preference or verified lesson is available for this global or engagement scope. The mission can proceed without retained context.</p>}
              {contextCandidates.length > 0 && <ul className="os-review-list" aria-label="Eligible Autonomous context">
                {contextCandidates.map((candidate) => <li key={candidate.id}>
                  <label className="os-check-field"><input type="checkbox" checked={form.contextNodeIds.includes(candidate.id)} onChange={(event) => set("contextNodeIds", event.target.checked ? [...form.contextNodeIds, candidate.id] : form.contextNodeIds.filter((id) => id !== candidate.id))} /><span><strong>{candidate.title}</strong><small>{candidate.nodeType} · {candidate.lifecycleStatus} · {candidate.scope.kind === "engagement" ? `engagement ${candidate.scope.engagementId}` : "global"} · {Math.round(candidate.confidence * 100)}% confidence</small><small>{candidate.summary}</small><small>Provenance: {candidate.provenanceExplanation}</small><small>ID: {candidate.id}</small></span></label>
                  <StatusPill status={candidate.lifecycleStatus} />
                </li>)}
              </ul>}
              <p className="os-policy-note">Selected IDs are revalidated at launch. Stale, expired, restricted, unconfirmed, or cross-engagement nodes fail preflight. Secrets, raw confidential payloads, and candidate personal preferences are excluded.</p>
            </fieldset>}
            {step === 5 && <fieldset><legend>Contract review</legend><p className="os-field-intro">Launching creates the durable mission and run. The system must recover in-contract or safe-stop; it will not wait for routine approval.</p>
              <dl className="os-review-grid"><div><dt>Mission</dt><dd>{form.title}</dd></div><div><dt>Objective</dt><dd>{form.objective}</dd></div><div><dt>Allowed targets</dt><dd>{lines(form.allowedTargets).join(", ")}</dd></div><div><dt>Success criteria</dt><dd>{lines(form.successCriteria).length}</dd></div><div><dt>Time budget</dt><dd>{form.timeBudgetMinutes} minutes</dd></div><div><dt>Retries / replans</dt><dd>{form.retryBudget} / {form.replanBudget}</dd></div><div><dt>Concurrency</dt><dd>{form.concurrencyLimit}</dd></div><div><dt>Storage</dt><dd>{form.evidenceStorageBudgetMb} MiB evidence / {form.artifactStorageBudgetMb} MiB artifacts</dd></div><div><dt>Signed specialists</dt><dd>{form.specialistAgentIds.length}</dd></div><div><dt>Selected memory nodes</dt><dd>{selectedContext.length}; Context Pack created at planning</dd></div><div><dt>Contract version</dt><dd>{contractReview?.contract.version ?? "Not issued"}</dd></div><div><dt>Contract SHA-256</dt><dd><code>{contractReview?.contract.hash ?? "Run preflight to issue"}</code></dd></div></dl>
              {contractReview && <><h3>Provider, tool, delivery, and retention summary</h3><dl className="os-review-grid"><div><dt>Provider</dt><dd>{contractReview.policySummary.provider}</dd></div><div><dt>Tools</dt><dd>{contractReview.policySummary.tools}</dd></div><div><dt>Notifications</dt><dd>{contractReview.policySummary.notifications}</dd></div><div><dt>Reporting</dt><dd>{contractReview.policySummary.reporting}</dd></div><div><dt>Retention</dt><dd>{contractReview.policySummary.retention}</dd></div><div><dt>Storage</dt><dd>{contractReview.policySummary.storage}</dd></div></dl></>}
              {contractReview && contractReview.readiness.checks.some((check) => check.status === "fail") && <><h3>Launch blockers</h3><ul className="os-review-list">{contractReview.readiness.checks.filter((check) => check.status === "fail").map((check) => <li key={check.id}><StatusPill status="fail" /><span><strong>{check.label}</strong><small>{check.impact}</small>{check.remediation && <small>{check.remediation}</small>}</span></li>)}</ul></>}
              <div className="os-launch-contract"><StatusPill status={readinessBlocked || contractReview?.readiness.status === "blocked" ? "blocked" : "ready"} /><div><strong>{readinessBlocked || contractReview?.readiness.status === "blocked" ? "Launch is blocked" : "Contract is ready to launch"}</strong><p>{readinessBlocked || contractReview?.readiness.status === "blocked" ? "Resolve readiness failures and rerun preflight before Autonomous execution." : "The reviewed version and digest bind execution authority to this exact contract."}</p></div></div>
            </fieldset>}
            {errors.length > 0 && <div className="os-validation-summary" role="alert"><strong>Resolve before continuing</strong><ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul></div>}
            {submitError && <ErrorPanel title={submitError instanceof ApiError && submitError.status === 409 ? "Mission is not ready to launch" : "Mission could not be created"} error={submitError} />}
            {preflightError && <ErrorPanel title="Contract preflight could not complete" error={preflightError} />}
            <div className="os-form-actions">
              {step > 0 && <Button type="button" variant="quiet" onClick={() => { setErrors([]); setStep((current) => current - 1); }}>Back</Button>}
              <span />
              {step < STEPS.length - 1 ? <Button type="button" disabled={preflighting} onClick={() => void continueTo(step + 1)}>{preflighting ? "Running preflight…" : "Continue"}</Button> : <Button type="submit" disabled={submitting || readinessBlocked || !contractReview || contractReview.readiness.status === "blocked"}>{submitting ? "Launching mission…" : "Launch Autonomous Mission"}</Button>}
            </div>
          </Card>
        </form>
      </div>
    </div>
  );
}
