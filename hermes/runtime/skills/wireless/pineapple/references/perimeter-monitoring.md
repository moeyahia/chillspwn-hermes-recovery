# Perimeter Monitoring Pattern

## Goal

Detect new wireless devices or access points inside an explicitly authorized physical perimeter while suppressing known infrastructure.

## Configuration boundary

Store the following outside Git with restrictive permissions:

- approved SSIDs and BSSIDs;
- personal or control-device MAC addresses;
- scheduler delivery destinations;
- Pineapple SSH destination and private-key path;
- scan state and captured evidence.

The monitor must stop when the required target or allowlist is unavailable. An empty allowlist must not silently mean "trust nothing" or "scan everything."

## Architecture

- `pineapple-monitor.sh` reports newly observed clients and captures.
- `network-defense.sh` checks the protected SSID against a configured BSSID allowlist.
- A deployment-specific perimeter monitor may add passive device classification and deduplication.
- Cron wrappers emit output only for real findings and return a non-zero status on configuration errors or timeouts.

## Operational rules

1. Verify scope and radio/interface state before scanning.
2. Apply the allowlist before reporting.
3. Prefer passive collection; active frames require explicit authorization.
4. Treat vendor/OUI classification as heuristic.
5. Keep state outside the repository and mode `0600`.
6. Never commit raw scan output, MAC addresses, probe requests, or packet captures.
7. Report the last successful run, current reachability, and whether silence means no events or a failed monitor.
