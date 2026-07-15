import { type FormEvent, useEffect, useRef, useState } from "react";
import { useNavigation } from "../../app/router/navigation";
import {
  createAutonomousBranch,
  fetchAutonomousBranchContext,
  preflightAutonomousBranch,
} from "../../data/api/commandOs";
import { useQuery, useQueryCache } from "../../data/cache/QueryProvider";
import { runtimeV2Api } from "../../data/api/runtimeV2";
import type {
  AutonomousBranchMode,
  AutonomousBranchPreflight,
  AutonomousMissionRequest,
} from "../../domain/types/commandOs";
import type { RuntimeRun } from "../../domain/types/runtimeV2";
import { Button, Card, ErrorPanel, LoadingPanel, StatusPill } from "../../design-system/components/Primitives";
import { KeyValueGrid, useActionState } from "../runs/OperationalSurface";
import { lines, requestKey, safeNextUrl } from "./formUtils";

const TERMINAL = new Set(["completed", "failed", "cancelled"]);

interface AmendmentForm {
  title: string;
  objective: string;
  successCriteria: string;
  engagementId: string;
  allowedTargets: string;
  prohibitedTargets: string;
  timeWindow: string;
  dataHandling: string;
  allowedActionClasses: string;
  prohibitedActionClasses: string;
  destructivePolicy: "prohibited" | "contract_only";
  evidenceRequirements: string;
  timeBudgetMinutes: string;
  tokenBudget: string;
  costBudget: string;
  retryBudget: string;
  replanBudget: string;
  concurrencyLimit: string;
  evidenceStorageBudgetMb: string;
  artifactStorageBudgetMb: string;
  specialistAgentIds: string;
  memoryScopes: string;
  contextNodeIds: string;
  safeStopConditions: string;
  deliverables: string;
}

function formFromRequest(request: AutonomousMissionRequest): AmendmentForm {
  return {
    title: request.title,
    objective: request.objective,
    successCriteria: request.successCriteria.join("\n"),
    engagementId: request.authorization.engagementId ?? "",
    allowedTargets: request.authorization.allowedTargets.join("\n"),
    prohibitedTargets: request.authorization.prohibitedTargets.join("\n"),
    timeWindow: request.authorization.timeWindow ?? "",
    dataHandling: request.authorization.dataHandling ?? "",
    allowedActionClasses: request.contract.allowedActionClasses.join("\n"),
    prohibitedActionClasses: request.contract.prohibitedActionClasses.join("\n"),
    destructivePolicy: request.contract.destructivePolicy,
    evidenceRequirements: request.contract.evidenceRequirements.join("\n"),
    timeBudgetMinutes: String(request.contract.timeBudgetMinutes),
    tokenBudget: request.contract.tokenBudget === undefined ? "" : String(request.contract.tokenBudget),
    costBudget: request.contract.costBudget === undefined ? "" : String(request.contract.costBudget),
    retryBudget: String(request.contract.retryBudget),
    replanBudget: String(request.contract.replanBudget),
    concurrencyLimit: String(request.contract.concurrencyLimit),
    evidenceStorageBudgetMb: String(request.contract.evidenceStorageBudgetBytes / (1024 * 1024)),
    artifactStorageBudgetMb: String(request.contract.artifactStorageBudgetBytes / (1024 * 1024)),
    specialistAgentIds: request.contract.specialistAgentIds.join("\n"),
    memoryScopes: request.contract.memoryScopes.join("\n"),
    contextNodeIds: request.contract.contextNodeIds.join("\n"),
    safeStopConditions: request.contract.safeStopConditions.join("\n"),
    deliverables: request.contract.deliverables.join("\n"),
  };
}

function numberValue(value: string): number {
  return Number(value.trim());
}

