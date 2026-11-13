#!/usr/bin/env python3
# make_mod2.py <sandbox X> <script text file> [target]: like make_mod.py, with MZX0 back-references so long repetitive scenes fit the slot.
import sys, struct, os
ROOT=os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../..'))
sys.path.insert(0, ROOT+'/web-research/tools')
import mzx
X, src = sys.argv[1], sys.argv[2]
target = sys.argv[3] if len(sys.argv) > 3 else '00_00'
d = bytearray(open(os.environ.get('BASE_SCR', ROOT+'/mods/japan/_update_v131072/romfs/allscr.mrg'),'rb').read())
ents = mzx.mrgd(bytes(d))
nb = bytes(d[ents[0][0]:ents[0][1]])
names = [nb[i:i+32].split(b'\r\n')[0].split(b'\0')[0].decode('latin1') for i in range(0, len(nb), 32)]
names = [n for n in names if n]
idx = names.index(target)
o, e = ents[3+idx]
text = open(src,'rb').read().strip()
if not text.endswith(b'_END_();'): text += b'_RTM_();_END_();'
inv = bytes(c ^ 0xFF for c in text)
if len(inv) % 2: inv += b'\xff'
words = [inv[i:i+2] for i in range(0, len(inv), 2)]
n = len(words)
out = bytearray(b'MZX0' + struct.pack('<I', len(text)))
lit = []
def flush():
    global lit
    while lit:
        chunk = lit[:64]; lit = lit[64:]
        out.append(((len(chunk)-1) << 2) | 3)
        for w in chunk: out.extend(w)
# hash of word pairs -> recent positions
from collections import defaultdict, deque
pos = defaultdict(lambda: deque(maxlen=8))
i = 0
while i < n:
    best_len, best_d = 0, 0
    if i + 1 < n:
        for j in reversed(pos[(words[i], words[i+1])]):
            dist = i - j
            if dist > 256: break
            l = 0
            while l < 64 and i + l < n and words[j + l] == words[i + l]: l += 1
            if l > best_len: best_len, best_d = l, dist
    if best_len >= 2:
        flush()
        out.append(((best_len-1) << 2) | 1)
        out.append(best_d - 1)
        for k in range(i, i + best_len):
            if k + 1 < n: pos[(words[k], words[k+1])].append(k)
        i += best_len
    else:
        lit.append(words[i])
        if i + 1 < n: pos[(words[i], words[i+1])].append(i)
        i += 1
flush()
assert len(out) <= e-o, (len(out), e-o)
d[o:o+len(out)] = out
os.makedirs(f'{X}/mods/japan/zz_test/romfs', exist_ok=True)
open(f'{X}/mods/japan/zz_test/romfs/allscr.mrg','wb').write(d)
chk = mzx.mzx(bytes(d[o:e]))
assert bytes(c ^ 0xFF for c in chk) == text, (len(chk), len(text))
print('ok, script bytes', len(text), 'blob bytes', len(out), 'slot', e-o)
