import { type FormEvent, useState } from "react";
import { AppLink } from "../../app/router/navigation";
import { operationsApi } from "../../data/api/operations";
import { useQuery } from "../../data/cache/QueryProvider";
import type { ArtifactRecord, EvidenceRecord, FindingRecord } from "../../domain/types/operations";
import { Button, Card, ErrorPanel, LoadingPanel, PageHeader, StatusPill } from "../../design-system/components/Primitives";
import { CursorControls, FilterForm, formatTime, JsonDetails, KeyValueGrid, QueryBoundary, SelectFilter, StreamState, SurfaceTabs, useActionState, useUrlFilters } from "../runs/OperationalSurface";

type IntelligenceView = "evidence" | "findings" | "artifacts";

export default function IntelligencePage({ view, selectedId }: { view: IntelligenceView; selectedId?: string }) {
  return <div className="os-page"><PageHeader eyebrow="Verified intelligence" title="Evidence, findings, and artifacts" description="Immutable provenance and evidence-gated conclusions from authorized missions." actions={<StreamState />} />
    <SurfaceTabs current={view} items={[{ id: "evidence", label: "Evidence", href: "/intelligence/evidence" }, { id: "findings", label: "Findings", href: "/intelligence/findings" }, { id: "artifacts", label: "Artifacts", href: "/intelligence/artifacts" }]} />
    {view === "evidence" && <EvidenceView selectedId={selectedId} />}{view === "findings" && <FindingView selectedId={selectedId} />}{view === "artifacts" && <ArtifactView selectedId={selectedId} />}
  </div>;
}

function EvidenceView({ selectedId }: { selectedId?: string }) {
  const filters = useUrlFilters({ limit: "25" });
  const list = useQuery(`evidence:${filters.key}`, (signal) => operationsApi.evidence(filters.values, signal));
  const detail = useQuery(`evidence-detail:${selectedId ?? "none"}`, (signal) => selectedId ? operationsApi.evidenceDetail(selectedId, signal) : Promise.resolve(undefined));
  return <><FilterForm filters={filters}><SelectFilter filters={filters} name="verificationState" label="Verification" options={["unverified", "verified", "disputed", "rejected"].map((value) => ({ value, label: value }))} /></FilterForm>
    <EvidenceRunExportControl runId={filters.values.runId || detail.data?.runId || undefined} />
    <IntelligenceLayout list={<QueryBoundary data={list.data?.items} error={list.error} isLoading={list.isLoading} onRetry={list.refresh} emptyTitle="No evidence retained" emptyDescription="Evidence will appear after an authorized action produces a hashed record.">{(items) => <><EvidenceTable items={items} selectedId={selectedId} /><CursorControls cursor={filters.values.cursor} nextCursor={list.data?.nextCursor ?? null} onChange={(cursor) => filters.set({ cursor }, { resetCursor: false, replace: false })} /></>}</QueryBoundary>} detail={<EvidenceDetail item={detail.data} loading={detail.isLoading && Boolean(selectedId)} error={detail.error} onRetry={detail.refresh} />} />
  </>;
}

const EXACT_RUN_ID = /^[A-Za-z0-9._:@/-]{1,200}$/u;

export function EvidenceRunExportControl({ runId }: { runId?: string }) {
  const exactRunId = runId?.trim();
  if (!exactRunId || !EXACT_RUN_ID.test(exactRunId)) return null;
  return <Card aria-label="Exact run evidence export">
    <div className="os-card-heading">
      <div><p className="os-eyebrow">Exact run scope</p><h2>Bounded evidence metadata export</h2></div>
      <a className="os-button os-button--secondary" href={operationsApi.evidenceRunExportUrl(exactRunId)}>Export evidence metadata</a>
    </div>
    <p className="os-muted">Run <span className="os-mono">{exactRunId}</span> is the exact export boundary. The server re-checks authorization and sensitivity, bounds the record count and size, and excludes raw evidence content and storage paths.</p>
  </Card>;
}

function EvidenceTable({ items, selectedId }: { items: EvidenceRecord[]; selectedId?: string }) {
  return <div className="os-table-wrap"><table className="os-data-table"><thead><tr><th>Evidence</th><th>Mission</th><th>Type</th><th>Verification</th><th>Acquired</th></tr></thead><tbody>{items.map((item) => <tr key={item.id} className={item.id === selectedId ? "is-selected" : undefined}><th scope="row"><AppLink href={`/intelligence/evidence/${encodeURIComponent(item.id)}`}>{item.summary || item.id}</AppLink><small className="os-mono">{item.contentHash.slice(0, 12)}…</small></th><td>{item.mission.name}</td><td>{item.evidenceType}</td><td><StatusPill status={item.verificationState} /></td><td>{formatTime(item.acquiredAt)}</td></tr>)}</tbody></table></div>;
}

