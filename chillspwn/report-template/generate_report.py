#!/usr/bin/env python3
"""
HustleArmyKnife — Pentest Report Generator

Fills the HTML report template with engagement data and outputs a complete HTML report.

Usage:
    python3 generate_report.py --data report_data.json
    python3 generate_report.py --data report_data.json --output report.html

No external dependencies required — uses only Python standard library.
"""

import argparse
import html
import json
import os
import re
from pathlib import Path


def load_template(template_path: str) -> str:
    """Load the HTML template file."""
    with open(template_path, "r", encoding="utf-8") as f:
        return f.read()


def load_data(data_path: str) -> dict:
    """Load the JSON data file with engagement details."""
    with open(data_path, "r", encoding="utf-8") as f:
        return json.load(f)


def fill_placeholders(html: str, data: dict) -> str:
    """
    Replace all {{PLACEHOLDER}} tokens in the HTML with values from data.
    Supports nested keys via dot notation: {{meta.client}} -> data["meta"]["client"]
    """
    def resolve_key(key: str, data: dict):
        parts = key.strip().split(".")
        val = data
        for part in parts:
            if isinstance(val, dict) and part in val:
                val = val[part]
            else:
                return None
        return str(val) if val is not None else None

    def replacer(match):
        key = match.group(1)
        resolved = resolve_key(key, data)
        if resolved is not None:
            return resolved
        return match.group(0)

    return re.sub(r"\{\{(\S+?)\}\}", replacer, html)


def build_findings_html(findings: list) -> str:
    """Generate HTML blocks for each finding from the data."""
    blocks = []
    for f in findings:
        severity = f.get("severity", "info").lower()
        title = f.get("title", "Untitled Finding")
        cvss = f.get("cvss", "N/A")
        # Intigriti triage fields — added so every finding carries a defensible
        # CVSS vector + rationale per kb.intigriti.com/en/articles/10335710.
        cvss_vector = f.get("cvss_vector", "")
        cvss_version = f.get("cvss_version", "3.1")
        scoring_rationale = f.get("scoring_rationale", "")
        triage_status = f.get("triage_status", "")
        intigriti_class = f.get("intigriti_class", "")
        description = f.get("description", "")
        # HTML-escape every monospace/code field: shell metacharacters (< > & | <<EOF,
        # 2>&1, redirects) would otherwise inject raw markup and shatter the <pre><code>
        # block. html.escape leaves newlines intact, so <pre> formatting is preserved.
        evidence = html.escape(f.get("evidence", ""))
        steps = f.get("reproduction_steps", [])
        exploit_code = html.escape(f.get("exploit_code", ""))
        exploit_lang = f.get("exploit_language", "Python 3")
        exploit_file = f.get("exploit_filename", "exploit.py")
        exploit_usage = html.escape(f.get("exploit_usage", ""))
        expected_output = html.escape(f.get("expected_output", ""))
        remediations = f.get("remediation", [])

        steps_html = ""
        for i, step in enumerate(steps, 1):
            steps_html += f'<p><strong>Step {i}:</strong> {step}</p>\n'

        exploit_html = ""
        if exploit_code:
            exploit_html = f"""
                    <div class="finding-subsection">
                        <h4 class="finding-subsection-title">Working Exploit Code</h4>
                        <p>⚠️ <strong style="color: var(--neon-red);">WARNING:</strong>
                            <em>This code is provided for authorized security testing only.</em>
                        </p>
                        <div class="code-block">
                            <div class="code-header">
                                <span class="code-language">{exploit_lang}</span>
                                <span class="code-filename">{exploit_file}</span>
                            </div>
                            <pre><code>{exploit_code}</code></pre>
                        </div>
                        {f'<p><strong>Usage:</strong> <code>{exploit_usage}</code></p>' if exploit_usage else ''}
                        {f'<p style="margin-top: 10px;"><strong>Expected Output:</strong></p><div class="code-block"><div class="code-header"><span class="code-language">Output</span></div><pre><code>{expected_output}</code></pre></div>' if expected_output else ''}
                    </div>"""

        evidence_html = ""
        if evidence:
            evidence_html = f"""
                    <div class="finding-subsection">
                        <h4 class="finding-subsection-title">Evidence</h4>
                        <div class="code-block">
                            <div class="code-header">
                                <span class="code-language">Output</span>
                            </div>
                            <pre><code>{evidence}</code></pre>
                        </div>
                    </div>"""

        # Intigriti scoring block — surfaces CVSS vector + rationale + triage
        # classification so reviewers can audit the severity assignment.
        scoring_html = ""
        if cvss_vector or scoring_rationale or intigriti_class or triage_status:
            # Build inner rows only for fields that are populated to keep the
            # block tight when only partial data is available.
            rows = []
            if cvss_vector:
                rows.append(
                    f'<p><strong>CVSSv{cvss_version} Vector:</strong> '
                    f'<code>{cvss_vector}</code></p>'
                )
            if intigriti_class:
                rows.append(
                    f'<p><strong>Intigriti Classification:</strong> {intigriti_class}</p>'
                )
            if triage_status:
                rows.append(
                    f'<p><strong>Triage Status:</strong> {triage_status}</p>'
                )
            if scoring_rationale:
                rows.append(
                    f'<p><strong>Scoring Rationale:</strong> {scoring_rationale}</p>'
                )
            scoring_html = f"""
                    <div class="finding-subsection">
                        <h4 class="finding-subsection-title">Severity Scoring (Intigriti Triage Standards)</h4>
                        {''.join(rows)}
                    </div>"""

        icons = ["🔧", "🛡️", "📋", "⚡", "🔒"]
        remed_html = ""
        for i, rem in enumerate(remediations):
            icon = icons[i % len(icons)]
            remed_html += f"""
                        <div class="remediation-item">
                            <span class="remediation-icon">{icon}</span>
                            <span class="remediation-text">{rem}</span>
                        </div>"""

        block = f"""
            <div class="finding">
                <div class="finding-header">
                    <span class="severity-badge {severity}">{severity.upper()}</span>
                    <span class="finding-title">{title}</span>
                    <span class="finding-cvss">CVSS {cvss}</span>
                </div>
                <div class="finding-body">
                    <div class="finding-subsection">
                        <h4 class="finding-subsection-title">Description</h4>
                        <p>{description}</p>
                    </div>
                    {scoring_html}
                    {evidence_html}
                    <div class="finding-subsection">
                        <h4 class="finding-subsection-title">Reproduction Steps</h4>
                        {steps_html}
                    </div>
                    {exploit_html}
                    <div class="finding-subsection">
                        <h4 class="finding-subsection-title">Remediation</h4>
                        {remed_html}
                    </div>
                </div>
            </div>"""
        blocks.append(block)

    return "\n".join(blocks)


