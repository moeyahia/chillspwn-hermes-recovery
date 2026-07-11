# Logging svc_recovery Council — 2026-05-26

## Context
User suspected HTB Logging root path still centered on `svc_recovery`. A council run was launched with a svc_recovery-focused briefing and prior dead ends.

## Council yield
- 5/6 usable assessments: Claude Opus, GPT-5.5, DeepSeek V4, Gemini, Grok.
- Nemotron produced no assessment.
- Output directory used in-session: `/root/htb/boxes/logging/council_svc_recovery_20260526_204612`.

## Durable technique: validate council theories against local artifacts before reporting
Before presenting the verdict, the orchestrator ran a local artifact sanity check:
- Parsed BloodHound JSON for `svc_recovery` and `Emergency Recovery` SIDs.
- Confirmed `svc_recovery` had `GenericWrite` over `MSA_HEALTH$`.
- Confirmed no extra outbound `Emergency Recovery` ACEs in checked BH exports.
- Confirmed `User` cert template properties from `certipy_all.txt`: enabled, ClientAuth, `Enrollee Supplies Subject=False`, `SubjectAltRequireUpn`, Domain Users enrollment.

This avoided blindly accepting a council recommendation and produced a grounded synthesis.

## Key attack idea surfaced
The strongest fresh idea was an ESC10-style pivot through a *controlled intermediary object*:

```text
svc_recovery
  -> GenericWrite on msa_health$
  -> temporarily set msa_health$ UPN to administrator@logging.htb
  -> request User template cert as msa_health$
  -> cert SAN/mapping targets Administrator
  -> authenticate via PKINIT/cert
  -> restore msa_health$ UPN
```

Generalizable lesson: when a principal has GenericWrite over an account that can enroll a ClientAuth certificate template using directory-derived UPN (`SubjectAltRequireUpn`), evaluate UPN manipulation on the controlled account — not only on the final target user. Prior councils had focused on whether `jaylee` could write her own UPN and missed the intermediary-object angle.

## Fast sanity checks recommended by council
For AD/HTB recovery-themed accounts, add quick low-cost checks before deeper exploitation:
1. Kerberos SMB direct read test for sensitive file paths if share enumeration showed `C$`/`ADMIN$` access.
2. Read-only LDAP checks of current UPN/mail attributes for controlled account and target account.
3. Template enrollment proof with original attributes before any mutation.
4. Certificate binding enforcement / strong mapping checks when relying on ESC10.

## Launcher reliability lesson
The first local council launcher used `time.time()` for timeout accounting. On this VM the wall clock can jump due hypervisor/time-offset behavior, making elapsed time appear huge and causing premature process kills. Patch direct council launchers to use `time.monotonic()` for elapsed-time/timeout logic.

Bad:
```python
start = time.time()
if time.time() - start > timeout:
    ...
```

Good:
```python
start = time.monotonic()
if time.monotonic() - start > timeout:
    ...
```

## Reporting pattern that worked
- Send Telegram after launch with model list and expected duration.
- Send Telegram when first lanes complete and when all usable assessments are in.
- Create a concise `synthesis.md` in the council directory containing: yield, grounded artifact checks, verdict, ranked paths, immediate actions, risks, and do-not-repeat list.
