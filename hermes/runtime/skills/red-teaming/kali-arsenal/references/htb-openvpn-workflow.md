# Hack The Box OpenVPN Workflow

Use this when the user sends an HTB `.ovpn` profile or asks to prepare for HTB boxes/challenges.

## Save uploaded profiles

Messaging platforms may reject `.ovpn`; ask the user to upload it as `.txt` or `.zip`, then save it back with `.ovpn` permissions:

```bash
mkdir -p /root/htb/{vpn,boxes,challenges,loot,scans}
chmod 700 /root/htb /root/htb/vpn
install -m 600 /path/to/uploaded-profile.txt /root/htb/vpn/htb.ovpn
```

Do not print embedded private keys, certificates, or `tls-auth` static key content in user-facing replies.

## Start VPN

```bash
/usr/sbin/openvpn \
  --config /root/htb/vpn/htb.ovpn \
  --daemon htb-vpn \
  --writepid /root/htb/vpn/openvpn.pid \
  --log /root/htb/vpn/openvpn.log
sleep 8
```

Verify:

```bash
pgrep -af '/usr/sbin/openvpn'
ip -brief addr | grep -E 'tun|tap'
ip route | grep -E 'tun|10\.10\.|10\.129\.'
grep -E 'Initialization Sequence Completed|AUTH_FAILED|ERROR|VERIFY OK|PUSH_REPLY' /root/htb/vpn/openvpn.log | tail -40
```

Expected success marker:

```text
Initialization Sequence Completed
```

Common HTB routes include:

```text
10.129.0.0/16 via tun0
10.10.8.0/22 via tun0
10.10.110.0/24 via tun0
```

## Switching VPN profiles safely

Avoid broad `pkill -f` commands that include the same pattern inside the shell command string; they can kill the currently executing shell/tool invocation. Prefer the PID file:

```bash
PID=$(cat /root/htb/vpn/openvpn.pid 2>/dev/null || true)
if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
  kill "$PID" || true
  for i in 1 2 3 4 5; do
    kill -0 "$PID" 2>/dev/null || break
    sleep 1
  done
  kill -9 "$PID" 2>/dev/null || true
fi
```

Then start the new profile with a fresh `--writepid` and `--log`.

## Per-box directory layout

For a target IP:

```bash
TARGET=10.129.x.x
mkdir -p /root/htb/boxes/$TARGET/{scans,loot,notes,exploit}
```

## Initial enumeration pattern

```bash
TARGET=10.129.x.x
ping -c 2 -W 2 $TARGET || true
nmap -Pn --min-rate 5000 -p- --open -oN /root/htb/boxes/$TARGET/scans/nmap_fast.txt $TARGET
```

Then run targeted version/scripts on discovered ports, for example FTP:

```bash
nmap -Pn -sCV -p21 -oN /root/htb/boxes/$TARGET/scans/nmap_ftp_sCV.txt $TARGET
nc -nv -w 5 $TARGET 21 </dev/null
```

For Starting Point FTP-style boxes, check anonymous access and download loot:

```bash
ftp -inv $TARGET <<'EOF'
user anonymous anonymous
pwd
ls -la
binary
get flag.txt
bye
EOF
```

## User-facing style

Show the exact command used and raw output when the user asks about versions, OS, or how a finding was determined. Keep explanation concise and tie it directly to the tool output.