function EvidenceDetail({ item, loading, error, onRetry }: { item?: EvidenceRecord; loading: boolean; error?: Error; onRetry: () => void }) {
  if (loading) return <LoadingPanel label="Loading evidence provenance" />; if (error && !item) return <ErrorPanel error={error} onRetry={onRetry} />; if (!item) return <Card><p className="os-muted">Select evidence to inspect provenance and chain of custody.</p></Card>;
  return <Card><div className="os-card-heading"><h2>{item.summary || "Evidence record"}</h2><StatusPill status={item.verificationState} /></div><KeyValueGrid items={[{ label: "Target", value: item.target ?? "Not reported" }, { label: "Confidence", value: item.confidence === null ? "Not scored" : `${Math.round(item.confidence * 100)}%` }, { label: "Sensitivity", value: item.sensitivity }, { label: "Hash", value: <span className="os-mono">{item.contentHash}</span> }]} />
    <h3>Chain of custody</h3>{item.chainOfCustody?.length ? <ol className="os-timeline">{item.chainOfCustody.map((event) => <li key={event.id}><strong>{event.eventType}</strong><span>{event.actor} · {formatTime(event.occurredAt)}</span><JsonDetails value={event.details} /></li>)}</ol> : <p className="os-muted">No custody events returned.</p>}<JsonDetails label="Provenance" value={item.provenance} /></Card>;
}

function FindingView({ selectedId }: { selectedId?: string }) {
  const filters = useUrlFilters({ limit: "25" });
  const list = useQuery(`findings:${filters.key}`, (signal) => operationsApi.findings(filters.values, signal));
  const detail = useQuery(`finding-detail:${selectedId ?? "none"}`, (signal) => selectedId ? operationsApi.finding(selectedId, signal) : Promise.resolve(undefined), { staleTime: 0 });
  return <><FilterForm filters={filters}><SelectFilter filters={filters} name="severity" label="Severity" options={["informational", "low", "medium", "high", "critical"].map((value) => ({ value, label: value }))} /><SelectFilter filters={filters} name="reviewStatus" label="Review" options={["draft", "under_review", "verified", "rejected", "accepted_risk"].map((value) => ({ value, label: value }))} /></FilterForm>
    <IntelligenceLayout list={<QueryBoundary data={list.data?.items} error={list.error} isLoading={list.isLoading} onRetry={list.refresh} emptyTitle="No findings recorded" emptyDescription="Evidence-linked conclusions will appear here for review.">{(items) => <><div className="os-table-wrap"><table className="os-data-table"><thead><tr><th>Finding</th><th>Severity</th><th>Evidence</th><th>Review</th><th>Updated</th></tr></thead><tbody>{items.map((item) => <tr key={item.id} className={item.id === selectedId ? "is-selected" : undefined}><th scope="row"><AppLink href={`/intelligence/findings/${encodeURIComponent(item.id)}`}>{item.title}</AppLink><small>{item.mission.name}</small></th><td><StatusPill status={item.severity} /></td><td>{item.verifiedEvidenceCount}/{item.evidenceCount} verified</td><td><StatusPill status={item.reviewStatus} /></td><td>{formatTime(item.updatedAt)}</td></tr>)}</tbody></table></div><CursorControls cursor={filters.values.cursor} nextCursor={list.data?.nextCursor ?? null} onChange={(cursor) => filters.set({ cursor }, { resetCursor: false, replace: false })} /></>}</QueryBoundary>} detail={<FindingDetail item={detail.data} loading={detail.isLoading && Boolean(selectedId)} error={detail.error} onRetry={detail.refresh} onChanged={() => { detail.refresh(); list.refresh(); }} />} />
  </>;
}

function FindingDetail({ item, loading, error, onRetry, onChanged }: { item?: FindingRecord; loading: boolean; error?: Error; onRetry: () => void; onChanged: () => void }) {
  const [status, setStatus] = useState("under_review"); const [reason, setReason] = useState(""); const [override, setOverride] = useState(false); const action = useActionState();
  if (loading) return <LoadingPanel label="Loading finding evidence" />; if (error && !item) return <ErrorPanel error={error} onRetry={onRetry} />; if (!item) return <Card><p className="os-muted">Select a finding to inspect impact and linked evidence.</p></Card>;
  const submit = (event: FormEvent) => { event.preventDefault(); void action.run(() => operationsApi.reviewFinding(item.id, { expectedVersion: item.version, status, reason, operatorOverride: override }, `finding-${crypto.randomUUID()}`).then(onChanged), "Finding review recorded."); };
  return <Card><div className="os-card-heading"><h2>{item.title}</h2><StatusPill status={item.severity} /></div><p>{item.description}</p><h3>Impact</h3><p>{item.impact}</p>{item.remediation && <><h3>Remediation</h3><p>{item.remediation}</p></>}<KeyValueGrid items={[{ label: "Affected scope", value: item.affectedScope }, { label: "Confidence", value: item.confidence === null ? "Not scored" : `${Math.round(item.confidence * 100)}%` }, { label: "Evidence", value: `${item.verifiedEvidenceCount}/${item.evidenceCount} verified` }, { label: "Version", value: item.version }]} />
    {item.evidence?.length ? <ul className="os-compact-list">{item.evidence.map((evidence) => <li key={evidence.id}><span>{evidence.summary}</span><StatusPill status={evidence.verificationState} /></li>)}</ul> : <p className="os-muted">No evidence links were returned. Verification remains evidence-gated.</p>}
    <form className="os-review-form" onSubmit={submit}><h3>Record review decision</h3><label><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value)}>{["under_review", "verified", "rejected", "accepted_risk"].map((value) => <option key={value}>{value}</option>)}</select></label><label><span>Reason</span><textarea required value={reason} onChange={(event) => setReason(event.target.value)} /></label><label className="os-check"><input type="checkbox" checked={override} onChange={(event) => setOverride(event.target.checked)} /><span>Explicit evidence-gate override (audited)</span></label>{action.error && <ErrorPanel error={action.error} />}{action.message && <p role="status" className="os-success-note">{action.message}</p>}<Button disabled={action.pending || reason.trim().length < 3}>{action.pending ? "Recording…" : "Record decision"}</Button></form>
  </Card>;
}

