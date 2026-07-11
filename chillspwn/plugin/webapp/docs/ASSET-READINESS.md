# Asset Readiness (Phase 17.1)

Live: `GET /api/assets/readiness` — status only, no contents/secrets.

| Asset / MCP | Readiness | Notes |
|---|---|---|
| Wordlists | `metadata_ready` | metadata-only; sparse-checkout specific lists on demand (no multi-GB clone) |
| Hashcat | `metadata_ready` | metadata-only; authorized-lab cracking on GPU host, --potfile-disable |
| `vulnintel-cve-mcp` (VulnIntel) | `ready` (keyless) | NVD/EPSS/KEV/ATT&CK lookups; VT/Shodan/GreyNoise tools need keys (not exposed keyless) |
| `vulnintel-nvd` (VulnIntel) | `ready` (keyless) | NVD CVE lookup fallback |
| `vulnintel-cve-search-local` (VulnIntel) | `missing_key` | needs `CVE_SEARCH_BASE` + local cve-search |
| `sechub-threat-intel` (OSINTSeeker) | `missing_key` | needs `VT_API_KEY`/`OTX_API_KEY` |
| `sechub-cloud-security` (CloudSentinel) | `missing_key` | cloud-ACCOUNT posture only; NOT for target testing |
| `sechub-active-directory` (ADAttackMapper) | `missing_key` | per-engagement `AD_DC_HOST`/`AD_DOMAIN` |
| `pentest-mcp-server-ssh` (SessionRunner) | `missing_key` | per-engagement `PENTEST_SSH_TARGETS`+creds |
| sechub-* docker MCPs | `disabled` | need `MCP_ARSENAL_ALLOW_DOCKER=true` + built images |

`ready` = enabled + dependencies present · `missing_key` = needs a key/cred · `disabled` = off by
default · `not_configured` = not in the active config.
