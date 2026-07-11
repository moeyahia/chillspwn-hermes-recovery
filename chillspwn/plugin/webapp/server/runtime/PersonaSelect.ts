/**
 * PersonaSelect (Phase 7.5.1) — pick the persona to execute a managed run with, honoring the
 * run's providerKind so observed execution NEVER silently drifts to a different provider.
 *
 * Pure + dependency-free so it is fully unit-testable. The endpoint passes loadPersonas().
 */

import type { ProviderKind } from "./types";

/** Map a run's providerKind to the persona `provider` field value it should match. */
export function providerKindToPersonaProvider(kind: ProviderKind): string {
  return kind === "claude" ? "anthropic" : kind; // claude ⇒ anthropic; openrouter/openai-codex unchanged
}

export interface SelectablePersona {
  name: string;
  /** Absent ⇒ the claude/anthropic path. */
  provider?: string;
}

export type PersonaSelection<T> = { ok: true; persona: T } | { ok: false; error: string };

/**
 * Selection order (never crosses providers):
 *   1. a persona matching BOTH the run persona name AND the run's provider;
 *   2. else any persona matching the run's provider (safe provider-compatible default);
 *   3. else a CLEAR error — we do NOT fall back to a persona of a different provider.
 */
export function selectExecutionPersona<T extends SelectablePersona>(
  personas: T[],
  runPersona: string,
  providerKind: ProviderKind,
): PersonaSelection<T> {
  const want = providerKindToPersonaProvider(providerKind);
  const provOf = (p: SelectablePersona): string => p.provider || "anthropic"; // absent ⇒ claude
  const name = String(runPersona || "").toLowerCase();

  const exact = personas.find((p) => p.name.toLowerCase() === name && provOf(p) === want);
  if (exact) return { ok: true, persona: exact };

  const byProvider = personas.find((p) => provOf(p) === want);
  if (byProvider) return { ok: true, persona: byProvider };

  return {
    ok: false,
    error: `no persona available for provider '${providerKind}' — refusing to run a managed ` +
      `run on a different provider than requested`,
  };
}
