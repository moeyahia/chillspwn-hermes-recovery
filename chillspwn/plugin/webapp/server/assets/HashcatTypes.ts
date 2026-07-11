/**
 * Phase 17 — Hashcat asset types. CredSmith reasons about cracking STRATEGY using wordlist + rule
 * METADATA (paths, family, expansion factor, runtime class) — never the contents. Cracking is
 * authorized-lab-only; plaintext passwords + hashes are NEVER stored as reusable memory.
 */

export const HASHCAT_STRATEGIES = ["straight", "rules", "passphrase", "mask", "hybrid", "combinator", "policy-driven-mutation"] as const;
export type HashcatStrategy = (typeof HASHCAT_STRATEGIES)[number];

export interface HashcatBaseWordlist {
  assetId: string; repo: string; category: string; strategy: string; localPath: string;
  approxLineCount: number; isLarge: boolean; isBreachData: boolean; enabledByDefault: boolean;
  requiresApproval?: boolean; passwordStyle: string; bestAttackMode: string; expectedRuntimeClass: string;
  assignedAgents: string[]; safeUsageNotes: string;
}
export interface HashcatRule {
  assetId: string; repo: string; ruleFamily: string; localPath: string; approxRuleCount: number;
  estimatedExpansionFactor: number; intendedPasswordStyle: string; bestAttackMode: string;
  riskCost: string; expectedRuntimeClass: string; enabledByDefault: boolean; requiresApproval?: boolean;
  assignedAgents: string[]; safeUsageNotes: string;
}

export interface HashcatStrategyInput {
  hashType?: string;            // e.g. "ntlm", "bcrypt", "sha256", "wpa"
  objective?: string;          // e.g. "quick wins", "corporate phrases", "policy-aware"
  runtimeBudget?: "fast" | "balanced" | "deep";
  passwordStyleHint?: string;  // e.g. "corporate", "common", "phrase"
}

export interface HashcatStrategyPlan {
  strategy: HashcatStrategy;
  hashType: string | null;
  selectedWordlistPaths: string[];
  selectedRulePaths: string[];
  commandPlan: string;          // path-based hashcat command template (no hash values, no contents)
  estimatedExpansion: number;
  expectedRuntimeClass: string;
  approvalRequired: boolean;
  reason: string;
  safety: string;
}
