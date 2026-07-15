# Contributing to the recovery repository

This private repository combines the ChillsPwn application, selected runtime configuration, Hermes Agent source, and restoration tooling. Changes must keep the snapshot recoverable without introducing credentials, engagement data, or generated host state.

## Development setup

Read [README.md](README.md), [RECOVERY.md](RECOVERY.md), and [SECURITY.md](SECURITY.md). For ChillsPwn development, install Bun 1.3.14, Node.js 22 or newer, and Python 3.11 or newer, then run:

```bash
cd chillspwn/plugin/webapp
bun install --frozen-lockfile
cp .env.example .env
bun run dev
```

The full runtime also requires the separately authenticated provider CLIs and host contracts described in [the application integration guide](chillspwn/plugin/webapp/docs/integrations.md). Never use production credentials or client data in development fixtures.

## Branches and scope

Create a focused branch from `main` using a name such as `feat/short-description`, `fix/short-description`, `docs/short-description`, `security/short-description`, or `chore/short-description`.

- Keep application behavior, recovery packaging, dependency maintenance, and broad formatting in separate changes where practical.
- Preserve the `chillspwn/`, `hermes/`, `deployment/`, and `scripts/` boundaries.
- Do not delete recovery material unless its purpose and regeneration path are understood.
- Do not add build output, local databases, logs, provider auth stores, or engagement artifacts.

## Coding and documentation standards

- Follow the conventions in the component being changed and the root `.editorconfig`.
- Prefer small, explicit modules and fail-closed security boundaries.
- Do not read or log credential values to test their presence.
- Update configuration, API, architecture, deployment, rollback, and recovery documentation with the related code change.
- Use synthetic, clearly nonfunctional fixtures and sanitized screenshots.
- Avoid unrelated formatting. No repository-wide formatter or linter baseline is currently enforced.

Application-specific guidance is in [the ChillsPwn contributing guide](chillspwn/plugin/webapp/CONTRIBUTING.md). Hermes source retains its upstream contribution documentation under `hermes/source/`.

## Validation

Run the recovery and portable application checks before opening a pull request:

```bash
./scripts/verify-snapshot.sh
bash -n scripts/restore.sh scripts/verify-snapshot.sh
cd chillspwn/plugin/webapp
bun install --frozen-lockfile
bun run check
bun audit
git diff --check
```

Compile the retained Hermes entry points from the repository root:

```bash
python3 -m compileall -q \
  hermes/source/agent \
  hermes/source/acp_adapter \
  hermes/source/hermes_cli \
  hermes/source/run_agent.py
```

Add tests for changed behavior. Security-boundary changes should cover allow, deny, malformed-input, and failure paths. Document any live integration test separately; CI cannot authenticate excluded OAuth stores.

## Commits and pull requests

Use concise imperative Conventional Commit subjects, for example:

```text
fix: fail closed when Grok boundary attestation is incomplete
docs: update recovery runbook
ci: validate the recovery snapshot
chore: refresh compatible dependencies
```

A pull request should explain the problem, focused solution, security and recovery impact, exact checks run, deployment or migration needs, rollback path, and any test that could not run. Include sanitized screenshots for UI changes. At least one review is recommended; authentication, provider execution, credential handling, process control, and migration changes should receive a security-focused review.

Use the issue forms for reproducible bugs and feature proposals. Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
