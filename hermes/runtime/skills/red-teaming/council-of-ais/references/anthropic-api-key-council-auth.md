# Anthropic API-Key Authentication for Council Claude Lane

## Trigger

Use this when the user asks to make the Council of AIs Claude lane authenticate with an Anthropic API key rather than Claude Code / Anthropic OAuth.

The council script already launches Claude with:

```bash
hermes chat --provider anthropic --model claude-opus-4-7 ...
```

So the key question is not the council command; it is which credential Hermes selects for provider `anthropic`.

## Check current state without exposing secrets

```bash
python3 - <<'PY'
from pathlib import Path
for key in ['ANTHROPIC_API_KEY', 'ANTHROPIC_TOKEN']:
    found = False
    for i, line in enumerate(Path('/root/.hermes/.env').read_text(errors='ignore').splitlines(), 1):
        s=line.strip()
        if s and not s.startswith('#') and '=' in s:
            k,v=s.split('=',1)
            if k.strip()==key:
                v=v.strip().strip('"').strip("'")
                print(f'{key}: present line {i}; set={bool(v)}; length={len(v)}')
                found=True
    if not found:
        print(f'{key}: not present')
PY
hermes auth list anthropic
```

Important observed shape:

```text
anthropic (2 credentials):
  #1 claude_code oauth hermes_pkce ←
  #2 api-key-2 manual
```

This means an API key exists, but OAuth is still selected first.

## Force API key selection

Hermes normalizes Anthropic pool priorities with manual entries first, but if both OAuth and API key are `manual:*`/`manual`, the older OAuth entry may still stay first. The reliable fix is to remove the OAuth pool entry and leave the manual API key as credential #1.

Always back up auth state first:

```bash
backup="/root/.hermes/auth.json.bak.remove_anthropic_oauth.$(date +%Y%m%d_%H%M%S)"
cp /root/.hermes/auth.json "$backup"
hermes auth remove anthropic 1
hermes auth list anthropic
printf 'Backup: %s\n' "$backup"
```

Expected result:

```text
anthropic (1 credentials):
  #1 api-key-2 manual ←
```

## Verify runtime resolution

Run a non-secret runtime check:

```bash
python3 - <<'PY'
from hermes_cli.runtime_provider import resolve_runtime_provider
r = resolve_runtime_provider(requested='anthropic', target_model='claude-opus-4-7')
print('provider:', r.get('provider'))
print('api_mode:', r.get('api_mode'))
print('base_url:', r.get('base_url'))
print('source:', r.get('source'))
print('api_key_set:', bool(r.get('api_key')))
print('api_key_prefix:', (r.get('api_key') or '')[:11] + '…' if r.get('api_key') else '')
pool = r.get('credential_pool')
if pool:
    cur = pool.current()
    print('selected_label:', getattr(cur, 'label', None))
    print('selected_auth_type:', getattr(cur, 'auth_type', None))
    print('selected_source:', getattr(cur, 'source', None))
PY
```

Expected result:

```text
provider: anthropic
api_mode: anthropic_messages
base_url: https://api.anthropic.com
source: manual
api_key_set: True
api_key_prefix: sk-ant-api0…
selected_label: api-key-2
selected_auth_type: api_key
selected_source: manual
```

## Pitfalls

- Do not rely on `.env` alone. `ANTHROPIC_API_KEY` may be present but empty while Hermes still has an API key stored in `~/.hermes/auth.json` credential pool.
- Reordering `auth.json` by hand is not enough if Hermes re-normalizes priorities. Verify with `resolve_runtime_provider`, not just file contents.
- The council script does not need changing if it already uses `--provider anthropic`; it will inherit whichever Anthropic credential Hermes runtime selects.
- Keep the auth backup path in the user-facing response so the OAuth entry can be restored if needed.