function requestFromForm(base: AutonomousMissionRequest, form: AmendmentForm): AutonomousMissionRequest {
  const tokenBudget = form.tokenBudget.trim() ? numberValue(form.tokenBudget) : undefined;
  const costBudget = form.costBudget.trim() ? numberValue(form.costBudget) : undefined;
  return {
    ...base,
    title: form.title.trim(),
    objective: form.objective.trim(),
    successCriteria: lines(form.successCriteria),
    authorization: {
      allowedTargets: lines(form.allowedTargets),
      prohibitedTargets: lines(form.prohibitedTargets),
      authorizationConfirmed: true,
      ...(form.engagementId.trim() ? { engagementId: form.engagementId.trim() } : {}),
      ...(form.timeWindow.trim() ? { timeWindow: form.timeWindow.trim() } : {}),
      ...(form.dataHandling.trim() ? { dataHandling: form.dataHandling.trim() } : {}),
    },
    contract: {
      ...base.contract,
      allowedActionClasses: lines(form.allowedActionClasses),
      prohibitedActionClasses: lines(form.prohibitedActionClasses),
      destructivePolicy: form.destructivePolicy,
      evidenceRequirements: lines(form.evidenceRequirements),
      timeBudgetMinutes: numberValue(form.timeBudgetMinutes),
      ...(tokenBudget === undefined ? {} : { tokenBudget }),
      ...(costBudget === undefined ? {} : { costBudget }),
      retryBudget: numberValue(form.retryBudget),
      replanBudget: numberValue(form.replanBudget),
      concurrencyLimit: numberValue(form.concurrencyLimit),
      evidenceStorageBudgetBytes: numberValue(form.evidenceStorageBudgetMb) * 1024 * 1024,
      artifactStorageBudgetBytes: numberValue(form.artifactStorageBudgetMb) * 1024 * 1024,
      specialistAgentIds: lines(form.specialistAgentIds),
      memoryScopes: lines(form.memoryScopes),
      contextNodeIds: lines(form.contextNodeIds),
      safeStopConditions: lines(form.safeStopConditions),
      deliverables: lines(form.deliverables),
    },
  };
}

function ReadinessReview({ review }: { review: AutonomousBranchPreflight }) {
  return <Card className="os-branch-review">
    <div className="os-card-heading"><div><p className="os-eyebrow">Server-issued review</p><h3>Contract v{review.contract.version}</h3></div><StatusPill status={review.preflight.readiness.status} /></div>
    <p className="os-mono os-branch-hash">SHA-256 {review.contract.hash}</p>
    <KeyValueGrid items={[
      { label: "Contract state", value: review.contract.state },
      { label: "Source run version", value: review.sourceRunVersion },
      { label: "Specialist pool", value: review.preflight.execution.team.effectiveAgentIds.join(", ") || "None" },
      { label: "Context selected", value: review.preflight.context.selectedNodeIds.length },
    ]} />
    <ul className="os-compact-list">{review.preflight.readiness.checks.map((check) => <li key={check.id}><span><strong>{check.label}</strong><small>{check.impact}{check.remediation ? ` · ${check.remediation}` : ""}</small></span><StatusPill status={check.status} /></li>)}</ul>
  </Card>;
}

