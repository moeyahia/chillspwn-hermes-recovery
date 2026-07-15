# PineAP Daemon Diagnostics

Use the configured SSH destination and key. Do not rely on a remembered device address, hostname, or SSH shortcut.

## Verification sequence

```bash
: "${PINEAPPLE_SSH_TARGET:?set user@host}"
: "${PINEAPPLE_SSH_KEY:?set the dedicated private-key path}"

ssh -i "$PINEAPPLE_SSH_KEY" -o BatchMode=yes -o StrictHostKeyChecking=yes \
  "$PINEAPPLE_SSH_TARGET" \
  '/etc/init.d/pineapd status; /etc/init.d/pineapple status'
```

Then verify the process and supporting state:

```bash
ssh -i "$PINEAPPLE_SSH_KEY" -o BatchMode=yes -o StrictHostKeyChecking=yes \
  "$PINEAPPLE_SSH_TARGET" \
  "ps | grep '[p]ineapd'; uci show wireless; logread | grep -E 'hostapd|pineap' | tail -30"
```

Init-script state is stronger evidence than a single process grep. Compare UCI output with the operator-owned expected configuration, but never paste SSIDs, keys, client MACs, or uplink credentials into shared logs.
