---
name: htb-attack-chain-playbooks
description: "Use when solving or resuming HTB/Vulnlab-style boxes by selecting reusable attack-chain classes, preserving box-specific chains as references rather than one-off skills."
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [linux]
metadata:
  hermes:
    tags: [htb, vulnlab, attack-chains, privilege-escalation, methodology]
    related_skills: [active-directory-pentest, pentest-engagement-ops, windows-pentest-operations]
---

# HTB / Vulnlab Attack-Chain Playbooks

## Overview

Umbrella for reusable box-chain patterns that are too specific to be top-level skills but too valuable to discard. Keep broad methodology in the main body and archive full box/session notes under `references/`.

## When to Use

Use when a task is an HTB/Vulnlab/CTF-like engagement and the problem is selecting or resuming a known chain class:
- webapp foothold into container/git/secrets/privesc;
- AD DC dominance via gMSA, shadow credentials, ADCS, WSUS, or DLL/plugin abuse;
- legacy versus modern Windows DC exploitation selection;
- deciding when a session-specific exploit chain should be treated as a reference, not a standalone skill.

Use `pentest-engagement-ops` for host/VPN/process mechanics and `active-directory-pentest` for general AD graph movement.

## Chain-class selection

1. Start with the service/theme: webapp + repo leakage, AD graph, legacy Windows, OT/IT bridge, or appliance/hardware.
2. Map foothold material to reusable primitives: credentials, writable plugin/DLL path, git history, container escapes, ACL/GPO edges, certificate abuse, gMSA/secrets, or remote RPC SYSTEM.
3. Prefer the intended chain when evidence points to it; do not grind unrelated CVEs once a graph or theme is clear.
4. Save target-specific details as reference files and keep SKILL.md focused on reusable decision rules.

## Webapp / container / git chain class

Look for source disclosure, git history, config secrets, container environment leaks, mounted host paths, CI/CD credentials, and application-specific writable code paths. Convert foothold to host privesc through the exposed primitive rather than generic kernel guessing.

## AD DC / gMSA / DLL chain class

Modern AD DC chains often combine delegated rights, gMSA or service-account material, shadow credentials, ADCS misconfigurations, WSUS/package abuse, or writable DLL/plugin paths. Confirm each edge with BloodHound/LDAP/tool output before executing the next destructive step.

## Reference-first storage rule

A detailed box chain should be a `references/<box-or-chain>.md` file under this umbrella unless it defines a broadly reusable technique class. The top-level skill should name the class and link to the reference; it should not become a one-box walkthrough.

## Common Pitfalls

1. **Promoting one box's exact bug to a top-level skill.** Use a reference file unless the pattern generalizes.
2. **Overfitting to the last chain.** Re-run service/theme triage before applying a known pattern.
3. **Skipping verification between edges.** Each credential, ACL, shell, and privilege claim needs a concrete signal.

## Verification Checklist

- [ ] Engagement class identified and mapped to a chain family.
- [ ] Box-specific evidence stored as notes/reference, not a narrow new skill.
- [ ] Each chain edge verified before final reporting.