export function AutonomousBranchPanel({ missionId, selectedRun }: { missionId: string; selectedRun: RuntimeRun }) {
  const navigation = useNavigation();
  const cache = useQueryCache();
  const context = useQuery(
    `autonomous-branch-context:${missionId}:${selectedRun.id}`,
    (signal) => fetchAutonomousBranchContext(missionId, selectedRun.id, signal),
    { staleTime: 0 },
  );
  const control = useActionState();
  const [mode, setMode] = useState<AutonomousBranchMode>("unchanged_contract");
  const [reason, setReason] = useState("");
  const [stopReason, setStopReason] = useState("");
  const [form, setForm] = useState<AmendmentForm>();
  const [initializedRunId, setInitializedRunId] = useState<string>();
  const [review, setReview] = useState<AutonomousBranchPreflight>();
  const [reviewError, setReviewError] = useState<Error>();
  const [reviewPending, setReviewPending] = useState(false);
  const [deliberatelyConfirmed, setDeliberatelyConfirmed] = useState(false);
  const [createError, setCreateError] = useState<Error>();
  const [createPending, setCreatePending] = useState(false);
  const preflightKey = useRef(requestKey());
  const createKey = useRef(requestKey());

  useEffect(() => {
    if (!context.data || initializedRunId === context.data.sourceRun.id) return;
    setForm(formFromRequest(context.data.request));
    setInitializedRunId(context.data.sourceRun.id);
  }, [context.data, initializedRunId]);

  const invalidateReview = () => {
    setReview(undefined);
    setReviewError(undefined);
    setCreateError(undefined);
    setDeliberatelyConfirmed(false);
    preflightKey.current = requestKey();
    createKey.current = requestKey();
  };
  const updateForm = <K extends keyof AmendmentForm>(key: K, value: AmendmentForm[K]) => {
    invalidateReview();
    setForm((current) => current ? { ...current, [key]: value } : current);
  };
  const refreshRuntime = () => {
    cache.invalidatePrefix("mission-runtime:");
    cache.invalidatePrefix("run:");
    cache.invalidate("command-os-overview");
    context.refresh();
  };
  const runControl = (command: "pause" | "cancel") => {
    void control.run(
      () => runtimeV2Api.controlRun(
        selectedRun.id,
        command,
        stopReason,
        requestKey(),
      ).then(() => { refreshRuntime(); }),
      command === "pause"
        ? "Run paused at a durable checkpoint. Refreshing branch readiness."
        : "Run cancelled safely. Refreshing branch readiness.",
    );
  };

  const runPreflight = async (event: FormEvent) => {
    event.preventDefault();
    if (!context.data || !form) return;
    setReviewPending(true);
    setReviewError(undefined);
    setCreateError(undefined);
    setDeliberatelyConfirmed(false);
    try {
      const result = await preflightAutonomousBranch(missionId, {
        sourceRunId: context.data.sourceRun.id,
        sourceRunVersion: context.data.sourceRun.version,
        mode,
        reason,
        ...(mode === "contract_amendment" ? { request: requestFromForm(context.data.request, form) } : {}),
      }, preflightKey.current);
      setReview(result);
    } catch (cause) {
      setReviewError(cause instanceof Error ? cause : new Error("Autonomous branch preflight failed"));
    } finally {
      setReviewPending(false);
    }
  };

  const create = async () => {
    if (!context.data || !review || !deliberatelyConfirmed) return;
    setCreatePending(true);
    setCreateError(undefined);
    try {
      const result = await createAutonomousBranch(missionId, {
        sourceRunId: review.sourceRunId,
        sourceRunVersion: review.sourceRunVersion,
        mode: review.mode,
        reason,
        ...(review.contract.id && review.mode === "contract_amendment"
          ? { draftContractId: review.contract.id }
          : {}),
        review: { version: review.contract.version, hash: review.contract.hash },
      }, createKey.current);
      cache.invalidate("command-os-overview");
      cache.invalidatePrefix("mission-runtime:");
      cache.invalidatePrefix("run:");
      navigation.navigate(safeNextUrl(
        result.nextUrl,
        `/missions/${encodeURIComponent(missionId)}/runs/${encodeURIComponent(result.run.id)}`,
      ));
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause : new Error("Autonomous branch creation failed"));
    } finally {
      setCreatePending(false);
    }
  };

  if (context.isLoading) return <LoadingPanel label="Loading signed Autonomous contract history" />;
  if (context.error && !context.data) return <ErrorPanel title="Contract branch controls are unavailable" error={context.error} onRetry={context.refresh} />;
  if (!context.data || !form) return null;
  const source = context.data.sourceRun;
  const canPause = !TERMINAL.has(source.status) && source.status !== "blocked";
  const canCancel = !TERMINAL.has(source.status);
  const readinessReady = Boolean(review && review.preflight.readiness.status !== "blocked" && !review.preflight.readiness.checks.some((check) => check.status === "fail"));
  const reviewPersisted = Boolean(review && (review.mode === "unchanged_contract" ? review.contract.state === "confirmed" : review.contract.state === "draft"));
  const canCreate = source.safeToBranch && readinessReady && reviewPersisted && deliberatelyConfirmed && !createPending;

  return <section className="os-autonomous-branch" aria-labelledby="autonomous-branch-title">
    <Card>
      <div className="os-card-heading"><div><p className="os-eyebrow">Versioned journey amendment</p><h2 id="autonomous-branch-title">Create a separate Autonomous execution attempt</h2></div><StatusPill status={source.safeToBranch ? "safe_to_branch" : "must_stop"}>{source.safeToBranch ? "Safe to branch" : "Pause or cancel first"}</StatusPill></div>
      <p>The active contract is never edited in place. A new run either reuses its exact signed authority or confirms a fully readiness-checked successor contract.</p>
      <KeyValueGrid items={[
        { label: "Source run", value: <span className="os-mono">{source.id}</span> },
        { label: "Run state / version", value: `${source.status} · v${source.version}` },
        { label: "Signed contract", value: `v${context.data.contract.version} · ${context.data.contract.state}` },
        { label: "Branch safety", value: source.safeToBranchReason },
      ]} />
      {!source.safeToBranch && <form className="os-review-form" onSubmit={(event) => { event.preventDefault(); runControl("pause"); }}>
        <label><span>Operator stop reason (audited)</span><input required minLength={3} value={stopReason} onChange={(event) => setStopReason(event.target.value)} placeholder="Why must this run stop before branching?" /></label>
        <div className="os-branch-actions">
          <Button variant="secondary" disabled={!canPause || control.pending || stopReason.trim().length < 3}>Pause at durable checkpoint</Button>
          <Button type="button" variant="danger" disabled={!canCancel || control.pending || stopReason.trim().length < 3} onClick={() => runControl("cancel")}>Cancel source run</Button>
        </div>
      </form>}
      {control.error && <ErrorPanel title="Run control failed" error={control.error} />}
      {control.message && <p role="status" className="os-success-note">{control.message}</p>}
    </Card>

    <form className="os-review-form os-branch-composer" onSubmit={runPreflight}>
      <Card>
        <fieldset><legend>Choose the authority for the new run</legend>
          <div className="os-branch-mode">
            <label><input type="radio" name="branch-mode" checked={mode === "unchanged_contract"} onChange={() => { setMode("unchanged_contract"); invalidateReview(); }} /><span><strong>Unchanged signed contract</strong><small>Branch under the same version and SHA-256. Objective, scope, tools, budgets, specialists, and memory authority remain identical.</small></span></label>
            <label><input type="radio" name="branch-mode" checked={mode === "contract_amendment"} onChange={() => { setMode("contract_amendment"); invalidateReview(); }} /><span><strong>Versioned contract amendment</strong><small>Create a new draft, rerun full readiness, then deliberately confirm it. The prior contract remains in immutable history.</small></span></label>
          </div>
        </fieldset>
        <label><span>Branch or amendment reason (audited)</span><textarea required minLength={3} rows={3} value={reason} onChange={(event) => { setReason(event.target.value); invalidateReview(); }} placeholder="Why is a new execution attempt necessary?" /></label>
      </Card>

      {mode === "contract_amendment" && <Card className="os-branch-fields">
        <p className="os-eyebrow">Full successor contract</p><h3>Amend explicit authority</h3>
        <p className="os-muted">Unchanged fields remain copied from contract v{context.data.contract.version}; every submitted field is revalidated by the live readiness gate.</p>
        <div className="os-branch-field-grid">
          <label><span>Mission title</span><input required value={form.title} onChange={(event) => updateForm("title", event.target.value)} /></label>
          <label className="is-wide"><span>Authorized objective</span><textarea required rows={3} value={form.objective} onChange={(event) => updateForm("objective", event.target.value)} /></label>
          <label><span>Success criteria · one per line</span><textarea required rows={4} value={form.successCriteria} onChange={(event) => updateForm("successCriteria", event.target.value)} /></label>
          <label><span>Engagement ID</span><input value={form.engagementId} onChange={(event) => updateForm("engagementId", event.target.value)} /></label>
          <label><span>Allowed targets · one per line</span><textarea required rows={4} value={form.allowedTargets} onChange={(event) => updateForm("allowedTargets", event.target.value)} /></label>
          <label><span>Prohibited targets · one per line</span><textarea rows={4} value={form.prohibitedTargets} onChange={(event) => updateForm("prohibitedTargets", event.target.value)} /></label>
          <label><span>Authorization time window</span><input value={form.timeWindow} onChange={(event) => updateForm("timeWindow", event.target.value)} /></label>
          <label><span>Data-handling constraint</span><input value={form.dataHandling} onChange={(event) => updateForm("dataHandling", event.target.value)} /></label>
          <label><span>Allowed action classes · one per line</span><textarea required rows={4} value={form.allowedActionClasses} onChange={(event) => updateForm("allowedActionClasses", event.target.value)} /></label>
          <label><span>Prohibited action classes · one per line</span><textarea rows={4} value={form.prohibitedActionClasses} onChange={(event) => updateForm("prohibitedActionClasses", event.target.value)} /></label>
          <label><span>Destructive-action policy</span><select value={form.destructivePolicy} onChange={(event) => updateForm("destructivePolicy", event.target.value as AmendmentForm["destructivePolicy"])}><option value="prohibited">Prohibited</option><option value="contract_only">Only when explicitly inside this contract</option></select></label>
          <label><span>Evidence requirements · one per line</span><textarea rows={4} value={form.evidenceRequirements} onChange={(event) => updateForm("evidenceRequirements", event.target.value)} /></label>
          <label><span>Time budget · minutes</span><input type="number" min="1" required value={form.timeBudgetMinutes} onChange={(event) => updateForm("timeBudgetMinutes", event.target.value)} /></label>
          <label><span>Token budget · optional</span><input type="number" min="0" value={form.tokenBudget} onChange={(event) => updateForm("tokenBudget", event.target.value)} /></label>
          <label><span>Cost budget · optional</span><input type="number" min="0" step="0.01" value={form.costBudget} onChange={(event) => updateForm("costBudget", event.target.value)} /></label>
          <label><span>Retry budget</span><input type="number" min="0" required value={form.retryBudget} onChange={(event) => updateForm("retryBudget", event.target.value)} /></label>
          <label><span>Replan budget</span><input type="number" min="0" required value={form.replanBudget} onChange={(event) => updateForm("replanBudget", event.target.value)} /></label>
          <label><span>Concurrency limit</span><input type="number" min="1" required value={form.concurrencyLimit} onChange={(event) => updateForm("concurrencyLimit", event.target.value)} /></label>
          <label><span>Evidence storage · MiB</span><input type="number" min="1" required value={form.evidenceStorageBudgetMb} onChange={(event) => updateForm("evidenceStorageBudgetMb", event.target.value)} /></label>
          <label><span>Artifact storage · MiB</span><input type="number" min="1" required value={form.artifactStorageBudgetMb} onChange={(event) => updateForm("artifactStorageBudgetMb", event.target.value)} /></label>
          <label><span>Signed specialist IDs · one per line</span><textarea required rows={4} value={form.specialistAgentIds} onChange={(event) => updateForm("specialistAgentIds", event.target.value)} /></label>
          <label><span>Allowed memory scopes · one per line</span><textarea rows={4} value={form.memoryScopes} onChange={(event) => updateForm("memoryScopes", event.target.value)} /></label>
          <label><span>Exact context-node IDs · one per line</span><textarea rows={4} value={form.contextNodeIds} onChange={(event) => updateForm("contextNodeIds", event.target.value)} /></label>
          <label><span>Safe-stop conditions · one per line</span><textarea required rows={4} value={form.safeStopConditions} onChange={(event) => updateForm("safeStopConditions", event.target.value)} /></label>
          <label><span>Final deliverables · one per line</span><textarea required rows={4} value={form.deliverables} onChange={(event) => updateForm("deliverables", event.target.value)} /></label>
        </div>
      </Card>}

      <div className="os-branch-actions"><Button disabled={!source.safeToBranch || reason.trim().length < 3 || reviewPending}>{reviewPending ? "Checking live readiness…" : mode === "contract_amendment" ? "Draft and review amended contract" : "Review unchanged signed contract"}</Button></div>
    </form>

    {reviewError && <ErrorPanel title="Branch preflight did not pass" error={reviewError} />}
    {review && <ReadinessReview review={review} />}
    {review && <Card className="os-branch-confirmation">
      <label className="os-check"><input type="checkbox" checked={deliberatelyConfirmed} onChange={(event) => setDeliberatelyConfirmed(event.target.checked)} /><span>I reviewed contract v{review.contract.version}, its SHA-256 digest, live readiness, scope, budgets, specialist pool, and safe-stop behavior. Create one separate Autonomous run without routine user-wait states.</span></label>
      <div className="os-branch-actions"><Button type="button" disabled={!canCreate} onClick={() => void create()}>{createPending ? "Creating durable run…" : mode === "contract_amendment" ? `Confirm contract v${review.contract.version} and create run` : `Create run under contract v${review.contract.version}`}</Button></div>
    </Card>}
    {createError && <ErrorPanel title="New Autonomous run was not created" error={createError} />}

    <Card><p className="os-eyebrow">Immutable lineage</p><h3>Contract history</h3><ul className="os-compact-list">{context.data.history.map((item) => <li key={item.id}><span><strong>Contract v{item.version}</strong><small className="os-mono">{item.hash} · source {item.sourceContractId ?? "initial"}</small></span><StatusPill status={item.state} /></li>)}</ul></Card>
  </section>;
}
