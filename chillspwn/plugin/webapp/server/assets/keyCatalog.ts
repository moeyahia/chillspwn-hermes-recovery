/**
 * Phase 17.1 — API-key catalog + asset-readiness. Pure metadata: env var NAMES, aliases, category,
 * purpose, how-to-obtain (high level), free-tier, fallback, scope, stay-disabled. NEVER values.
 *
 * Categories (per the operator spec):
 *   A can_activate_without_key   B optional_improves_quality   C per_engagement
 *   D cloud_account_posture      E keep_disabled_until_provided
 */

export type KeyCategory = "can_activate_without_key" | "optional_improves_quality" | "per_engagement" | "cloud_account_posture" | "keep_disabled_until_provided";

export interface KeyInfo {
  env: string; aliases: string[]; category: KeyCategory; required: boolean;
  purpose: string; howToObtain: string; freeTier: string; fallback: string;
  scope: "global" | "per-engagement" | "cloud-account"; stayDisabledByDefault: boolean;
}

export const KEY_CATALOG: KeyInfo[] = [
  { env: "NVD_API_KEY", aliases: [], category: "optional_improves_quality", required: false, purpose: "raise NVD CVE API rate limit", howToObtain: "free request at nvd.nist.gov/developers/request-an-api-key", freeTier: "yes (free key)", fallback: "works keyless at a lower rate limit", scope: "global", stayDisabledByDefault: false },
  { env: "VIRUSTOTAL_KEY", aliases: ["VIRUSTOTAL_API_KEY", "VT_API_KEY"], category: "optional_improves_quality", required: false, purpose: "file/URL/domain reputation enrichment", howToObtain: "free account at virustotal.com → API key", freeTier: "yes (limited)", fallback: "VT enrichment tools not exposed", scope: "global", stayDisabledByDefault: true },
  { env: "SHODAN_KEY", aliases: ["SHODAN_API_KEY"], category: "optional_improves_quality", required: false, purpose: "exposed-host intelligence", howToObtain: "account at shodan.io → API key", freeTier: "limited", fallback: "Shodan tools not exposed", scope: "global", stayDisabledByDefault: true },
  { env: "OTX_API_KEY", aliases: [], category: "keep_disabled_until_provided", required: true, purpose: "AlienVault OTX threat pulses", howToObtain: "free account at otx.alienvault.com", freeTier: "yes", fallback: "threat-intel MCP stays disabled", scope: "global", stayDisabledByDefault: true },
  { env: "VT_API_KEY", aliases: ["VIRUSTOTAL_KEY", "VIRUSTOTAL_API_KEY"], category: "keep_disabled_until_provided", required: true, purpose: "VirusTotal for sechub-threat-intel", howToObtain: "virustotal.com API key", freeTier: "yes (limited)", fallback: "threat-intel MCP stays disabled", scope: "global", stayDisabledByDefault: true },
  { env: "GREYNOISE_API_KEY", aliases: [], category: "optional_improves_quality", required: false, purpose: "IP noise/reputation", howToObtain: "community key at greynoise.io", freeTier: "yes (community)", fallback: "GreyNoise tools not exposed", scope: "global", stayDisabledByDefault: true },
  { env: "ZOOMEYE_API_KEY", aliases: [], category: "keep_disabled_until_provided", required: false, purpose: "ZoomEye host intelligence", howToObtain: "account at zoomeye.org", freeTier: "limited", fallback: "not used unless provided", scope: "global", stayDisabledByDefault: true },
  { env: "CENSYS_API_ID", aliases: [], category: "keep_disabled_until_provided", required: false, purpose: "Censys host/cert intel (id)", howToObtain: "account at censys.io", freeTier: "yes (limited)", fallback: "not used unless provided", scope: "global", stayDisabledByDefault: true },
  { env: "CENSYS_API_SECRET", aliases: [], category: "keep_disabled_until_provided", required: false, purpose: "Censys host/cert intel (secret)", howToObtain: "account at censys.io", freeTier: "yes (limited)", fallback: "not used unless provided", scope: "global", stayDisabledByDefault: true },
  { env: "CVE_SEARCH_BASE", aliases: [], category: "keep_disabled_until_provided", required: true, purpose: "URL of a local self-hosted cve-search instance", howToObtain: "self-host cve-search (cve-search/cve-search) + its Mongo/Redis DB", freeTier: "n/a (self-host)", fallback: "local cve-search MCP stays disabled; use keyless NVD/EPSS instead", scope: "global", stayDisabledByDefault: true },
  // D — cloud-account posture (NOT for cloud-hosted target testing)
  { env: "AWS_PROFILE", aliases: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"], category: "cloud_account_posture", required: false, purpose: "scan YOUR OWN AWS account posture (NOT needed for target testing)", howToObtain: "aws configure / IAM read-only creds for an account you own", freeTier: "n/a", fallback: "cloud-account scanning disabled; target testing unaffected", scope: "cloud-account", stayDisabledByDefault: true },
  { env: "AWS_ACCESS_KEY_ID", aliases: ["AWS_PROFILE"], category: "cloud_account_posture", required: false, purpose: "AWS account posture (key id)", howToObtain: "IAM read-only", freeTier: "n/a", fallback: "disabled", scope: "cloud-account", stayDisabledByDefault: true },
  { env: "AWS_SECRET_ACCESS_KEY", aliases: [], category: "cloud_account_posture", required: false, purpose: "AWS account posture (secret)", howToObtain: "IAM read-only", freeTier: "n/a", fallback: "disabled", scope: "cloud-account", stayDisabledByDefault: true },
  { env: "KUBECONFIG", aliases: [], category: "cloud_account_posture", required: false, purpose: "scan a k8s cluster YOU own", howToObtain: "your cluster's read-only kubeconfig", freeTier: "n/a", fallback: "k8s scanning disabled", scope: "cloud-account", stayDisabledByDefault: true },
  { env: "AZURE_TENANT_ID", aliases: ["AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET", "AZURE_SUBSCRIPTION_ID"], category: "cloud_account_posture", required: false, purpose: "Azure account posture", howToObtain: "Azure app registration (read-only)", freeTier: "n/a", fallback: "disabled", scope: "cloud-account", stayDisabledByDefault: true },
  { env: "GOOGLE_APPLICATION_CREDENTIALS", aliases: ["GOOGLE_CLOUD_PROJECT"], category: "cloud_account_posture", required: false, purpose: "GCP account posture", howToObtain: "GCP service-account JSON (read-only)", freeTier: "n/a", fallback: "disabled", scope: "cloud-account", stayDisabledByDefault: true },
  // C — per-engagement (must NOT be global defaults)
  { env: "AD_DC_HOST", aliases: [], category: "per_engagement", required: false, purpose: "lab AD domain controller host", howToObtain: "the authorized lab/engagement target", freeTier: "n/a", fallback: "AD MCP disabled", scope: "per-engagement", stayDisabledByDefault: true },
  { env: "AD_DOMAIN", aliases: [], category: "per_engagement", required: false, purpose: "lab AD domain name", howToObtain: "the authorized lab/engagement target", freeTier: "n/a", fallback: "AD MCP disabled", scope: "per-engagement", stayDisabledByDefault: true },
  { env: "PENTEST_SSH_TARGETS", aliases: [], category: "per_engagement", required: false, purpose: "authorized SSH target host list", howToObtain: "the authorized lab/engagement scope", freeTier: "n/a", fallback: "session MCP won't start", scope: "per-engagement", stayDisabledByDefault: true },
  { env: "TARGET_PASSWORD", aliases: ["TARGET_SSH_KEY"], category: "per_engagement", required: false, purpose: "authorized SSH target credential", howToObtain: "the authorized lab/engagement", freeTier: "n/a", fallback: "session MCP won't start", scope: "per-engagement", stayDisabledByDefault: true },
  { env: "TARGET_SSH_KEY", aliases: ["TARGET_PASSWORD"], category: "per_engagement", required: false, purpose: "authorized SSH target key", howToObtain: "the authorized lab/engagement", freeTier: "n/a", fallback: "session MCP won't start", scope: "per-engagement", stayDisabledByDefault: true },
];

const BY_ENV: Record<string, KeyInfo> = Object.fromEntries(KEY_CATALOG.map((k) => [k.env, k]));
/** Look up an env var by its canonical name OR any alias. */
export function keyInfoFor(env: string): KeyInfo | null {
  if (BY_ENV[env]) return BY_ENV[env];
  return KEY_CATALOG.find((k) => k.aliases.includes(env)) ?? null;
}
