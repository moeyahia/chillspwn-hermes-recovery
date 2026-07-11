/**
 * Phase 17 — asset + missing-keys APIs. All endpoints return METADATA + PATHS only — never wordlist/
 * rule CONTENTS, never secret VALUES. Read-only.
 *   GET /api/assets/wordlists[?agent&category&profile]   — wordlist inventory metadata
 *   GET /api/assets/wordlists/select?...                 — path/metadata selection for a task
 *   GET /api/assets/hashcat                               — hashcat wordlist/rule inventory metadata
 *   GET /api/assets/hashcat/strategy?...                  — cracking strategy (paths + command template)
 *   GET /api/mcp/missing-keys                             — which MCP API keys are absent (names only)
 */

import { existsSync, readFileSync } from "fs";
import type { Express, Request, Response } from "express";
import { WordlistAssetManager } from "../assets/WordlistAssetManager";
import { HashcatAssetManager } from "../assets/HashcatAssetManager";
import { KEY_CATALOG, keyInfoFor } from "../assets/keyCatalog";

export interface AssetRouteDeps {
  wordlistManifest: string;
  hashcatManifest: string;
  mcpManifest: string;        // server/agents/mcpArsenal.manifest.json
  vulnIntelManifest: string;  // server/assets/vulnIntelMcp.manifest.json
  activeMcpConfig?: string;   // /opt/chillspwn-mcp-arsenal/.mcp.arsenal.json (live enablement)
  enabled: () => boolean;     // SECURITY.enableSpecialistAgentRouting (assets gate with the army)
  env?: () => NodeJS.ProcessEnv;
}