def build_risk_grid(findings: list) -> str:
    """Generate the risk overview grid from findings data."""
    counts = {"critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0}
    for f in findings:
        sev = f.get("severity", "info").lower()
        if sev in counts:
            counts[sev] += 1

    cards = ""
    for sev, count in counts.items():
        cards += f"""
                <div class="risk-card {sev}">
                    <div class="risk-count">{count}</div>
                    <div class="risk-label">{sev.capitalize()}</div>
                </div>"""

    return f'<div class="risk-grid">{cards}\n            </div>'


def build_tools_table(tools: list) -> str:
    """Generate the tools table rows."""
    rows = ""
    for t in tools:
        rows += f"""
                        <tr>
                            <td>{t.get('name', '')}</td>
                            <td><code>{t.get('version', '')}</code></td>
                            <td>{t.get('purpose', '')}</td>
                        </tr>"""
    return rows


def build_attack_chain(chain: list) -> str:
    """Generate the attack chain visualization."""
    nodes = []
    for i, step in enumerate(chain):
        node = f"""
                    <div class="chain-node">
                        <div class="chain-node-label">Phase {i + 1}</div>
                        <div class="chain-node-desc">{step}</div>
                    </div>"""
        nodes.append(node)

    return '<div class="attack-chain">' + \
        '\n                    <div class="chain-arrow">→</div>'.join(nodes) + \
        '\n                </div>'


def build_scope_table(assets: list) -> str:
    """Generate the scope/assets table rows."""
    rows = ""
    for a in assets:
        status_color = "var(--neon-green)" if a.get("tested", True) else "var(--neon-red)"
        status_text = "● Tested" if a.get("tested", True) else "○ Not Tested"
        rows += f"""
                        <tr>
                            <td>{a.get('name', '')}</td>
                            <td>{a.get('type', '')}</td>
                            <td><code>{a.get('ip', '')}</code></td>
                            <td style="color: {status_color};">{status_text}</td>
                        </tr>"""
    return rows


def generate_full_html(template_html: str, data: dict) -> str:
    """
    Build the complete report HTML by:
    1. Injecting dynamic sections (findings, risk grid, tools, attack chain)
    2. Filling simple placeholders
    """
    html = template_html

    if "findings" in data:
        findings_html = build_findings_html(data["findings"])
        html = html.replace("<!-- FINDINGS_PLACEHOLDER -->", findings_html)

        risk_html = build_risk_grid(data["findings"])
        html = html.replace("<!-- RISK_GRID_PLACEHOLDER -->", risk_html)

    if "attack_chain" in data:
        chain_html = build_attack_chain(data["attack_chain"])
        html = html.replace("<!-- ATTACK_CHAIN_PLACEHOLDER -->", chain_html)

    if "tools" in data:
        tools_html = build_tools_table(data["tools"])
        html = html.replace("<!-- TOOLS_PLACEHOLDER -->", tools_html)

    if "assets" in data:
        scope_html = build_scope_table(data["assets"])
        html = html.replace("<!-- SCOPE_PLACEHOLDER -->", scope_html)

    html = fill_placeholders(html, data)

    return html


def main():
    parser = argparse.ArgumentParser(
        description="HustleArmyKnife — Pentest Report Generator"
    )
    parser.add_argument(
        "--template", "-t",
        default=str(Path(__file__).parent / "report-template.html"),
        help="Path to the HTML template (default: report-template.html)"
    )
    parser.add_argument(
        "--data", "-d",
        required=True,
        help="Path to JSON data file with engagement details"
    )
    parser.add_argument(
        "--output", "-o",
        default="report.html",
        help="Output HTML filename (default: report.html)"
    )
    args = parser.parse_args()

    print(f"[*] Loading template: {args.template}")
    template_html = load_template(args.template)

    print(f"[*] Loading data: {args.data}")
    data = load_data(args.data)

    filled_html = generate_full_html(template_html, data)

    with open(args.output, "w", encoding="utf-8") as f:
        f.write(filled_html)
    print(f"[+] Report saved: {args.output} ({os.path.getsize(args.output):,} bytes)")


if __name__ == "__main__":
    main()
