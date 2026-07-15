import { PathSecurityError, safeSegment } from "./paths";

const RESOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function safeResourceId(value: unknown, label: string, maximumLength: number): string {
  if (typeof value !== "string") {
    throw new PathSecurityError(`${label} must be a string`);
  }
  const id = safeSegment(value, label);
  if (id.length > maximumLength) {
    throw new PathSecurityError(`${label} is too long`);
  }
  if (!RESOURCE_ID_PATTERN.test(id)) {
    throw new PathSecurityError(`${label} contains unsupported characters`);
  }
  return id;
}

/**
 * Session identifiers are used as map keys, filenames, log names, and provider
 * resume handles. Keep one strict representation at every ingress so an ID can
 * never become a path or control-sequence primitive later in the runtime.
 */
export function safeSessionId(value: unknown, label = "session ID"): string {
  return safeResourceId(value, label, 128);
}

export function safeEngagementName(value: unknown, label = "engagement name"): string {
  return safeResourceId(value, label, 128);
}

export function boundedPositiveInteger(
  value: unknown,
  fallback: number,
  maximum: number,
): number {
  if (typeof value !== "string" && typeof value !== "number") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}
