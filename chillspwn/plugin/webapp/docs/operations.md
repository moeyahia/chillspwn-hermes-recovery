# Operations

## Health and readiness

`GET /api/health` confirms that the HTTP process is alive. It does not prove that personas, the Mission Board schema, provider CLIs, live OAuth sessions, report tooling, MCP servers, specialist routes, or engagement paths are ready.

Perform an integration readiness review after every deployment and credential change. Launch
readiness must use live, non-secret provider/MCP attestations and must fail closed when a required
journey executor or specialist route is not callable. The UI may report dependency names, state,
reason, and remediation, but must never read back or return credential values.

The hardened deployment consists of two cooperating application units:

- `chillspwn.service`: unprivileged dashboard and agent runtime; and
- `hermes-gateway.service`: unprivileged Hermes message adapters and cron scheduler.

Both run as `chillspwn` with explicitly empty supplementary groups and no
capabilities:

```bash
systemctl status chillspwn.service hermes-gateway.service --no-pager
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
tail -F /var/log/chillspwn/dashboard.log /var/log/chillspwn/hermes-gateway.log
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
/opt/chillspwn-runtime/hermes-venv/bin/python \
  /opt/chillspwn/libexec/validate-hermes-config.py \
  --allow-missing /var/lib/chillspwn/hermes/config.yaml
```

The validator reports paths and violation types but does not print secret values.

## State and backups

Follow [Data and migrations](data-and-migrations.md). Separate source recovery from operational-state backup. A source archive should contain only reviewed repository files; an operational backup needs encryption, access control, retention, and restore testing.

## Workspace and engagement roots

Treat `ALLOWED_WORKSPACE_ROOTS` as a security boundary, not just a file-browser preference. It controls file routes, engagement discovery/creation and working directories, interactive Claude `--add-dir` roots, and OSINT output. Production allows only `/var/lib/chillspwn/workspaces/htb/boxes` and `/var/lib/chillspwn/workspaces/engagements`; tracked `.mount` units bind the existing operator data into those paths. Verify both with `findmnt` and as the service identity after every reboot. Do not allow `/root`, provider-auth state, the canonical database/vault root, reviewed source, or the repository checkout.

Detached OSINT snapshots and worker logs live under `CHILLSPWN_STATE_DIR/osint-jobs`, while findings and reports live in an `osint-*` directory below the first writable allowed root. On restart, malformed or out-of-root persisted jobs are skipped; this is fail-closed behavior. Review the configured allowlist before treating a missing historical job as data loss.

## Provider operations

- **Claude:** treat native CLI compatibility as advisory unless the selected journey's exact scope,
  tool, and decision boundary can be enforced; never expose it as a third journey.
- **OpenRouter:** verify credential availability without printing it and require the managed,
  fail-closed gate before consequential journey execution.
- **Codex/Gemini:** verify the external Hermes orchestrator, authentication, specialist routing, and
  policy-enforcement compatibility.
- **Grok ACP:** require a live OAuth/ACP readiness probe in addition to file permissions; verify the
  isolated runtime assets, hook/MCP attestation, and Mission Board delegation before launch. A local
  executable or readable auth file alone is not proof of a healthy provider.

Provider selection remains secondary and policy-driven. Operators create only Autonomous or Guided
missions; an unavailable or non-enforceable provider is excluded or blocks preflight rather than
silently degrading the journey contract.

## Reusable memory

Command OS V2 memory is canonical in
`/var/lib/chillspwn/command-os-v2.sqlite` and projected to
`/var/lib/chillspwn/brain-vaults`. There is no root memory-broker service in the
supported unit graph. Back up SQLite transactionally, stop vault sync before a
vault restore, preserve provenance/lifecycle state, and verify that forgetting
removes future retrieval and synchronized projections.

## Service privilege checks

After every unit or account change, verify the running processes have the
`chillspwn` UID/GID, no supplementary groups, no effective/permitted
capabilities, no sudo permission, and no Docker socket access. Do not solve a
path failure by adding `root`, `adm`, `sudo`, or `docker` membership. Correct
the explicit `/opt`, `/var/lib/chillspwn`, log, or bind-mount path instead.

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
