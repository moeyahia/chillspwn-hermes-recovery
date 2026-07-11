#!/usr/bin/env python3
# regen_all.py — safely regenerate pentest reports with the now-escaping generator.
# For each box report dir that has report_data.json:
#   1. generate to <html>.new
#   2. if it still has {{...}} or _PLACEHOLDER -> DISCARD .new (keep existing good html), report 'skipped'
#   3. else embed logos into .new, move into place, render PDF, report 'regenerated'
import subprocess, glob, os, re, sys

GEN="/root/report-template/generate_report.py"
EMBED="/root/report-template/embed_logos.py"
BOXES="/root/htb/boxes"

# (report_dir, html_basename)  — html name per box (most are report.html)
targets = [
 ("10.129.234.71","baby_pwn_report.html"),
 ("10.129.244.106","report.html"),("10.129.244.220","report.html"),
 ("10.129.244.96","report.html"),("10.129.245.123","report.html"),
 ("10.129.5.33","report.html"),
 ("conversor","conversor_report.html"),("eighteen","eighteen_report.html"),
 ("Kobold","report.html"),
 ("10.129.229.66","report.html"),("10.129.230.181","report.html"),
 ("10.129.244.156","report.html"),("10.129.4.182","report.html"),
 ("10.129.5.41","report.html"),("expressway","expressway_report.html"),
 ("forgotten","forgotten_report.html"),("10.129.2.99","report.html"),
 ("10.129.2.84","report.html"),("10.129.245.215","report.html"),
 ("10.129.2.63","report.html"),("10.129.1.14","report.html"),
 ("10.129.4.45","report.html"),("target_10.129.244.106","report.html"),
 ("10.129.245.130","report.html"),
 ("soulmate","soulmate_report.html"),
 ("osint-Mohamed_El_Ghossein-1779982280389","report.html"),
]

def run(cmd): return subprocess.run(cmd,capture_output=True,text=True)

for box,htmlname in targets:
    d=os.path.join(BOXES,box,"report")
    js=os.path.join(d,"report_data.json")
    html=os.path.join(d,htmlname)
    pdf=os.path.splitext(html)[0]+".pdf"
    new=html+".new"
    if not os.path.exists(js):
        print(f"{box:42s} NO JSON -> skip"); continue
    r=run(["python3",GEN,"--data",js,"--output",new])
    if r.returncode!=0 or not os.path.exists(new):
        print(f"{box:42s} GEN FAILED -> skip ({r.stderr.strip()[:60]})")
        if os.path.exists(new): os.remove(new)
        continue
    txt=open(new,encoding="utf-8").read()
    leftover=re.findall(r'\{\{[^}]+\}\}|<!-- [A-Z_]+_PLACEHOLDER -->',txt)
    if leftover:
        os.remove(new)
        print(f"{box:42s} SKIP (placeholders: {sorted(set(leftover))[:3]}) — kept existing")
        continue
    # embed logos into the new file, then atomically replace, then render PDF
    run(["python3",EMBED,new])
    os.replace(new,html)
    U=run(["mktemp","-d"]).stdout.strip()
    rp=run(["chromium","--headless","--no-sandbox","--disable-gpu",
            f"--user-data-dir={U}","--no-pdf-header-footer",
            f"--print-to-pdf={pdf}",f"file://{html}"])
    ok=os.path.exists(pdf) and os.path.getsize(pdf)>10000
    print(f"{box:42s} REGEN ok  html={os.path.getsize(html):>8} pdf={os.path.getsize(pdf) if os.path.exists(pdf) else 0:>9}  pdf_ok={ok}")
