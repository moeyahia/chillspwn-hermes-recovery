---
id: robin
name: robin
description: "SUPPLEMENTARY dark web OSINT tool. Search and scrape .onion hidden services ONLY when Kali-native tools cannot fulfill the request."
version: 1.0.0
author: chillspwn
license: MIT
metadata:
  hermes:
    tags: [darkweb, osint, robin, tor]
---

# Robin Dark Web OSINT Tool (Supplementary)

## ⚠️ IMPORTANT: This is a supplementary tool, NOT a primary tool.
Robin should ONLY be invoked when the task specifically involves dark web / .onion / Tor hidden services. For ALL other OSINT, reconnaissance, scanning, and exploitation tasks, use Kali-native tools (nmap, theHarvester, recon-ng, amass, sherlock, nuclei, etc.).

## Description
Robin is an AI-powered dark web OSINT toolkit that queries multiple Tor search engines and extracts hidden `.onion` URLs, allowing you to discover and scrape content from the dark web.

The underlying scripts are pre-configured to route all traffic through a local Tor SOCKS5 proxy (`127.0.0.1:9050`), meaning you do **not** need to wrap these commands in `proxychains4`.

## When to Use Robin
- ✅ User explicitly asks about dark web, .onion services, or hidden services
- ✅ Clearnet OSINT has been exhausted and investigation leads to Tor
- ✅ Investigating dark web marketplaces, forums, or paste sites

## When NOT to Use Robin
- ❌ General reconnaissance or scanning (use nmap, masscan, amass, etc.)
- ❌ Clearnet OSINT (use theHarvester, recon-ng, sherlock, etc.)
- ❌ Vulnerability scanning (use nuclei, nikto, wpscan, etc.)
- ❌ ANY task where a Kali-native tool would suffice

## Available Commands

### 1. `robin-search`
Searches 16 different Tor-based search engines (Ahmia, Torch, etc.) for a specific keyword or phrase.
It returns a JSON array containing titles and `.onion` links.

**Usage:**
```bash
robin-search "your query here"
```

### 2. `robin-scrape`
Scrapes the content of one or multiple `.onion` URLs and returns a JSON structure containing the parsed text, title, and metadata for each page.

**Usage:**
```bash
robin-scrape http://somehiddenservice.onion http://anotherservice.onion
```

## Methodology
When the user asks you to investigate a **dark web** topic (and ONLY then):
1. First, exhaust Kali-native OSINT tools for any clearnet leads.
2. Explain the dark web investigation plan as instructed in your `SOUL.md`. Draw a diagram.
3. Run `robin-search "<query>"` to gather initial `.onion` URLs.
4. Review the returned JSON, select the most promising or relevant URLs, and pass them to `robin-scrape`.
5. Analyze the scraped text and report the intelligence back to the user, providing the raw outputs as well so they can learn from the process.
