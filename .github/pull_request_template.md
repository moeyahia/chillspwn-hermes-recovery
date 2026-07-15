## Summary

Describe the problem, focused solution, and why it belongs in this recovery repository.

## Related issues

Closes #

## Change type

- [ ] Bug fix
- [ ] Feature
- [ ] Documentation
- [ ] Dependency/build maintenance
- [ ] CI/repository maintenance
- [ ] Security hardening
- [ ] Recovery snapshot refresh

## Expected and actual behavior

Describe behavior before and after the change. Include a minimal reproduction for fixes.

## Testing evidence

List every command run and its actual result. Explain any check that could not run.

```text
./scripts/verify-snapshot.sh
cd chillspwn/plugin/webapp
bun install --frozen-lockfile
bun run check
bun audit
git diff --check
```

## Environment

Include OS, commit/tag, Bun/Node/Python versions, browser, provider path, and relevant feature-flag names. Do not include secret values.

## Screenshots

Add sanitized before/after screenshots for user-interface changes when relevant.

## Security, privacy, data, deployment, and rollback

Describe effects on authentication, authorization, credentials, provider/tool boundaries, logs, engagement data, APIs, migrations, recovery, operations, and rollback. Write `None` only after reviewing each area.

## Contributor checklist

- [ ] I kept the change focused and preserved behavior outside its scope.
- [ ] I added or updated tests for changed behavior.
- [ ] I updated relevant documentation and examples.
- [ ] I ran the checks listed above and reported failures honestly.
- [ ] I verified that no credentials, private URLs, target data, logs, databases, generated output, or personal information are included.
- [ ] I did not weaken secure defaults or bypass an unexplained secret-scanning result.
- [ ] I considered compatibility, migration, deployment, recovery, and rollback.
