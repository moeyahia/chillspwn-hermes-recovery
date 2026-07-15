---
name: adcs-jea-gmsa-chain
description: Reusable authorized Active Directory chain covering ADCS enrollment-group abuse, constrained PowerShell/JEA pivots, gMSA and RBCD relationships, SQL service execution, local SYSTEM escalation, and certificate-template remediation checks.
---

# ADCS, JEA, gMSA, and RBCD Attack Chain

## Prerequisites

- Written authorization for the domain and certificate authority in scope.
- A controlled domain principal with an initial authenticated foothold.
- Time synchronization with the domain controller for Kerberos operations.
- A dedicated evidence directory and a rollback record for every directory or template change.

## Technique chain

1. Enumerate ADCS CAs, templates, enrollment rights, issuance requirements, EKUs, and group-linked issuance policies with `certipy-ad find`.
2. Map nested group membership and policy-OID relationships. Treat certificate issuance groups as privilege-bearing objects.
3. Enumerate PowerShell remoting and JEA endpoints. Record the language mode, visible commands, virtual-account behavior, and allowed parameter sets.
4. Use constrained endpoints only to exercise explicitly exposed functionality. Look for safe information-disclosure or service-control primitives before attempting code execution.
5. Enumerate gMSA read rights, delegation settings, and RBCD ACLs with BloodHound, `nxc`, and Impacket. Request managed-password material only when authorized.
6. If SQL Server is present, validate the login context and enabled execution features. Prefer a benign identity query before any operating-system command.
7. For a local service-account foothold, enumerate token privileges and service misconfigurations. Use a non-destructive SYSTEM marker before performing the minimum required privileged action.
8. Where template-control rights exist, snapshot the original template, make the smallest test change, request a short-lived test certificate, then restore and verify the template.

## Placeholder commands

```bash
certipy-ad find -u '<USER>@<DOMAIN>' -p '<PASSWORD>' -dc-ip <DC_IP> -enabled -vulnerable
nxc winrm <TARGET_IP> -u '<USER>' -p '<PASSWORD>'
impacket-GetUserSPNs '<DOMAIN>/<USER>:<PASSWORD>' -dc-ip <DC_IP>
certipy-ad template -u '<USER>@<DOMAIN>' -p '<PASSWORD>' -template '<TEMPLATE>' -save-old
```

Use the engagement secret store or environment variables rather than shell history for real credentials.

## Validation and failure recovery

- Verify the authenticated identity after every certificate, Kerberos, JEA, SQL, or token transition.
- A certificate with a requested SAN does not prove that the target identity was issued; inspect the certificate and authentication result.
- Do not assume a JEA endpoint is escapable because it exposes a privileged command. Validate allowed parameters and execution context.
- Avoid repeated remote-management sessions when throttling is observed; close one session before opening another.
- Restore directory ACLs, RBCD attributes, SPNs, group memberships, SQL settings, and certificate templates from captured originals.

## Evidence and cleanup

- Preserve sanitized command output, object GUIDs, template configuration diffs, and identity proofs.
- Never store issued private keys, passwords, hashes, tickets, or proof strings in this skill.
- Revoke test certificates when appropriate, remove temporary principals and files, and verify all restored settings independently.
