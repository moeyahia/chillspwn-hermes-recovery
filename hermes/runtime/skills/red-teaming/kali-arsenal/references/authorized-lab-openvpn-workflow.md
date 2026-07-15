# Authorized-Lab OpenVPN Workflow

## Protect the profile

Store supplied profiles beneath an ignored engagement directory with mode `0600`. Never commit VPN profiles, embedded certificates, private keys, or control-plane URLs.

```bash
install -m 0600 <SUPPLIED_PROFILE> <ENGAGEMENT_DIR>/vpn/profile.ovpn
```

## Start and validate

Run OpenVPN under a tracked unit or `tmux` session with a dedicated log. Then verify interface, address, and route selection before scanning.

```bash
sudo openvpn --config <ENGAGEMENT_DIR>/vpn/profile.ovpn \
  --log <ENGAGEMENT_DIR>/vpn/openvpn.log --daemon
ip -brief address
ip route get <TARGET_IP>
nc -vz -w 3 <TARGET_IP> <EXPECTED_PORT>
```

## Switch profiles safely

1. Stop the exact old process.
2. Verify the old tunnel and routes are gone.
3. Start the new supplied profile.
4. Confirm the new address and route.
5. Revalidate one expected service before resuming.

## Workspace layout

Keep one stable directory per engagement with `recon/`, `evidence/`, `loot/`, `exploit/`, `logs/`, and `report/`. Store current target values in an ignored state file; use placeholders in reusable memory.

## Cleanup

Stop the VPN process, verify routes are removed, archive sanitized logs, and securely remove unused profiles according to the engagement retention policy.
