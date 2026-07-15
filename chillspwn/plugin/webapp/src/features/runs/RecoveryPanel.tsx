import { useEffect, useState } from "react";
import { AppLink } from "../../app/router/navigation";
import { operationsApi } from "../../data/api/operations";
import { runtimeV2Api } from "../../data/api/runtimeV2";
import { useQuery } from "../../data/cache/QueryProvider";
import { useEventStream } from "../../data/events/EventStreamProvider";
import type { RecoveryActionAvailability, RunRecoveryRecord } from "../../domain/types/operations";
import { Button, ButtonLink, Card, ErrorPanel, LoadingPanel, StatusPill } from "../../design-system/components/Primitives";
import { formatTime, KeyValueGrid, useActionState } from "./OperationalSurface";

function bounded(value: number, limit: number | null, remaining: number | null): string {
  if (limit === null) return `${value} used · limit not reported`;
  return `${value}/${limit} used · ${remaining ?? Math.max(0, limit - value)} remaining`;
}

function memoryHref(item: RunRecoveryRecord["failedAttemptMemories"][number]): string {
  return item.kind === "memory"
    ? `/brain/nodes/${encodeURIComponent(item.id)}`
    : `/learning/lessons/${encodeURIComponent(item.id)}`;
}

function actionVariant(action: RecoveryActionAvailability): "secondary" | "danger" {
  return action.kind === "terminate" ? "danger" : "secondary";
}

