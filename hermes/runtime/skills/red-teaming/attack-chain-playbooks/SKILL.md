---
name: attack-chain-playbooks
description: Select and apply reusable, technique-oriented attack chains for authorized lab and penetration-test targets while keeping target-specific data in engagement storage.
---

# Attack-Chain Playbooks

## Scope

Use this skill to select a chain class, not to replay a target walkthrough. Re-enumerate the current environment, prove every prerequisite, and store live targets, identities, secrets, and evidence only in the engagement workspace.

## Chain selection

Choose the smallest matching reference:

- `references/archived-skills/webapp-container-git-privesc.md`: workflow/web-app foothold, container pivot, localhost service discovery, and privileged Git/service consumers.
- `references/archived-skills/ad-dc-gmsa-dll-privesc.md`: ADCS, gMSA/ACL, native DLL loading, scheduled-task gates, and WSUS trust abuse.
- `../it-ot-nifi-opcua-privesc/SKILL.md`: Apache NiFi execution, support-artifact pivoting, OPC UA state manipulation, and gated maintenance consoles.
- `../../pentest-engagement-ops/references/mlflow-pickle-pth-privesc.md`: MLflow model deserialization followed by privileged Python path loading.
- `../../pentest-engagement-ops/references/pcap-dashboard-ftp-capabilities.md`: packet-capture disclosure, scoped credential reuse, and Linux capability escalation.

## Execution contract

For every transition:

1. State the prerequisite and expected evidence.
2. Run a low-impact validation.
3. Record the actual identity and trust boundary.
4. Stop or branch when the evidence disagrees with the hypothesis.
5. Preserve originals before mutation and define rollback first.
6. Perform the minimum action needed to meet the objective.
7. Clean up and verify restoration independently.

## Memory rule

Reusable memory may contain:

- Technique sequence and decision signals.
- Parameterized commands using angle-bracket placeholders.
- Validation, failure modes, rollback, cleanup, and defensive references.

Reusable memory must not contain:

- Target or platform instance names, addresses, domains, or URLs.
- Real usernames, credentials, hashes, tickets, certificates, or private keys.
- Proof strings, flags, copied walkthrough text, or unique target paths.
- Claims that a technique works without a fresh prerequisite check.

## Verification checklist

- [ ] Written authorization and current scope confirmed.
- [ ] Current service and identity evidence captured.
- [ ] Each pivot independently validated.
- [ ] Sensitive values kept outside reusable memory.
- [ ] Original state and hashes recorded before mutation.
- [ ] Cleanup completed and verified.
