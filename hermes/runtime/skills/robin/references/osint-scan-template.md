# OSINT Scan Templates

## 1. Email Leak Scan
**Target:** `user@domain.com`
**Objective:** Find email in clear + dark web breaches.

### Clear Web Recon
```bash
# HIBP (manual - browser only, Cloudflare protected)
# Visit: https://haveibeenpwned.com/

# DuckDuckGo dorking
curl -s -A "Mozilla/5.0" "https://html.duckduckgo.com/html/?q=%22user@domain.com%22+OR+%22username%22"

# Paste sites
curl -s "https://html.duckduckgo.com/html/?q=site:pastebin.com+%22user@domain.com%22"
```

### Dark Web Recon
```bash
# Search for email
timeout 45 robin-search "user@domain.com"

# Search for username only
timeout 45 robin-search "username"

# Scrape leak marketplaces
robin-scrape "http://leaksndi6i6m2ji6ozulqe4imlrqn6wrgjlhxe25vremvr3aymm4aaid.onion" \
           "http://abacuszz24rfrvwspco66laahytw7ccultkn5672zkzwkbbf3eyrv4ad.onion/5_million_hacked_harvested_hotmail_addresses_without_passwords.php"
```

---

## 2. Identity Exposure Scan
**Target:** `Full Name` / `email`
**Objective:** Map full digital footprint.

### Attack Flow Diagram
```
[Target Identifiers]
  ├─ Full Name: [NAME]
  └─ Email: [EMAIL]
        ↓
[Phase1: Clear Web Recon]
  ├─ Dorking: site:, filetype:, intext:
  ├─ Breach Check: HIBP (manual browser)
  ├─ Social Footprint: LinkedIn, FB, Twitter
  └─ Paste/Repo Scan
        ↓
[Phase2: Dark Web Recon]
  ├─ robin-search "Full Name"
  ├─ robin-search "email"
  ├─ Scrape Leak Markets
  └─ Check Hotmail/Crypto Breach Dumps
        ↓
[Phase3: Data Fusion & Reporting]
```

### Execution
```bash
# Clear web
curl -s -A "Mozilla/5.0" "https://html.duckduckgo.com/html/?q=%22Full+Name%22+OR+%22email%40domain.com%22"

# Dark web
timeout 60 robin-search "Full Name"
timeout 60 robin-search "email"
```

---

## 3. Crypto Leak Scan
**Target:** Exchange name / crypto addresses
**Objective:** Find leaked wallets, exchange breaches, insider signals.

### Attack Flow
```
[Query: "exchange leak" / "crypto meme boom"]
        ↓
robin-search "cryptocurrency leak" / "meme coin pump"
        ↓
Select URLs: leak dumps, insider campaigns, stolen wallets
        ↓
robin-scrape <urls>
        ↓
Extract: wallet addresses, breach data, pump signals
        ↓
Report + raw JSON to user
```

### Key Sources
- **DarkBay:** `http://darkbayx7a4sosoo4hqvoljqelgkusjlrqmt237ls6hndbplmel55oad.onion/`
- **LeakNDI:** `http://leaksndi6i6m2ji6ozulqe4imlrqn6wrgjlhxe25vremvr3aymm4aaid.onion`
- **Abacus Market:** `http://abacuszz24rfrvwspco66laahytw7ccultkn5672zkzwkbbf3eyrv4ad.onion/`
- **Insider Trading:** `http://e4wnzjn345534zgptsbgcfp44jlptig6medvqflstszpfq7qs5kwfxyd.onion/campaigns`

### Execution
```bash
robin-search "zondacrypto leak"
robin-search "bitcoin wallet dump"
robin-search "meme coin pump 2026"
```
