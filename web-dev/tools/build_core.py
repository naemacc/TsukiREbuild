#!/usr/bin/env python3
"""build_core.py <repo root>: scripts, dialogue and image sizes -> web/assets, for the local web version.

Output (generated from your own dump, stays on this machine):
  assets/scripts/<n>.json   one script: {"name", "ops": [[op, arg, ...], ...], "labels": {label: op index}}
  assets/scripts/index.json names and the jump number -> script table
  assets/text.json          dialogue lines, by id
  assets/images.json        NAME -> [width, height] of the stored image
"""
import hashlib
import json
import os
import re
import sqlite3
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "../../web-research/tools"))
from romio import Rom
import mzx
import packs
from build_animations import build as build_animations
from build_effects import build as build_effects

ROOT = sys.argv[1] if len(sys.argv) > 1 else "."
OUT = os.path.join(HERE, "../../web/assets")
OP = re.compile(r"_([A-Za-z0-9_]+)\(([^()]*)\);")


def split_args(s):
    return s.split(",") if s else []


def zcode(name):
    """A Z command's block and index as the interpreter reads them from its name (0x77790 case Z, 0x78894 on): name
    characters 2-4 are the block and 5-6 the index, each a hex digit (above 0x60 less 0x57, else less 0x30). Packed as
    block x 256 + index."""
    d = [c - 0x57 if c > 0x60 else c - 0x30 for c in name.encode()[2:7]]
    return ((d[0] * 16 + d[1]) * 16 + d[2]) * 256 + d[3] * 16 + d[4]


def parse(text):
    """ops, labels and the Z commands: zm (a message op's index -> its zcode) and zl (op index -> the label Z commands
    just before it, [zcode, label], in order). Every Z command marks the message before it read (see vm.js zStep)."""
    ops, labels, zm, zl = [], {}, {}, {}
    pos = 0
    for m in OP.finditer(text):
        if m.start() != pos:
            raise ValueError("gap at %d: %r" % (pos, text[pos:m.start()][:60]))
        pos = m.end()
        name, args = m[1], m[2]
        if name.startswith(("ZZ", "ZY")):
            if args:
                labels[args] = len(ops)
            zl.setdefault(len(ops), []).append([zcode(name), args])
            continue
        if name.startswith("ZM"):
            zm[len(ops)] = zcode(name)
            ops.append(["MSG", args])
            continue
        ops.append([name] + split_args(args))
    return ops, labels, zm, zl


IMAGE_SHA256 = "ac6b01203d0e82e33c38ca9ef2fa0d55f1e55d851919196f9073cdafc41b7951"
# JUMP n (native 0x77c7c) looks n up in a table of 552 16-bit jump numbers at 0x350d58 (loop 0x77ca8-0x77cd8); the
# position where it is found is the script's index in allscr.mrg, and 0xffff is no number. Story scripts are numbered
# position + 296; the others are 110 START_SCRIPT, 240/260/270 the prologue scripts, 1000-1024 QA_00-QA_24, 2000-2007
# the F069 scripts (2000 is 12_01_CIEL12_3C_FLAG0, which sets F069 = 1, and 2001 its FLAG1, which sets 0: the callers'
# `IF__ F069 eq 0 L; JUMP 2001; L: JUMP 2000` keep F069 as it is), 3000 ARCHIVE, 3100 QACALL, 4000 STAFFROLL, 8000
# TEST_SCRIPT and 8001- the JUMP scripts.
JUMP_TABLE, JUMP_COUNT = 0x350D58, 552


def native_jumps(root, names):
    image = open(os.path.join(root, "data/tsuki/analysis/main.bin"), "rb").read()
    if hashlib.sha256(image).hexdigest() != IMAGE_SHA256:
        raise ValueError("main.bin: unsupported executable image for the jump table")
    table = struct.unpack_from("<%dH" % JUMP_COUNT, image, JUMP_TABLE)
    jump = {n: i for i, n in enumerate(table) if n != 0xFFFF and i < len(names)}
    odd = [names[i] for i, n in enumerate(table) if i < len(names) and re.fullmatch(r"\d\d_\d\d_.*", names[i]) and n != i + 296
           and not names[i].endswith(("_FLAG0", "_FLAG1"))]
    if odd:
        print("WARNING: story scripts not numbered position + 296:", odd[:6])
    return jump


