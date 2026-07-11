#!/usr/bin/env python3
# embed_logos.py <report.html> [report.html ...]
# Makes report HTML fully self-contained by replacing every logo <img src> that
# points at assets/Logo.svg or assets/smallLogo.png (relative OR file:// absolute)
# with an inline base64 data URI. Portable: logos render anywhere the HTML opens.
import sys, base64, re, os

ASSETS = "/root/report-template/assets"
def data_uri(fn, mime):
    with open(os.path.join(ASSETS, fn), "rb") as f:
        return "data:%s;base64,%s" % (mime, base64.b64encode(f.read()).decode())

SVG = data_uri("Logo.svg", "image/svg+xml")
PNG = data_uri("smallLogo.png", "image/png")

# match any src that ends in the asset filename, with optional path/scheme prefix
pat_svg = re.compile(r'src="(?:[^"]*?/)?(?:file:///[^"]*?)?assets/Logo\.svg"')
pat_png = re.compile(r'src="(?:[^"]*?/)?(?:file:///[^"]*?)?assets/smallLogo\.png"')
# also catch the already-rewritten file:// absolute form
pat_svg2 = re.compile(r'src="file:///root/report-template/assets/Logo\.svg"')
pat_png2 = re.compile(r'src="file:///root/report-template/assets/smallLogo\.png"')

for path in sys.argv[1:]:
    h = open(path, encoding="utf-8").read()
    n = 0
    for pat, uri in ((pat_svg, SVG), (pat_svg2, SVG), (pat_png, PNG), (pat_png2, PNG)):
        h, c = pat.subn('src="%s"' % uri, h)
        n += c
    open(path, "w", encoding="utf-8").write(h)
    print(f"[+] {path}: embedded {n} logo refs ({os.path.getsize(path):,} bytes)")
