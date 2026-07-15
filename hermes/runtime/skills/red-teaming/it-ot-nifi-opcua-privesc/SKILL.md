---
name: it-ot-nifi-opcua-privesc
description: Reusable authorized IT/OT chain involving Apache NiFi authorization flaws, in-band command execution, support-artifact discovery, OPC UA process-state validation, and a gated maintenance-console privilege boundary.
version: 1.1.0
author: chillspwn
license: MIT
platforms: [linux]
metadata:
  hermes:
    tags: [kali, nifi, opcua, ot, privesc, support-artifacts, sudo]
    related_skills: [kali-pentest-explainer-lane, kali-arsenal, network-attack-surface-mapping, pentest-report-pdf]
---

# IT/OT NiFi to OPC UA Maintenance Chain

## Trigger

Use only in an explicitly authorized environment that exposes Apache NiFi and one or more internal OT/ICS services such as OPC UA, an HMI, a PLC simulator, or a safety controller.

## Core model

Map and validate each trust transition independently:

`NiFi authorization -> service execution -> support artifact -> operator identity -> OPC UA state -> privileged maintenance consumer`

Do not copy a prior target sequence blindly. A missing prerequisite means the chain branches or stops.

## 1. Reconnaissance

```bash
nmap -sC -sV -p- --min-rate 1000 <TARGET_IP> -oA <EVIDENCE_DIR>/nmap
ffuf -u http://<TARGET_IP>/ -H 'Host: FUZZ.<BASE_DOMAIN>' \
  -w <VHOST_WORDLIST> -mc all -fc 404
```

Map business roles as well as ports: public application, workflow engine, HMI, OPC UA endpoint, controller, SSH, and maintenance interface.

## 2. NiFi authorization

```bash
curl -sS http://<NIFI_HOST>/nifi-api/flow/current-user
```

Record the current identity and permissions. Creating processors, modifying process groups, or using restricted components without an appropriate identity is a critical finding.

## 3. In-band execution

If callbacks are blocked, build a minimal temporary graph:

`GenerateFlowFile -> ExecuteStreamCommand -> output queue`

Use a harmless `id` command first and retrieve stdout through the queue API. Select an argument delimiter not present in the command. For file retrieval, prefer `FetchFile` when the source directory cannot be owned by NiFi.

```bash
id
ps -eo pid,user,group,args
ss -lntup
```

## 4. Support and deployment artifacts

Review application-owned support bundles, backup directories, old configuration, service units, and deployment manifests. Record only paths and secret types in reusable notes. Move any recovered key, password, or decryption material directly to the engagement secret store.

Validate a recovered identity against its intended service first. Stop before lockout thresholds and do not assume credential reuse.

## 5. OPC UA namespace analysis

Browse the namespace and record node ID, browse name, type, current value, and access level. Common process-state fields include raw telemetry, calibrated telemetry, offsets, mode, override, trip state, and reset methods.

```python
from asyncua import Client

async with Client("opc.tcp://<HOST>:<PORT>") as client:
    node = client.get_node("<NODE_ID>")
    original = await node.read_value()
    # Write only a rules-of-engagement-approved test value.
    # Restore `original` before closing the session.
```

Treat a maintenance gate as a state machine rather than a single magic value. Read current telemetry, infer the predicate, and use the smallest reversible change. If a calibrated value depends on a raw value plus offset, calculate from live data instead of hard-coding a stale threshold.

## 6. Gated maintenance privilege

After an operator pivot:

```bash
sudo -l
```

Inspect the authorized maintenance binary and its gate conditions. If sudo execution is permitted only during an open maintenance window, reproduce the approved state and run a benign identity query through the console. Use `ssh -tt` only when PTY behavior is required.

Never use the maintenance path to persist or alter safety logic beyond the explicit objective.

## Validation and failure recovery

- Callback failure: retrieve output through the NiFi queue before changing payloads.
- Permission denied: identify the next trust boundary rather than guessing filenames or credentials.
- OPC UA write rejected: re-read access levels, data types, security mode, and session identity.
- State drifts: calculate from live telemetry and keep the original values for rollback.
- Gate remains closed: verify every predicate and HMI state; do not brute-force operational values.

## Evidence

Preserve sanitized:

- Service and virtual-host enumeration.
- NiFi current-user permissions and temporary graph identifiers.
- Execution identity and internal socket map.
- Type and location of support artifact, excluding its secret value.
- OPC UA namespace and before/after values.
- Maintenance state, sudo policy, privileged identity proof, and cleanup checks.

## Cleanup

Stop and delete test processors, queues, process groups, tunnels, and temporary files. Restore all OPC UA values, close maintenance state, remove copied sensitive artifacts, and verify the HMI/controller baseline independently.

## Defensive remediation

- Disable anonymous NiFi access and restrict the NiFi API.
- Remove restricted-component rights from low-trust identities.
- Encrypt and permission support artifacts; rotate exposed material.
- Apply OPC UA authentication, authorization, signing/encryption, and network segmentation.
- Avoid business-state-dependent privileged shells; use narrow allowlisted maintenance operations and auditable approvals.
