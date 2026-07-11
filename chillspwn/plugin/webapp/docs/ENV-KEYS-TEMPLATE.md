# Operator Env-Key Template (Phase 17.1)

Copy `/.env.mcp.example` lines you need into `/root/.hermes/.env` (never committed), then restart and
set the MCP's `enabled:true`. **Values are read from env only — never logged, stored, or returned.**

Groups:
- **VulnIntel / CVE intelligence** — `NVD_API_KEY` (optional), `CVE_SEARCH_BASE` (local only). Keyless
  NVD/EPSS/KEV already works; a key only raises rate limits.
- **OSINT / threat intelligence** — `VIRUSTOTAL_KEY`/`VT_API_KEY`, `SHODAN_KEY`, `OTX_API_KEY`,
  `GREYNOISE_API_KEY`, `ZOOMEYE_API_KEY`, `CENSYS_API_ID/SECRET`. Optional; **stay disabled by default**.
- **Cloud-ACCOUNT posture** — `AWS_*`/`KUBECONFIG`/`AZURE_*`/`GOOGLE_*`. **Only** for scanning an account
  you own; **NOT needed for cloud-hosted target testing**. Stay disabled unless explicitly provided.
- **AD per-engagement** — `AD_DC_HOST`, `AD_DOMAIN`. **Do not set globally** — per authorized lab only.
- **SSH/session per-engagement** — `PENTEST_SSH_TARGETS`, `TARGET_PASSWORD`/`TARGET_SSH_KEY`. **Do not
  set globally** — per authorized lab only.

Markers: optional · required · per-engagement (never global) · disabled-by-default. Full table + how-to-
obtain + free-tier: `docs/MISSING-API-KEYS.md` (and live `GET /api/mcp/missing-keys`).
