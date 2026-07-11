#!/usr/bin/env python3
# fix_quotes.py — remove the residual double-escaped quote artifact (\" -> ") in code
# fields. JSON-escapable quotes got double-escaped by agents, so code shows  rm -rf \"$X\"
# instead of  rm -rf "$X". Safe: intentional \" in these reconstructed exploits is negligible.
import glob, json
FIELDS=('exploit_code','evidence','expected_output')
fixed=[]
for js in sorted(glob.glob("/root/htb/boxes/*/report/report_data.json")):
    box=js.split('/boxes/')[1].split('/')[0]
    try: d=json.load(open(js))
    except Exception: continue
    if not isinstance(d,dict): continue
    n=0
    for f in d.get('findings',[]):
        if not isinstance(f,dict): continue
        for fld in FIELDS:
            v=f.get(fld)
            if isinstance(v,str) and '\\"' in v:
                nv=v.replace('\\"','"')
                if nv!=v: f[fld]=nv; n+=1
    if n:
        json.dump(d,open(js,'w'),indent=2,ensure_ascii=False); fixed.append((box,n))
print("quote-fixed:", ", ".join(f"{b}({n})" for b,n in fixed) or "none")
