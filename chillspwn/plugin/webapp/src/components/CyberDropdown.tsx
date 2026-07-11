import { useState, useRef, useEffect } from "react";

export interface CyberDropdownOption {
  id: string;
  label: string;
  desc?: string;
}

// Cyberpunk-themed dropdown styled to match ChillsPwn. Replaces native
// <select> which renders as the OS-default picker on mobile (looks out of
// place with the rest of the JARVIS UI).
export function CyberDropdown({
  value,
  onChange,
  options,
  label,
  accent = "var(--jarvis-blue)",
  fullWidth = false,
  size = "md",
  disabled = false,
  placeholder = "Select…",
  searchable = false,
}: {
  value: string;
  onChange: (v: string) => void;
  options: CyberDropdownOption[];
  label?: string;
  accent?: string;
  fullWidth?: boolean;
  size?: "sm" | "md";
  disabled?: boolean;
  placeholder?: string;
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.id === value);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [open]);

  // Reset the filter each time the panel closes so it never starts stale.
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const q = query.trim().toLowerCase();
  const visibleOptions = searchable && q
    ? options.filter(
        (o) =>
          o.id.toLowerCase().includes(q) ||
          o.label.toLowerCase().includes(q) ||
          (o.desc ? o.desc.toLowerCase().includes(q) : false)
      )
    : options;

  const isOverride = value && options[0]?.id !== value;
  const fontSize = size === "sm" ? 10 : 11;
  const padding = size === "sm" ? "5px 9px" : "7px 12px";
  const minHeight = size === "sm" ? 30 : 36;

  return (
    <div
      ref={containerRef}
      style={{
        display: "flex", alignItems: "center", gap: 8,
        position: "relative", flexWrap: "wrap",
        width: fullWidth ? "100%" : undefined,
      }}
    >
      {label && (
        <label style={{
          fontSize: 9, fontWeight: 700, color: "var(--text-muted)",
          letterSpacing: "0.06em", textTransform: "uppercase", flexShrink: 0,
        }}>
          {label}
        </label>
      )}

      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        style={{
          flex: 1, minWidth: 160,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          fontSize, padding, borderRadius: 5,
          border: `1px solid ${isOverride ? `${accent}80` : "var(--border-color)"}`,
          background: disabled
            ? "rgba(0,0,0,0.15)"
            : isOverride ? `${accent}10` : "rgba(0,0,0,0.3)",
          color: disabled ? "var(--text-muted)" : "var(--text-primary)",
          cursor: disabled ? "not-allowed" : "pointer",
          fontWeight: 600, minHeight,
          textAlign: "left", fontFamily: "inherit",
          boxShadow: open ? `0 0 12px ${accent}40` : "none",
          transition: "all 0.15s",
          WebkitTapHighlightColor: "transparent",
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {current ? (
            <>
              <span style={{ color: accent, fontWeight: 700 }}>{current.label}</span>
              {current.desc && (
                <span style={{ color: "var(--text-dim)", marginLeft: 6, fontSize: fontSize - 1 }}>
                  — {current.desc}
                </span>
              )}
            </>
          ) : (
            <span style={{ color: "var(--text-muted)" }}>{placeholder}</span>
          )}
        </span>
        <span style={{
          flexShrink: 0, marginLeft: 8, color: accent,
          fontSize: fontSize + 2,
          transform: open ? "rotate(180deg)" : "rotate(0)",
          transition: "transform 0.15s",
        }}>
          ▾
        </span>
      </button>

      {open && (
        <div
          style={{
            position: "absolute", top: "calc(100% + 4px)",
            left: label ? 60 : 0, right: 0,
            zIndex: 100,
            background: "#11161f",
            border: `1px solid ${accent}50`,
            borderRadius: 6,
            boxShadow: `0 8px 24px rgba(0,0,0,0.6), 0 0 24px ${accent}20`,
            maxHeight: 320, overflowY: "auto",
          }}
        >
          {searchable && (
            <div
              style={{
                position: "sticky", top: 0, zIndex: 1,
                padding: 6, background: "#11161f",
                borderBottom: `1px solid ${accent}30`,
              }}
            >
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="filter…"
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: "100%", boxSizing: "border-box",
                  fontSize: 11, padding: "6px 9px", borderRadius: 4,
                  border: `1px solid ${accent}50`,
                  background: "rgba(0,0,0,0.4)",
                  color: "var(--text-primary)", fontFamily: "inherit",
                  outline: "none",
                }}
              />
            </div>
          )}
          {visibleOptions.length === 0 && (
            <div style={{ padding: "12px 14px", fontSize: 10, color: "var(--text-muted)" }}>
              no matches
            </div>
          )}
          {visibleOptions.map((opt) => {
            const isActive = opt.id === value;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => { onChange(opt.id); setOpen(false); }}
                style={{
                  width: "100%", textAlign: "left", padding: "9px 14px",
                  background: isActive ? `${accent}15` : "transparent",
                  border: "none",
                  borderBottom: "1px solid rgba(255,255,255,0.04)",
                  color: "var(--text-primary)", cursor: "pointer",
                  display: "flex", flexDirection: "column", gap: 2,
                  minHeight: 40, fontFamily: "inherit",
                  WebkitTapHighlightColor: "transparent",
                  transition: "background 0.1s",
                }}
                onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
                onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
              >
                <span style={{
                  fontSize: 11, fontWeight: 700,
                  color: isActive ? accent : "var(--text-primary)",
                  display: "flex", alignItems: "center", gap: 6,
                }}>
                  {isActive && <span style={{ color: accent }}>▸</span>}
                  {opt.label}
                </span>
                {opt.desc && (
                  <span style={{ fontSize: 9, color: "var(--text-dim)" }}>
                    {opt.desc}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
