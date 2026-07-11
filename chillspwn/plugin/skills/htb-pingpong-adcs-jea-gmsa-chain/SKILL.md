---
name: htb-pingpong-adcs-jea-gmsa-chain
description: HTB PingPong end-to-end chain: ESC13/JEA/gMSA/RBCD/MSSQL/EfsPotato/R.Martinelli/SmartcardAuthentication ESC4-ESC1 to Administrator flags.
---

# HTB PingPong ADCS/JEA/gMSA Chain

## Validated final path

1. Establish Kerberos-first foothold as `PING.HTB\c.roberts` through ESC13 `TemporaryWinRM` / PFX.
2. Use the restricted JEA endpoint correctly: visible commands are tiny, but invocation operator works: `& { whoami }` executes as `PONG\Pong_GMSA$`.
3. Read the intended PowerShell history / use recovered report-confirmed credential for `PONG.HTB\c.carlssen` and validate Kerberos + DC2 WinRM.
4. As `c.carlssen`, set RBCD on `CN=svc_sql,OU=Service Accounts,DC=pong,DC=htb` to allow `Pong_GMSA$` SID.
5. Use `Pong_GMSA$` S4U to impersonate `C.Adam` to `mssqlsvc/dc2.pong.htb`; connect to MSSQL. `C.Adam` is SQL sysadmin.
6. Enable/use `xp_cmdshell` as `PONG\svc_sql`; confirm `SeImpersonatePrivilege`.
7. PrintSpoofer timed out; EfsPotato / EFSRPC SeImpersonate LPE worked to prove `NT AUTHORITY\SYSTEM` on DC2.
8. From DC2 SYSTEM, perform targeted PONG credential extraction only for `R.Martinelli`; validate TGT and cross-forest PING LDAP ticket/bind.
9. R.Martinelli maps to the PONG FSP in PING `CA Managers` and can modify PING `SmartcardAuthentication` template.
10. Use the raw security descriptor LDAP modification method (not impacket-dacledit) to add a narrow `c.roberts` Certificate-Enrollment ACE and set SAN supply flag; restore template exactly after request.
11. Correct final certificate request: use Certipy as `c.roberts` after raw-SD ACE gate with both `-upn Administrator@ping.htb` and Administrator SID `S-1-5-21-750635624-2058721901-1932338391-500`. This avoids the prior UPN-only cert PKINIT failure (`Object SID mismatch`).
12. PKINIT as PING Administrator, then read exact flags.

## Critical pitfalls learned

- Do not close the restricted JEA branch based on `Get-Command` alone; `& { whoami }` works.
- Windows certreq with SAN in `-attrib` issued a private-key Administrator cert but did not include UPN/SID identity, causing PKINIT failure.
- Certipy UPN+SID works only after the c.roberts enrollment ACE is actually applied. Failed ACE add leads to `CERTSRV_E_TEMPLATE_DENIED`.
- Impacket `dacledit -k` was unreliable here (`invalidCredentials data 52e`); the raw SD LDAP method succeeded.
- Always restore `SmartcardAuthentication` after each request attempt and prove normalized diff/raw SD clean.
- Avoid stale DC1 IP drift; confirmed final IP in this session was `10.129.10.227`.

## Final flags from completed session

- user: `bbce0db865e002a3b76958ee96d466f9`
- root: `34d96c94f8bfa5d749ae92afe8e9ac64`

## Report artifacts

- `/root/htb/boxes/ping/report/PingPong_Penetration_Test_Report.pdf`
- `/root/htb/boxes/ping/notes/FINAL_CERTIPY_UPN_SID_FLAGS_20260608_024414.md`
