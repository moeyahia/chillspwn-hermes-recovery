# HTB Logging council lessons — WSUS/Admin-session round (2026-05-26)

## Situation

The operator suspected the final path was `WSUS -> root`, but prior attempts against WSUS SOAP/reporting surfaces were inert. A focused council round was launched to reason about the missing "proper admin session" or privileged client execution condition.

## Final resolution

The correct boundary was not an interactive Administrator session and not SOAP `ReportEventBatch` execution. The working path was:

1. Obtain a trusted ADCS-issued Server Authentication certificate for `wsus.logging.htb`.
2. Inject DNS so `wsus.logging.htb` resolves to the attacker host.
3. Run rogue WSUS (`wsuks`) on TCP 8531 with the trusted certificate.
4. Let the DC's own Windows Update client connect to the hostname it already trusts.
5. The DC downloads and installs the fake update as `NT AUTHORITY\SYSTEM`.
6. Use SYSTEM to add controlled principal to Domain Admins, then DCSync/read flag.

## Council-use lesson

When the user says a path needs a "proper admin session", translate that broadly. In WSUS/AD contexts, the privileged session may be a machine/system service workflow rather than an interactive user logon. Ask the council to enumerate:

- Which trusted client/service naturally contacts this endpoint?
- What identity/context does that client execute updates/actions under?
- What hostname, certificate, DNS, and content-signing conditions must be satisfied?
- How to trigger the legitimate client workflow instead of directly calling low-impact reporting APIs?

## Briefing guidance

For future WSUS councils, include a dedicated section:

```text
Do not focus on inert reporting endpoints unless you can connect them to install-time execution. Prioritize trusted-client update workflows: WUA/Windows Update service, hostname resolution, TLS identity, update metadata, content download, approval/installation trigger, and execution context.
```

## Validation guidance

Before accepting a council's WSUS theory, validate:

- WSUS client registry config (`WUServer`, `WUStatusServer`, TLS port).
- DNS resolution of the WSUS hostname from the DC.
- Whether attacker can obtain/serve a cert valid for that hostname.
- Whether the DC makes outbound contact to the rogue endpoint.
- Whether the payload executes in SYSTEM context.

This reference is session-specific detail; the general rule is: in enterprise service abuse, the "session" may be an automated trusted service transaction.
