# Contributing to ChillsPwn

Thank you for helping improve ChillsPwn. The project combines a web application with security-sensitive process, provider, credential, and filesystem boundaries, so changes should be small, reviewable, and supported by evidence.

## Before you begin

- Read [README.md](README.md), [SECURITY.md](SECURITY.md), and [docs/architecture.md](docs/architecture.md).
- Use the repository only with authorized targets and sanitized development data.
- Never attach credentials, real target data, flags, raw model logs, databases, private URLs, or provider auth files to issues or pull requests.
- Report vulnerabilities privately as described in `SECURITY.md`.

## Development setup

Install Bun 1.3.14, Node.js 22 or newer, and Python 3, then run:

```bash
bun install --frozen-lockfile
cp .env.example .env
bun run dev
```

The Vite client listens on port 3132 and proxies to the Bun backend on port 3131. Full provider and Mission Board behavior requires the external contracts in [docs/integrations.md](docs/integrations.md).

## Branches

Create a focused branch from the current default branch. Suggested names:

- `feat/short-description`
- `fix/short-description`
- `docs/short-description`
- `chore/short-description`
- `security/short-description`

Do not mix engagement artifacts, generated output, dependency updates, broad formatting, and application behavior in one branch.

## Coding standards

- Follow the existing TypeScript and React conventions in the module you change.
- Prefer small modules and explicit interfaces over expanding `server/index.ts`.
- Preserve secure defaults and fail closed at authentication, authorization, and provider boundaries.
- Do not read or log credential values merely to test whether a credential exists.
- Keep provider-specific assumptions behind documented integration contracts.
- Add comments for security invariants and non-obvious lifecycle behavior, not for self-evident syntax.
- Use LF line endings and the repository `.editorconfig`.

There is no repository-wide formatter or linter baseline yet. Avoid unrelated reformatting and run `git diff --check` before committing.

## Tests

Run the portable validation suite before opening a pull request:

```bash
bun install --frozen-lockfile
bun run check
bun audit
git diff --check
```

`bun run check` runs modular server and client typechecks, Bun unit tests, the portable Python gate test, and a production frontend build.

Add or update tests for changed behavior. Security-boundary changes should include positive, denial, malformed-input, and failure-path cases. If a test requires a live Hermes/provider environment and cannot run in CI, label it clearly and document the exact prerequisites and evidence you collected.

## Documentation

Update documentation in the same pull request when changing:

- environment variables or secure defaults;
- API routes or response contracts;
- provider, ACP, or MCP behavior;
- data formats or schema expectations;
- deployment, rollback, or operational steps;
- user-visible workflows.

Commands in documentation must be commands you ran or verified against the project.

## Commits

Use concise imperative subjects. Conventional Commit prefixes are encouraged:

```text
feat: add provider readiness state
fix: fail closed when commander attestation is incomplete
docs: document Grok OAuth deployment contract
ci: add Bun validation workflow
chore: update compatible dependencies
```

Keep generated files, dependency changes, documentation, and functional changes separate where practical. Never bypass secret scanning to land an unexplained finding.

## Pull requests

1. Explain the problem and scope.
2. Link related issues.
3. Describe security, compatibility, data, and deployment effects.
4. Include the commands run and their actual outcomes.
5. Provide sanitized screenshots for UI changes.
6. Call out checks that could not be run and why.
7. Request review from a maintainer familiar with the affected boundary.
8. Resolve review conversations and keep the branch current.

One approving review should be required. Changes to authentication, authorization, provider execution, credential handling, process management, or data migration should receive an additional security-focused review when possible.

## Bugs and feature proposals

Use the GitHub issue forms after searching for an existing report. A useful bug report includes a minimal reproduction, expected and actual behavior, sanitized logs, environment/runtime versions, and regression range if known.

Feature proposals should describe the operator problem, security implications, alternatives, external dependencies, and how success can be tested. Large architectural changes should begin with a short design document or issue before implementation.
