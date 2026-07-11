# Kali OSINT Tool Pitfalls (Session 2026-05-20)
## Target: Mohamed El Ghossein / moeyahia@hotmail.com

### Tool Failures
1. **theHarvester**: Deprecated warning: `theHarvester is deprecated. Please use theHarvester instead.` Exit 0, no results for `moeyahia@hotmail.com` in Google/Bing searches.
2. **recon-ng**: Invalid command `workspace create osint_moeyahia` via CLI. Requires interactive mode: `recon-ng -w osint_moeyahia`.
3. **metagoofil**: Timed out after 90s for `metagoofil -d "Mohamed El Ghossein"`. Exit code 124.
4. **dmitry**: `dmitry -i -w -o /tmp/dmitry_moeyahia.txt moeyahia@hotmail.com` returned no host IP (email is invalid input for dmitry, which requires domains/IPs).
5. **HIBP**: Blocked by Cloudflare on curl/browser tools. Manual check required at https://haveibeenpwned.com/.

### Successful Commands
- `whois hotmail.com`: Returned Microsoft domain registration details (Azure DNS, registrar abuse contact).
- `dnsrecon -d hotmail.com -t std`: Enumerated NS, MX, TXT, DMARC records successfully.
- `robin-search "moeyahia hotmail"`: Returned no direct dark web hits (exit 0).
- `robin-scrape` on LeakNDI/Abacus Market: Scraped leak listings (paywalled, no direct target match).