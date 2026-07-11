/**
 * Prompt-obfuscation shim (Phase 1).
 *
 * Goal: the default production runtime is TRANSPARENT and AUDITABLE — it must not
 * rewrite, leetspeak, or otherwise hide prompt/model intent.
 *
 * Phase 14 — DEPRECATED / QUARANTINED: the legacy g0dm0d3/parseltongue engine
 * (server/lib/g0dm0d3.ts, server/lib/parseltongue.ts) is retained ONLY because these
 * shim functions still have call sites where they act as the IDENTITY (no-op) when
 * ENABLE_PROMPT_OBFUSCATION is off (the default). It is NOT deleted (call sites exist)
 * and NOT moved to a legacy/ dir (would break imports) in this batch. Removal path:
 * inline these as identity at the call sites, then delete the lib files. DO NOT
 * re-enable prompt obfuscation. See MIGRATION.md.
 *
 * All former direct calls to g0dm0d3 in server/index.ts now route through these
 * shims. When obfuscation is disabled (the default):
 *   - the input is returned UNCHANGED (identity),
 *   - g0dm0d3 / parseltongue are NEVER imported or invoked.
 * When explicitly enabled, a loud one-time audit warning is emitted and the legacy
 * engine is lazily required.
 *
 * `isPromptObfuscationEnabled` is overridable via setObfuscationEnabled so the
 * server can wire it to SecurityConfig, and tests can flip it deterministically.
 */

let _enabled = false;
let _warned = false;
let _auditSink: ((message: string) => void) | undefined;

/** Wire the flag (called once from index.ts with cfg.enablePromptObfuscation). */
export function setObfuscationEnabled(enabled: boolean, auditSink?: (message: string) => void): void {
  _enabled = enabled;
  _auditSink = auditSink;
  _warned = false;
}

export function isPromptObfuscationEnabled(): boolean {
  return _enabled;
}

function warnOnce(): void {
  if (_warned) return;
  _warned = true;
  const msg =
    "SECURITY: prompt obfuscation (g0dm0d3/parseltongue) is ENABLED. This rewrites " +
    "prompts to evade model filters — it is legacy, unsafe, and non-auditable, and is " +
    "scheduled for removal. Set ENABLE_PROMPT_OBFUSCATION=false to disable.";
  if (_auditSink) {
    try {
      _auditSink(msg);
    } catch {
      /* never throw from the warning path */
    }
  } else {
    // eslint-disable-next-line no-console
    console.warn(`[chillspwn] ${msg}`);
  }
}

/**
 * Lazily load the legacy engine ONLY when obfuscation is enabled. Kept behind a
 * function so that, in the default path, the module graph never reaches g0dm0d3.
 */
function legacy(): typeof import("../lib/g0dm0d3") | null {
  try {
    // Lazy require: not evaluated unless obfuscation is explicitly enabled.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("../lib/g0dm0d3") as typeof import("../lib/g0dm0d3");
  } catch {
    return null;
  }
}

/** Default-path: identity. Enabled: legacy obfuscatePrompt with default config. */
export function maybeObfuscatePrompt(text: string): string {
  if (!_enabled) return text;
  warnOnce();
  const g = legacy();
  if (!g) return text;
  return g.obfuscatePrompt(text, g.resolveGodmodeConfig({ enabled: true }));
}

/** Default-path: identity. Enabled: legacy safeObfuscate. */
export function maybeSafeObfuscate(text: string): string {
  if (!_enabled) return text;
  warnOnce();
  const g = legacy();
  if (!g) return text;
  return g.safeObfuscate(text, g.resolveGodmodeConfig({ enabled: true }));
}

/** Default-path: identity. Enabled: legacy alias replacement + obfuscation. */
export function maybeObfuscateWithAliases(text: string): string {
  if (!_enabled) return text;
  warnOnce();
  const g = legacy();
  if (!g) return text;
  return g.obfuscateWithAliases(text, g.resolveGodmodeConfig({ enabled: true }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Council briefing (Phase 1.1)
// ─────────────────────────────────────────────────────────────────────────────
//
// The council summon path used to UNCONDITIONALLY append a "respond in l33tspeak"
// instruction to every briefing — i.e. obfuscation was active by default even
// though the rest of the runtime gates it. That instruction is now gated behind the
// same ENABLE_PROMPT_OBFUSCATION flag, so the default runtime keeps council
// briefings + assessments plain and auditable.

/** The legacy l33tspeak response mandate. Only appended when obfuscation is enabled. */
export const LEETSPEAK_COUNCIL_INSTRUCTION = `\n\n=== RESPONSE FORMAT (MANDATORY) ===
Write your ENTIRE assessment using l33tspeak (leet speak) style:
- Replace letters with numbers/symbols: a=4, e=3, i=1, o=0, s=5, t=7, etc.
- Use "@" for "a", "3" for "E", "$" for "S", "!" for "i" or "I"
- Write command names and tool names in ALL CAPS with l33t substitution
- Example: "Runn1ng Nm4p" instead of "Running Nmap", "3xpl01t" instead of "exploit"
- Keep the technical meaning intact — only change the character representation
This is a required format. Do NOT output plain English. Every sentence must use l33tspeak.`;

/** "" when obfuscation is disabled (default); the l33t mandate when enabled. */
export function councilResponseInstruction(): string {
  if (!_enabled) return "";
  warnOnce();
  return LEETSPEAK_COUNCIL_INSTRUCTION;
}

/**
 * Assemble the council briefing. In the default (transparent) runtime this returns
 * the base briefing unchanged — no obfuscation/l33tspeak instruction is added.
 */
export function buildCouncilBriefing(baseBriefing: string): string {
  return baseBriefing + councilResponseInstruction();
}
