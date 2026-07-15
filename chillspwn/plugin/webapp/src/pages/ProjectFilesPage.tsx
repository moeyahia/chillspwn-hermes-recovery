import { useState, useEffect, useCallback } from "react";
import { renderSafeMarkdownLink } from "../lib/safeMarkdown";

interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modified: string;
}

interface RootDir {
  path: string;
  name: string;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "0B";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${(bytes / 1024 / 1024).toFixed(1)}M`;
}

function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fileIcon(name: string, isDir: boolean): string {
  if (isDir) return "\u{1F4C1}";
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    md: "\u{1F4DD}", txt: "\u{1F4DD}", log: "\u{1F4DD}",
    py: "\u{1F40D}", sh: "\u{1F4DC}", bash: "\u{1F4DC}",
    json: "\u{1F4CB}", yaml: "\u{1F4CB}", yml: "\u{1F4CB}", xml: "\u{1F4CB}",
    html: "\u{1F310}", htm: "\u{1F310}", css: "\u{1F3A8}",
    js: "\u{26A1}", ts: "\u{26A1}", jsx: "\u{26A1}", tsx: "\u{26A1}",
    png: "\u{1F5BC}", jpg: "\u{1F5BC}", jpeg: "\u{1F5BC}", gif: "\u{1F5BC}", svg: "\u{1F5BC}",
    pdf: "\u{1F4D5}",
    nmap: "\u{1F50D}", gnmap: "\u{1F50D}",
    pcap: "\u{1F4E1}", cap: "\u{1F4E1}",
    zip: "\u{1F4E6}", gz: "\u{1F4E6}", tar: "\u{1F4E6}",
    c: "\u{2699}", h: "\u{2699}", cpp: "\u{2699}",
    sql: "\u{1F5C4}", db: "\u{1F5C4}",
  };
  return map[ext] || "\u{1F4C4}";
}

function extToLang(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    py: "python", sh: "bash", js: "javascript", ts: "typescript",
    json: "json", yaml: "yaml", yml: "yaml", xml: "xml",
    html: "html", css: "css", md: "markdown", sql: "sql",
    c: "c", cpp: "cpp", h: "c", nmap: "text", txt: "text", log: "text",
  };
  return map[ext] || "text";
}

function renderMarkdown(md: string): string {
  let html = md
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    // Headers
    .replace(/^######\s+(.+)$/gm, '<h6 style="font-size:0.75rem;font-weight:700;margin:0.8rem 0 0.3rem;color:var(--jarvis-blue)">$1</h6>')
    .replace(/^#####\s+(.+)$/gm, '<h5 style="font-size:0.8rem;font-weight:700;margin:0.8rem 0 0.3rem;color:var(--jarvis-blue)">$1</h5>')
    .replace(/^####\s+(.+)$/gm, '<h4 style="font-size:0.85rem;font-weight:700;margin:1rem 0 0.3rem;color:var(--jarvis-blue)">$1</h4>')
    .replace(/^###\s+(.+)$/gm, '<h3 style="font-size:0.9rem;font-weight:700;margin:1rem 0 0.4rem;color:var(--jarvis-blue)">$1</h3>')
    .replace(/^##\s+(.+)$/gm, '<h2 style="font-size:1rem;font-weight:700;margin:1.2rem 0 0.4rem;color:var(--jarvis-blue)">$1</h2>')
    .replace(/^#\s+(.+)$/gm, '<h1 style="font-size:1.1rem;font-weight:700;margin:1.2rem 0 0.5rem;color:var(--jarvis-blue)">$1</h1>')
    // Code blocks
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) =>
      `<pre style="background:rgba(0,0,0,0.3);padding:0.6rem;border-radius:0.4rem;border:1px solid var(--border-color);font-size:0.7rem;overflow-x:auto;margin:0.5rem 0"><code>${code.trim()}</code></pre>`)
    // Inline code
    .replace(/`([^`]+)`/g, '<code style="background:rgba(182,242,58,0.08);color:var(--jarvis-blue);padding:0.1rem 0.3rem;border-radius:0.2rem;font-size:0.7rem">$1</code>')
    // Bold + italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) => renderSafeMarkdownLink(label, href))
    // Unordered lists
    .replace(/^[-*]\s+(.+)$/gm, '<li style="margin-left:1.2rem;list-style:disc">$1</li>')
    // Ordered lists
    .replace(/^\d+\.\s+(.+)$/gm, '<li style="margin-left:1.2rem;list-style:decimal">$1</li>')
    // Blockquotes
    .replace(/^&gt;\s+(.+)$/gm, '<blockquote style="border-left:2px solid var(--jarvis-blue);padding-left:0.6rem;margin:0.5rem 0;color:var(--text-dim)">$1</blockquote>')
    // Horizontal rules
    .replace(/^---+$/gm, '<hr style="border:none;border-top:1px solid var(--border-color);margin:1rem 0">')
    // Paragraphs (double newlines)
    .replace(/\n\n/g, '</p><p style="margin:0.4rem 0">')
    // Single newlines to br
    .replace(/\n/g, '<br>');
  return `<div style="font-family:inherit"><p style="margin:0.4rem 0">${html}</p></div>`;
}

export default function ProjectFilesPage({ onSendToChat }: { onSendToChat?: (text: string) => void }) {
  const [roots, setRoots] = useState<RootDir[]>([]);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [pathHistory, setPathHistory] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"source" | "render">("source");

  // Load project roots
  useEffect(() => {
    fetch("/api/files/roots")
      .then((r) => r.json())
      .then(setRoots)
      .catch(() => setRoots([]));
  }, []);

  const navigate = useCallback((path: string) => {
    setLoading(true);
    setSelectedFile(null);
    setFileContent(null);
    fetch(`/api/files/list?path=${encodeURIComponent(path)}`)
      .then((r) => r.json())
      .then((data) => {
        setEntries(data.entries || []);
        setCurrentPath(data.path);
        setPathHistory((prev) => [...prev.filter((p) => p !== path), path].slice(-20));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const openFile = useCallback((path: string) => {
    setSelectedFile(path);
    setFileLoading(true);
    setEditing(false);
    setSaveStatus(null);
    const ext = path.split(".").pop()?.toLowerCase() || "";
    setViewMode(["html", "htm", "md"].includes(ext) ? "render" : "source");
    fetch(`/api/files/read?path=${encodeURIComponent(path)}`)
      .then((r) => r.json())
      .then((data) => {
        const content = data.content || data.error || "Empty file";
        setFileContent(content);
        setEditContent(content);
        setFileLoading(false);
      })
      .catch((e) => {
        setFileContent(`Error: ${e.message}`);
        setFileLoading(false);
      });
  }, []);

  const saveFile = useCallback(async () => {
    if (!selectedFile) return;
    setSaving(true);
    setSaveStatus(null);
    try {
      const resp = await fetch("/api/files/write", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: selectedFile, content: editContent }),
      });
      if (resp.ok) {
        setFileContent(editContent);
        setEditing(false);
        setSaveStatus("Saved");
        setTimeout(() => setSaveStatus(null), 2000);
      } else {
        const err = await resp.json();
        setSaveStatus(`Error: ${err.error}`);
      }
    } catch (e: any) {
      setSaveStatus(`Error: ${e.message}`);
    }
    setSaving(false);
  }, [selectedFile, editContent]);

  const sendToChat = useCallback(() => {
    if (!selectedFile || !fileContent) return;
    const fileName = selectedFile.split("/").pop() || selectedFile;
    const text = `Here is the content of \`${fileName}\` (${selectedFile}):\n\`\`\`\n${fileContent.slice(0, 4000)}\n\`\`\`${fileContent.length > 4000 ? "\n(truncated — full file is " + fileContent.length + " chars)" : ""}`;
    onSendToChat?.(text);
  }, [selectedFile, fileContent, onSendToChat]);

  const goUp = () => {
    if (!currentPath) return;
    const parent = currentPath.split("/").slice(0, -1).join("/") || "/";
    navigate(parent);
  };

  // Breadcrumb segments
  const breadcrumbs = currentPath ? currentPath.split("/").filter(Boolean) : [];

  return (
    <div className="flex h-full" style={{ color: "var(--text-primary)" }}>
      {/* Left: File tree / browser */}
      <div
        className="flex flex-col overflow-hidden"
        style={{
          width: selectedFile ? "40%" : "100%",
          borderRight: selectedFile ? "1px solid var(--border-color)" : "none",
          transition: "width 0.2s ease",
        }}
      >
        {/* Header with breadcrumb */}
        <div
          className="px-3 py-2 flex items-center gap-2 shrink-0"
          style={{ borderBottom: "1px solid var(--border-color)" }}
        >
          {currentPath && (
            <button
              onClick={goUp}
              className="text-xs px-2 py-1 rounded"
              style={{ border: "1px solid var(--border-color)", color: "var(--text-dim)" }}
            >
              ← Up
            </button>
          )}
          <div className="flex-1 flex items-center gap-1 overflow-x-auto text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
            {!currentPath ? (
              <span>Select a project</span>
            ) : (
              breadcrumbs.map((seg, i) => (
                <span key={i} className="flex items-center gap-1">
                  {i > 0 && <span style={{ color: "var(--border-bright)" }}>/</span>}
                  <button
                    onClick={() => navigate("/" + breadcrumbs.slice(0, i + 1).join("/"))}
                    className="hover:underline"
                    style={{ color: i === breadcrumbs.length - 1 ? "var(--jarvis-blue)" : "var(--text-dim)" }}
                  >
                    {seg}
                  </button>
                </span>
              ))
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-2">
          {/* Project roots (initial view) */}
          {!currentPath && (
            <div className="space-y-2">
              <p className="text-[11px] px-2 py-1" style={{ color: "var(--text-muted)" }}>
                Project directories
              </p>
              {roots.map((root) => (
                <button
                  key={root.path}
                  onClick={() => navigate(root.path)}
                  className="w-full text-left px-3 py-3 rounded-lg flex items-center gap-3 transition-all"
                  style={{
                    background: "rgba(182,242,58,0.04)",
                    border: "1px solid var(--border-color)",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(182,242,58,0.3)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border-color)"; }}
                >
                  <span className="text-lg">{"\u{1F4C2}"}</span>
                  <div>
                    <div className="text-xs font-semibold" style={{ color: "var(--jarvis-blue)" }}>{root.name}</div>
                    <div className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>{root.path}</div>
                  </div>
                </button>
              ))}
              {roots.length === 0 && (
                <p className="text-[11px] px-2 py-4 text-center" style={{ color: "var(--text-muted)" }}>
                  No project directories found. Create engagements at /root/htb/boxes/ or /root/engagements/
                </p>
              )}
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center py-8" style={{ color: "var(--text-muted)" }}>
              <span className="animate-pulse text-xs">Loading...</span>
            </div>
          )}

          {/* Directory listing */}
          {currentPath && !loading && (
            <div className="space-y-0.5">
              {entries.length === 0 && (
                <p className="text-[11px] px-2 py-4 text-center" style={{ color: "var(--text-muted)" }}>
                  Empty directory
                </p>
              )}
              {entries.map((entry) => (
                <button
                  key={entry.path}
                  onClick={() => entry.isDir ? navigate(entry.path) : openFile(entry.path)}
                  className="w-full text-left px-2 py-1.5 rounded flex items-center gap-2 transition-all group"
                  style={{
                    background: selectedFile === entry.path ? "rgba(182,242,58,0.1)" : "transparent",
                  }}
                  onMouseEnter={(e) => {
                    if (selectedFile !== entry.path) e.currentTarget.style.background = "rgba(182,242,58,0.04)";
                  }}
                  onMouseLeave={(e) => {
                    if (selectedFile !== entry.path) e.currentTarget.style.background = "transparent";
                  }}
                >
                  <span className="text-sm shrink-0">{fileIcon(entry.name, entry.isDir)}</span>
                  <span
                    className="flex-1 text-xs truncate font-mono"
                    style={{
                      color: entry.isDir ? "var(--jarvis-blue)" : "var(--text-primary)",
                      fontWeight: entry.isDir ? 600 : 400,
                    }}
                  >
                    {entry.name}
                  </span>
                  {!entry.isDir && (
                    <span className="text-[9px] shrink-0" style={{ color: "var(--text-muted)" }}>
                      {formatSize(entry.size)}
                    </span>
                  )}
                  <span className="text-[9px] shrink-0 hidden group-hover:inline" style={{ color: "var(--text-muted)" }}>
                    {formatDate(entry.modified)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right: File viewer */}
      {selectedFile && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* File header with actions */}
          <div
            className="px-3 py-2 flex items-center justify-between shrink-0"
            style={{ borderBottom: "1px solid var(--border-color)" }}
          >
            <div className="flex items-center gap-2 overflow-hidden">
              <span className="text-sm">{fileIcon(selectedFile.split("/").pop() || "", false)}</span>
              <span className="text-xs font-mono truncate" style={{ color: "var(--jarvis-blue)" }}>
                {selectedFile.split("/").pop()}
              </span>
              <span className="text-[9px] font-mono" style={{ color: "var(--text-muted)" }}>
                {extToLang(selectedFile)}
              </span>
              {saveStatus && (
                <span className="text-[9px]" style={{ color: saveStatus.startsWith("Error") ? "var(--neon-red)" : "var(--neon-green)" }}>
                  {saveStatus}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {/* Send to Chat */}
              {onSendToChat && !editing && fileContent && (
                <button
                  onClick={sendToChat}
                  className="text-[10px] px-2 py-1 rounded transition-all"
                  style={{ border: "1px solid rgba(182,242,58,0.25)", color: "var(--jarvis-blue)" }}
                  title="Send file content to chat as context"
                >
                  Send to Chat
                </button>
              )}
              {/* View mode toggle for HTML/MD files */}
              {(() => {
                const ext = (selectedFile || "").split(".").pop()?.toLowerCase() || "";
                const canRender = ["html", "htm", "md"].includes(ext);
                if (canRender && !editing) return (
                  <button
                    onClick={() => setViewMode(viewMode === "render" ? "source" : "render")}
                    className="text-[10px] px-2 py-1 rounded transition-all"
                    style={{ border: "1px solid rgba(182,242,58,0.25)", color: viewMode === "render" ? "var(--neon-green)" : "var(--text-dim)" }}
                  >
                    {viewMode === "render" ? "Source" : "Render"}
                  </button>
                );
                return null;
              })()}
              {/* Edit / Save / Cancel */}
              {!editing ? (
                <button
                  onClick={() => { setEditing(true); setViewMode("source"); setEditContent(fileContent || ""); }}
                  className="text-[10px] px-2 py-1 rounded transition-all"
                  style={{ border: "1px solid rgba(182,242,58,0.25)", color: "var(--jarvis-blue)" }}
                >
                  Edit
                </button>
              ) : (
                <>
                  <button
                    onClick={() => { setEditing(false); setSaveStatus(null); }}
                    className="text-[10px] px-2 py-1 rounded"
                    style={{ border: "1px solid var(--border-color)", color: "var(--text-dim)" }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveFile}
                    disabled={saving}
                    className="text-[10px] px-2 py-1 rounded"
                    style={{
                      background: "rgba(182,242,58,0.15)",
                      border: "1px solid rgba(182,242,58,0.3)",
                      color: "var(--jarvis-blue)",
                      opacity: saving ? 0.5 : 1,
                    }}
                  >
                    {saving ? "Saving..." : "Save"}
                  </button>
                </>
              )}
              {/* Close */}
              <button
                onClick={() => { setSelectedFile(null); setFileContent(null); setEditing(false); }}
                className="text-[10px] px-2 py-1 rounded"
                style={{ color: "var(--neon-red)", border: "1px solid rgba(255,0,64,0.2)" }}
              >
                Close
              </button>
            </div>
          </div>

          {/* File content — view, edit, or render */}
          <div className="flex-1 overflow-auto p-3">
            {fileLoading ? (
              <div className="flex items-center justify-center py-8" style={{ color: "var(--text-muted)" }}>
                <span className="animate-pulse text-xs">Loading file...</span>
              </div>
            ) : editing ? (
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="w-full h-full text-[11px] font-mono leading-relaxed resize-none"
                style={{
                  color: "var(--text-primary)",
                  background: "rgba(0,0,0,0.3)",
                  padding: "0.75rem",
                  borderRadius: "0.5rem",
                  border: "1px solid rgba(182,242,58,0.15)",
                  outline: "none",
                  minHeight: "100%",
                }}
                spellCheck={false}
              />
            ) : viewMode === "render" && selectedFile?.match(/\.(html|htm)$/i) ? (
              /* HTML render — iframe sandbox */
              <iframe
                srcDoc={fileContent || ""}
                sandbox=""
                className="w-full rounded-lg"
                style={{
                  border: "1px solid var(--border-color)",
                  background: "#fff",
                  minHeight: "100%",
                  height: "100%",
                }}
                title="HTML Preview"
              />
            ) : viewMode === "render" && selectedFile?.match(/\.md$/i) ? (
              /* Markdown render — simple conversion */
              <div
                className="text-xs leading-relaxed"
                style={{
                  color: "var(--text-primary)",
                  background: "rgba(0,0,0,0.15)",
                  padding: "1rem",
                  borderRadius: "0.5rem",
                  border: "1px solid var(--border-color)",
                  minHeight: "100%",
                }}
                dangerouslySetInnerHTML={{ __html: renderMarkdown(fileContent || "") }}
              />
            ) : (
              /* Source code view with line numbers */
              <pre
                className="text-[11px] font-mono leading-relaxed whitespace-pre-wrap"
                style={{
                  color: "var(--text-primary)",
                  background: "rgba(0,0,0,0.2)",
                  padding: "0.75rem",
                  borderRadius: "0.5rem",
                  border: "1px solid var(--border-color)",
                  minHeight: "100%",
                }}
              >
                {(fileContent || "").split("\n").map((line, i) => (
                  <div key={i} className="flex hover:bg-white/5">
                    <span
                      className="select-none shrink-0 text-right mr-3 inline-block"
                      style={{ width: 35, color: "var(--text-muted)", fontSize: "9px" }}
                    >
                      {i + 1}
                    </span>
                    <span className="flex-1">{line}</span>
                  </div>
                ))}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
