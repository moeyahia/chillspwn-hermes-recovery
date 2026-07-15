# MCP Arsenal Bridge (Phase 16)

Makes the staged MCP arsenal **executable for specialist agents** through the OpenRouter/runtime path
— **never** through the frozen Claude path. Default **OFF**.

## Why MCPs are NOT attached to Claude
- `spawnClaude` / `claude -p` / CLI args / stream-json / session resume / output parsing are **frozen**.
- No `--mcp-config` is added to the Claude path; `/root/.claude.json` `mcpServers` is left untouched.
- Claude stays **observe-only** for tool enforcement. MCP execution is wired into the OR/Codex/runtime
  path only. (This is the §16.0 design decision; confirmed: no MCP runtime existed before Phase 16.)

## Architecture (the chain)
```
Specialist agent (OR/Codex)
  → mcp_execute tool  (integration/phase16_mcp_tool.py — one logical tool)
  → POST /api/mcp/execute
      → run/step exist?  specialist exists?  actor not bypassing?
      → AgentRoutingPolicy (specialist allowlist; ChillsPwn can't direct-call)
      → AgentRuntime.requestTool  (ToolPolicy risk gate + approval)
      → McpArsenalBridge.execute  (health → mode → dispatch)
          → McpToolExecutor       (stdio JSON-RPC: initialize → tools/call)
          → specific MCP server/tool
      → normalized ToolResult → Evidence (large→Artifact) → audit → Cockpit/Mission Board
```
Tools are exposed **only** via specialist allowlists + the bridge. **No MCP is exposed globally.**

## Components
| File | Role |
|------|------|
| `server/mcp/McpTypes.ts` | server states, runtime types, result/RPC types |
| `server/mcp/McpServerRegistry.ts` | load `.mcp.arsenal.json` + manifest, derive start commands, compute health |
| `server/mcp/McpToolExecutor.ts` | **minimal stdio MCP client** (JSON-RPC, no new dep): initialize/tools-list/tools-call + timeout |
| `server/mcp/McpArsenalBridge.ts` | mode + per-specialist tool view + health + normalized execute (truncate/redact) |
| `server/routes/mcpRoutes.ts` | read-only APIs + the gated `POST /api/mcp/execute` |
| `integration/phase16_mcp_tool.py` | orchestrator-side `mcp_execute` tool (routes through the gate) |

## Feature flags (default safe)
| Flag | Default | Meaning |
|------|---------|---------|
| `ENABLE_MCP_ARSENAL` | `false` | master switch |
| `MCP_ARSENAL_CONFIG` | `/opt/chillspwn-mcp-arsenal/.mcp.arsenal.json` | active config path |
| `MCP_ARSENAL_MODE` | `disabled` | `disabled` \| `dry-run` (record, no exec) \| `enabled` (execute) |
| `MCP_ARSENAL_START_SERVERS` | `false` | allow the bridge to start stdio MCP servers |
| `MCP_ARSENAL_ALLOW_DOCKER` | `false` | allow starting Docker MCP servers |
| `MCP_ARSENAL_DEFAULT_TIMEOUT_SECONDS` | `120` | per-call timeout |
| `MCP_ARSENAL_MAX_OUTPUT_BYTES` | `20000` | preview budget (overflow → artifact) |

**Activation order:** `ENABLE_MCP_ARSENAL=true` + `MCP_ARSENAL_MODE=dry-run` first → validate → then
`MCP_ARSENAL_MODE=enabled` + `MCP_ARSENAL_START_SERVERS=true` (and `MCP_ARSENAL_ALLOW_DOCKER=true` only
when you have built the Docker images).

## Server states
`disabled` · `configured` · `missing_dependency` (binary/docker image) · `missing_secret` (env/key) ·
`starting` · `healthy` · `failed` · `stopped`.

## Read-only APIs
```
GET  /api/mcp/servers                       # all servers + health
GET  /api/mcp/tools                         # all tools + owning server/agents
GET  /api/mcp/specialists/:agentId/tools    # a specialist's runnable vs blocked tools
GET  /api/mcp/health                        # health of every server
POST /api/mcp/health-check {server?}        # re-check (reloads config)
```
Execution is ONLY through the gated `POST /api/mcp/execute` — there is no arbitrary UI execution.

## Installing profiles
```
sudo /opt/chillspwn/plugin/webapp/scripts/setup-mcp-arsenal.sh --profile core --write-config --health-check
sudo /opt/chillspwn/plugin/webapp/scripts/setup-mcp-arsenal.sh --profile web  --write-config --health-check
sudo /opt/chillspwn/plugin/webapp/scripts/setup-mcp-arsenal.sh --profile ad   --write-config --health-check
sudo /opt/chillspwn/plugin/webapp/scripts/setup-mcp-arsenal.sh --profile osint --write-config --health-check
```
`--write-config` MERGES each profile into the active config, all `enabled:false`, with env templates
(no secrets). Run `--health-check` to see which binaries/images/keys are present. The light stdio
servers (`pentest-mcp-server-ssh` python, `pentest-mcp-recon` node) install via venv/npm; the sechub
categories are **Docker** images you must build; `chillspwn-reporting` is built-in.

