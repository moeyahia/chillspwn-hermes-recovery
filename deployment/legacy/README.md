# Legacy deployment artifacts

These files document the complete pre-Command OS V2.1 `/root/.hermes`
three-service deployment. They
are retained only to identify and reverse an older installation during a
controlled migration.

Do not install them on the hardened V2.1 host. In particular, V2.1 does not run
a root memory broker, does not use a root HOME, and does not use the legacy warm
drop-in. The supported units are under [`../systemd`](../systemd). The retained
`scripts/restore.sh` requires the explicit `--legacy-root-layout` acknowledgement
and installs only these legacy unit copies.
