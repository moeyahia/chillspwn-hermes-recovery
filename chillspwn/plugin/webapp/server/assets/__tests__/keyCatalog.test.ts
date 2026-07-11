import { test, expect, describe } from "bun:test";
import { keyInfoFor, KEY_CATALOG } from "../keyCatalog";
import { WordlistAssetManager } from "../WordlistAssetManager";
import { join } from "path";
import { getAgent } from "../../agents/agentRoster";

const wl = new WordlistAssetManager(join(import.meta.dir, "..", "wordlistAssets.manifest.json"));

describe("17.1 key catalog — aliases + classification", () => {
  test("alias normalization", () => {
    expect(keyInfoFor("VIRUSTOTAL_API_KEY")!.env).toBe("VIRUSTOTAL_KEY");
    expect(keyInfoFor("VT_API_KEY")).not.toBeNull();
    expect(keyInfoFor("SHODAN_API_KEY")!.env).toBe("SHODAN_KEY");
    expect(keyInfoFor("AWS_ACCESS_KEY_ID")).not.toBeNull();
  });
  test("required/optional classification", () => {
    expect(keyInfoFor("NVD_API_KEY")!.required).toBe(false);   // optional
    expect(keyInfoFor("NVD_API_KEY")!.category).toBe("optional_improves_quality");
    expect(keyInfoFor("OTX_API_KEY")!.required).toBe(true);    // keep disabled until provided
  });
  test("cloud creds = cloud-account scope, NOT required (target testing needs none)", () => {
    const aws = keyInfoFor("AWS_PROFILE")!;
    expect(aws.category).toBe("cloud_account_posture");
    expect(aws.scope).toBe("cloud-account");
    expect(aws.required).toBe(false);
    expect(aws.fallback).toContain("target testing unaffected");
  });
  test("per-engagement keys are per-engagement scope, stay disabled", () => {
    for (const k of ["AD_DC_HOST", "AD_DOMAIN", "PENTEST_SSH_TARGETS", "TARGET_PASSWORD", "TARGET_SSH_KEY"]) {
      const i = keyInfoFor(k)!; expect(i.category).toBe("per_engagement"); expect(i.scope).toBe("per-engagement"); expect(i.stayDisabledByDefault).toBe(true);
    }
  });
  test("CVE_SEARCH_BASE missing → local cve-search disabled (fallback to keyless NVD)", () => {
    const i = keyInfoFor("CVE_SEARCH_BASE")!; expect(i.fallback).toContain("keyless NVD");
  });
});

describe("17.1 VulnIntel read-only + keyless CVE tools", () => {
  test("VulnIntel allowlist = read-only CVE tools (no exploit/exec/scan)", () => {
    const v = getAgent("VulnIntel")!;
    for (const t of ["lookup_cve", "get_epss_score", "check_kev", "get_attack_mapping"]) expect(v.allowedTools).toContain(t);
    for (const t of ["execute", "runHashcat", "nmapScan", "ffufScan", "sqlmap"]) { expect(v.allowedTools).not.toContain(t); expect(v.deniedTools).toContain(t); }
  });
});

describe("17.1 backup-config wordlist selection (fixed) — path/metadata only", () => {
  test("backup-config returns lists by PATH, no contents", () => {
    const sel = wl.select({ taskType: "backup-config", specialistAgentId: "WebBreaker" });
    expect(sel.selectedWordlists.length).toBeGreaterThan(0);
    expect(sel.commandPathArgs.every((a) => a.startsWith("-w /opt/"))).toBe(true);
    expect(sel.selectedWordlists.every((w) => !("contents" in w) && !("preview" in w) && !("lines" in w))).toBe(true);
  });
});
