#!/usr/bin/env python3
"""
ChillsPwn — OSINT Report Generator

Builds a rich HTML report from an OSINT job's findings.json + raw/ directory.

Usage:
    python3 generate_osint_report.py --data findings.json --raw-dir raw/ --output report.html
"""

import argparse
import datetime
import html
import json
import os
import re
import sys
from pathlib import Path


def esc(s):
    """HTML escape, treating None as empty."""
    if s is None:
        return ""
    return html.escape(str(s))


def load_template(path):
    return Path(path).read_text(encoding="utf-8")


def load_data(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


# ──────────────────────────────────────────────────────────
# Section builders
# ──────────────────────────────────────────────────────────

def build_chip_list(items, cls="accent"):
    if not items:
        return '<div class="empty">No entries discovered.</div>'
    chips = "".join(f'<span class="chip {cls}">{esc(i)}</span>' for i in items if i)
    return f'<div class="chip-list">{chips}</div>'


def build_table(rows, headers):
    if not rows:
        return '<div class="empty">No data available.</div>'
    thead = "".join(f"<th>{esc(h)}</th>" for h in headers)
    tbody = ""
    for row in rows:
        cells = "".join(f"<td>{esc(c)}</td>" for c in row)
        tbody += f"<tr>{cells}</tr>"
    return f'<table class="data-table"><thead><tr>{thead}</tr></thead><tbody>{tbody}</tbody></table>'


def build_infrastructure(infra):
    if not infra:
        return '<div class="empty">No infrastructure data collected.</div>'
    out = []

    domains = infra.get("domains") or []
    subdomains = infra.get("subdomains") or []
    ips = infra.get("ips") or []
    mail = infra.get("mail_servers") or []
    ns = infra.get("name_servers") or []
    certs = infra.get("ssl_certs") or []
    ports = infra.get("open_ports") or []
    techs = infra.get("technologies") or []

    if domains:
        out.append('<div class="subsection"><div class="subsection-title">Apex Domains</div>')
        out.append(build_chip_list(domains, "accent"))
        out.append('</div>')

    if subdomains:
        out.append('<div class="subsection"><div class="subsection-title">'
                   f'Subdomains ({len(subdomains)})</div>')
        out.append(build_chip_list(subdomains, "accent"))
        out.append('</div>')

    if ips:
        ip_rows = []
        for ip in ips:
            if isinstance(ip, dict):
                ip_rows.append([
                    ip.get("address", ""),
                    ip.get("asn", ""),
                    ip.get("country", ""),
                    ip.get("org", ""),
                    ip.get("reverse_dns", "")
                ])
            else:
                ip_rows.append([ip, "", "", "", ""])
        out.append('<div class="subsection"><div class="subsection-title">'
                   f'IP Addresses ({len(ips)})</div>')
        out.append(build_table(ip_rows, ["IP", "ASN", "Country", "Org", "Reverse DNS"]))
        out.append('</div>')

    if mail or ns:
        out.append('<div class="subsection"><div class="subsection-title">DNS Records</div>')
        if mail:
            out.append('<p style="font-size:11px;color:var(--text-muted);margin-bottom:6px;">Mail servers (MX)</p>')
            out.append(build_chip_list(mail))
        if ns:
            out.append('<p style="font-size:11px;color:var(--text-muted);margin:12px 0 6px;">Name servers (NS)</p>')
            out.append(build_chip_list(ns))
        out.append('</div>')

    if ports:
        port_rows = []
        for p in ports:
            if isinstance(p, dict):
                port_rows.append([
                    p.get("host", ""),
                    p.get("port", ""),
                    p.get("protocol", "tcp"),
                    p.get("service", ""),
                    p.get("version", ""),
                ])
            else:
                port_rows.append([str(p), "", "", "", ""])
        out.append('<div class="subsection"><div class="subsection-title">'
                   f'Open Ports &amp; Services ({len(ports)})</div>')
        out.append(build_table(port_rows, ["Host", "Port", "Proto", "Service", "Version"]))
        out.append('</div>')

    if techs:
        out.append('<div class="subsection"><div class="subsection-title">'
                   f'Technologies Detected ({len(techs)})</div>')
        out.append(build_chip_list(techs))
        out.append('</div>')

    if certs:
        cert_rows = []
        for c in certs:
            if isinstance(c, dict):
                cert_rows.append([
                    c.get("subject", ""),
                    c.get("issuer", ""),
                    c.get("valid_from", ""),
                    c.get("valid_to", ""),
                    ", ".join(c.get("san", [])) if isinstance(c.get("san"), list) else c.get("san", ""),
                ])
            else:
                cert_rows.append([str(c), "", "", "", ""])
        out.append('<div class="subsection"><div class="subsection-title">'
                   f'SSL/TLS Certificates ({len(certs)})</div>')
        out.append(build_table(cert_rows, ["Subject", "Issuer", "Valid From", "Valid To", "SAN"]))
        out.append('</div>')

    if not out:
        return '<div class="empty">No infrastructure data collected.</div>'
    return "".join(out)


def build_people(people):
    if not people:
        return '<div class="empty">No people/identity data discovered.</div>'
    out = []
    for key, label, cls in [
        ("emails", "Email Addresses", "accent"),
        ("names", "Names", "accent"),
        ("usernames", "Usernames", "accent"),
        ("social_profiles", "Social Profiles", "accent"),
    ]:
        items = people.get(key) or []
        if items:
            display_items = []
            for item in items:
                if isinstance(item, dict):
                    # social_profiles often have {"platform": "...", "url": "..."}
                    display_items.append(f"{item.get('platform','?')}: {item.get('url') or item.get('handle','')}")
                else:
                    display_items.append(item)
            out.append(f'<div class="subsection"><div class="subsection-title">{label} ({len(display_items)})</div>')
            out.append(build_chip_list(display_items, cls))
            out.append('</div>')
    return "".join(out) or '<div class="empty">No people/identity data discovered.</div>'


def build_organization(org):
    if not org or not any(org.values()):
        return '<div class="empty">No organization data collected.</div>'
    rows = []
    for k, v in org.items():
        if v:
            label = k.replace("_", " ").title()
            rows.append([label, v])
    return build_table(rows, ["Field", "Value"])


def build_exposure(exp):
    if not exp:
        return '<div class="empty">No public-exposure data found.</div>'
    out = []
    leaked_creds = exp.get("leaked_credentials") or []
    exposed_files = exp.get("exposed_files") or []
    buckets = exp.get("open_buckets") or []
    gh_secrets = exp.get("github_secrets") or []
    breaches = exp.get("data_breach_mentions") or []

    if leaked_creds:
        out.append(f'<div class="subsection"><div class="subsection-title">Leaked Credentials ({len(leaked_creds)})</div>')
        out.append(build_chip_list(leaked_creds, "danger"))
        out.append('</div>')
    if exposed_files:
        out.append(f'<div class="subsection"><div class="subsection-title">Exposed Files ({len(exposed_files)})</div>')
        out.append(build_chip_list(exposed_files, "warn"))
        out.append('</div>')
    if buckets:
        out.append(f'<div class="subsection"><div class="subsection-title">Open Buckets ({len(buckets)})</div>')
        out.append(build_chip_list(buckets, "danger"))
        out.append('</div>')
    if gh_secrets:
        out.append(f'<div class="subsection"><div class="subsection-title">GitHub Secrets ({len(gh_secrets)})</div>')
        out.append(build_chip_list(gh_secrets, "danger"))
        out.append('</div>')
    if breaches:
        out.append(f'<div class="subsection"><div class="subsection-title">Data Breach Mentions ({len(breaches)})</div>')
        out.append(build_chip_list(breaches, "warn"))
        out.append('</div>')

    return "".join(out) or '<div class="empty">No public-exposure data found.</div>'


def build_darkweb(items):
    if not items:
        return '<div class="empty">No dark web mentions discovered (or dark web scan not in scope).</div>'
    rows = []
    for x in items:
        if isinstance(x, dict):
            rows.append([
                x.get("source", x.get("site", "?")),
                x.get("url", ""),
                x.get("title", x.get("snippet", "")),
                x.get("date", ""),
            ])
        else:
            rows.append([str(x), "", "", ""])
    return build_table(rows, ["Source", "URL", "Title / Snippet", "Date"])


def build_pivot_cards(items, css_class="pivot-card"):
    if not items:
        return '<div class="empty">None identified.</div>'
    return "".join(f'<div class="{css_class}">{esc(x)}</div>' for x in items)


def build_raw_output(raw_dir):
    """Embed raw tool output files as collapsible blocks."""
    if not raw_dir or not raw_dir.exists():
        return '<div class="empty">No raw tool output captured. (Skill did not save to raw/ directory.)</div>'

    blocks = []
    files = sorted(raw_dir.iterdir(), key=lambda p: p.name.lower())
    for f in files:
        if not f.is_file():
            continue
        try:
            content = f.read_text(encoding="utf-8", errors="replace")
        except Exception as e:
            content = f"[Failed to read {f.name}: {e}]"

        size = f.stat().st_size
        size_str = f"{size}B" if size < 1024 else f"{size/1024:.1f}K" if size < 1024*1024 else f"{size/1024/1024:.1f}M"

        # Cap content for sanity (huge nmap XMLs etc.)
        if len(content) > 80000:
            content = content[:80000] + f"\n\n[... truncated — full file is {size_str} ...]"

        # Use <details> for native collapse
        blocks.append(f'''
        <details class="raw-tool" open>
            <summary class="raw-tool-header" style="list-style:none;">
                <span class="raw-tool-name">▾ {esc(f.name)}</span>
                <span class="raw-tool-size">{size_str}</span>
            </summary>
            <pre class="raw-tool-body">{esc(content)}</pre>
        </details>''')

    if not blocks:
        return '<div class="empty">raw/ directory exists but is empty.</div>'
    return "".join(blocks)


def build_stats_grid(data):
    """Build a stat-grid from key counts."""
    infra = data.get("infrastructure") or {}
    people = data.get("people") or {}
    exposure = data.get("exposure") or {}

    cells = [
        ("Subdomains", len(infra.get("subdomains") or [])),
        ("IPs", len(infra.get("ips") or [])),
        ("Open Ports", len(infra.get("open_ports") or [])),
        ("Emails", len(people.get("emails") or [])),
        ("Identities", len(people.get("usernames") or []) + len(people.get("social_profiles") or [])),
        ("Exposures", sum(len(exposure.get(k) or []) for k in ["leaked_credentials","exposed_files","open_buckets","github_secrets","data_breach_mentions"])),
        ("Dark Web Hits", len(data.get("dark_web") or [])),
        ("Pivot Points", len(data.get("anomalies_or_pivots") or [])),
    ]
    html_out = ""
    for label, value in cells:
        html_out += f'''
        <div class="stat-card">
            <div class="stat-card-label">{esc(label)}</div>
            <div class="stat-card-value">{value}</div>
        </div>'''
    return html_out


def fill_placeholders(html_template, mapping):
    for k, v in mapping.items():
        html_template = html_template.replace("{{" + k + "}}", v)
    return html_template


def main():
    configured_template_dir = os.environ.get(
        "CHILLSPWN_REPORT_TEMPLATE_DIR",
        "/opt/chillspwn/report-template",
    )
    if not os.path.isabs(configured_template_dir):
        raise SystemExit("CHILLSPWN_REPORT_TEMPLATE_DIR must be an absolute path")
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", required=True, help="Path to findings.json")
    parser.add_argument("--raw-dir", help="Path to raw/ directory of tool outputs")
    parser.add_argument("--output", required=True, help="Output HTML path")
    parser.add_argument(
        "--template",
        default=str(Path(configured_template_dir).resolve() / "osint-template.html"),
    )
    args = parser.parse_args()

    data = load_data(args.data)
    tpl = load_template(args.template)
    raw_dir = Path(args.raw_dir) if args.raw_dir else None

    # Compute mapping
    target = data.get("target", "(unknown)")
    target_type = data.get("target_type") or data.get("targetType") or "(unspecified)"
    scope = data.get("scope", "(unspecified)")
    summary = data.get("summary", "No executive summary generated.")
    tools = data.get("tools_run") or []
    findings_count = sum(len(data.get(k) or []) for k in ["infrastructure", "people", "exposure"])

    mapping = {
        "TARGET": esc(target),
        "TARGET_TYPE": esc(target_type),
        "SCOPE": esc(scope),
        "DATE": datetime.datetime.now().strftime("%B %d, %Y · %H:%M"),
        "ASSESSOR": esc(data.get("assessor", "ChillsPwn")),
        "TOOLS_COUNT": str(len(tools)),
        "FINDINGS_COUNT": str(findings_count + sum(len(data.get(k) or []) for k in ["dark_web", "anomalies_or_pivots"])),
        "SUMMARY": esc(summary).replace("\n", "<br>"),
        "STATS_GRID": build_stats_grid(data),
        "INFRA_HTML": build_infrastructure(data.get("infrastructure") or {}),
        "PEOPLE_HTML": build_people(data.get("people") or {}),
        "ORG_HTML": build_organization(data.get("organization") or {}),
        "EXPOSURE_HTML": build_exposure(data.get("exposure") or {}),
        "DARKWEB_HTML": build_darkweb(data.get("dark_web") or []),
        "ANOMALIES_HTML": build_pivot_cards(data.get("anomalies_or_pivots") or []),
        "NEXTSTEPS_HTML": build_pivot_cards(data.get("next_steps_suggested") or [], "pivot-card next-step"),
        "RAW_OUTPUT_HTML": build_raw_output(raw_dir),
    }

    output_html = fill_placeholders(tpl, mapping)
    Path(args.output).write_text(output_html, encoding="utf-8")
    print(f"✓ OSINT report generated: {args.output}")
    print(f"  target: {target} · tools: {len(tools)} · raw files: {len(list(raw_dir.iterdir())) if raw_dir and raw_dir.exists() else 0}")


if __name__ == "__main__":
    main()
