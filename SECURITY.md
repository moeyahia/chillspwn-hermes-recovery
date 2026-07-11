# Backup security boundary

Treat this repository as confidential and keep GitHub visibility set to **private**.

The snapshot must remain free of live credentials and client/engagement data. Never add any of the following:

- `.env*`, `auth.json*`, OAuth refresh/access tokens, cookies, or CLI authentication directories
- SSH/private keys, PFX/P12/JKS/keystore files, Kerberos caches, password databases, or cloud credentials
- `state.db`, `kanban.db`, SQLite WAL/SHM files, conversations, memories, session logs, or raw LLM logs
- exploit artifacts, loot, scans, client reports, VPN files, or target-specific notes

Before every push, run:

```bash
./scripts/verify-snapshot.sh
gitleaks dir . --redact --no-banner
```

If operational state must be backed up, stop or quiesce writers, make consistent database snapshots, encrypt the archive client-side to a recovery key held off the server, and upload only the ciphertext. Do not store the decryption key in this repository or on the same server.
