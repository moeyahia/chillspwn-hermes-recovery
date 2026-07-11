#!/usr/bin/env python3
# fix_newlines.py — repair double-escaped \n/\t in report JSONs.
# Agents wrote "\\n" in JSON (decodes to literal backslash-n) where they meant a real
# newline, so code/evidence rendered as one giant unreadable line. Convert the literal
# backslash-n (Python '\\n') back to a real newline in the code/output fields.
# Windows boxes: convert ONLY \n (skip \t/\r to protect \temp \root \test \tools \reg paths).
import glob, json, os
WINDOWS={'lock','10.129.230.181','10.129.245.130'}
FIELDS=('exploit_code','evidence','expected_output','description')
fixed=[]
for js in sorted(glob.glob("/root/htb/boxes/*/report/report_data.json")):
    box=js.split('/boxes/')[1].split('/')[0]
    try: d=json.load(open(js))
    except Exception: continue
    if not isinstance(d,dict): continue
    changed=0
    for f in d.get('findings',[]):
        if not isinstance(f,dict): continue
        for fld in FIELDS:
            v=f.get(fld)
            if not isinstance(v,str) or '\\n' not in v: continue
            nv=v.replace('\\r\\n','\n').replace('\\n','\n')      # \n always -> newline
            if box not in WINDOWS:
                nv=nv.replace('\\t','\t').replace('\\r','')       # tabs/CR only on Linux boxes
            if nv!=v:
                f[fld]=nv; changed+=1
    if changed:
        json.dump(d, open(js,'w'), indent=2, ensure_ascii=False)
        fixed.append((box,changed))
        print(f"  fixed {box:42s} {changed} field(s)")
print(f"\nTotal JSONs fixed: {len(fixed)}")
