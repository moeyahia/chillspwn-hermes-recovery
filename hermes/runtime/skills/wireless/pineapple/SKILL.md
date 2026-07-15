---
name: pineapple
description: "Operate an explicitly configured Hak5 WiFi Pineapple Mark VII for authorized wireless assessment, monitoring, capture, and IoT reconnaissance without embedding deployment identifiers or credentials."
version: 2.0.0
platforms: [linux]
metadata:
  hermes:
    tags: [wireless, pineapple, wifi, monitor-mode, packet-capture, ssh, recon, pineap, handshake, cron, monitoring, iot]
    related_skills: [kali-tool-audit]
---

# WiFi Pineapple Mark VII

Use this skill only on networks and devices covered by the active authorization. Execute requested checks directly and return verified results, but never infer a target, management address, protected SSID, BSSID, credential, or key path from historical memory.

## Required configuration

Keep deployment values in a protected service environment or operator-owned configuration file outside Git.

| Variable | Purpose |
|---|---|
| `PINEAPPLE_SSH_TARGET` | SSH destination in `user@host` form |
| `PINEAPPLE_SSH_KEY` | Dedicated private-key path |
| `PINEAPPLE_API_BASE` | Dashboard/API base URL, when API access is needed |
| `PINEAPPLE_PROTECTED_SSID` | Authorized SSID monitored for impersonation |
| `PINEAPPLE_KNOWN_BSSIDS_FILE` | File containing one authorized BSSID per line |
| `PINEAPPLE_EXPECTED_UPLINK_SSID` | Expected uplink SSID, when uplink monitoring is enabled |
| `PINEAPPLE_CONTROL_MAC` | Optional management-client MAC excluded from alerts |
| `PINEAPPLE_HANDSHAKE_DIR` | Absolute appliance directory containing authorized captures |
| `PINEAPPLE_IGNORED_SSIDS_FILE` | Optional file containing one ignored SSID per line |
| `PINEAPPLE_STATE_FILE` | Optional private state-file path |
| `PINEAPPLE_MONITOR_IFACE` | Recon interface; defaults to the device-standard `wlan1` |
| `PINEAPPLE_MANAGEMENT_IFACE` | Management AP interface; defaults to `wlan0` |
| `PINEAPPLE_UPLINK_IFACE` | Uplink interface; defaults to `wlan2` |

The bundled monitoring scripts fail closed when the SSH destination, key, or protected-network configuration is missing. Do not put real values in this skill, shell history, issue reports, or training memory.

## SSH and file transfer

Use the configured destination and rely on the operator's verified `known_hosts` entry:

```bash
ssh -i "$PINEAPPLE_SSH_KEY" \
  -o BatchMode=yes \
  -o StrictHostKeyChecking=yes \
  "$PINEAPPLE_SSH_TARGET"

scp -i "$PINEAPPLE_SSH_KEY" /path/to/local-file \
  "$PINEAPPLE_SSH_TARGET:/tmp/"
```

If host identity has not been enrolled, stop and ask the operator to verify the fingerprint out of band. Never replace this check with `StrictHostKeyChecking=no`.

## Dashboard tunnel

Bind the browser endpoint to loopback and derive the remote endpoint from configuration:

```bash
ssh -i "$PINEAPPLE_SSH_KEY" \
  -o BatchMode=yes \
  -o StrictHostKeyChecking=yes \
  -L 1471:127.0.0.1:1471 \
  -N "$PINEAPPLE_SSH_TARGET"
```

Open `http://127.0.0.1:1471` locally. If the dashboard binds to another address on the appliance, supply that address through an operator-owned tunnel command rather than recording it here.

## PineAP state and diagnostics

Prefer UCI and init scripts over raw interface rewrites:

```bash
ssh -i "$PINEAPPLE_SSH_KEY" "$PINEAPPLE_SSH_TARGET" \
  '/etc/init.d/pineapd status; /etc/init.d/pineapple status'

ssh -i "$PINEAPPLE_SSH_KEY" "$PINEAPPLE_SSH_TARGET" \
  'uci show pineap.@config[0] | grep -E "karma|beacon|capture|logging|broadcast"'
```

For an approved active engagement, PineAP settings can be enabled through UCI and then committed. Record the authorization and restoration plan before changing broadcast or association behavior.

## Passive capture

```bash
ssh -i "$PINEAPPLE_SSH_KEY" "$PINEAPPLE_SSH_TARGET" '
mkdir -p /tmp/authorized-capture
airodump-ng wlan1 --band abg -w /tmp/authorized-capture/sweep --output-format pcap &
echo $! >/tmp/authorized-capture/airodump.pid
'
```

Targeted documentation examples must use reserved identifiers. For example, `00:00:5e:00:53:01` is in an IANA documentation MAC-address range; replace it only at runtime with an authorized BSSID:

```bash
AUTHORIZED_BSSID='00:00:5e:00:53:01'
ssh -i "$PINEAPPLE_SSH_KEY" "$PINEAPPLE_SSH_TARGET" \
  "airodump-ng --bssid '$AUTHORIZED_BSSID' -w /tmp/authorized-capture/target wlan1"
```

Never store captured client identifiers, probe requests, handshakes, or packet captures in the recovery repository.

## API access

Require both the configured API base and a runtime-supplied credential. Do not persist tokens:

```bash
: "${PINEAPPLE_API_BASE:?set the approved API base URL}"
: "${PINEAPPLE_API_PASSWORD:?provide the API password through the protected environment}"

token="$(curl -fsS -X POST "$PINEAPPLE_API_BASE/api/login" \
  -H 'Content-Type: application/json' \
  --data "$(jq -nc --arg password "$PINEAPPLE_API_PASSWORD" '{username:"root",password:$password}')" \
  | jq -er '.token')"
```

Unset the password and token after the operation. Never echo either value.

## Monitoring scripts

- `scripts/pineapple-monitor.sh` reports newly observed DHCP clients, captures, SSIDs, and associated stations. Its state file is private and mode `0600`.
- `scripts/network-defense.sh` detects deauthentication floods, repeated authentication activity, unknown BSSIDs advertising the protected SSID, optional nearby-AP allowlist drift, and uplink loss.
- `scripts/reset-asix-usb-nic.sh` performs a least-disruptive ASIX driver rebind and requires `PINEAPPLE_HEALTH_HOST` instead of embedding a device address.
- `references/cron-status-checks.md` describes health verification without deployment-specific job IDs or paths.

Recurring jobs should be silent when no new event exists. Configure their script paths through `PINEAPPLE_MONITOR_SCRIPT`, `PINEAPPLE_DEFENSE_SCRIPT`, `PERIMETER_MONITOR_SCRIPT`, and `PERIMETER_DAILY_SCRIPT` in the protected scheduler environment.

## Restoration and safety

1. Capture current UCI configuration before changes.
2. Prefer UCI changes so OpenWrt can preserve bridge ownership and service state.
3. Stop temporary capture processes using their recorded PIDs.
4. Restore the saved wireless configuration and restart only the affected service.
5. Verify the dashboard, PineAP daemon, interfaces, and authorized uplink from live evidence.
6. Remove transient capture files after approved evidence is transferred.

The Pineapple's BusyBox image may not include `timeout`. For remote bounded commands, start the process, save its PID, sleep for the approved interval, then terminate and wait for that PID.

## Related references

- `references/pineap-diagnostics.md`
- `references/iot-device-recon.md`
- `references/rtsp-camera-recon.md`
- `references/perimeter-monitoring.md`
- `references/cron-status-checks.md`
