#!/usr/bin/env bash
# Least-disruptive cleanup for Pineapple ASIX USB Ethernet cosmetic D-state kworker hangs.
# Run on Kali. Requires root.
set -euo pipefail

PINEAPPLE_IP="${PINEAPPLE_IP:-172.16.42.1}"
ASIX_IF="${ASIX_IF:-}"

find_binding() {
  for d in /sys/bus/usb/drivers/asix/*:*; do
    [ -e "$d" ] || continue
    basename "$d"
    return 0
  done
  return 1
}

binding="${1:-}"
if [ -z "$binding" ]; then
  binding="$(find_binding || true)"
fi

if [ -z "$binding" ]; then
  echo "ERROR: no ASIX USB binding found under /sys/bus/usb/drivers/asix" >&2
  exit 1
fi

iface_for_binding() {
  local netdir="/sys/bus/usb/drivers/asix/$binding/net"
  if [ -d "$netdir" ]; then
    find "$netdir" -mindepth 1 -maxdepth 1 -type l -printf '%f\n' | head -1
  fi
}

pre_iface="$(iface_for_binding || true)"
echo "[*] ASIX binding: $binding"
echo "[*] Pre-reset iface: ${pre_iface:-unknown}"

if ping -c 1 -W 1 "$PINEAPPLE_IP" >/dev/null 2>&1; then
  echo "[*] Pineapple reachable before reset"
else
  echo "[!] Pineapple not reachable before reset; continuing driver rebind anyway"
fi

echo "[*] Unbinding $binding"
echo "$binding" > /sys/bus/usb/drivers/asix/unbind
sleep 3

echo "[*] Rebinding $binding"
echo "$binding" > /sys/bus/usb/drivers/asix/bind
sleep 5

post_iface="$(iface_for_binding || true)"
if [ -n "${ASIX_IF:-}" ]; then
  post_iface="$ASIX_IF"
fi

echo "[*] Post-reset iface: ${post_iface:-unknown}"
if [ -n "$post_iface" ]; then
  ip link set "$post_iface" up || true
  if ! ip -4 addr show "$post_iface" | grep -q '172\.16\.42\.'; then
    echo "[*] Requesting DHCP on $post_iface"
    if command -v dhclient >/dev/null 2>&1; then
      dhclient -1 -v "$post_iface" || true
    elif command -v udhcpc >/dev/null 2>&1; then
      udhcpc -i "$post_iface" -n -q || true
    fi
  fi
fi

for i in $(seq 1 20); do
  if ping -c 1 -W 1 "$PINEAPPLE_IP" >/dev/null 2>&1; then
    echo "[+] Pineapple reachable after ${i}s"
    break
  fi
  sleep 1
  if [ "$i" = 20 ]; then
    echo "[!] Pineapple still not reachable after 20s" >&2
    exit 2
  fi
done

echo "[*] D-state USB/asix kworker check:"
ps -eo pid,stat,etime,wchan:40,comm,args | awk '($2 ~ /D/ && ($5 ~ /usb|asix|phy|mdio/ || $0 ~ /asix|AX88772|events_power/)) {print}' || true
