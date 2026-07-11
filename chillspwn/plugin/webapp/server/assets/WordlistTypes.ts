/**
 * Phase 17 — Wordlist asset types.
 *
 * Wordlists are used by PATH + METADATA + suitability — NEVER by reading their contents into a model
 * prompt or runtime memory. These types describe the inventory + the selection contract only.
 */

export const WORDLIST_PROFILES = [
  "quick", "balanced", "deep", "api", "cloud", "extensions", "raft", "directory",
  "subdomain", "usernames", "passwords", "parameters", "backup-config", "technology-specific",
] as const;
export type WordlistProfile = (typeof WORDLIST_PROFILES)[number];

export interface WordlistEntry {
  assetId: string;
  repo: string;
  category: string;
  profiles: string[];
  relPath: string;
  localPath: string;
  approxSizeBytes: number;
  approxLineCount: number;
  isLarge: boolean;
  isBreachData: boolean;
  enabledByDefault: boolean;
  requiresDownload: boolean;
  requiresApproval?: boolean;
  assignedAgents: string[];
  recommendedTools: string[];
  useCase: string;
  safeUsageNotes: string;
}

export interface WordlistSelectionInput {
  taskType?: string;            // e.g. "directory", "subdomain", "password-audit"
  targetTechnology?: string;    // e.g. "apache", "php", "iis"
  protocol?: string;            // e.g. "http", "dns", "smb"
  speedProfile?: "quick" | "balanced" | "deep";
  depthProfile?: "shallow" | "balanced" | "deep";
  riskTolerance?: "low" | "medium" | "high";
  specialistAgentId?: string;
}

export interface WordlistSelection {
  selectedWordlists: Array<{ assetId: string; localPath: string; category: string; approxSizeBytes: number; isLarge: boolean; isBreachData: boolean; requiresApproval: boolean; recommendedTools: string[] }>;
  reason: string;
  /** Path-only args an agent can hand to ffuf/gobuster/hashcat — NEVER the file contents. */
  commandPathArgs: string[];
  estimatedSize: number;
  caution: string | null;
}
