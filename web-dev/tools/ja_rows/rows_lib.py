"""Row breaks of the original engine, put back into a line's own markup.

raw_tokens(text): the line's letters in the engine's order, each with where it sits in the text.
engine_items(buf): the engine's laid-out buffer (native +0xd8a0 after 0xbf0f8) as letters, the indices a row break comes before, and each ruby group.
with_rows(text, buf): the text with ROW where the engine broke a row by itself, a ruby group cut by a break written as the engine's two groups.
"""
import re
ROW = ""
DASH = "―—─"
TAG = re.compile(r"\[[a-z]+\d*\]")

def raw_tokens(text):
    """[{c, a, b, ruby}], forced: letters (c: the character the engine draws, a..b: its place in text; ruby: group number or None), and the letter
    indices an explicit ^ comes before."""
    toks = []; forced = []; groups = []
    i = 0; n = len(text)
    while i < n:
        ch = text[i]
        if ch == "@" and i + 1 < n and text[i + 1].isalpha():
            j = i + 2
            if text[i + 1] == "c" and j < n and text[j].isdigit(): j += 1
            i = j; continue
        if ch == "^": forced.append(len(toks)); i += 1; continue
        if ch == "<":
            bar = text.find("|", i); end = text.find(">", i)
            if bar > i and end > bar:
                g = len(groups); groups.append({"a": i, "b": end + 1, "base": text[i + 1:bar], "read": text[bar + 1:end], "first": len(toks)})
                for k in range(i + 1, bar): toks.append({"c": text[k], "a": k, "b": k + 1, "ruby": g})
                groups[g]["n"] = bar - i - 1
                i = end + 1; continue
        m = TAG.match(text, i)
        if m:
            toks.append({"c": "　", "a": i, "b": m.end(), "ruby": None, "tag": True}); i = m.end(); continue
        toks.append({"c": ch, "a": i, "b": i + 1, "ruby": None}); i += 1
    return toks, forced, groups

def engine_items(buf):
    """letters [(char, ruby group index or None)], breaks [letter index], groups [{first, n, read}]"""
    s = buf; n = len(s)
    items = []; breaks = []; groups = []; cur = None
    i = 0
    if s[:1] == "\n": breaks.append(0); i = 1          # a glued line that did not fit the row before starts a row of its own
    assert s[i] == "\x07", repr(s[:8])
    i += 2
    while i < n:
        o = ord(s[i])
        if o == 0x0A: breaks.append(len(items)); i += 1
        elif o == 0x0D:
            cnt = ord(s[i + 1]); g = s[i + 2]; assert ord(s[i + 3]) == 6, repr(s)
            for _ in range(cnt): items.append(("―" if g in "Œœ" else "■", None))
            i += 4
        elif o == 0x01: cur = {"first": len(items), "n": 0, "read": ""}; i += 1
        elif o == 0x02:
            j = s.index("\x04", i); assert s[i + 1] == "\x03"
            cur["read"] = s[i + 2:j]; cur["n"] = len(items) - cur["first"]; groups.append(cur); cur = None; i = j + 1
        elif o in (0x07, 0x08): i += 2
        elif o < 0x20: i += 1          # 0x0c glue, 0x10 / 0x11 narrow run, 0x12 / 0x13, 0x14 / 0x15 face, 0x16 / 0x19 / 0x17 picture letters, 0x1f
        else:
            items.append((s[i], len(groups) if cur is not None else None)); i += 1
    return items, breaks, groups

def same(a, b):
    if a == b: return True
    if a in DASH and b == "―": return True
    if a == " " and b == " ": return True
    return False

def with_rows(text, buf, skip=0):
    """text with the engine's own row breaks; skip: letters of the buffer that belong to text shown before this one (MSAD)."""
    toks, forced, groups = raw_tokens(text)
    items, breaks, egroups = engine_items(buf)
    part = items[skip:skip + len(toks)]
    if len(part) != len(toks): raise ValueError("length %d / %d" % (len(part), len(toks)))
    for t, (c, _) in zip(toks, part):
        if not same(t["c"], c): raise ValueError("letter %r / %r" % (t["c"], c))
    auto = sorted(b - skip for b in breaks if 0 < b - skip < len(toks) and (b - skip) not in forced)
    if not auto: return text
    out = []; pos = 0
    for b in auto:
        t = toks[b]
        g = t["ruby"]
        if g is not None and toks[b - 1]["ruby"] == g:
            # inside a ruby group: the engine made two groups of it
            grp = groups[g]
            eg = [e for e in egroups if skip + grp["first"] <= e["first"] < skip + grp["first"] + grp["n"]]
            if len(eg) < 2: raise ValueError("ruby split not found")
            out.append(text[pos:grp["a"]])
            base = grp["base"]; k = 0; pieces = []
            for e in eg:
                pieces.append("<%s|%s>" % (base[k:k + e["n"]], e["read"])); k += e["n"]
            # (a group cut twice does not occur; the break goes between the first two)
            cut = eg[1]["first"] - skip
            assert cut == b, (cut, b)
            out.append(pieces[0] + ROW + "".join(pieces[1:]))
            pos = grp["b"]
        else:
            at = groups[g]["a"] if g is not None else t["a"]      # before a ruby group's "<", not inside it
            if at < pos: raise ValueError("break before written text")
            out.append(text[pos:at] + ROW)
            pos = at
    out.append(text[pos:])
    return "".join(out)
