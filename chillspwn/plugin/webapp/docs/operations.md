# Operations

## Health and readiness

`GET /api/health` confirms that the HTTP process is alive. It does not prove that personas, the Mission Board schema, provider CLIs, OAuth sessions, report tooling, MCP servers, or engagement paths are ready.

Perform an integration readiness review after every deployment and credential change. A future readiness endpoint should report dependency names and states without reading or returning credential values.

The integrated recovery deployment consists of three cooperating units:

- `chillspwn-memory.service`: root-owned validated memory broker;
- `chillspwn.service`: unprivileged dashboard and agent runtime; and
- `hermes-gateway.service`: unprivileged Hermes message adapters and cron scheduler.

Check all three together because the application units require the broker:

```bash
systemctl status chillspwn-memory.service chillspwn.service hermes-gateway.service --no-pager
```

## Logs

The application and provider paths may write dashboard logs, raw model events, process output, and engagement reports outside the repository. Treat raw model logs as sensitive: they can contain prompts, target data, credentials, tool output, and private keys.

- Restrict logs to the service account and operators.
- Do not log secret values or environment contents.
- Define rotation and retention.
- Keep logs out of backups intended for source recovery.
- Sanitize evidence before sharing it in an issue or pull request.

The recovery systemd unit redirects application stdout/stderr to the service-owned file below; use `journalctl` for unit lifecycle messages:

```bash
journalctl -u chillspwn.service -n 200 --no-pager
tail -F /root/.hermes/chillspwn/logs/dashboard.log
```

Deployments that do not redirect standard output can follow the full application stream with:

```bash
journalctl -u chillspwn.service -f
```

## Process lifecycle

ChillsPwn manages provider and worker process trees. Stale sessions should be closed through the application lifecycle where possible so state and process ownership remain consistent. Before killing an untracked process manually, inspect its command, parent, engagement, and current board/run association.

After an abnormal shutdown, check:

- service and child processes;
- active session/run mappings;
- Mission Board cards still marked running;
- provider session files;
- locks, temporary files, and incomplete reports.

## Credentials

- Store provider OAuth/API state outside Git.
- Use mode `0600` for credential caches, PFX bundles, private keys, and environment files.
- Run provider login as the same service account that launches the provider.
- Rotate credentials after suspected archive, log, or backup exposure.
- Never solve access failures with group/world-readable auth files.
- Keep API-secret environment files `root:root` mode `0600` and unreadable by the service. systemd injects their values before the user transition.
- Keep refreshable OAuth files narrowly service-owned where the CLI must update them atomically.
- Remember that provider-specific child environments are not strong isolation while provider children share the dashboard UID.

Before restarting after a Hermes configuration change, run the deployed root-owned validator:

```bash
/root/hermes-venv/bin/python /opt/chillspwn/libexec/validate-hermes-config.py \
  --allow-missing /root/.hermes/config.yaml
```

The validator reports paths and violation types but does not print secret values.

## State and backups

Follow [Data and migrations](data-and-migrations.md). Separate source recovery from operational-state backup. A source archive should contain only reviewed repository files; an operational backup needs encryption, access control, retention, and restore testing.

## Workspace and engagement roots

Treat `ALLOWED_WORKSPACE_ROOTS` as a security boundary, not just a file-browser preference. It controls file routes, engagement discovery/creation and working directories, interactive Claude `--add-dir` roots, and OSINT output. The recovery helper provisions only `/root/htb/boxes` and `/root/engagements`. For every custom root, pre-create a real non-symlink directory, grant `chillspwn` read/write/traverse access plus suitable child inheritance, and verify it as that identity before restarting. Do not use `/root`, a provider-auth directory, protected memory, reviewed source, or the repository checkout.

Detached OSINT snapshots and worker logs live under `CHILLSPWN_STATE_DIR/osint-jobs`, while findings and reports live in an `osint-*` directory below the first writable allowed root. On restart, malformed or out-of-root persisted jobs are skipped; this is fail-closed behavior. Review the configured allowlist before treating a missing historical job as data loss.

## Provider operations

- **Claude:** verify CLI authentication and distinguish observe-only UI state from enforceable runtime controls.
- **OpenRouter:** verify key availability without printing it; roll out gating in dry-run first.
- **Codex/Gemini:** verify the external Hermes orchestrator and its authentication.
- **Grok ACP:** verify OAuth file permissions, isolated runtime assets, hook/MCP attestation, and Mission Board delegation before starting an engagement.

## Reusable memory

Do not make `/root/.hermes/memories` readable or writable by `chillspwn`. Normal service access must go through `/run/chillspwn-memory/broker.sock`; direct root/operator curation must use the reviewed CLI with broker client mode deliberately disabled. A broker outage is expected to fail closed: provider context omits reusable memory, and the dashboard memory endpoint returns `503` rather than reading raw files.

## Incident response

If a credential or engagement artifact may have entered Git:

1. Stop publication and revoke/rotate the credential immediately.
2. Identify every branch, tag, archive, backup, fork, and remote containing it.
3. Preserve evidence needed for investigation without copying the secret further.
4. Clean history only from a controlled backup and with maintainer approval.
5. Coordinate the forced ref update with every collaborator if rewriting a published repository.
6. Re-run history and candidate-tree secret scans before resuming publication.

Deleting the current file does not remove it from Git history.

## Routine maintenance

- Review Dependabot pull requests weekly and run the full validation suite.
- Review provider CLI and ACP/MCP contract changes before upgrading.
- Keep Bun and action pins current through reviewed changes.
- Periodically scan the candidate source tree and all reachable Git history for secrets.
- Review ignored files and repository size before broad staging.
- Test backup restoration and rollback procedures.
