# Hashcat Assets (Phase 17)

CredSmith reasons about cracking **strategy** from wordlist/rule METADATA — never their contents, never
hash values, never plaintext. Cracking is **authorized-lab only**.

## Where they live
`/opt/chillspwn-assets/hashcat/`. Manifest: `server/assets/hashcatAssets.manifest.json` — Probable-Wordlists,
passphrase-wordlist, hashcat-rules-collection, hashcat-rules-generator (commits pinned; nothing downloaded).

## Strategy selection
`GET /api/assets/hashcat` (inventory) and `GET /api/assets/hashcat/strategy?hashType=&objective=&budget=&style=`
→ `{ strategy, selectedWordlistPaths, selectedRulePaths, commandPlan, estimatedExpansion, expectedRuntimeClass,
approvalRequired, safety }`. Strategies: straight · rules · passphrase · mask · hybrid · combinator ·
policy-driven-mutation. Rule metadata carries `estimatedExpansionFactor` + `riskCost` so CredSmith can
estimate keyspace before running. `commandPlan` is a PATH-based template (`hashcat -a 0 -m <type> <hashfile>
<wl> -r <rule> --potfile-disable`) — no hash values, no contents.

## Repo roles
Probable-Wordlists → high-frequency base (straight) · passphrase-wordlist → corporate phrase strategy ·
hashcat-rules-collection → rule families (best64 low-cost → OneRuleToRuleThemAll/dive high-expansion,
approval-gated) · hashcat-rules-generator → policy-driven mutation (generate a tailored `.rule` from a
stated password policy).

## Safety
Crack on the GPU host with `--potfile-disable`; the model supplies its own wordlist each run. **Plaintext
passwords + hashes are NEVER stored as reusable memory** — only redacted evidence. Lessons describe
STRATEGY (`hashcat_strategy_lesson`), never secrets. Large lists/rules are approval-gated.
