# Perimeter Monitoring Pattern (2026-05-22)

## Goal
Detect new/unknown WiFi devices entering the physical perimeter without triggering on known home devices on Ghossein.

## Architecture
- Separate scripts from existing `pineapple-monitor.sh` / `ghossein-defense.sh`
- Two new scripts:
  - `perimeter_whitelist.sh` — manages known devices (home APs + personal devices)
  - `perimeter_monitor.sh` — enhanced passive recon using airodump-ng + OUI + basic device class fingerprinting

## Key Techniques
- Whitelist-first approach: all known home MACs are excluded before alerting
- Device class guessing via vendor OUI (Apple → Phone/Tablet, Intel → Laptop, Espressif → IoT, etc.)
- Uses only existing tools on the Pineapple (no bettercap)
- Cron job runs every 10 minutes, delivers only on new detections

## Current Scripts
- `/root/perimeter_whitelist.sh`
- `/root/perimeter_monitor.sh`

## Cron Job
Job ID: `eba34f64a8ae` (Perimeter Monitor) — every 10m, model: grok-4.3

## Limitations
- No bettercap (opkg repositories unreachable)
- Fingerprinting is heuristic only (vendor + basic patterns)
- Does not perform active probing

## Future Improvements
- Add richer 802.11 capability parsing (HT/VHT, supported rates)
- Consider bettercap if package feed becomes available