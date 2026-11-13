import json, re, os, subprocess
from rows_lib import *
HERE=os.path.dirname(os.path.abspath(__file__))
U=json.load(open('units.json')); units=U['units']
res={}; gxs={}
def read(path):
    for l in open(path):
        if l.startswith('#'): continue
        p=l.rstrip('\n').split('\t'); res[int(p[0][1:])]=bytes.fromhex(p[3]).decode('utf-8')
read('pass1.out')
def last_row_px(buf, k=None):
    items,breaks,_=engine_items(buf)
    st=breaks[-1] if breaks else 0
    w=sum(24.8 if ord(c)<0x100 else 49.6 for c,_ in items[st:])      # a narrow letter is half a cell
    if not breaks and k in gxs: w+=gxs[k]-264.0                      # a glued line still on the row it was glued to
    return w
T=json.load(open('../text_ja.json'))
allrecs=json.load(open('all.json'))
def body(arg):
    m=re.search(r"@[en]",arg)
    return arg[:m.start()] if m else arg
def unit_text(u):
    txt=''
    for oi,arg in u['ops']:
        b=body(arg).replace('@x','').replace('@k','')
        txt+=re.sub(r"\$(\d+)", lambda m: T[int(m[1])], b)
    return txt
def unit_buf(k):
    if k in res: return res[k]
    u=units[k]
    ids=re.findall(r"\$(\d+)", u['ops'][0][1])
    if not u['glued'] and len(u['ops'])==1 and len(ids)==1: return allrecs[str(int(ids[0]))][2]
    return None
todo=[k for k in U['special'] if units[k]['glued']]
passn=2
while todo:
    lines=[]; rest=[]
    for k in todo:
        u=units[k]; pb=unit_buf(u['prev']) if u['prev'] is not None else None
        if u['prev'] is None: gx=264.0
        elif pb is None: rest.append(k); continue
        else: gx=264.0+last_row_px(pb, u['prev'])+2.0
        gxs[k]=gx
        lines.append(f"u{k}\t@x{unit_text(u)}\t{gx:.3f}\n")
    open(f'pass{passn}.tsv','w',encoding='utf-8').write(''.join(lines))
    print("pass",passn,len(lines),"left",len(rest), flush=True)
    subprocess.check_call(['./runbatch.sh', f'{HERE}/pass{passn}.tsv', f'{HERE}/pass{passn}.out'])
    read(f'pass{passn}.out')
    if len(rest)==len(todo): print("stuck", rest[:5]); break
    todo=rest; passn+=1
json.dump({'buf':{str(k):v for k,v in res.items()},'gx':{str(k):v for k,v in gxs.items()}}, open('units_out.json','w'), ensure_ascii=False)
print("unit results", len(res))
