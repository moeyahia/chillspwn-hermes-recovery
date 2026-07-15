import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useEventStream } from "../../data/events/EventStreamProvider";
import { Button, Card, EmptyState, ErrorPanel, LoadingPanel, StatusPill } from "../../design-system/components/Primitives";
import { AppLink } from "../../app/router/navigation";

export function formatTime(value: string | null | undefined): string {
  if (!value) return "Not reported";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "Not measured";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

export function percent(value: number | null | undefined, fractional = true): string {
  if (value === null || value === undefined) return "Not measured";
  return `${Math.round((fractional ? value * 100 : value))}%`;
}

export function JsonDetails({ value, label = "Technical detail" }: { value: unknown; label?: string }) {
  return <details className="os-raw-details"><summary>{label}</summary><pre>{JSON.stringify(value, null, 2)}</pre></details>;
}

export function StreamState() {
  const stream = useEventStream();
  const label = stream.state === "connected"
    ? "Live updates connected"
    : stream.state === "fallback"
      ? "Stream degraded — authoritative refresh active"
      : stream.state === "reconnecting"
        ? "Reconnecting live updates"
        : stream.state === "offline"
          ? "Offline — showing last validated state"
          : "Connecting live updates";
  return <span role="status" aria-live="polite"><StatusPill status={stream.state}>{label}</StatusPill></span>;
}

export function DegradedNotice({ children }: { children: ReactNode }) {
  return <div className="os-degraded" role="status"><strong>Partial data</strong><span>{children}</span></div>;
}

export function QueryBoundary<T>({ data, error, isLoading, onRetry, emptyTitle, emptyDescription, children }: {
  data: T[] | undefined; error?: Error; isLoading: boolean; onRetry: () => void;
  emptyTitle: string; emptyDescription: string; children: (items: T[]) => ReactNode;
}) {
  if (isLoading) return <LoadingPanel label="Loading verified operational records" />;
  if (error && !data) return <ErrorPanel error={error} onRetry={onRetry} />;
  if (!data?.length) return <Card><EmptyState title={emptyTitle} description={emptyDescription} /></Card>;
  return <>{error && <DegradedNotice>Refresh failed. The last validated response remains visible.</DegradedNotice>}{children(data)}</>;
}

export function CursorControls({ nextCursor, cursor, onChange }: { nextCursor: string | null; cursor?: string; onChange: (cursor?: string) => void }) {
  return <nav className="os-pagination" aria-label="Results pages"><Button variant="secondary" disabled={!cursor} onClick={() => onChange(undefined)}>First page</Button><Button variant="secondary" disabled={!nextCursor} onClick={() => onChange(nextCursor ?? undefined)}>Next page</Button></nav>;
}

export interface UrlFilters {
  readonly values: Readonly<Record<string, string>>;
  readonly set: (patch: Record<string, string | undefined>, options?: { resetCursor?: boolean; replace?: boolean }) => void;
  readonly key: string;
}

export function useUrlFilters(defaults: Record<string, string> = {}): UrlFilters {
  const read = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    const result: Record<string, string> = { ...defaults };
    params.forEach((value, key) => { result[key] = value; });
    return result;
  }, [JSON.stringify(defaults)]);
  const [values, setValues] = useState(read);
  useEffect(() => { const update = () => setValues(read()); window.addEventListener("popstate", update); return () => window.removeEventListener("popstate", update); }, [read]);
  const set = useCallback((patch: Record<string, string | undefined>, options: { resetCursor?: boolean; replace?: boolean } = {}) => {
    const params = new URLSearchParams(window.location.search);
    if (options.resetCursor !== false && !("cursor" in patch)) params.delete("cursor");
    Object.entries(patch).forEach(([key, value]) => value ? params.set(key, value) : params.delete(key));
    const url = `${window.location.pathname}${params.size ? `?${params.toString()}` : ""}`;
    window.history[options.replace === false ? "pushState" : "replaceState"]({}, "", url);
    setValues(read());
  }, [read]);
  return useMemo(() => ({ values, set, key: new URLSearchParams(values).toString() }), [values, set]);
}

export function FilterForm({ filters, children, searchLabel = "Search", searchKey = "query" }: { filters: UrlFilters; children?: ReactNode; searchLabel?: string; searchKey?: string }) {
  const [query, setQuery] = useState(filters.values[searchKey] ?? "");
  useEffect(() => setQuery(filters.values[searchKey] ?? ""), [filters.values[searchKey], searchKey]);
  const submit = (event: FormEvent) => { event.preventDefault(); filters.set({ [searchKey]: query || undefined }); };
  return <form className="os-filter-bar" onSubmit={submit}><label><span>{searchLabel}</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Filter by ${searchLabel.toLowerCase()}`} /></label>{children}<Button type="submit" variant="secondary">Apply filters</Button></form>;
}

export function SelectFilter({ filters, name, label, options }: { filters: UrlFilters; name: string; label: string; options: Array<{ value: string; label: string }> }) {
  return <label><span>{label}</span><select value={filters.values[name] ?? ""} onChange={(event) => filters.set({ [name]: event.target.value || undefined })}><option value="">All</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

export function SurfaceTabs({ current, items }: { current: string; items: Array<{ id: string; label: string; href?: string; onSelect?: () => void }> }) {
  return <nav className="os-surface-tabs" aria-label="Section views">{items.map((item) => item.href ? <AppLink key={item.id} href={item.href} aria-label={item.label} className={current === item.id ? "is-current" : undefined}>{item.label}</AppLink> : <button key={item.id} type="button" onClick={item.onSelect} aria-current={current === item.id ? "page" : undefined}>{item.label}</button>)}</nav>;
}

export function KeyValueGrid({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return <dl className="os-key-values">{items.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>;
}

export function useActionState() {
  const [pending, setPending] = useState(false); const [error, setError] = useState<Error>(); const [message, setMessage] = useState<string>();
  const run = useCallback(async (operation: () => Promise<unknown>, success: string) => { setPending(true); setError(undefined); setMessage(undefined); try { await operation(); setMessage(success); } catch (cause) { setError(cause instanceof Error ? cause : new Error("Action failed")); } finally { setPending(false); } }, []);
  return { pending, error, message, run, clear: () => { setError(undefined); setMessage(undefined); } };
}
