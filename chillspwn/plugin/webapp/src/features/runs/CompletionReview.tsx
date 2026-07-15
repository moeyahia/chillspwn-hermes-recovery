import { useMemo, useState } from "react";
import { operationsApi } from "../../data/api/operations";
import { useQuery } from "../../data/cache/QueryProvider";
import { Button, ButtonLink, Card, LoadingPanel, StatusPill } from "../../design-system/components/Primitives";
import type { RunPlan, RuntimeRun } from "../../domain/types/runtimeV2";
import { comparisonBasisLabel, completionOutcomeLabel, formatComparisonMetricValue, summarizeCompletionEvents, unresolvedCompletionItems } from "../../lib/completionReview";
import { ContextPackPanel } from "../brain/ContextPackPanel";
import { DegradedNotice, formatDuration, formatTime, JsonDetails, percent } from "./OperationalSurface";

const TERMINAL = new Set(["completed", "failed", "cancelled"]);

function elapsedSeconds(run: RuntimeRun): number | null {
  if (!run.startedAt || !run.endedAt) return null;
  const elapsed = Date.parse(run.endedAt) - Date.parse(run.startedAt);
  return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed / 1_000 : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** A reusable, real-data completion review rendered only for terminal runs. */
export function CompletionReview({ run, plan, missionSuccessCriteria = [] }: {
  run: RuntimeRun;
  plan?: RunPlan;
  missionSuccessCriteria?: readonly string[];
}) {
  const [selectedContextPackId, setSelectedContextPackId] = useState<string>();
  const evidence = useQuery(`completion-evidence:${run.id}`, (signal) => operationsApi.evidence({ runId: run.id, limit: 100 }, signal), { staleTime: 15_000 });
  const findings = useQuery(`completion-findings:${run.id}`, (signal) => operationsApi.findings({ runId: run.id, limit: 100 }, signal), { staleTime: 15_000 });
  const artifacts = useQuery(`completion-artifacts:${run.id}`, (signal) => operationsApi.artifacts({ runId: run.id, limit: 100 }, signal), { staleTime: 15_000 });
  const evaluations = useQuery(`completion-evaluations:${run.id}`, (signal) => operationsApi.evaluations({ runId: run.id, limit: 10 }, signal), { staleTime: 15_000 });
  const events = useQuery(`completion-events:${run.id}`, (signal) => operationsApi.events({ runId: run.id, limit: 100 }, signal), { staleTime: 15_000 });
  const lessons = useQuery(`completion-lessons:${run.missionId}`, (signal) => operationsApi.lessons({ missionId: run.missionId, limit: 100 }, signal), { staleTime: 15_000 });
  const lessonUsage = useQuery(`completion-lesson-usage:${run.id}`, (signal) => operationsApi.lessonUsage({ runId: run.id, limit: 100 }, signal), { staleTime: 15_000 });

  const eventSummary = useMemo(() => summarizeCompletionEvents(events.data?.items ?? []), [events.data?.items]);
  const contextPackIds = useMemo(() => [...new Set([
    ...eventSummary.contextPackIds,
    ...(lessonUsage.data?.items.map((item) => item.contextPackId).filter((id): id is string => Boolean(id)) ?? []),
  ])], [eventSummary.contextPackIds, lessonUsage.data?.items]);
  const unresolved = unresolvedCompletionItems(plan?.steps ?? [], findings.data?.items ?? []);
  const evaluation = evaluations.data?.items[0];
  const reportArtifacts = artifacts.data?.items.filter((item) => item.artifactType.toLocaleLowerCase("en-US").includes("report")) ?? [];
  const verifiedEvidence = evidence.data?.items.filter((item) => item.verificationState === "verified").length ?? 0;
  const verifiedFindings = findings.data?.items.filter((item) => item.reviewStatus === "verified").length ?? 0;
  const loading = [evidence, findings, artifacts, evaluations, events, lessons, lessonUsage].some((query) => query.isLoading && !query.data);
  const errors = [evidence.error, findings.error, artifacts.error, evaluations.error, events.error, lessons.error, lessonUsage.error].filter((error): error is Error => Boolean(error));
  const criteria = plan?.steps.flatMap((step) => step.successCriteria.map((criterion) => ({ criterion, status: step.status, step: step.title }))) ?? [];

  if (!TERMINAL.has(run.status)) return null;

  return <section className="os-completion-review" aria-labelledby={`completion-review-${run.id}`}>
    <Card className={`os-completion-hero os-completion-hero--${run.status}`}>
      <div className="os-card-heading"><div><p className="os-eyebrow">Mission completion review</p><h2 id={`completion-review-${run.id}`}>{completionOutcomeLabel(run)}</h2></div><StatusPill status={run.status} /></div>
      <p>{run.statusReason ?? evaluation?.retrospective ?? "The run reached a terminal state. Evaluation details remain linked below."}</p>
      <div className="os-completion-actions">
        <a className="os-button os-button--primary" href={operationsApi.runCompletionExportUrl(run.id)} download>Export authorized completion bundle</a>
        <ButtonLink href={`/intelligence/evidence?runId=${encodeURIComponent(run.id)}`} variant="secondary">Review evidence</ButtonLink>
        <ButtonLink href={`/reports?runId=${encodeURIComponent(run.id)}`} variant="quiet">Open reports</ButtonLink>
      </div>
      <p className="os-muted">The export is scope-checked and metadata-only. It excludes raw evidence, tool/provider payloads, artifact paths, memory-note bodies, and authentication material.</p>
    </Card>

    {loading && <LoadingPanel label="Assembling evidence-linked completion records" />}
    {errors.length > 0 && <DegradedNotice>{errors.length} completion data source{errors.length === 1 ? " is" : "s are"} unavailable. The visible records remain authoritative; retry from the linked domain view.</DegradedNotice>}

    <section className="os-metric-row" aria-label="Completion metrics">
      <div><span>Evidence verified</span><strong>{verifiedEvidence}/{evidence.data?.items.length ?? 0}</strong></div>
      <div><span>Findings verified</span><strong>{verifiedFindings}/{findings.data?.items.length ?? 0}</strong></div>
      <div><span>Evidence coverage</span><strong>{percent(evaluation?.evidenceCoverage)}</strong></div>
      <div><span>Elapsed</span><strong>{formatDuration(elapsedSeconds(run))}</strong></div>
    </section>

    <div className="os-completion-grid">
      <Card>
        <div className="os-card-heading"><div><p className="os-eyebrow">Outcome validation</p><h3>Success criteria and evaluation</h3></div><StatusPill status={evaluation ? "evaluated" : "pending"} /></div>
        {missionSuccessCriteria.length > 0 && <><h4>Mission criteria</h4><ul className="os-compact-list">{missionSuccessCriteria.map((criterion) => <li key={criterion}><span>{criterion}</span><StatusPill status={evaluation ? "evaluated" : "awaiting_evaluation"} /></li>)}</ul></>}
        {criteria.length > 0 && <><h4>Plan criteria</h4><ul className="os-compact-list">{criteria.map((item, index) => <li key={`${item.step}:${index}`}><span><strong>{item.criterion}</strong><small>{item.step}</small></span><StatusPill status={item.status} /></li>)}</ul></>}
        {!evaluation && <p className="os-muted">No journey-aware run evaluation has been persisted yet. The terminal outcome is visible, but the system does not claim an evaluation score.</p>}
        {evaluation && <><p>{evaluation.retrospective}</p><JsonDetails label="Evaluation scores and measured metrics" value={{ scores: evaluation.scores, metrics: evaluation.metrics, createdAt: evaluation.createdAt }} /></>}
      </Card>

      <Card>
        <div className="os-card-heading"><div><p className="os-eyebrow">Reliability and policy</p><h3>Retries, recoveries, and interventions</h3></div><StatusPill status={eventSummary.safeStopEvents > 0 ? "safe_stopped" : "recorded"} /></div>
        <dl className="os-review-grid"><div><dt>Retry events</dt><dd>{eventSummary.retryEvents}</dd></div><div><dt>Recovery events</dt><dd>{eventSummary.recoveryEvents}</dd></div><div><dt>Policy/decision events</dt><dd>{eventSummary.policyEvents}</dd></div><div><dt>Safe stops</dt><dd>{eventSummary.safeStopEvents}</dd></div></dl>
        <p className="os-muted">Counts reflect the latest 100 scope-visible semantic events; the downloadable bundle includes up to 1,000 records per domain and declares truncation.</p>
        {(events.data?.items ?? []).filter((item) => /recover|retry|policy|contract|scope|approval|decision/iu.test(`${item.eventType} ${item.summary}`)).slice(0, 6).map((item) => <article className="os-completion-event" key={item.id}><strong>{item.summary}</strong><span>{item.eventType} · {formatTime(item.occurredAt)}</span></article>)}
      </Card>

      <Card>
        <div className="os-card-heading"><div><p className="os-eyebrow">Measured comparison</p><h3>Comparable prior-run performance</h3></div><StatusPill status={evaluation?.comparison.status === "available" ? "recorded" : "insufficient_data"} /></div>
        {!evaluation && <p className="os-muted">Insufficient comparable data: the current run does not yet have a persisted evaluation.</p>}
        {evaluation && <>
          <p>{evaluation.comparison.summary}</p>
          <dl className="os-review-grid">
            <div><dt>Basis</dt><dd>{comparisonBasisLabel(evaluation.comparison.basis)}</dd></div>
            <div><dt>Prior outcome</dt><dd>{evaluation.comparison.prior?.terminalStatus ?? "Not available"}</dd></div>
            <div><dt>Outcome matched</dt><dd>{evaluation.comparison.terminalStatusMatch === null ? "Not available" : evaluation.comparison.terminalStatusMatch ? "Yes" : "No"}</dd></div>
            <div><dt>Metrics compared</dt><dd>{evaluation.comparison.metrics.length}</dd></div>
          </dl>
          {evaluation.comparison.status === "available" && <ul className="os-compact-list">
            {evaluation.comparison.metrics.map((metric) => <li key={metric.key}><span><strong>{metric.label}</strong><small>Current {formatComparisonMetricValue(metric, metric.current)} · prior {formatComparisonMetricValue(metric, metric.prior)} · delta {metric.delta > 0 ? "+" : ""}{formatComparisonMetricValue(metric, metric.delta)}</small></span><StatusPill status={metric.movement}>{metric.movement}</StatusPill></li>)}
          </ul>}
          <p className="os-muted">The baseline is selected deterministically from canonical evaluations and never crosses an engagement. Directional changes are descriptive and are not proof that the system improved.</p>
        </>}
      </Card>

      <Card>
        <div className="os-card-heading"><div><p className="os-eyebrow">Intelligence</p><h3>Evidence, findings, and deliverables</h3></div><StatusPill status={evidence.data?.items.length ? "available" : "empty"} /></div>
        <ul className="os-compact-list">
          {(findings.data?.items ?? []).slice(0, 6).map((finding) => <li key={finding.id}><span><strong>{finding.title}</strong><small>{finding.evidenceCount} linked evidence · {finding.severity}</small></span><StatusPill status={finding.reviewStatus} /></li>)}
          {(findings.data?.items.length ?? 0) === 0 && <li><span>No finding records were produced for this run.</span></li>}
        </ul>
        <h4>Artifacts and reports</h4>
        <ul className="os-compact-list">{(artifacts.data?.items ?? []).slice(0, 6).map((artifact) => <li key={artifact.id}><span><strong>{artifact.artifactType}</strong><small>{artifact.byteSize.toLocaleString()} B · {artifact.contentHash.slice(0, 12)}…</small></span><StatusPill status={artifact.storage.available ? "available" : "unavailable"} /></li>)}{(artifacts.data?.items.length ?? 0) === 0 && <li><span>No artifact metadata was recorded.</span></li>}</ul>
        <p className="os-muted">{reportArtifacts.length} report artifact{reportArtifacts.length === 1 ? "" : "s"} linked to this run.</p>
      </Card>

      <Card>
        <div className="os-card-heading"><div><p className="os-eyebrow">Second Brain and learning</p><h3>Context used and lessons proposed</h3></div><StatusPill status={contextPackIds.length ? "recorded" : "not_used"} /></div>
        <ul className="os-compact-list">{(lessonUsage.data?.items ?? []).map((usage) => <li key={usage.id}><span><strong>{usage.lesson.statement}</strong><small>{usage.influenceSummary}</small></span><StatusPill status="reused" /></li>)}{(lessonUsage.data?.items.length ?? 0) === 0 && <li><span>No verified lesson usage was recorded for this run.</span></li>}</ul>
        {(lessons.data?.items.length ?? 0) > 0 && <JsonDetails label="Mission lesson candidates and review states" value={lessons.data?.items.map((lesson) => ({ id: lesson.id, statement: lesson.statement, status: lesson.status, evidenceCount: lesson.evidenceCount }))} />}
        {contextPackIds.length > 0 && <div className="os-context-pack-links"><span>Inspectable context packs</span>{contextPackIds.map((packId) => <Button key={packId} variant="quiet" onClick={() => setSelectedContextPackId(selectedContextPackId === packId ? undefined : packId)}>{selectedContextPackId === packId ? "Hide context" : `Inspect ${packId}`}</Button>)}</div>}
        {selectedContextPackId && <ContextPackPanel packId={selectedContextPackId} />}
        <ButtonLink href={`/brain/graph?runId=${encodeURIComponent(run.id)}`} variant="secondary">Open memory graph</ButtonLink>
      </Card>
    </div>

    <Card className="os-unresolved-review">
      <div className="os-card-heading"><div><p className="os-eyebrow">Follow-up</p><h3>Unresolved items</h3></div><StatusPill status={unresolved.length ? "attention" : "clear"} /></div>
      {unresolved.length === 0 ? <p className="os-muted">No unresolved latest-plan steps or unreviewed findings are visible in the current scope.</p> : <ul className="os-compact-list">{unresolved.map((item) => <li key={`${item.type}:${item.id}`}><span><strong>{item.summary}</strong><small>{item.type} · {item.id}</small></span><StatusPill status={item.status} /></li>)}</ul>}
      {run.statusReason && <p><strong>Terminal reason:</strong> {text(run.statusReason)}</p>}
    </Card>
  </section>;
}