export function RecoveryPanel({ runId, onChanged }: { runId: string; onChanged: () => void }) {
  const query = useQuery(`run-recovery:${runId}`, (signal) => operationsApi.recovery(runId, signal), { staleTime: 0 });
  const stream = useEventStream();
  const [reason, setReason] = useState("");
  const mutation = useActionState();
  useEffect(() => {
    if (stream.lastEvent?.runId === runId) query.refresh();
  }, [stream.lastEvent?.id, runId]);

  if (query.isLoading) return <Card className="os-recovery-panel"><LoadingPanel label="Loading canonical recovery intelligence" /></Card>;
  if (query.error && !query.data) return <Card className="os-recovery-panel"><ErrorPanel title="Recovery intelligence is unavailable" error={query.error} onRetry={query.refresh} /></Card>;
  const recovery = query.data;
  if (!recovery?.recoveryRequired) return null;

  const perform = (action: RecoveryActionAvailability) => {
    if (!action.available || !action.command || !reason.trim()) return;
    void mutation.run(
      () => runtimeV2Api.controlRun(
        runId,
        action.command === "cancel" ? "cancel" : "resume",
        reason.trim(),
        `recovery-${action.command}-${crypto.randomUUID()}`,
      ).then(() => { setReason(""); query.refresh(); onChanged(); }),
      action.command === "cancel" ? "Run terminated gracefully." : "Run resumed from its durable checkpoint.",
    );
  };

  return <Card className="os-recovery-panel" aria-labelledby={`recovery-${runId}`}>
    <div className="os-card-heading">
      <div>
        <p className="os-eyebrow">Canonical recovery panel</p>
        <h2 id={`recovery-${runId}`}>{recovery.run.journey === "autonomous"
          ? recovery.proposedRecovery.kind === "safe_stop" ? "Autonomous run safe-stopped" : "Autonomous recovery intelligence"
          : recovery.guidedDecision ? "Guided recovery needs your decision" : "Guided recovery intelligence"}</h2>
      </div>
      <StatusPill status={recovery.run.status} />
    </div>
    {query.error && <p className="os-degraded" role="status">Refresh failed; the last validated recovery projection remains visible.</p>}

    <section className="os-recovery-summary" aria-labelledby={`detected-${runId}`}>
      <p className="os-eyebrow">What was detected</p>
      <h3 id={`detected-${runId}`}>{recovery.detection.summary}</h3>
      <KeyValueGrid items={[
        { label: "Failure category", value: recovery.detection.category ?? "Not classified" },
        { label: "Current owner", value: recovery.run.currentOwnerId ?? "Supervisor" },
        { label: "Current step", value: recovery.run.currentStepId ?? "Not reported" },
        { label: "Lease expiry", value: formatTime(recovery.run.leaseExpiresAt) },
      ]} />
    </section>

    <div className="os-recovery-grid">
      <section aria-labelledby={`checkpoint-${runId}`}>
        <p className="os-eyebrow">Last durable boundary</p>
        <h3 id={`checkpoint-${runId}`}>Checkpoint</h3>
        {recovery.checkpoint ? <>
          <KeyValueGrid items={[
            { label: "Recorded", value: formatTime(recovery.checkpoint.createdAt) },
            { label: "Event sequence", value: recovery.checkpoint.eventSequence },
            { label: "Plan version", value: recovery.checkpoint.planVersion ?? "Not recorded" },
            { label: "Completed actions", value: recovery.checkpoint.completedActionCount },
            { label: "In-flight classification", value: recovery.checkpoint.inFlightClassification ?? "No special classification" },
            { label: "In-flight actions", value: recovery.checkpoint.inFlightActions.length },
          ]} />
          <p className="os-muted os-mono">Integrity {recovery.checkpoint.stateHash.slice(0, 16)}…</p>
          {recovery.checkpoint.inFlightActions.length > 0 && <ul className="os-compact-list">
            {recovery.checkpoint.inFlightActions.map((action) => <li key={action.id}><span><strong>{action.id}</strong><small>{action.status} · {action.idempotent ? "idempotent" : "non-idempotent"} · {action.destructive ? "destructive" : "non-destructive"}</small></span></li>)}
          </ul>}
        </> : <p className="os-state-note">No validated checkpoint is available. Resume is disabled.</p>}
      </section>

      <section aria-labelledby={`attempts-${runId}`}>
        <p className="os-eyebrow">Attempts and bounded budgets</p>
        <h3 id={`attempts-${runId}`}>Recovery budget</h3>
        <KeyValueGrid items={[
          { label: "Retries", value: bounded(recovery.attempts.retryCount, recovery.attempts.retryLimit, recovery.attempts.retriesRemaining) },
          { label: "Replans", value: bounded(recovery.attempts.replanCount, recovery.attempts.replanLimit, recovery.attempts.replansRemaining) },
          { label: "Failed actions retained", value: recovery.detection.failedActions.length },
          { label: "Detection events retained", value: recovery.detection.evidence.length },
        ]} />
        {recovery.detection.failedActions.length > 0 && <ol className="os-recovery-attempts">
          {recovery.detection.failedActions.map((action) => <li key={action.id}>
            <div><strong>{action.intentSummary}</strong><StatusPill status={action.status} /></div>
            <p>{action.resultSummary ?? "No result summary was recorded."}</p>
            <small>{action.errorCategory ?? "unclassified"} · action retries {action.retryCount} · {formatTime(action.endedAt)}</small>
          </li>)}
        </ol>}
      </section>
    </div>

    <section className="os-recovery-proposal" aria-labelledby={`proposal-${runId}`}>
      <div className="os-card-heading"><div><p className="os-eyebrow">Proposed recovery</p><h3 id={`proposal-${runId}`}>{recovery.proposedRecovery.summary}</h3></div><StatusPill status={recovery.proposedRecovery.kind} /></div>
      <p>{recovery.proposedRecovery.basis}</p>
      <KeyValueGrid items={[
        { label: "Time impact", value: recovery.proposedRecovery.impact.time },
        { label: "Cost impact", value: recovery.proposedRecovery.impact.cost },
        { label: "Scope impact", value: recovery.proposedRecovery.impact.scope },
        { label: "Next runtime action", value: recovery.run.nextAction ?? "No next action is scheduled" },
      ]} />
      {recovery.guidedDecision && <div className="os-guided-recovery-decision">
        <div><p className="os-eyebrow">Exact Guided decision</p><h4>{recovery.guidedDecision.rationale}</h4><p>{recovery.guidedDecision.riskClass} risk · expires {formatTime(recovery.guidedDecision.expiresAt)}</p></div>
        <ButtonLink href={`/guided/${encodeURIComponent(recovery.run.missionId)}`} variant="primary">Review exact step</ButtonLink>
      </div>}
    </section>

    <div className="os-recovery-grid">
      <section aria-labelledby={`evidence-${runId}`}>
        <p className="os-eyebrow">Detection evidence</p>
        <h3 id={`evidence-${runId}`}>Immutable recovery events</h3>
        {recovery.detection.evidence.length > 0 ? <ol className="os-timeline">
          {recovery.detection.evidence.map((event) => <li key={event.id}><strong>{event.summary}</strong><span>{event.eventType} · sequence {event.sequence} · {formatTime(event.occurredAt)}</span></li>)}
        </ol> : <p className="os-muted">No recovery-specific event has been persisted; the run status and failed actions are the available detection evidence.</p>}
      </section>

      <section aria-labelledby={`memory-${runId}`}>
        <p className="os-eyebrow">Failed-attempt memory</p>
        <h3 id={`memory-${runId}`}>Related avoidance knowledge</h3>
        {recovery.failedAttemptMemories.length > 0 ? <ul className="os-compact-list">
          {recovery.failedAttemptMemories.map((item) => <li key={`${item.kind}:${item.id}`}><span><AppLink href={memoryHref(item)}>{item.title}</AppLink><small>{item.kind} · {item.status}{item.failureCategory ? ` · ${item.failureCategory}` : ""}{item.confidence === null ? "" : ` · ${Math.round(item.confidence * 100)}% confidence`}</small></span></li>)}
        </ul> : <p className="os-muted">No scoped failed-attempt memory is linked to this run or failure category.</p>}
      </section>
    </div>

    <section className="os-recovery-actions" aria-labelledby={`actions-${runId}`}>
      <p className="os-eyebrow">Supported recovery controls</p>
      <h3 id={`actions-${runId}`}>Act only through enforced backend boundaries</h3>
      <label><span>Operator reason (audited)</span><input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why is this recovery action necessary?" /></label>
      <ul>
        {recovery.actions.map((action) => <li key={action.kind}>
          <Button variant={actionVariant(action)} disabled={!action.available || mutation.pending || !reason.trim()} onClick={() => perform(action)}>{action.label}</Button>
          <span><StatusPill status={action.available ? "available" : "unavailable"} />{action.reason}</span>
        </li>)}
      </ul>
      {mutation.error && <ErrorPanel title="Recovery action was not accepted" error={mutation.error} />}
      {mutation.message && <p role="status" className="os-success-note">{mutation.message}</p>}
    </section>
  </Card>;
}