def main():
    rom = Rom(ROOT)
    os.makedirs(os.path.join(OUT, "scripts"), exist_ok=True)
    d = rom.read("allscr.mrg")
    ents = mzx.mrgd(d)
    nb = d[ents[0][0]:ents[0][1]]
    names = [nb[i:i + 32].split(b"\r\n")[0].split(b"\0")[0].decode() for i in range(0, len(nb), 32)]
    names = [n for n in names if n]
    scripts = []
    for i, (o, e) in enumerate(ents[3:]):
        raw = mzx.mzx(d[o:e])
        if raw[:1] == b"\xa0":
            raw = bytes(c ^ 0xFF for c in raw)
        # The scripts are UTF-8 (only TEST_SCRIPT has text outside ASCII; ASCII decoding damaged its literals).
        scripts.append(raw.decode("utf-8", "replace"))
    if len(scripts) == len(names) + 1 and not scripts[-1]:
        scripts.pop()  # the patch leaves an empty last entry
    assert len(scripts) == len(names), (len(scripts), len(names))
    parsed = [parse(s) for s in scripts]
    idx = {n: i for i, n in enumerate(names)}

    # jump number -> script, from the engine's own table (see native_jumps).
    jump = native_jumps(ROOT, names)
    unresolved = {}
    for i, (ops, labels, _, _) in enumerate(parsed):
        for op in ops:
            if op[0] == "JUMP":
                t = int(op[1])
                l = op[2] if len(op) > 2 else ""
                if t not in jump or (l and l not in parsed[jump[t]][1]):
                    unresolved.setdefault(t, set()).add((names[i], l))
    for t, s in sorted(unresolved.items()):
        print("unresolved jump", t, sorted(s)[:3], "of", len(s))
    # what a jump number that is not a script position can only be: find it by its labels
    for t, s in sorted(unresolved.items()):
        need = {l for _, l in s if l}
        cand = [names[k] for k, (_, labels, _, _) in enumerate(parsed) if need and need <= set(labels)]
        print("  candidates", t, cand[:6])

    lines_z = {}   # dialogue line -> the zcodes of the messages that show it (for carrying old per-line read bits over)
    for i, (ops, labels, zm, zl) in enumerate(parsed):
        with open(os.path.join(OUT, "scripts", f"{i}.json"), "w") as f:
            json.dump({"name": names[i], "ops": ops, "labels": labels, "zm": zm, "zl": zl}, f, separators=(",", ":"))
        for k, code in zm.items():
            for line in re.findall(r"\$(\d+)", ops[k][1] if len(ops[k]) > 1 else ""):
                lines_z.setdefault(int(line), []).append(code)
    with open(os.path.join(OUT, "scripts", "zlines.json"), "w") as f:
        json.dump({str(k): v for k, v in sorted(lines_z.items())}, f, separators=(",", ":"))
    with open(os.path.join(OUT, "scripts", "index.json"), "w") as f:
        json.dump({"names": names, "jump": {str(k): v for k, v in jump.items()}, "start": idx["START_SCRIPT"]}, f, separators=(",", ":"))
    print("scripts", len(names), "ops", sum(len(p[0]) for p in parsed), "messages", sum(len(p[2]) for p in parsed))

    # dialogue: the first pair of script_text.mrg is the language in use
    t = rom.read("script_text.mrg")
    te = mzx.mrgd(t)
    tb = t[te[1][0]:te[1][1]]
    lines = tb.decode("utf-8", "replace").split("\r\n")
    with open(os.path.join(OUT, "text.json"), "w") as f:
        json.dump(lines, f, ensure_ascii=False, separators=(",", ":"))
    print("text lines", len(lines))

    # image sizes
    sizes = {}
    for p, end in (("allpac", 14770), ("allpaccg", None), ("allui", None), ("parts", None)):
        for i, n, off, stored, _ in packs.entries(rom, p):
            if end is not None and i >= end:
                continue
            if not stored:
                continue
            blob = rom.read(p + ".mrg", off, min(stored, 256 << 10))
            key = n.split(".")[0].upper()
            sizes.setdefault(key, {"p": p, "o": off, "s": stored})
    with open(os.path.join(HERE, "../data/image_table.json"), "w") as f:
        json.dump(sizes, f, separators=(",", ":"))
    print("image table", len(sizes))
    build_animations(ROOT, OUT)
    build_effects(ROOT, OUT)


if __name__ == "__main__":
    main()
