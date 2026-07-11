/**
 * Phase 17 — HashcatAssetManager. Builds an authorized-lab cracking STRATEGY from hash type +
 * objective + runtime budget, using wordlist/rule METADATA only. Returns PATHS + a path-based command
 * template — never wordlist/rule contents, never hash values, never plaintext. Cracking output is
 * redacted evidence; lessons describe strategy, not secrets.
 */

import { existsSync, readFileSync } from "fs";
import type { HashcatBaseWordlist, HashcatRule, HashcatStrategyInput, HashcatStrategyPlan, HashcatStrategy } from "./HashcatTypes";

export class HashcatAssetManager {
  private wordlists: HashcatBaseWordlist[] = [];
  private rules: HashcatRule[] = [];
  private loadError: string | null = null;

  constructor(private readonly manifestPath: string) { this.reload(); }

  reload(): void {
    this.wordlists = []; this.rules = []; this.loadError = null;
    try {
      if (!existsSync(this.manifestPath)) { this.loadError = `hashcat manifest not found: ${this.manifestPath}`; return; }
      const m = JSON.parse(readFileSync(this.manifestPath, "utf-8"));
      this.wordlists = (m.baseWordlists || []) as HashcatBaseWordlist[];
      this.rules = (m.rules || []) as HashcatRule[];
    } catch (e) { this.loadError = `failed to load hashcat manifest: ${(e as Error).message}`; }
  }
  getLoadError(): string | null { return this.loadError; }
  listWordlists(): HashcatBaseWordlist[] { return this.wordlists; }
  listRules(): HashcatRule[] { return this.rules; }

  /** Build a cracking strategy (paths + command template only). Always authorized-lab + approval-gated. */
  strategy(input: HashcatStrategyInput): HashcatStrategyPlan {
    const budget = input.runtimeBudget ?? "balanced";
    const style = (input.passwordStyleHint ?? input.objective ?? "").toLowerCase();
    const isPhrase = /phrase|corporate|passphrase|sentence/.test(style);
    const isPolicy = /policy|complexity|pattern/.test(style);

    let strat: HashcatStrategy;
    if (isPolicy) strat = "policy-driven-mutation";
    else if (isPhrase) strat = "passphrase";
    else if (budget === "fast") strat = "straight";
    else strat = "rules";

    // Choose wordlists by strategy + budget (prefer non-large unless deep).
    const wantLarge = budget === "deep";
    const wlPool = this.wordlists.filter((w) => (strat === "passphrase" ? w.strategy === "passphrase" : true));
    const wls = (wantLarge ? wlPool : wlPool.filter((w) => !w.isLarge)).slice(0, wantLarge ? 2 : 1);
    const wlFinal = wls.length ? wls : wlPool.slice(0, 1);

    // Choose rules by strategy + budget.
    let rulePool: HashcatRule[] = [];
    if (strat === "rules") rulePool = this.rules.filter((r) => r.ruleFamily === "general-purpose" || (wantLarge && /broad|exhaustive/.test(r.ruleFamily)));
    else if (strat === "passphrase") rulePool = this.rules.filter((r) => r.ruleFamily === "passphrase-mutation");
    else if (strat === "policy-driven-mutation") rulePool = this.rules.filter((r) => r.ruleFamily === "policy-driven-mutation");
    const rules = rulePool.slice(0, wantLarge ? 2 : 1);

    const expansion = rules.reduce((n, r) => n + (r.estimatedExpansionFactor || 1), strat === "straight" ? 1 : 0) || 1;
    const approvalRequired = true || wlFinal.some((w) => w.isLarge || w.isBreachData || w.requiresApproval) || rules.some((r) => r.requiresApproval);
    const runtime = wantLarge ? "deep (hours+)" : rules.some((r) => /slow/.test(r.expectedRuntimeClass)) ? "slow" : "fast-minutes";

    const ruleArgs = rules.map((r) => `-r ${r.localPath}`).join(" ");
    const wlArgs = wlFinal.map((w) => w.localPath).join(" ");
    const cmd = strat === "policy-driven-mutation"
      ? `python /opt/chillspwn-assets/hashcat/hashcat-rules-generator/generate.py --policy <policy> -o <out.rule> && hashcat -a 0 -m <type> <hashfile> ${wlArgs} -r <out.rule> --potfile-disable`
      : `hashcat -a 0 -m <type> <hashfile> ${wlArgs} ${ruleArgs} --potfile-disable  # GPU host; model supplies its own wordlist`;

    return {
      strategy: strat,
      hashType: input.hashType ?? null,
      selectedWordlistPaths: wlFinal.map((w) => w.localPath),
      selectedRulePaths: rules.map((r) => r.localPath),
      commandPlan: cmd,
      estimatedExpansion: expansion,
      expectedRuntimeClass: runtime,
      approvalRequired,
      reason: `objective='${input.objective ?? "(generic)"}' style='${style || "n/a"}' budget=${budget} → strategy '${strat}' with ${wlFinal.length} wordlist(s) + ${rules.length} rule(s), by PATH (no contents read)`,
      safety: "AUTHORIZED LAB ONLY. Crack on the GPU host with --potfile-disable; the model supplies its own wordlist each run. Plaintext passwords + hashes are NEVER stored as reusable memory — only redacted evidence + strategy lessons.",
    };
  }
}
