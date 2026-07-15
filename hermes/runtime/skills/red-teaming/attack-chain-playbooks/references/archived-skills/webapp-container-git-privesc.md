# Web Application to Container, Host, and Privileged Service Chain

## Applicability

Use when an authorized target combines a workflow/orchestration web application, containerized code execution, localhost-only services, or a Git service running with excessive operating-system privilege.

## 1. Establish the application trust boundary

Enumerate authentication, available tools/nodes, sandbox policy, file operations, and outbound network access. Prove read and write separately with benign engagement markers.

For low-code and AI workflow platforms, inventory allowed modules before attempting generic shell payloads. A permitted browser-automation library may spawn a process internally even when direct imports such as `child_process`, `process`, or `fs` are blocked. Validate with `id` or another harmless command and capture output in-band.

## 2. Treat container root as a pivot

After execution:

```bash
id
cat /proc/1/cgroup
cat /proc/self/mountinfo
findmnt
ip route
```

Inventory environment-variable names and mount destinations without copying secret values into reusable notes. Look for host-mounted application data, deployment keys, service credentials, and the host gateway. Do not report host compromise until the host boundary is independently crossed.

## 3. Container-management applications

Distinguish application-level manager access from raw Docker-socket access:

- Record service identity, working directory, data-store path, and socket reachability.
- Enumerate public routes from source or OpenAPI instead of guessing.
- Treat SSRF parser errors as possible reachability evidence, not automatically as arbitrary response access.
- A predictable signing key is insufficient without the claims and subject identifiers required by the application; validate authentication semantics.

## 4. Host pivot and localhost mapping

After an authorized host account pivot:

```bash
id
sudo -l
ss -lntup
ps -eo pid,user,group,args
systemctl --no-pager --type=service --state=running
```

Probe loopback-bound services from the host itself or through a narrowly scoped SSH tunnel. Record product version, process owner, configuration path, database location, and repository root.

## 5. Privileged Git services

High-risk signals include:

- A Git web service running as root.
- Repositories or service data beneath a privileged home directory.
- User-controlled hooks, imports, migrations, symlinks, or repository paths consumed by the privileged service.
- Built-in SSH behavior or forced-command parsers with version-specific vulnerabilities.

For Gogs/Gitea-style products, verify whether the built-in SSH server is enabled. When system OpenSSH forces the service command, successful key authentication does not imply arbitrary shell execution. Pivot to source-backed parser, hook, API, migration, session, database, or file-write primitives instead of repeatedly running an inapplicable exploit.

When registration is CAPTCHA-gated, preserve the cookie jar, CSRF token, challenge ID, and image from the same request. A failed submission can rotate the challenge; never reuse stale artifacts.

## 6. Writable application volumes

Map host paths to container mount destinations with `/proc/<PID>/mountinfo`. A writable data directory is not necessarily executable. Validate a harmless marker through the application's real routing semantics; if content remains data-only, investigate configuration, logs, salts, object identifiers, reload consumers, or trust relationships.

Group-writable TLS material is an indirect primitive until a privileged reload or authentication consumer is proven.

## Evidence and cleanup

Preserve:

- Initial service and virtual-host map.
- Authentication and authorization proof.
- Benign file read/write and execution markers.
- Container/host boundary evidence.
- Loopback service map and privileged process configuration.
- The exact vulnerable consumer and resulting identity transition.

Remove test accounts, keys, markers, hooks, imported repositories, tunnels, and modified application data. Restore original bytes and permissions and verify independently.

## References

- Docker security guidance: `https://docs.docker.com/engine/security/`
- Gitea security documentation: `https://docs.gitea.com/usage/security`
- OWASP SSRF prevention: `https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html`
