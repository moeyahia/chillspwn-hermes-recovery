# PineAP Daemon Diagnostics

**Context**: Session where `pineapd` did not appear in initial `ps` output despite the Evil Twin / management AP being active.

## Reliable Verification Sequence

1. **Start with init scripts** (most reliable indicator):
   ```bash
   /etc/init.d/pineapd status
   /etc/init.d/pineapple status
   ```

2. **Confirm process after status check**:
   ```bash
   ps | grep pineapd | grep -v grep
   ```

3. **Inspect supporting state**:
   - Binaries: `/usr/sbin/pineapd`, `/usr/bin/pineap`, `/usr/sbin/pineapd_wrapper`
   - UCI config: `uci show wireless` (look for wlan0 as hidden "linksys" AP)
   - Logs: `logread | grep -E 'hostapd|wlan0' | tail -30`

## Observed Behavior

- `wlan0` runs a hidden "linksys" management AP via hostapd independently.
- Clients are often rejected due to MAC allow filter (normal for management interface).
- `wlan1`/`wlan1mon` stay in monitor mode for PineAP features.
- `pineapd` can be running even when a simple `ps` grep misses it on the first try.

## Pitfall

Raw process greps are flaky on the Pineapple. The init script status command is the authoritative source. Always run the status check before concluding PineAP is down.