function ArtifactView({ selectedId }: { selectedId?: string }) {
  const filters = useUrlFilters({ limit: "25" }); const list = useQuery(`artifacts:${filters.key}`, (signal) => operationsApi.artifacts(filters.values, signal)); const detail = useQuery(`artifact:${selectedId ?? "none"}`, (signal) => selectedId ? operationsApi.artifact(selectedId, signal) : Promise.resolve(undefined));
  return <><FilterForm filters={filters} searchKey="artifactType" searchLabel="Artifact type" /><IntelligenceLayout list={<QueryBoundary data={list.data?.items} error={list.error} isLoading={list.isLoading} onRetry={list.refresh} emptyTitle="No artifacts produced" emptyDescription="Reports, captures, and exports will appear after durable creation.">{(items) => <><div className="os-table-wrap"><table className="os-data-table"><thead><tr><th>Artifact</th><th>Mission</th><th>Size</th><th>Storage</th><th>Created</th></tr></thead><tbody>{items.map((item) => <tr key={item.id} className={item.id === selectedId ? "is-selected" : undefined}><th scope="row"><AppLink href={`/intelligence/artifacts/${encodeURIComponent(item.id)}`}>{item.artifactType}</AppLink><small>{item.mediaType}</small></th><td>{item.mission.name}</td><td>{new Intl.NumberFormat(undefined, { notation: "compact", style: "unit", unit: "byte" }).format(item.byteSize)}</td><td><StatusPill status={item.storage.available ? "available" : "unavailable"}>{item.storage.scheme}</StatusPill></td><td>{formatTime(item.createdAt)}</td></tr>)}</tbody></table></div><CursorControls cursor={filters.values.cursor} nextCursor={list.data?.nextCursor ?? null} onChange={(cursor) => filters.set({ cursor }, { resetCursor: false, replace: false })} /></>}</QueryBoundary>} detail={<ArtifactDetail item={detail.data} loading={detail.isLoading && Boolean(selectedId)} error={detail.error} onRetry={detail.refresh} />} /></>;
}

export function supportsVerifiedArtifactDownload(item: Pick<ArtifactRecord, "artifactType" | "storage">): boolean {
  return item.artifactType === "obsidian_attachment"
    && item.storage.scheme === "vault-attachment"
    && item.storage.available;
}

export function ArtifactDetail({ item, loading, error, onRetry }: { item?: ArtifactRecord; loading: boolean; error?: Error; onRetry: () => void }) {
  if (loading) return <LoadingPanel label="Loading artifact metadata" />;
  if (error && !item) return <ErrorPanel error={error} onRetry={onRetry} />;
  if (!item) return <Card><p className="os-muted">Select an artifact to inspect its hash, provenance-safe storage projection, and evaluation link.</p></Card>;
  const supportsDownload = supportsVerifiedArtifactDownload(item);
  return <Card>
    <div className="os-card-heading"><h2>{item.artifactType}</h2><StatusPill status={supportsDownload ? "verified_delivery" : "metadata_only"}>{supportsDownload ? "Verified delivery" : "Metadata only"}</StatusPill></div>
    <KeyValueGrid items={[{ label: "Mission", value: item.mission.name }, { label: "Media type", value: item.mediaType }, { label: "Byte size", value: item.byteSize.toLocaleString() }, { label: "Storage scheme", value: item.storage.scheme }, { label: "Hash", value: <span className="os-mono">{item.contentHash}</span> }]} />
    <JsonDetails label="Artifact metadata" value={item.metadata} />
    {supportsDownload ? <>
      <div className="os-completion-actions"><a className="os-button os-button--primary" href={operationsApi.artifactDownloadUrl(item.id)}>Download verified content</a></div>
      <p className="os-muted">The server will re-check mission scope, sensitivity, vault permission, file containment, byte size, and SHA-256 before returning an inert attachment.</p>
    </> : <p className="os-muted">Artifact content remains metadata-only. Storage scheme <span className="os-mono">{item.storage.scheme}</span> has no approved canonical content-delivery adapter.</p>}
  </Card>;
}

function IntelligenceLayout({ list, detail }: { list: React.ReactNode; detail: React.ReactNode }) { return <div className="os-master-detail"><section>{list}</section><aside className="os-detail-panel">{detail}</aside></div>; }
