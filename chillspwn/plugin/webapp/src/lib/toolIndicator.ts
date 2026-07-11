// Shared tool/skill indicator — single source of truth for the chat AND the agent board, so a tool
// chip looks identical everywhere. Moved verbatim from ChatPage.tsx (which now imports from here).
export type ToolMeta = { icon: string; label: string; color: string };

export function toolIndicator(name?: string, content?: string): ToolMeta {
  const t = (name || "").toLowerCase();
  let extra = "";
  try { const inp = JSON.parse(content || "{}"); extra = inp.skill || inp.name || ""; } catch { extra = content || ""; }
  const m: Record<string, ToolMeta> = {
    terminal:            { icon: "⚡", label: "TERMINAL",   color: "#2bd47f" },
    bash:                { icon: "⚡", label: "TERMINAL",   color: "#2bd47f" },
    execute_code:        { icon: "🐍", label: "CODE",       color: "#b6f23a" },
    write_file:          { icon: "✏️", label: "WRITE FILE", color: "#ffae42" },
    read_file:           { icon: "📄", label: "READ FILE",  color: "#b6f23a" },
    patch:               { icon: "🩹", label: "PATCH",      color: "#ffae42" },
    search_files:        { icon: "🔍", label: "SEARCH",     color: "#b6f23a" },
    process:             { icon: "⚙",  label: "PROCESS",    color: "#b07cff" },
    use_skill:           { icon: "📚", label: extra ? `SKILL → ${extra}` : "SKILL", color: "#00ffaa" },
    skill_manage:        { icon: "💾", label: "SKILL SAVE",  color: "#00ffaa" },
    recall_conversation: { icon: "🧠", label: "RECALL",     color: "#b07cff" },
    read:                { icon: "📄", label: "READ FILE",  color: "#b6f23a" },
    write:               { icon: "✏️", label: "WRITE FILE", color: "#ffae42" },
    edit:                { icon: "🩹", label: "EDIT",       color: "#ffae42" },
    glob:                { icon: "🔍", label: "GLOB",       color: "#b6f23a" },
    grep:                { icon: "🔍", label: "SEARCH",     color: "#b6f23a" },
    websearch:           { icon: "🌐", label: "WEB SEARCH", color: "#b6f23a" },
    webfetch:            { icon: "🌐", label: "WEB FETCH",  color: "#b6f23a" },
    remember:            { icon: "💾", label: "REMEMBER",    color: "#00ffaa" },
    delegate_task:       { icon: "🔱", label: "SUB-AGENT",  color: "#ff8844" },
    board_create_task:   { icon: "🎯", label: "DELEGATE",   color: "#ff8844" },
    board_await:         { icon: "⏳", label: "GATHER",     color: "#ff8844" },
    board_list:          { icon: "🗂", label: "BOARD",      color: "#ff8844" },
    board_update:        { icon: "🔄", label: "PROMOTE",    color: "#ff8844" },
  };
  return m[t] || { icon: "▸", label: (name || "tool").toUpperCase(), color: "var(--neon-amber)" };
}

// The OpenRouter agent tools an operator can grant a column (the per-persona whitelist).
export const OR_TOOL_NAMES = [
  "terminal", "read_file", "write_file", "patch", "search_files",
  "execute_code", "process", "use_skill", "recall_conversation", "remember",
] as const;
export type OrToolName = typeof OR_TOOL_NAMES[number];
