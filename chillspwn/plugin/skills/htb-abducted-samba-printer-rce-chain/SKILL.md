---
name: htb-abducted-samba-printer-rce-chain
description: HTB Abducted chain: Samba HP-Reception CVE-2026-4480 printer RCE to nobody, rclone credential recovery, scott SSH, transfer symlink to marcus, systemd drop-in SUID root.
---

# HTB Abducted Samba Printer RCE Chain

## Validated path

Target profile:
- Linux/Ubuntu host with OpenSSH 9.6p1 and Samba on 139/445.
- NetBIOS name: `ABDUCTED`.
- Null SMB auth works.
- Users: `scott`, `marcus`.
- Printer share `HP-Reception` is null-accessible and writable.

End-to-end chain:
1. Enumerate SMB null auth and confirm `HP-Reception` printer share.
2. Exploit CVE-2026-4480 Samba spoolss print-command/job-name injection against `HP-Reception`.
   - Public PoC used from `CVE-2026-4480-PoC/exploit.py` with `python3-samba`.
   - First prove command execution with `id | nc <tun0_ip> 4445`.
   - Then obtain reverse shell as `nobody`/`nogroup`.
3. From low-priv shell, read `/opt/offsite-backup/rclone.conf`.
4. Reveal/decrypt the rclone-obfuscated password; recovered password was reused by `scott`.
5. SSH as `scott` and read user flag.
6. Abuse SMB `transfer` share behavior (`wide links=yes` / `force user=marcus`) to plant an SSH public key for `marcus` via symlink/authorized_keys path.
7. SSH as `marcus`.
8. Abuse writable `smbd.service.d` systemd drop-in as the `operators` group to create SUID bash.
9. Run SUID bash with `-p` and read root flag.

## Evidence from validated run
- Target IP used: `10.129.15.29`.
- Callback proof path: `/root/htb/boxes/abducted/loot/cve_2026_4480_callback.txt`.
- Foothold transcript: `/root/htb/boxes/abducted/loot/foothold_shell.txt`.
- Chain note: `/root/htb/boxes/abducted/notes/exploit_chain_10.129.15.29.md`.
- User flag captured: `3ab14c8cd18a8f48e26ab1dd84cf7ee6`.
- Root flag captured: `ef91e944632bb58aa47aa4a384a5fa72`.

## Pitfalls
- `marcus:scott` in SMB spray was only Guest fallback, not a valid credential.
- Printer share may not list files; successful `print`/`put` only proves spool write. The RCE path is via spoolss/job-name injection, not arbitrary file read.
- Avoid heavy SSH brute force; the intended password comes from rclone config after RCE.
- Do not claim flags unless actual flag-shaped values are read.
