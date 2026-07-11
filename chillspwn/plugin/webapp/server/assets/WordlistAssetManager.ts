/**
 * Phase 17 — WordlistAssetManager. Loads the wordlist manifest and selects wordlists by PATH +
 * METADATA + suitability for a specialist's task. HARD RULES enforced here:
 *   - never returns wordlist CONTENTS (only path/size/category/use-case/checksum/recommended-tool);
 *   - large + breach datasets are disabled by default and flagged requiresApproval;
 *   - never auto-downloads; the bridge/installer handles downloads on explicit operator action.
 */

import { existsSync, readFileSync } from "fs";
import type { WordlistEntry, WordlistSelectionInput, WordlistSelection } from "./WordlistTypes";

export class WordlistAssetManager {
  private entries: WordlistEntry[] = [];
  private loadError: string | null = null;

  constructor(private readonly manifestPath: string) { this.reload(); }

  reload(): void {
    this.entries = []; this.loadError = null;
    try {
      if (!existsSync(this.manifestPath)) { this.loadError = `wordlist manifest not found: ${this.manifestPath}`; return; }
      const m = JSON.parse(readFileSync(this.manifestPath, "utf-8"));
      this.entries = (m.wordlists || []) as WordlistEntry[];
    } catch (e) { this.loadError = `failed to load wordlist manifest: ${(e as Error).message}`; }
  }

  getLoadError(): string | null { return this.loadError; }

  /** Inventory metadata ONLY (never contents). Optionally filtered by agent/category/profile. */
  list(filter: { agentId?: string; category?: string; profile?: string; includeLarge?: boolean; includeBreach?: boolean } = {}): WordlistEntry[] {
    return this.entries.filter((w) =>
      (!filter.agentId || w.assignedAgents.map((a) => a.toLowerCase()).includes(filter.agentId.toLowerCase())) &&
      (!filter.category || w.category === filter.category) &&
      (!filter.profile || w.profiles.includes(filter.profile)) &&
      (filter.includeLarge || !w.isLarge) &&
      (filter.includeBreach || !w.isBreachData));
  }

  forAgent(agentId: string): WordlistEntry[] { return this.list({ agentId, includeLarge: true, includeBreach: true }); }

  /**
   * Select wordlists for a task. Returns paths + metadata + a caution — NEVER contents. Large/breach
   * lists are included only for deep/high-risk profiles and are flagged requiresApproval.
   */
  select(input: WordlistSelectionInput): WordlistSelection {
    const speed = input.speedProfile ?? "balanced";
    const depth = input.depthProfile ?? "balanced";
    const risk = input.riskTolerance ?? "low";
    const wantDeep = speed === "deep" || depth === "deep" || risk === "high";

    // Derive candidate categories AND profiles from the task (an entry matches by EITHER, so
    // 17.1: backup-config — categorized under `extensions` but tagged with the `backup-config`
    // profile — is selected correctly).
    const tt = (input.taskType ?? "").toLowerCase();
    const proto = (input.protocol ?? "").toLowerCase();
    const cats = new Set<string>();
    const profs = new Set<string>();
    if (/sub|dns/.test(tt) || proto === "dns") { cats.add("subdomain"); profs.add("subdomain"); }
    if (/dir|content|web|fuzz/.test(tt)) { cats.add("directory"); profs.add("directory"); }
    if (/api/.test(tt)) { cats.add("api"); profs.add("api"); }
    if (/param/.test(tt)) { cats.add("parameters"); profs.add("parameters"); }
    if (/user/.test(tt)) { cats.add("usernames"); profs.add("usernames"); }
    if (/pass|cred|crack|audit/.test(tt)) { cats.add("passwords"); profs.add("passwords"); }
    if (/backup|config/.test(tt)) { cats.add("backup-config"); cats.add("extensions"); profs.add("backup-config"); }
    if (/ext/.test(tt)) { cats.add("extensions"); profs.add("extensions"); }
    if (input.targetTechnology) { cats.add("technology-specific"); profs.add("technology-specific"); }
    if (cats.size === 0) { cats.add("directory"); profs.add("directory"); }

    let pool = this.entries.filter((w) => cats.has(w.category) || w.profiles.some((p) => profs.has(p)));
    if (input.specialistAgentId) pool = pool.filter((w) => w.assignedAgents.map((a) => a.toLowerCase()).includes(input.specialistAgentId!.toLowerCase()));
    // Prefer non-large for quick/balanced; allow large only when deep/high-risk.
    const small = pool.filter((w) => !w.isLarge);
    const large = pool.filter((w) => w.isLarge);
    let chosen = (speed === "quick" ? small.filter((w) => w.profiles.includes("quick")).slice(0, 1) : small).slice(0, wantDeep ? 4 : 2);
    if (wantDeep) chosen = [...chosen, ...large.slice(0, 2)];
    if (chosen.length === 0) chosen = pool.slice(0, 1); // last resort

    const breach = chosen.filter((w) => w.isBreachData);
    const needsApproval = chosen.filter((w) => w.isLarge || w.isBreachData || w.requiresApproval);
    return {
      selectedWordlists: chosen.map((w) => ({ assetId: w.assetId, localPath: w.localPath, category: w.category, approxSizeBytes: w.approxSizeBytes, isLarge: w.isLarge, isBreachData: w.isBreachData, requiresApproval: !!(w.isLarge || w.isBreachData || w.requiresApproval), recommendedTools: w.recommendedTools })),
      reason: `task='${input.taskType ?? "(generic)"}' → categories [${[...cats].join(", ")}], ${speed}/${depth}/${risk}${input.specialistAgentId ? ` for ${input.specialistAgentId}` : ""}: ${chosen.length} list(s) by PATH (contents never read)`,
      commandPathArgs: chosen.map((w) => `-w ${w.localPath}`),
      estimatedSize: chosen.reduce((n, w) => n + w.approxSizeBytes, 0),
      caution: [
        needsApproval.length ? `${needsApproval.length} selected list(s) are LARGE/breach → operator approval required; not auto-downloaded` : "",
        breach.length ? "BREACH DATA selected — authorized lab/password-audit only; never print entries or store as memory" : "",
      ].filter(Boolean).join("; ") || null,
    };
  }
}
