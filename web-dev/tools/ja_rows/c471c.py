"""The engine's break rule (native 0xc471c), transcribed. W: the working text as a list of characters (control codes 0x10 / 0x11 / 0x0a / 0x0c included)."""
T3 = ".,-!?:;！？⁉⁈‼⁇．，。、：；」』）】》”’ー～ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ々"
T2 = "・「『（【“‘"
T1 = T3 + "…―─—Œœ"
A, E, X = set(T3), set(T2), set(T1)
HALF = ('\x10', '\x11')
def single(c): return c != '' and ord(c) < 0x80
def rule(W, p, used, cap, extra=1):
    """-> index in W to break before, or None."""
    n = len(W)
    at = lambda k: W[k] if 0 <= k < n else ''
    n_rem = n - p
    if n_rem < extra:
        if at(p) in A: return None
    d = cap - used
    if cap < used:
        return p + 1 if at(p) in A else p
    if at(p) == ' ': return p + 1
    cur = p
    if d > 0:
        prev = None; prevc = ''
        i = 0
        while True:
            q = cur; c = at(cur); cur += 1 if c != '' else 0
            if c in HALF: return prev if prevc in E else q
            if c == '\n': return q
            if c in E: return q
            i += 1
            if i == d: break
            prev = q; prevc = c
    P0 = cur
    def nxt():
        nonlocal cur
        c = at(cur)
        if c != '': cur += 1
        return c
    ca = nxt()
    if ca in HALF and ca != '': ca = nxt()
    if ca == ' ': return cur
    P1 = cur; cb = nxt()
    pair = ''
    if cb in HALF and cb != '':
        P1 = cur; cb = nxt()
    elif single(cb) and single(ca):
        pair = cb                         # two narrow letters are one cell: the first of them is ca + cb
        P1 = cur; cb = nxt()
        if cb in HALF and cb != '': P1 = cur; cb = nxt()
    cc = nxt()
    if cc in HALF and cc != '': cc = nxt()
    if cb == '\n': return None
    ca_s = ca + pair
    def eq(s, g):                         # strncmp(s, g, len(s)) == 0
        return g.startswith(s)
    a_is_OE = eq(ca_s, 'Œ'); 
    if (a_is_OE and eq(cb, 'Œ')) or (eq(ca_s, 'œ') and eq(cb, 'œ')):
        if extra + d <= n_rem:
            if a_is_OE:
                if cb == '': return cur
            elif eq(ca_s, 'œ') and cb == '': return cur
        if d < 2:
            if eq(cc, 'Œ'): return p
            if eq(cc, 'œ'): return p
            if d == 0: return P0
        if eq(cc, 'Œ'): return P0
        if eq(cc, 'œ'): return P0
    b3 = cc not in X
    b4 = ca_s not in E
    b6 = ca_s not in A
    b5 = cb not in A
    if cb in X and b3:
        return P1 + (1 if at(P1) != '' else 0) if True else None
    if b4 and b5:
        if cb == '': return None
        return P1
    if b5 or not b4:
        if (not b4) and b5: return P0
        return None
    if b6: return P0
    if not b3:
        if d < 1: return P0
        if d != 1: return p + (d - 1)
        return p
    return P0 + 2
