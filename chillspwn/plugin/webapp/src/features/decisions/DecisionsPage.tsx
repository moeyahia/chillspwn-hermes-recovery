import { type FormEvent, useState } from "react";
import { fetchOverview } from "../../data/api/commandOs";
import { runtimeV2Api } from "../../data/api/runtimeV2";
import { useQuery } from "../../data/cache/QueryProvider";
import type { GuidedDecision, GuidedDecisionControl } from "../../domain/types/runtimeV2";
import { Button, ButtonLink, Card, ErrorPanel, PageHeader, StatusPill } from "../../design-system/components/Primitives";
import { DegradedNotice, FilterForm, formatTime, JsonDetails, QueryBoundary, SelectFilter, StreamState, useActionState, useUrlFilters } from "../runs/OperationalSurface";

export default function DecisionsPage() {
  const filters = useUrlFilters({ status: "pending", limit: "100" });
  const decisions = useQuery(`guided-decisions:${filters.key}`, (signal) => runtimeV2Api.decisions({ status: filters.values.status, runId: filters.values.runId, limit: Number(filters.values.limit ?? 100) }, signal), { staleTime: 0 });
  const overview = useQuery("command-os-overview", fetchOverview, { staleTime: 0 });
  const exceptions = overview.data?.attention.filter((item) => /safe|block|recover|policy|budget|fail/iu.test(`${item.type} ${item.severity} ${item.title}`)) ?? [];
  return <div className="os-page"><PageHeader eyebrow="Deliberate control" title="Decisions" description="Exact Guided-step decisions and real Autonomous exceptions. Autonomous runs never wait here for routine approval." actions={<StreamState />} />
    <FilterForm filters={filters} searchKey="runId" searchLabel="Run ID"><SelectFilter filters={filters} name="status" label="Decision state" options={["pending", "approved", "manual", "alternative", "rejected", "expired", "cancelled"].map((value) => ({ value, label: value }))} /></FilterForm>
    {overview.error && <DegradedNotice>Autonomous exception summary is unavailable; Guided decisions remain authoritative.</DegradedNotice>}
    {exceptions.length > 0 && <section><h2>Autonomous exceptions and system attention</h2><div className="os-attention-list">{exceptions.map((item) => <Card key={item.id}><div className="os-card-heading"><h3>{item.title}</h3><StatusPill status={item.severity} /></div><p>{item.summary}</p>{item.missionId && <ButtonLink variant="secondary" href={`/missions/${encodeURIComponent(item.missionId)}`}>Open mission</ButtonLink>}</Card>)}</div></section>}
    <section><h2>Guided step decisions</h2><QueryBoundary data={decisions.data?.items} error={decisions.error} isLoading={decisions.isLoading} onRetry={decisions.refresh} emptyTitle="No Guided decisions match" emptyDescription="Guided missions will create one exact, expiring decision for each consequential represented action.">{(items) => <div className="os-decision-grid">{items.map((decision) => <DecisionCard key={decision.id} decision={decision} onChanged={decisions.refresh} />)}</div>}</QueryBoundary></section>
  </div>;
}