export function registerAssetRoutes(app: Express, deps: AssetRouteDeps): void {
  const wl = new WordlistAssetManager(deps.wordlistManifest);
  const hc = new HashcatAssetManager(deps.hashcatManifest);
  const gate = (res: Response) => deps.enabled() ? true : (res.status(403).json({ error: "specialist agent routing disabled" }), false);

  app.get("/api/assets/wordlists", (req: Request, res: Response) => {
    if (!gate(res)) return;
    if (wl.getLoadError()) return res.status(503).json({ error: wl.getLoadError() });
    res.json({
      note: "metadata + paths only — wordlist contents are never returned",
      wordlists: wl.list({
        agentId: req.query.agent as string | undefined,
        category: req.query.category as string | undefined,
        profile: req.query.profile as string | undefined,
        includeLarge: req.query.includeLarge === "true",
        includeBreach: req.query.includeBreach === "true",
      }),
    });
  });

  app.get("/api/assets/wordlists/select", (req: Request, res: Response) => {
    if (!gate(res)) return;
    if (wl.getLoadError()) return res.status(503).json({ error: wl.getLoadError() });
    res.json(wl.select({
      taskType: req.query.taskType as string | undefined,
      targetTechnology: req.query.tech as string | undefined,
      protocol: req.query.protocol as string | undefined,
      speedProfile: req.query.speed as any,
      depthProfile: req.query.depth as any,
      riskTolerance: req.query.risk as any,
      specialistAgentId: req.query.agent as string | undefined,
    }));
  });

  app.get("/api/assets/hashcat", (_req: Request, res: Response) => {
    if (!gate(res)) return;
    if (hc.getLoadError()) return res.status(503).json({ error: hc.getLoadError() });
    res.json({ note: "metadata + paths only — wordlist/rule contents are never returned", wordlists: hc.listWordlists(), rules: hc.listRules() });
  });

  app.get("/api/assets/hashcat/strategy", (req: Request, res: Response) => {
    if (!gate(res)) return;
    if (hc.getLoadError()) return res.status(503).json({ error: hc.getLoadError() });
    res.json(hc.strategy({
      hashType: req.query.hashType as string | undefined,
      objective: req.query.objective as string | undefined,
      runtimeBudget: req.query.budget as any,
      passwordStyleHint: req.query.style as string | undefined,
    }));
  });

  // Part 7 — missing API keys (names only, never values). Aggregates MCP manifests + the live env.
  app.get("/api/mcp/missing-keys", (_req: Request, res: Response) => {
    if (!gate(res)) return;
    const env = (deps.env ?? (() => process.env))();
    const rows: any[] = [];
    const scan = (manifestPath: string, kind: string) => {
      if (!existsSync(manifestPath)) return;
      try {
        const m = JSON.parse(readFileSync(manifestPath, "utf-8"));
        for (const s of m.servers || []) {
          // requiredEnv drives health; optionalEnv (e.g. keyless CVE enrichers) is reported too.
          const keys: string[] = [...(s.requiredEnv || []), ...(s.optionalEnv || [])];
          for (const k of keys) {
            // 17.1 — a key is PRESENT if its canonical name OR any alias is set in env.
            const info = keyInfoFor(k);
            const aliases = info?.aliases ?? [];
            const present = !!env[k] || aliases.some((a) => !!env[a]);
            rows.push({
              mcpServer: s.mcpServerName || s.assetId, source: kind, repo: s.sourceRepo || s.repo || "",
              env: k, aliases, present,
              category: info?.category ?? "keep_disabled_until_provided",
              required: info ? info.required : ((s.apiKeysRequired || []).length > 0 && !/optional/i.test((s.apiKeysRequired || []).join(","))),
              agent: (s.assignedAgents || []).join(","), enabled: s.enabledByDefault === true,
              purpose: info?.purpose ?? "", howToObtain: info?.howToObtain ?? "", freeTier: info?.freeTier ?? "unknown",
              fallback: info?.fallback ?? (s.consequenceIfNoKey || "feature degraded / server disabled"),
              scope: info?.scope ?? "global", stayDisabledByDefault: info?.stayDisabledByDefault ?? true,
            });
          }
        }
      } catch { /* skip unreadable manifest */ }
    };
    scan(deps.mcpManifest, "mcpArsenal");
    scan(deps.vulnIntelManifest, "vulnIntel");
    const seen = new Set<string>();
    const missing = rows.filter((r) => { const k = `${r.mcpServer}:${r.env}`; if (seen.has(k)) return false; seen.add(k); return !r.present; });
    res.json({
      note: "env var NAMES only — values are never read or returned. Cloud creds are NOT required for cloud-hosted TARGET testing; only for cloud-ACCOUNT posture scanning.",
      categories: { A: "can_activate_without_key", B: "optional_improves_quality", C: "per_engagement", D: "cloud_account_posture", E: "keep_disabled_until_provided" },
      missingCount: missing.length, missing, catalog: KEY_CATALOG,
    });
  });

  // Part 6 — asset readiness (paths/status only, no contents/secrets).
  app.get("/api/assets/readiness", (_req: Request, res: Response) => {
    if (!gate(res)) return;
    const env = (deps.env ?? (() => process.env))();
    const cfg = deps.activeMcpConfig && existsSync(deps.activeMcpConfig) ? (() => { try { return JSON.parse(readFileSync(deps.activeMcpConfig!, "utf-8")).mcpServers || {}; } catch { return {}; } })() : {};
    const srv = (name: string) => cfg[name];
    const mcpStatus = (name: string, keys: string[] = []) => {
      const s = srv(name);
      if (!s) return "not_configured";
      if (!s.enabled) {
        if (keys.length && !keys.every((k) => env[k] || (keyInfoFor(k)?.aliases ?? []).some((a) => env[a]))) return "missing_key";
        return "disabled";
      }
      return "ready";
    };
    const wlCount = wl.getLoadError() ? 0 : wl.list({ includeLarge: true, includeBreach: true }).length;
    const hcCount = hc.getLoadError() ? 0 : hc.listWordlists().length + hc.listRules().length;
    res.json({
      note: "readiness status only — no file contents, no secret values",
      wordlists: { status: wlCount ? "metadata_ready" : "manifest_missing", count: wlCount, downloaded: false, note: "metadata-only; sparse-checkout specific lists on demand" },
      hashcat: { status: hcCount ? "metadata_ready" : "manifest_missing", count: hcCount, downloaded: false, note: "metadata-only; authorized-lab cracking on GPU host" },
      vulnIntelCve: {
        "vulnintel-cve-mcp": mcpStatus("vulnintel-cve-mcp", []),
        "vulnintel-nvd": mcpStatus("vulnintel-nvd", []),
        "vulnintel-cve-search-local": mcpStatus("vulnintel-cve-search-local", ["CVE_SEARCH_BASE"]),
      },
      osint: { "sechub-osint": mcpStatus("sechub-osint"), "sechub-threat-intel": mcpStatus("sechub-threat-intel", ["VT_API_KEY", "OTX_API_KEY"]) },
      cloud: { "sechub-cloud-security": mcpStatus("sechub-cloud-security", ["AWS_PROFILE"]), note: "cloud creds needed ONLY for cloud-ACCOUNT posture, NOT for cloud-hosted target testing" },
      ad: { "sechub-active-directory": mcpStatus("sechub-active-directory", ["AD_DC_HOST"]), note: "per-engagement config" },
      session: { "pentest-mcp-server-ssh": mcpStatus("pentest-mcp-server-ssh", ["PENTEST_SSH_TARGETS"]), note: "per-engagement SSH target config" },
    });
  });
}
