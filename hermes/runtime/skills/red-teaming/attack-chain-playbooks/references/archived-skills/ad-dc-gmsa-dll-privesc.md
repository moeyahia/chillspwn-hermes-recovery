# Active Directory: gMSA, ADCS, Native DLL, and WSUS Chains

## Applicability

Use during an authorized Windows domain assessment when one or more of these conditions are observed:

- ADCS templates or issuance policies grant a low-trust principal meaningful enrollment or template-control rights.
- A principal has write rights over a gMSA or another account object.
- A privileged service or scheduled task loads a native DLL from a writable location.
- Domain clients trust an internally configured WSUS endpoint.

Do not assume all branches are available. Prove prerequisites and select the shortest reversible path.

## 1. ADCS certificate abuse

### Enumeration

```bash
certipy-ad find -u '<USER>@<DOMAIN>' -p '<PASSWORD>' \
  -dc-ip <DC_IP> -enabled -vulnerable
```

Record template owner, enrollment rights, issuance requirements, subject-name settings, EKUs, authorized signatures, and issuance-policy group links.

### Validation

- Inspect the issued certificate identity and EKUs; a requested SAN does not prove the CA issued the intended identity.
- PKINIT needs a suitable client-authentication EKU and working Kerberos time.
- A server-authentication certificate may not map to an LDAP client identity. Verify `whoami`/bind identity; a connected shell can still be anonymous.
- Delete stale cache/output files before retrying tools that prompt on overwrite.

### LDAP fallback discipline

If an interactive certificate-authenticated LDAP shell has argument-parsing problems, use a maintained LDAP library for the exact authorized modification. Verify bind identity before any write. Snapshot the target object's attributes and security descriptor, apply one change, read it back, then restore.

## 2. gMSA and shadow-credential paths

Use BloodHound and LDAP enumeration to confirm the effective ACL before writing a key credential. Keep generated certificates, keys, tickets, and hashes in the engagement secret store.

```bash
certipy-ad shadow auto -u '<USER>@<DOMAIN>' -p '<PASSWORD>' \
  -account '<TARGET_ACCOUNT>' -dc-ip <DC_IP>
```

Protected Users and gMSA accounts can reject NTLM even when the recovered material is valid; use the authorized Kerberos path and verify the resulting identity. Restore any temporary key credential and confirm removal.

## 3. Remote-management reliability

- Use one WinRM/PSRP session at a time and close it before opening another.
- When throttling appears, stop retrying and allow recovery rather than creating a connection storm.
- Use SMB/LDAP for enumeration when remote command sessions are unstable.
- Keep staged command blocks small and prefer uploaded scripts over very large inline Base64.
- PowerShell command composition differs from `cmd.exe`; select the correct `nxc` mode.

## 4. Native DLL sideload or hijack

### Prove context first

Before building a privileged payload, deploy a benign native DLL that records `GetUserNameA()` and the process architecture to a service-writable log. The loader may run as an ordinary service identity rather than SYSTEM.

### Match the loader contract

1. Identify the exact DLL filename and exported function expected by the service.
2. Determine x86/x64 architecture. Win32 error `193` usually indicates architecture mismatch; `126` indicates a missing DLL or dependency.
3. Export the expected native symbol and calling convention.
4. Compile with the normal MinGW C runtime and entry point. Tiny `-nostdlib` builds can load while API calls fail because runtime initialization is absent.
5. Use `CreateProcessA` with `CREATE_NO_WINDOW` when `system()` or `WinExec()` is unreliable in a managed host process.
6. Write diagnostics to a directory already writable by the service identity, represented as `<SERVICE_DATA_DIR>`.

Minimal template:

```c
#include <windows.h>

__declspec(dllexport) void __stdcall <EXPECTED_EXPORT>(void) {
    STARTUPINFOA si = { .cb = sizeof(si) };
    PROCESS_INFORMATION pi = {0};
    char cmd[] = "cmd.exe /c whoami > <SERVICE_DATA_DIR>\\identity.txt";
    if (CreateProcessA(NULL, cmd, NULL, NULL, FALSE, CREATE_NO_WINDOW,
                       NULL, NULL, &si, &pi)) {
        CloseHandle(pi.hThread);
        CloseHandle(pi.hProcess);
    }
}
BOOL WINAPI DllMain(HINSTANCE h, DWORD reason, LPVOID reserved) { return TRUE; }
```

```bash
i686-w64-mingw32-gcc -shared -Os -s -o test.dll test.c
x86_64-w64-mingw32-gcc -shared -Os -s -o test64.dll test.c
objdump -p test.dll | sed -n '/Export Table/,+40p'
```

From a 32-bit loader on 64-bit Windows, `Sysnative` is the alias for launching a 64-bit child; once the child is 64-bit, use ordinary `System32` paths.

### Trigger windows

A writable task-consumed file is not enough. Prove task liveness using Task Scheduler Operational events and fresh execution artifacts. Preserve the original bytes and SHA-256, stage a benign marker only during an active window, and restore immediately after the test.

## 5. WSUS trust abuse and deserialization checks

### Trusted endpoint branch

1. Read `WUServer` and `WUStatusServer` policy values.
2. Confirm hostname, scheme, port, and client behavior.
3. Determine whether an authorized DNS-change path and a server certificate for the exact hostname exist.
4. Use a benign update action to prove that the Windows Update client reaches and trusts the controlled endpoint.
5. Restore DNS, certificates, listeners, and policy-related artifacts.

Do not treat an accepting SOAP endpoint as client execution. HTTP and HTTPS endpoints can have different registration and trust requirements.

### Deserialization branch

For CVE-specific testing, confirm product build and patch status first. Generate .NET Framework/WPF-dependent payload material on a compatible Windows environment; Mono or an incomplete tool release can fail for dependency reasons. Use a harmless marker and preserve request/response evidence.

## 6. Related escalation checks

- ESC10-style UPN manipulation requires control of the source identity, a suitable client-auth template, and an unambiguous target mapping. Snapshot and restore the original UPN.
- Performance Log Users membership can create privileged performance-counter loading paths. Prove the real group and loader context with a benign telemetry DLL before any privileged action.
- Kerberos failures can result from clock skew; record target time and use an approved synchronization method. Do not weaken domain policy.

## Evidence, failure recovery, and cleanup

- Record effective ACLs, template settings, EKUs, loader identity, architecture, service/task event IDs, and update-client policy.
- Keep all passwords, hashes, certificates, tickets, and proof material outside this reusable file.
- Restore key credentials, UPNs, memberships, ACLs, templates, DNS records, service files, and task-consumed files.
- Remove payloads and markers, close sessions, and verify restoration with independent reads.

## Technical references

- Certipy documentation: `https://github.com/ly4k/Certipy/wiki`
- Microsoft gMSA overview: `https://learn.microsoft.com/windows-server/identity/ad-ds/manage/group-managed-service-accounts/group-managed-service-accounts/group-managed-service-accounts-overview`
- DLL search-order guidance: `https://learn.microsoft.com/windows/win32/dlls/dynamic-link-library-search-order`
- WSUS deployment guidance: `https://learn.microsoft.com/windows-server/administration/windows-server-update-services/deploy/deploy-windows-server-update-services`