The vendor tree, active config, application manifest, every configured working directory, and every resolved executable must remain root-owned and not group/other-writable. Never make `/opt/chillspwn-mcp-arsenal` service-owned and never use `sudo chown $USER` as a workaround. Writable MCP process state belongs only in `/root/.hermes/chillspwn/mcp-runtime`. The restore helper normalizes and validates this boundary as the real service identity; an enabled entry with an untrusted command or working directory stays non-runnable.

## Enabling OSINT keys / cloud credentials
- **OSINT / threat-intel** (`sechub-threat-intel`): set `VT_API_KEY` / `OTX_API_KEY` / `SHODAN_API_KEY`
  in the environment, then set the server's `enabled:true` in the active config. Disabled until keys
  exist. Keys are read from env only — never stored in memory or printed.
- **Cloud account-posture** (`sechub-cloud-security` / `prowler`): needs **read-only lab cloud
  credentials** (`AWS_PROFILE` / `KUBECONFIG`). Disabled until provided.

## Cloud-hosted target testing vs cloud account-posture scanning
- **Testing a target that happens to be cloud-hosted** (web app, host) → use the **recon/web** MCPs
  (ReconScout/WebBreaker). **No cloud credentials required.**
- **Scanning a cloud ACCOUNT'S posture** (IAM, buckets, config) → that's `sechub-cloud-security`
  (CloudSentinel) and **requires the account's read-only credentials**. Keep the cloud-control-plane
  MCP **disabled** unless those credentials are explicitly provided.

## How-to
- **Enable one MCP:** set `enabled:true` for that server in the active config; ensure its specialist
  owns the tools (`agentMcpMap.ts`); `MCP_ARSENAL_MODE=enabled`.
- **Disable one MCP:** set `enabled:false` (it stays out of every specialist's runnable set).
- **Disable one specialist's tool:** add it to the agent's `deniedTools` in `agentRoster.ts`.
- **Disable a whole specialist:** remove it from `agentRoster.ts` / stop routing to it.
- **Health-check:** `scripts/setup-mcp-arsenal.sh --profile <p> --health-check` or `POST /api/mcp/health-check`.

## Rollback
- `ENABLE_MCP_ARSENAL=false` (or `MCP_ARSENAL_MODE=disabled`) — bridge inert, no execution.
- Move `/opt/chillspwn-mcp-arsenal/.mcp.arsenal.json` into a root-only rollback directory — no config is then loaded.
- `git checkout` the pre-Phase-16 commit. The Claude path is untouched in every case.

## Phase 16.2 — approval mode + real local MCP
**Approval mode** (`APPROVAL_MODE=human|auto|hybrid`, default human, runtime-toggleable via
`GET/POST /api/runtime/approval-mode`, persisted): human=operator approves every gated action;
auto=runtime auto-approves actions that PASSED ToolPolicy+AgentRoutingPolicy (denials/ChillsPwn-bypass/
out-of-allowlist stay denied); hybrid=auto low-risk (`AUTO_APPROVE_RISK_CLASSES`, capped by
`AUTO_APPROVE_MAX_RISK`), human for terminal/file-write/credential/exploit/destructive + sensitive
tools. Auto-grants emit `approval_auto_granted`; approval records carry approvalMode/autoApproved/
approvedBy=`runtime:auto-policy`/policyReason. Cockpit shows the mode badge + switcher + AUTO-APPROVED.
Auto-approval is an OPERATOR runtime policy, NOT ChillsPwn self-approval.

**Real local MCP:** `pentest-mcp` (node) is built (`cd /opt/chillspwn-mcp-arsenal/pentest-mcp && npm ci
&& npx tsc --noEmitOnError false`) and enabled as `pentest-mcp-recon` (stdio, `MCP_TRANSPORT=stdio`),
giving ReconScout (nmapScan/gobuster/subfinderEnum/httpxProbe/extractionSweep), WebBreaker (ffufScan/
nucleiScan/nikto/gobuster/httpxProbe), CredSmith (runHashcat/runJohnTheRipper/generateWordlist/
hydraBruteforce). Intrusive tools are approval-gated; the bridge supports per-server `env` for spawned
stdio servers. `pentest-mcp-server` (python) is venv-installed but needs `TARGET_PASSWORD`/`TARGET_SSH_KEY`
to start (disabled, missing_secret). sechub-* remain docker_disabled; osint/threat-intel/cloud
missing_secret.

## Phase 17 — CVE/vuln-intel MCPs + asset managers
3 CVE MCPs (`vulnintel-cve-mcp`/`vulnintel-nvd`/`vulnintel-cve-search-local`) assigned ONLY to VulnIntel
(taxonomy: vulnerability_intelligence/cve_lookup/exploit_prioritization/kev_epss/attack_mapping). Wordlist/
hashcat assets are used via the asset managers + `/api/assets/*` (paths/metadata only), NOT as MCP servers.
Missing keys: `GET /api/mcp/missing-keys`. Install: `scripts/setup-security-assets.sh`.