export function DecisionCard({ decision, onChanged }: { decision: GuidedDecision; onChanged: () => void }) {
  const [authorizationNote, setAuthorizationNote] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [completionSummary, setCompletionSummary] = useState("");
  const [skipReason, setSkipReason] = useState("");
  const [stopReason, setStopReason] = useState("");
  const [stopConfirmed, setStopConfirmed] = useState(false);
  const action = useActionState();
  const pending = decision.status === "pending" && Date.parse(decision.expiresAt) > Date.now();
  const represented = decision.requestedParameters && typeof decision.requestedParameters === "object" && !Array.isArray(decision.requestedParameters)
    ? decision.requestedParameters as Record<string, unknown>
    : {};
  const manualOnly = represented.kind === "manual";
  const submit = (operation: GuidedDecisionControl, event: FormEvent): void => {
    event.preventDefault();
    const exact = {
      expectedFingerprint: decision.actionFingerprint,
      expectedParameters: decision.requestedParameters,
    };
    const body = operation === "manual-result"
      ? { ...exact, summary: completionSummary }
      : operation === "reject"
        ? { ...exact, reason: rejectionReason }
        : operation === "stop"
          ? { ...exact, reason: stopReason }
          : operation === "skip"
            ? { ...exact, reason: skipReason }
          : { ...exact, reason: authorizationNote };
    const success = operation === "approve"
      ? "Exact step authorized."
      : operation === "reject"
        ? "Step rejected; the runtime will form a new represented approach."
        : operation === "manual-result"
          ? "Exact step completed from the reviewed manual result; canonical execution advanced."
          : operation === "stop"
            ? "Mission stopped; open work was cancelled and the exact-step control was audited."
            : "Exact step skipped; canonical execution moved to the next valid checkpoint.";
    void action.run(
      () => runtimeV2Api.decision(
        decision.id,
        operation,
        body,
        `decision-${operation}-${crypto.randomUUID()}`,
      ).then(onChanged),
      success,
    );
  };
  return <Card className="os-guided-decision-card">
    <div className="os-card-heading"><div><p className="os-eyebrow">Step {decision.stepId}</p><h3>{decision.rationale}</h3></div><StatusPill status={pending ? decision.status : decision.status === "pending" ? "expired" : decision.status} /></div>
    <dl className="os-key-values"><div><dt>Risk</dt><dd>{decision.riskClass}</dd></div><div><dt>Reversibility</dt><dd>{decision.reversibility}</dd></div><div><dt>Expires</dt><dd>{formatTime(decision.expiresAt)}</dd></div><div><dt>Fingerprint</dt><dd className="os-mono">{decision.actionFingerprint.slice(0, 16)}…</dd></div></dl>
    <JsonDetails label="Exact normalized parameters" value={decision.requestedParameters} />
    {pending && <div className="os-decision-actions">
      <section aria-labelledby={`execute-${decision.id}`}>
        <h4 id={`execute-${decision.id}`}>Authorize represented execution</h4>
        <p>Authorizes only the fingerprint and normalized parameters shown above.</p>
        <form onSubmit={(event) => submit("approve", event)}>
          <label><span>Optional authorization note</span><input maxLength={2000} value={authorizationNote} onChange={(event) => setAuthorizationNote(event.target.value)} /></label>
          {manualOnly
            ? <p className="os-muted">This operator-run step cannot be dispatched through MCP. Perform only the represented procedure, then use the separate completion control below.</p>
            : <Button disabled={action.pending}>Run this exact step</Button>}
        </form>
      </section>

      <section className="os-decision-completion" aria-labelledby={`complete-${decision.id}`}>
        <h4 id={`complete-${decision.id}`}>Complete and advance after manual execution</h4>
        <p id={`complete-warning-${decision.id}`}><strong>This is not interpretation.</strong> It attests that you performed this exact represented action, records verified result evidence, marks the step complete, and advances canonical execution.</p>
        <form onSubmit={(event) => submit("manual-result", event)}>
          <label><span>Reviewed result summary</span><textarea required maxLength={16_000} value={completionSummary} onChange={(event) => setCompletionSummary(event.target.value)} aria-describedby={`complete-warning-${decision.id}`} /></label>
          <Button variant="secondary" disabled={action.pending || !completionSummary.trim()}>Complete exact step and advance</Button>
        </form>
      </section>

      <section aria-labelledby={`change-${decision.id}`}>
        <h4 id={`change-${decision.id}`}>Choose a different approach</h4>
        <p>Rejecting does not complete or skip this step. It asks the runtime to recover with a materially different represented action.</p>
        <form onSubmit={(event) => submit("reject", event)}>
          <label><span>Required rejection reason</span><input required minLength={2} maxLength={2000} value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} /></label>
          <Button variant="secondary" disabled={action.pending || rejectionReason.trim().length < 2}>Reject and replan</Button>
        </form>
      </section>

      <section className="os-decision-skip" aria-labelledby={`skip-${decision.id}`}>
        <h4 id={`skip-${decision.id}`}>Skip this exact step</h4>
        <p id={`skip-warning-${decision.id}`}>Creates no action and no evidence. It marks only this represented step as skipped, records the reason and exact parameter hash, then advances to the next dependency-eligible checkpoint. Mission success is still evaluated from real retained evidence.</p>
        <form onSubmit={(event) => submit("skip", event)}>
          <label><span>Required skip reason</span><input required minLength={2} maxLength={2000} value={skipReason} onChange={(event) => setSkipReason(event.target.value)} aria-describedby={`skip-warning-${decision.id}`} /></label>
          <Button variant="secondary" disabled={action.pending || skipReason.trim().length < 2}>Skip exact step</Button>
        </form>
      </section>

      <section className="os-decision-stop" aria-labelledby={`stop-${decision.id}`}>
        <h4 id={`stop-${decision.id}`}>Stop this mission</h4>
        <p id={`stop-warning-${decision.id}`}>Cancels the run and all open work. The stop is bound to this exact pending step and retained in the canonical event and audit history.</p>
        <form onSubmit={(event) => submit("stop", event)}>
          <label><span>Required stop reason</span><input required minLength={2} maxLength={2000} value={stopReason} onChange={(event) => setStopReason(event.target.value)} /></label>
          <label className="os-checkbox-row"><input type="checkbox" checked={stopConfirmed} onChange={(event) => setStopConfirmed(event.target.checked)} aria-describedby={`stop-warning-${decision.id}`} /><span>I understand this stops the entire mission, not only this step.</span></label>
          <Button variant="danger" disabled={action.pending || stopReason.trim().length < 2 || !stopConfirmed}>Stop mission</Button>
        </form>
      </section>
    </div>}
    {action.error && <ErrorPanel error={action.error} />}{action.message && <p className="os-success-note" role="status">{action.message}</p>}
  </Card>;
}
