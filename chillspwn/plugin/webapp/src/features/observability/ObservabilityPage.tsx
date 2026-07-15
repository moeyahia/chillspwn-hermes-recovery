import { operationsApi } from "../../data/api/operations";
import { useQuery } from "../../data/cache/QueryProvider";
import { PageHeader, StatusPill } from "../../design-system/components/Primitives";
import { CursorControls, FilterForm, formatTime, JsonDetails, QueryBoundary, SelectFilter, StreamState, SurfaceTabs, useUrlFilters } from "../runs/OperationalSurface";

type View = "events" | "logs" | "health";
export default function ObservabilityPage() {
  const filters = useUrlFilters({ view: "events", limit: "50" });
  const view = (["events", "logs", "health"].includes(filters.values.view) ? filters.values.view : "events") as View;
  return <div className="os-page"><PageHeader eyebrow="Correlated operational truth" title="Observability" description="Semantic events first, with redacted raw attributes and trace pivots available on demand." actions={<StreamState />} />
    <SurfaceTabs current={view} items={["events", "logs", "health"].map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1), onSelect: () => filters.set({ view: id }) }))} />
    {view === "events" && <EventsView filters={filters} />}{view === "logs" && <LogsView filters={filters} />}{view === "health" && <HealthView filters={filters} />}
  </div>;
}

function EventsView({ filters }: { filters: ReturnType<typeof useUrlFilters> }) {
  const query = useQuery(`observability-events:${filters.key}`, (signal) => operationsApi.events(filters.values, signal));
  return <><FilterForm filters={filters} searchKey="eventType" searchLabel="Event type"><SelectFilter filters={filters} name="journey" label="Journey" options={[{ value: "autonomous", label: "Autonomous" }, { value: "guided", label: "Guided" }]} /></FilterForm>
    <QueryBoundary data={query.data?.items} error={query.error} isLoading={query.isLoading} onRetry={query.refresh} emptyTitle="No operational events" emptyDescription="The append-only event stream has no records in this filter scope.">{(items) => <><ol className="os-semantic-feed">{items.map((event) => <li key={event.id}><div className="os-feed-marker" aria-hidden="true" /><article><header><div><strong>{event.summary}</strong><span>{event.eventType}</span></div><time dateTime={event.occurredAt}>{formatTime(event.occurredAt)}</time></header><div className="os-feed-meta"><StatusPill status={event.journey ?? "system"} />{event.mission && <span>{event.mission.name}</span>}{event.actor.id && <span>{event.actor.type}: {event.actor.id}</span>}{event.correlation.traceId && <button type="button" onClick={() => filters.set({ traceId: event.correlation.traceId ?? undefined })}>Trace {event.correlation.traceId.slice(0, 12)}</button>}</div><JsonDetails label="Structured event payload" value={{ payload: event.payload, correlation: event.correlation, redaction: event.redaction }} /></article></li>)}</ol><CursorControls cursor={filters.values.cursor} nextCursor={query.data?.nextCursor ?? null} onChange={(cursor) => filters.set({ cursor }, { resetCursor: false, replace: false })} /></>}</QueryBoundary>
  </>;
}

function LogsView({ filters }: { filters: ReturnType<typeof useUrlFilters> }) {
  const query = useQuery(`observability-logs:${filters.key}`, (signal) => operationsApi.logs(filters.values, signal));
  return <><FilterForm filters={filters}><SelectFilter filters={filters} name="severity" label="Severity" options={["trace", "debug", "info", "warn", "error", "fatal"].map((value) => ({ value, label: value }))} /></FilterForm>
    <QueryBoundary data={query.data?.items} error={query.error} isLoading={query.isLoading} onRetry={query.refresh} emptyTitle="No structured logs" emptyDescription="No redacted logs match the selected correlation and severity filters.">{(items) => <><div className="os-table-wrap"><table className="os-data-table"><thead><tr><th>Message</th><th>Severity</th><th>Domain</th><th>Correlation</th><th>Time</th></tr></thead><tbody>{items.map((log) => <tr key={log.id}><th scope="row"><span>{log.message}</span><JsonDetails label="Attributes" value={log.attributes} /></th><td><StatusPill status={log.severity} /></td><td>{log.domain}</td><td>{log.correlation.traceId ? <button type="button" className="os-text-button" onClick={() => filters.set({ traceId: log.correlation.traceId ?? undefined })}>{log.correlation.traceId.slice(0, 12)}</button> : "—"}</td><td>{formatTime(log.occurredAt)}</td></tr>)}</tbody></table></div><CursorControls cursor={filters.values.cursor} nextCursor={query.data?.nextCursor ?? null} onChange={(cursor) => filters.set({ cursor }, { resetCursor: false, replace: false })} /></>}</QueryBoundary>
  </>;
}

function HealthView({ filters }: { filters: ReturnType<typeof useUrlFilters> }) {
  const query = useQuery(`observability-health:${filters.key}`, (signal) => operationsApi.health(filters.values, signal));
  return <><FilterForm filters={filters} searchKey="componentType" searchLabel="Component type"><SelectFilter filters={filters} name="status" label="Status" options={["healthy", "degraded", "unhealthy", "unknown"].map((value) => ({ value, label: value }))} /></FilterForm>
    <QueryBoundary data={query.data?.items} error={query.error} isLoading={query.isLoading} onRetry={query.refresh} emptyTitle="No health snapshots" emptyDescription="No component heartbeat has been captured in this scope.">{(items) => <><div className="os-health-grid">{items.map((item) => <article key={item.id}><div><strong>{item.componentId ?? "System"}</strong><span>{item.componentType ?? "component"}</span></div><StatusPill status={item.status} />{item.message && <p>{item.message}</p>}<time dateTime={item.capturedAt}>{formatTime(item.capturedAt)}</time><JsonDetails label="Health metrics" value={item.metrics} /></article>)}</div><CursorControls cursor={filters.values.cursor} nextCursor={query.data?.nextCursor ?? null} onChange={(cursor) => filters.set({ cursor }, { resetCursor: false, replace: false })} /></>}</QueryBoundary>
  </>;
}
