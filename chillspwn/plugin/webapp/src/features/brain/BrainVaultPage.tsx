import { useState } from "react";
import { connectVault, exportVault, fetchVaultSnapshot, importVault, portableExportVault, resolveVaultConflict, syncVault } from "../../data/api/brain";
import { useQuery } from "../../data/cache/QueryProvider";
import { Button, Card, ErrorPanel, LoadingPanel, PageHeader, StatusPill } from "../../design-system/components/Primitives";
import type { VaultOperationResult } from "../../domain/types/brain";
import { BrainEmpty, BrainNav, formatBrainDate } from "./BrainNav";

export default function BrainVaultPage() {
  const vault = useQuery("brain-vault", fetchVaultSnapshot, { staleTime: 0 });
  const [path, setPath] = useState("");
  const [name, setName] = useState("ChillsPwn Brain");
  const [permission, setPermission] = useState(false);
  const [state, setState] = useState<{ busy?: string; result?: VaultOperationResult; message?: string; error?: Error }>({});
  const snapshot = vault.data;
  const run = async (busy: string, action: () => Promise<VaultOperationResult>, message?: string) => {
    setState({ busy });
    try { const result = await action(); setState({ result, message: message ?? result.message }); vault.refresh(); }
    catch (error) { setState({ error: error instanceof Error ? error : new Error("Vault operation failed") }); }
  };
  const connect = async () => {
    setState({ busy: "connect" });
    try {
      await connectVault({ vaultPath: path.trim(), displayName: name.trim(), permissionGranted: true, syncScope: { lifecycleStatuses: ["confirmed", "verified", "disputed", "stale"] } });
      setState({ message: "Vault connected. Canonical data remains in SQLite until you explicitly export or synchronize." }); setPath(""); setPermission(false); vault.refresh();
    } catch (error) { setState({ error: error instanceof Error ? error : new Error("Unable to connect vault") }); }
  };
  return (
    <div className="os-page brain-page brain-vault-page">
      <PageHeader eyebrow="Human-readable memory projection" title="Obsidian Vault" description="A versioned Markdown, YAML, and [[wikilink]] projection. SQLite remains canonical; filesystem conflicts never overwrite operator edits silently." />
      <BrainNav />
      {vault.isLoading && <LoadingPanel label="Checking Obsidian vault health and conflicts" />}
      {vault.error && !vault.data && <ErrorPanel error={vault.error} onRetry={vault.refresh} />}
      {snapshot && <>
        <Card className="brain-vault-connect"><div className="os-section-heading"><div><p className="os-eyebrow">Filesystem permission</p><h2>Connect a local vault</h2></div><StatusPill status={snapshot.enabled ? "available" : "disabled"} /></div><p>The server permits vaults only inside {snapshot.allowedRootLabel ?? "its configured vault root"}. It rejects absolute escape paths, traversal, and symlink boundaries.</p><div className="os-field-grid"><label>Display name<input value={name} onChange={(event) => setName(event.target.value)} /></label><label>Path inside the allowed root<input value={path} onChange={(event) => setPath(event.target.value)} placeholder="ChillsPwn-Brain" /></label></div><label className="os-check-field"><input type="checkbox" checked={permission} onChange={(event) => setPermission(event.target.checked)} /><span><strong>Grant explicit filesystem permission</strong><small>Allow ChillsPwn to create and atomically synchronize Markdown notes inside this selected vault only.</small></span></label><Button onClick={connect} disabled={!snapshot.enabled || !permission || !name.trim() || !path.trim() || Boolean(state.busy)}>Connect vault</Button></Card>
        {snapshot.connections.length === 0 ? <Card><BrainEmpty kind="vault" title="No Obsidian vault connected" description="Connect a path inside the server-configured root to export confirmed memory as portable Markdown and wikilinks." /></Card> : <div className="brain-vault-connections">{snapshot.connections.map((connection) => { const states = snapshot.syncStates.filter((item) => item.connectionId === connection.id); return <Card key={connection.id}><header><div><p className="os-eyebrow">{connection.displayName}</p><h2>{connection.vaultPath}</h2></div><StatusPill status={connection.status} /></header><dl><div><dt>Permission granted</dt><dd>{formatBrainDate(connection.permissionGrantedAt)}</dd></div><div><dt>Last synchronized</dt><dd>{formatBrainDate(connection.lastSyncAt)}</dd></div><div><dt>Tracked notes</dt><dd>{states.length}</dd></div><div><dt>Needs review</dt><dd>{states.filter((item) => ["conflict", "quarantined", "error"].includes(item.status)).length}</dd></div></dl><div className="brain-vault-actions"><Button variant="secondary" onClick={() => run(`sync:${connection.id}`, () => syncVault(connection.id))} disabled={Boolean(state.busy)}>Synchronize</Button><Button variant="quiet" onClick={() => run(`export:${connection.id}`, () => exportVault(connection.id))} disabled={Boolean(state.busy)}>Export canonical notes</Button><Button variant="quiet" onClick={() => run(`import:${connection.id}`, () => importVault(connection.id))} disabled={Boolean(state.busy)}>Import operator edits</Button><Button variant="quiet" onClick={() => run(`portable:${connection.id}`, () => portableExportVault(connection.id))} disabled={Boolean(state.busy)}>Create portable ZIP</Button>{connection.obsidianUrl && <a className="os-button os-button--quiet" href={connection.obsidianUrl} rel="noopener noreferrer">Open vault in Obsidian</a>}</div>{states.length > 0 && <details><summary>Note synchronization state</summary><ul className="brain-sync-list">{states.slice(0, 100).map((item) => <li key={item.id}><span><code>{item.relativePath}</code>{item.errorMessage && <small>{item.errorMessage}</small>}</span><span className="brain-sync-status">{item.obsidianUrl && <a href={item.obsidianUrl} rel="noopener noreferrer" aria-label={`Open ${item.relativePath} in Obsidian`}>Open</a>}<StatusPill status={item.status} /></span></li>)}</ul></details>}</Card>; })}</div>}
        <Card className="brain-conflicts"><div className="os-section-heading"><div><p className="os-eyebrow">Never silently overwritten</p><h2>Vault conflicts</h2></div><span className="os-count">{snapshot.conflicts.filter((item) => item.status === "open").length}</span></div>{snapshot.conflicts.filter((item) => item.status === "open").length === 0 ? <p className="os-muted">No concurrent database and vault edits require resolution.</p> : <div className="brain-conflict-list">{snapshot.conflicts.filter((item) => item.status === "open").map((conflict) => <article key={conflict.id}><header><div><strong>{conflict.relativePath}</strong><small>Detected {formatBrainDate(conflict.detectedAt)}</small></div><StatusPill status="conflict" /></header>{(conflict.databaseTextRedacted || conflict.vaultTextRedacted) && <div className="brain-conflict-diff"><section><h3>Canonical database</h3><pre>{conflict.databaseTextRedacted ?? "Preview not returned by the service."}</pre></section><section><h3>Obsidian vault</h3><pre>{conflict.vaultTextRedacted ?? "Preview not returned by the service."}</pre></section></div>}<p>Choose which version becomes canonical. The losing version remains represented by audit and version history according to policy.</p><div><Button variant="secondary" onClick={() => run(`resolve-db:${conflict.id}`, () => resolveVaultConflict(conflict.id, "database"), "Conflict resolved using the canonical database version.")} disabled={Boolean(state.busy)}>Keep database version</Button><Button variant="secondary" onClick={() => run(`resolve-vault:${conflict.id}`, () => resolveVaultConflict(conflict.id, "vault"), "Conflict resolved using the operator's vault version.")} disabled={Boolean(state.busy)}>Keep vault version</Button></div></article>)}</div>}</Card>
      </>}
      {state.message && <div className="brain-operation-toast" role="status"><p>{state.message}</p>{state.result?.downloadUrl && <a href={state.result.downloadUrl}>Download portable ZIP</a>}</div>}{state.error && <p className="brain-operation-toast is-error" role="alert">{state.error.message}</p>}
    </div>
  );
}
