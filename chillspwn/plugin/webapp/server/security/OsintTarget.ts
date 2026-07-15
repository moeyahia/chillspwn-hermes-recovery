import { isIP } from "net";

export type OsintTargetType = "domain" | "ip" | "email" | "person" | "company";

export class OsintTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OsintTargetError";
  }
}

const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const EMAIL_LOCAL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/;
const HUMAN_NAME = /^[\p{L}\p{N}][\p{L}\p{N} .,'’_-]*$/u;

function normalizeDomain(value: string): string {
  const domain = value.toLowerCase().replace(/\.$/, "");
  if (domain.length < 1 || domain.length > 253 || !domain.includes(".")) {
    throw new OsintTargetError("domain must be a fully qualified DNS name");
  }
  if (!domain.split(".").every((label) => DOMAIN_LABEL.test(label))) {
    throw new OsintTargetError("domain contains an invalid DNS label");
  }
  return domain;
}

export function normalizeOsintTarget(value: unknown, type: OsintTargetType): string {
  if (typeof value !== "string") throw new OsintTargetError("target must be a string");
  const target = value.trim();
  if (!target || target.length > 254 || /[\u0000-\u001f\u007f]/.test(target)) {
    throw new OsintTargetError("target is empty, too long, or contains control characters");
  }

  switch (type) {
    case "domain":
      return normalizeDomain(target);
    case "ip":
      if (!isIP(target)) throw new OsintTargetError("IP target must be a valid IPv4 or IPv6 address");
      return target.toLowerCase();
    case "email": {
      const at = target.lastIndexOf("@");
      if (at <= 0 || at >= target.length - 1) throw new OsintTargetError("email target is invalid");
      const local = target.slice(0, at);
      if (local.length > 64 || !EMAIL_LOCAL.test(local)) throw new OsintTargetError("email local part is invalid");
      return `${local}@${normalizeDomain(target.slice(at + 1))}`;
    }
    case "person":
      if (target.length > 120 || !HUMAN_NAME.test(target)) throw new OsintTargetError("person target contains unsupported characters");
      return target;
    case "company":
      if (target.length > 160 || !HUMAN_NAME.test(target)) throw new OsintTargetError("company target contains unsupported characters");
      return target;
  }
}

/** POSIX-shell literal used only in displayed command templates handed to the agent. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
