# Snapshot validation

## 2026-07-15 ChillsPwn refresh

Validation performed against the curated recovery working tree before publication:

- Stable candidate-tree fingerprint before this validation record was updated:
  `b333a5ddae9ce2951c23964d943a266e5f808f3acb01e3c7385aadbf293842cc`.
- Snapshot verifier: passed.
- Candidate inventory: 4,859 regular files, 25 symlinks, and 62 deletions in the candidate diff; 0 files exceed 50 MiB and 0 sensitive filenames were detected.
- Original logo invariant: `public/Logo.svg` retained the exact expected SHA-256 `0a3dfd69f74a00d41bb0cb20d6af1097dffa265d4c1e54c9228fe4b55f85c955`.
- Changed/new shell-script syntax gate: 13 of 13 passed.
- Python compilation gate: 30 of 30 targets passed.
- Python `unittest` regressions: 39 of 39 passed.
- Focused Python `pytest` regressions: 58 of 58 passed.
- Bun frozen-lockfile install: 326 installs covering 377 packages; `bun.lock` remained unchanged.
- Production server entry bundle: passed, 71 modules and approximately 0.71 MB.
- ChillsPwn modular server TypeScript typecheck: passed.
- ChillsPwn client TypeScript typecheck: passed.
- ChillsPwn Bun tests: 593 passed, 0 failed, 2,138 expectations across 72 files.
- Portable OpenRouter gate integration: 34 of 34 passed.
- Portable Mission Board MCP regression: 17 of 17 passed.
- Production Vite build: passed, 66 modules transformed; 37 files totaling 2,767,919 bytes were produced under `dist/`.
- Bun dependency audit: no vulnerabilities found.
- Git whitespace validation (`git diff --check`): passed.
- All Gitleaks scans performed for the final candidate: 0 findings.
- TruffleHog reported 0 verified secrets and 21 unverified matches. All 21 were exact examples in tests or documentation.

An additional, optional syntax sweep over 42 inherited shell files reported 23 failures. Those inherited files are outside the changed/new 13-script publication gate, which passed completely. The broader failures remain disclosed maintenance debt and are not claimed as passing validation.

OAuth stores and API credentials are deliberately excluded, so this publication validation did not authenticate or invoke live provider turns. A recovered server must repeat the Claude, Codex, OpenRouter, Gemini, MCP, and Grok ACP checks in [RECOVERY.md](RECOVERY.md). In particular, Grok validation must confirm boundary attestation, Mission Board-only commander tooling, specialist execution, Expert/high reasoning, OAuth rather than API-key authentication, and complete process-tree shutdown.

## 2026-07-11 initial snapshot

The initial private recovery snapshot recorded these historical results before the July 15 application refresh:

- Snapshot structure and the then-current Grok guards: passed.
- Files represented in the Git index: 4,823 curated files/symlinks.
- Largest staged blob: approximately 1.43 MB; no file exceeded 50 MiB.
- Repository-configured Gitleaks 8.30.1: 0 findings.
- TruffleHog 3.95.3: 9,714 chunks / approximately 85 MB, 0 verified and 0 unverified secrets.
- ChillsPwn server and client TypeScript typechecks: passed.
- ChillsPwn production Vite build: passed.
- ChillsPwn Bun tests: 461 passed, 0 failed.
- Hermes Python compilation and 416 run-agent tests: passed.
- Restore and verification script Bash syntax: passed.

These results describe the tagged historical snapshot only; the current-branch results above are authoritative for the refreshed repository.
