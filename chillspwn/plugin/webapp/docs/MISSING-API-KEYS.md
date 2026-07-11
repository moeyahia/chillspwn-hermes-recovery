# Missing API Keys (Phase 17)

MCP servers that need API keys / credentials. **Env var NAMES only — values are never read, stored, or
printed.** Live status: `GET /api/mcp/missing-keys`.

## Cloud distinction (important)
- **Cloud-hosted TARGET testing does NOT require cloud credentials** — testing a web app/host that
  happens to run in AWS/Azure/GCP uses the recon/web MCPs (ReconScout/WebBreaker). No cloud keys.
- **Cloud-ACCOUNT posture scanning** (IAM/buckets/config of an account you own) is the only thing that
  needs cloud credentials — that's `sechub-cloud-security` (CloudSentinel), disabled until creds provided.

## Key reference
| Env var | Used by (MCP / agent) | Purpose | Required? | Free tier | Consequence if missing |
|---|---|---|---|---|---|
| `NVD_API_KEY` | vulnintel-cve-mcp, vulnintel-nvd / VulnIntel | NVD CVE rate-limit raise | optional | yes (NVD) | works keyless, lower rate limit |
| `VIRUSTOTAL_KEY` / `VIRUSTOTAL_API_KEY` | vulnintel-cve-mcp, sechub-threat-intel / VulnIntel, OSINTSeeker | file/URL/domain reputation | optional | yes | enrichment unavailable |
| `SHODAN_KEY` / `SHODAN_API_KEY` | vulnintel-cve-mcp, sechub-threat-intel | exposed-host intel | optional | limited | host intel unavailable |
| `OTX_API_KEY` | sechub-threat-intel / OSINTSeeker | AlienVault OTX pulses | optional | yes | TI pulses unavailable |
| `GREYNOISE_API_KEY` | vulnintel-cve-mcp | IP noise/reputation | optional | yes (community) | IP reputation unavailable |
| `ZOOMEYE_API_KEY` | (optional OSINT) | ZoomEye host intel | optional | limited | unavailable |
| `CENSYS_API_ID` / `CENSYS_API_SECRET` | (optional OSINT) | Censys host/cert intel | optional | yes | unavailable |
| `CVE_SEARCH_BASE` | vulnintel-cve-search-local / VulnIntel | local cve-search URL | required (for this server) | n/a (self-host) | server disabled |
| `AWS_PROFILE` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | sechub-cloud-security / CloudSentinel | **cloud-account** posture | only for account scanning | n/a | account scan disabled (NOT needed for target testing) |
| `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` / `AZURE_SUBSCRIPTION_ID` | sechub-cloud-security | Azure account posture | only for account scanning | n/a | account scan disabled |
| `GOOGLE_APPLICATION_CREDENTIALS` / `GOOGLE_CLOUD_PROJECT` | sechub-cloud-security | GCP account posture | only for account scanning | n/a | account scan disabled |
| `AD_DC_HOST` / `AD_DOMAIN` | sechub-active-directory / ADAttackMapper | lab AD target | per-engagement config | n/a | AD MCP disabled |
| `TARGET_PASSWORD` / `TARGET_SSH_KEY` | pentest-mcp-server-ssh / SessionRunner | lab SSH target creds | per-engagement | n/a | session MCP won't start |

## How to provide a key
Put the var in `/root/.hermes/.env` (never committed), restart, then set the server's `enabled:true` in
the active MCP config. Keys are read from env only — the dashboard never logs or returns values.

## Phase 17.1 — categories + keyless activation
Each key is categorized (live `GET /api/mcp/missing-keys` → `category` + `catalog`):
- **A can_activate_without_key** — keyless NVD/EPSS/KEV CVE intelligence (now ENABLED for VulnIntel),
  wordlist/hashcat metadata selectors.
- **B optional_improves_quality** — `NVD_API_KEY`, `VIRUSTOTAL_KEY`/`VT_API_KEY`, `SHODAN_KEY`,
  `GREYNOISE_API_KEY` (raise quality/rate limits; degrade gracefully when absent).
- **C per_engagement** — `AD_DC_HOST`, `AD_DOMAIN`, `PENTEST_SSH_TARGETS`, `TARGET_PASSWORD`,
  `TARGET_SSH_KEY` — set ONLY for the active authorized lab, **never as global defaults**.
- **D cloud_account_posture** — `AWS_*`, `KUBECONFIG`, `AZURE_*`, `GOOGLE_*` — only for scanning an
  account you own. **NOT needed for cloud-hosted target testing.**
- **E keep_disabled_until_provided** — `OTX_API_KEY`, `VT_API_KEY`, `CVE_SEARCH_BASE`, cloud-control-plane
  keys — MCPs stay disabled until explicitly provided.

Alias normalization: VIRUSTOTAL_KEY↔VIRUSTOTAL_API_KEY↔VT_API_KEY, SHODAN_KEY↔SHODAN_API_KEY,
AWS_PROFILE↔AWS_ACCESS_KEY_ID. A key counts as present if any alias is set. Template: `.env.mcp.example`.
