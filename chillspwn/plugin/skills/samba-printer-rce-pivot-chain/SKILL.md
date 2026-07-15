---
name: samba-printer-rce-pivot-chain
description: Reusable authorized-assessment chain from a vulnerable Samba printer workflow to a restricted service foothold, configuration-based credential recovery, an SSH pivot, and systemd drop-in privilege escalation.
---

# Samba Printer RCE and Service Pivot Chain

Use only on systems that are explicitly in scope. Replace every angle-bracketed value with engagement-local data and keep secrets in the engagement vault, never in this playbook.

## Prerequisites

- A Samba build and print workflow proven vulnerable by version and behavior.
- A writable or controllable printer-driver path.
- A callback channel or in-band command-output path.
- Authorization to test local credential and service-configuration weaknesses.

## Technique chain

1. Enumerate SMB dialects, shares, printers, and anonymous or low-privilege access with `nmap`, `smbclient`, and `rpcclient`.
2. Validate the printer primitive with a harmless marker before requesting a shell.
3. Record the execution identity and host/container boundary immediately after code execution.
4. Enumerate readable application and synchronization-tool configuration. Recover only the minimum credential material required for the next authorized pivot.
5. Test recovered credentials against the service they were intended for before attempting reuse against SSH or other protocols.
6. After an SSH pivot, inspect group memberships, ACLs, symbolic links, service units, and systemd drop-in directories.
7. If a privileged unit consumes a group-writable drop-in, prove execution with a reversible root-owned marker. Perform only the minimum privileged action required by the objective.

## Placeholder commands

```bash
nmap -sC -sV -p 22,139,445 <TARGET_IP>
smbclient -L //<TARGET_IP>/ -N
rpcclient -U '' -N <TARGET_IP> -c 'enumprinters'
ssh <USER>@<TARGET_IP>
id
find /etc/systemd /usr/lib/systemd -type d -writable 2>/dev/null
systemctl cat <UNIT>
```

## Validation and failure recovery

- Treat a callback failure as inconclusive; retry with an in-band identity or file-write marker.
- Confirm recovered material is current and scoped before reuse. Stop after repeated authentication failures to avoid lockout.
- A writable path is not sufficient: prove that the privileged unit actually reads it and that the unit can be triggered within scope.
- Preserve the original unit/drop-in content and its SHA-256 before any change.

## Cleanup

- Restore modified unit and drop-in files byte-for-byte.
- Run `systemctl daemon-reload` only when required and authorized.
- Remove payloads, temporary markers, callbacks, and copied credential artifacts.
- Record commands, timestamps, identities, and cleanup verification in the engagement evidence log.
