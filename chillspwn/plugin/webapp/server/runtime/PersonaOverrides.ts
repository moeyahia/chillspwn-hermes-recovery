export const PERSONA_RUNTIME_PROVIDERS = [
  "anthropic",
  "openrouter",
  "openai-codex",
  "gemini",
  "xai-grok",
] as const;

export type PersonaRuntimeProvider = (typeof PERSONA_RUNTIME_PROVIDERS)[number];

export interface PersonaRuntimeOverride {
  provider?: PersonaRuntimeProvider;
  model?: string;
}

export function isPersonaRuntimeProvider(value: unknown): value is PersonaRuntimeProvider {
  return typeof value === "string"
    && PERSONA_RUNTIME_PROVIDERS.includes(value as PersonaRuntimeProvider);
}

export function normalizePersonaModel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (/[\0\r\n]/.test(value)) return undefined;
  const model = value.trim();
  if (!model || model.length > 128) return undefined;
  return model;
}

/**
 * Treat the service-owned override file as untrusted runtime input. Only the two
 * fields that an operator is allowed to change can cross into a reviewed persona.
 */
export function sanitizePersonaOverrides(value: unknown): Record<string, PersonaRuntimeOverride> {
  const sanitized: Record<string, PersonaRuntimeOverride> = Object.create(null);
  if (!value || typeof value !== "object" || Array.isArray(value)) return sanitized;

  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = rawKey.trim().toLowerCase();
    if (!key || key.length > 128 || /[\0\r\n]/.test(key) || key === "__proto__" || key === "constructor" || key === "prototype") continue;
    if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) continue;

    const record = rawValue as Record<string, unknown>;
    const override: PersonaRuntimeOverride = {};
    if (isPersonaRuntimeProvider(record.provider)) override.provider = record.provider;
    const model = normalizePersonaModel(record.model);
    if (model) override.model = model;
    if (override.provider || override.model) sanitized[key] = override;
  }
  return sanitized;
}
