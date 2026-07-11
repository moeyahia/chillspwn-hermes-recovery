# Snapshot validation

Validation performed on the staged recovery copy on `2026-07-11`:

- Snapshot structure and Grok guards: passed
- Grok ACP planning command uses `--reasoning-effort high`: passed
- Grok ACP interactive session command uses `--reasoning-effort high`: passed
- Grok child environment removes `XAI_API_KEY`: passed
- Files represented in the Git index: 4,823 of 4,823 curated files/symlinks
- Largest staged blob: approximately 1.43 MB; no file exceeds 50 MiB
- Gitleaks 8.30.1, with reviewed allowlists for upstream examples/test fixtures: 0 leaks
- TruffleHog 3.95.3: 9,714 chunks / approximately 85 MB, 0 verified and 0 unverified secrets
- Chillspwn server TypeScript typecheck: passed
- Chillspwn client TypeScript typecheck: passed
- Chillspwn production Vite build: passed
- Chillspwn Bun tests: 461 passed, 0 failed
- Hermes Python compilation (`agent`, `acp_adapter`, `hermes_cli`, and `run_agent.py`): passed
- Hermes run-agent tests: 416 passed
- Restore and verification scripts: Bash syntax check passed

OAuth/API integrations were not authenticated from the snapshot because authentication stores are deliberately excluded. The deployed Grok ACP integration had already been exercised end-to-end before this snapshot; a recovered server must repeat OAuth login and the live checks in `RECOVERY.md`.
