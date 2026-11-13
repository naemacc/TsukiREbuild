#!/usr/bin/env python3
"""build_ja.py <repo root> [text] [scripts] [tables] [ui] [img] [movie] [font]: the original (Japanese) game -> web/assets/ja, for the language switch.

The port's files are made from the translation (the dump with the patch's layer on top). This makes, from the dump with only the game's own update on
top, what Japanese has that is not the same, and nothing else:

  ja/text.json           the dialogue lines, with the engine's row breaks (ROW, U+E3FE)
  ja/scripts/<n>.json    the scripts that are not the translation's (it rewrote glued and timed lines), with the rows of messages laid out with others
  ja/system.json         the keys of system.json that differ (messages, scene names, the help bar's label cells ...)
  ja/gallery.json, ja/flowchart.json   titles, credits and notes
  ja/ui/..., ja/img/..., ja/movie/...  interface art, pictures and movies that carry text
  ja/fonts/              the game's own faces
  ja/index.json          the list of all of it: {"files": [path under ja/, ...]}, which app/js/lang.js reads

Rows: the original engine wraps Japanese itself (the translation's patch turned that off and breaks its own lines). Where it breaks each line is in
web-dev/data/ja_rows.json, read from the engine (web-dev/tools/ja_rows/README.md), and written into the text here.
"""
import filecmp
import json
import os
import re
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "../../web-research/tools"))
LAYER = "_update_v131072"
os.environ["TSUKI_LAYER"] = LAYER      # every tool that opens the dump from here on reads the original game

ASSETS = os.path.join(HERE, "../../web/assets")
JA = os.path.join(ASSETS, "ja")
ROW = ""
DASH = "―—─"
TAG = re.compile(r"\[[a-z]+\d*\]")


# ---- rows ---------------------------------------------------------------------------------------------------------------------------
def raw_tokens(text):
    """A line's letters in the engine's order: [{a: where the letter is written, ruby: its group or None}], and the ruby groups."""
    toks, groups = [], []
    i, n = 0, len(text)
    while i < n:
        ch = text[i]
        if ch == "@" and i + 1 < n and text[i + 1].isalpha():
            i += 3 if text[i + 1] == "c" and i + 2 < n and text[i + 2].isdigit() else 2
            continue
        if ch == "^":
            i += 1
            continue
        if ch == "<":
            bar, end = text.find("|", i), text.find(">", i)
            if bar > i and end > bar:
                g = len(groups)
                groups.append({"a": i, "b": end + 1, "base": text[i + 1:bar], "read": text[bar + 1:end], "first": len(toks)})
                toks += [{"a": k, "ruby": g} for k in range(i + 1, bar)]
                i = end + 1
                continue
        m = TAG.match(text, i)
        if m:
            toks.append({"a": i, "ruby": None})
            i = m.end()
            continue
        toks.append({"a": i, "ruby": None})
        i += 1
    return toks, groups


def with_rows(text, breaks, new_row=False):
    """text with ROW before each letter of `breaks` (ja_rows.json: a letter index, or [index, n] inside a ruby group, whose reading's first n letters
    stay on the row above)."""
    if not breaks and not new_row:
        return text
    toks, groups = raw_tokens(text)
    out, pos = [ROW] if new_row else [], 0
    for b in breaks:
        split = None
        if isinstance(b, list):
            b, split = b
        g = toks[b]["ruby"]
        if split is not None:
            grp = groups[g]
            k = b - grp["first"]
            out.append(text[pos:grp["a"]] + "<%s|%s>%s<%s|%s>" % (grp["base"][:k], grp["read"][:split], ROW, grp["base"][k:], grp["read"][split:]))
            pos = grp["b"]
        else:
            at = groups[g]["a"] if g is not None else toks[b]["a"]
            out.append(text[pos:at] + ROW)
            pos = at
    out.append(text[pos:])
    return "".join(out)


def rows_data():
    return json.load(open(os.path.join(HERE, "../data/ja_rows.json")))


# ---- text and scripts ---------------------------------------------------------------------------------------------------------------
def lines_of(rom):
    import mzx
    t = rom.read("script_text.mrg")
    te = mzx.mrgd(t)
    return t[te[1][0]:te[1][1]].decode("utf-8", "replace").split("\r\n")   # (the last entry is the block's padding, as in text.json)


def build_text(rom):
    rows = rows_data()["lines"]
    lines = lines_of(rom)
    out = [with_rows(l, rows.get(str(i), [])) for i, l in enumerate(lines)]
    assert all(o.replace(ROW, "") == l or "<" in l for o, l in zip(out, lines))
    with open(os.path.join(JA, "text.json"), "w") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print("text:", len(out), "lines,", sum(ROW in o for o in out), "of them more than a row")
    return lines


# Five commands of the original scripts are mistyped: stray letters after the closing bracket (01_00_ARC01_2 "_STGS(0,,0,800,0)#);", 10_00_ARC10_7_2B
# "_SQK2(...)+);", 10_01_CIEL10_4_3 "_MFAD(...)0);", 14_01_CIEL14_1C "_STZ4(...)gb);") and one with no opening bracket (14_01A_CIEL14A_2
# "_STTR,0,26);"). The translation's scripts have them as they were meant, and so do these. The engine runs a command with stray letters after its
# bracket (a scene with "_STGS(3,,0,800,0)#);" on the unpatched build: the picture fades as it does for the command written right); the one with no
# opening bracket was not run.
def mend(text):
    text = re.sub(r"\)[#+0-9a-z]{1,3}\);", ");", text)
    return text.replace("_STTR,0,26);", "_STTR(0,26);")


def build_scripts(rom, lines):
    import mzx
    from build_core import parse
    d = rom.read("allscr.mrg")
    ents = mzx.mrgd(d)
    names = json.load(open(os.path.join(ASSETS, "scripts", "index.json")))["names"]
    rows = rows_data()["ops"]
    folder = os.path.join(JA, "scripts")
    shutil.rmtree(folder, ignore_errors=True)
    os.makedirs(folder)
    own = 0
    for i, (o, e) in enumerate(ents[3:3 + len(names)]):
        raw = mzx.mzx(d[o:e])
        if raw[:1] == b"\xa0":
            raw = bytes(c ^ 0xFF for c in raw)
        ops, labels, zm, zl = parse(mend(raw.decode("utf-8", "replace")))
        mine = json.loads(json.dumps({"name": names[i], "ops": ops, "labels": labels, "zm": zm, "zl": zl}))
        theirs = json.load(open(os.path.join(ASSETS, "scripts", f"{i}.json")))
        r = rows.get(names[i])
        if r:
            # messages laid out together with others (a glued line, text an MSAD adds): the rows of each line there, [text, ...] in the order the
            # message names them
            mine["rows"] = {op: [with_rows(lines[e[0]], e[1], len(e) > 2) for e in ents_] for op, ents_ in r.items()}
            for op, ents_ in r.items():
                ids = [int(x) for x in re.findall(r"\$(\d+)", ops[int(op)][1])]
                assert ops[int(op)][0] in ("MSG", "MSAD") and ids == [e[0] for e in ents_], (names[i], op, ops[int(op)], ents_)
        if mine == theirs:
            continue
        own += 1
        with open(os.path.join(folder, f"{i}.json"), "w") as f:
            json.dump(mine, f, ensure_ascii=False, separators=(",", ":"))
    print("scripts:", own, "of", len(names), "are Japanese's own")


# ---- fonts --------------------------------------------------------------------------------------------------------------------------
FONTS = {"ja/TT_TsukuMin-D.ttf": "TsukuMin.ttf", "ja2/TT_TsukuGo-D.ttf": "TsukuGo.ttf", "ja3/FOT-SeuratPro-M.otf": "SeuratPro.otf"}


def build_fonts(rom):
    import convert
    os.makedirs(os.path.join(JA, "fonts"), exist_ok=True)
    for rel, name in FONTS.items():
        out = os.path.join(JA, "fonts", name)
        if not os.path.exists(out):
            convert.copy_file(rom, rel, out)
    print("fonts:", ", ".join(FONTS.values()))


# ---- the list -----------------------------------------------------------------------------------------------------------------------
def write_index():
    files = []
    for d, _, fs in os.walk(JA):
        for f in fs:
            rel = os.path.relpath(os.path.join(d, f), JA)
            if rel != "index.json" and not rel.startswith(".") and not f.startswith(".") and not f.endswith(".tmp") and not re.search(r"\.\d+\.(src|tmp)\.mp4$", f):
                files.append(rel)
    files.sort()
    with open(os.path.join(JA, "index.json"), "w") as f:
        json.dump({"files": files}, f, separators=(",", ":"))
    print("index:", len(files), "files,", round(sum(os.path.getsize(os.path.join(JA, x)) for x in files) / 1e6, 1), "MB")


def main():
    root = sys.argv[1]
    kinds = set(sys.argv[2:]) or {"text", "scripts", "tables", "ui", "img", "movie", "font"}
    from romio import Rom
    rom = Rom(root)
    os.makedirs(JA, exist_ok=True)
    lines = None
    if kinds & {"text", "scripts"}:
        lines = build_text(rom) if "text" in kinds else lines_of(rom)
    if "scripts" in kinds:
        build_scripts(rom, lines)
    if "font" in kinds:
        build_fonts(rom)
    for kind in ("tables", "ui", "img", "movie"):
        if kind in kinds and kind in EXTRA:
            EXTRA[kind](root, rom)
    sync_sizes()
    write_index()


# ---- the system's words --------------------------------------------------------------------------------------------------------------
def build_tables(root, rom):
    """system.json's keys that differ (its messages, scene names and the help bar's label cells come from the game's SYSMES and art), the gallery's and the
    flowchart's words. The same tools as the shared files', reading the original."""
    from pathlib import Path
    import build_system, build_gallery, build_flowchart
    tmp = os.path.join(JA, ".build")
    os.makedirs(tmp, exist_ok=True)
    mine = build_system.build(Path(root), out=tmp)
    base = json.load(open(os.path.join(ASSETS, "system.json")))
    over = {k: v for k, v in json.loads(json.dumps(mine)).items() if base.get(k) != v and k not in ("messagesSource",)}
    with open(os.path.join(JA, "system.json"), "w") as f:
        json.dump(over, f, ensure_ascii=False, separators=(",", ":"))
    print("system: keys of its own:", ", ".join(over))
    build_gallery.build(Path(root), out=JA)
    thumbs = os.path.join(JA, "ui/CG_THUMB_PARTS_JA/cg_thumb_all.webp")
    if os.path.exists(thumbs) and same_picture(thumbs, os.path.join(ASSETS, "ui/CG_THUMB_PARTS_JA/cg_thumb_all.webp")):
        os.remove(thumbs)
    build_flowchart.build(Path(root), out=JA)
    shutil.rmtree(tmp, ignore_errors=True)


def same_picture(a, b, limit=0.5):
    """Whether two pictures show the same thing: the same size and, on average, less than `limit` of a level apart (two encodings of one picture)."""
    import numpy as np
    from PIL import Image
    if not os.path.exists(b):
        return False
    x, y = Image.open(a), Image.open(b)
    if x.size != y.size:
        return False
    mode = "RGBA" if "A" in x.getbands() or "A" in y.getbands() else "RGB"
    d = np.abs(np.asarray(x.convert(mode)).astype(np.int16) - np.asarray(y.convert(mode)).astype(np.int16))
    return float(d.mean()) < limit and float(d.max()) < 48


# ---- interface art ------------------------------------------------------------------------------------------------------------------
def build_ui(root, rom):
    """Every interface picture of the original that is not the translation's, under ja/ui (the same names: lang.js asks for these in their place)."""
    import build_ui as ui
    tmp = os.path.join(JA, ".build")
    shutil.rmtree(tmp, ignore_errors=True)
    os.makedirs(tmp)
    manifest = os.path.join(tmp, "manifest.json")
    ui.main(root, out=os.path.join(tmp, "ui"), manifest=manifest)
    base = json.load(open(ui.MANIFEST))
    mine = json.load(open(manifest))
    sized = [(k, t) for k, v in mine.items() for t, wh in v.items() if base.get(k, {}).get(t) not in (None, wh)]
    if sized:
        print("WARNING: interface pictures of another size than the translation's:", sized[:8])
    kept = 0
    dest = os.path.join(JA, "ui")
    for pack in sorted(os.listdir(os.path.join(tmp, "ui"))):
        for f in sorted(os.listdir(os.path.join(tmp, "ui", pack))):
            a, b = os.path.join(tmp, "ui", pack, f), os.path.join(ASSETS, "ui", pack, f)
            if not os.path.exists(b):
                continue                       # (a picture the port does not use, as in the shared folder)
            if filecmp.cmp(a, b, shallow=False) or same_picture(a, b, 0.0001):
                continue
            os.makedirs(os.path.join(dest, pack), exist_ok=True)
            shutil.move(a, os.path.join(dest, pack, f))
            kept += 1
    shutil.rmtree(tmp, ignore_errors=True)
    print("ui:", kept, "pictures are Japanese's own")


# ---- pictures -----------------------------------------------------------------------------------------------------------------------
def build_img(root, rom):
    """The story's pictures the translation redrew (signs, letters, screens with writing): the original's, under ja/img."""
    import convert
    import needed
    import packs
    from romio import Rom
    theirs = Rom(root, patch="tsukihimates_patch")
    want = needed.needed(ASSETS)["images"]
    table = convert.table()                       # where the translation's files are
    made = 0
    sized = {}
    dest = os.path.join(JA, "img")
    os.makedirs(dest, exist_ok=True)
    for pack in ("allpac", "allpaccg"):
        mine = {}
        for i, n, off, stored, _ in packs.entries(rom, pack):
            mine.setdefault(n.split(".")[0].upper(), {"p": pack, "o": off, "s": stored})
        for key in sorted(want):
            t = table.get(key)
            if not t or t["p"] != pack or key not in mine:
                continue
            e = mine[key]
            if e["s"] == t["s"] and rom.read(pack + ".mrg", e["o"], e["s"]) == theirs.read(pack + ".mrg", t["o"], t["s"]):
                continue
            out = os.path.join(dest, key + ".avif")
            if os.path.exists(out):
                made += 1
                continue
            im = convert.load_image(rom, e)
            s = convert.scales().get(key, [0, 0, 1.0])
            scale = s[2]
            if (im.width, im.height) != (s[0], s[1]) and s[0]:
                # a picture the translation made on another canvas (IMG2582-2586, the last Ciel-sensei's words, on one of 1557 x 368; three flowchart
                # previews cut narrower): the original's own size, kept whole, in ja/images.json
                sized[key] = [im.width, im.height, 1.0]
                scale = 1.0
            w, h = max(1, round(im.width * scale)), max(1, round(im.height * scale))
            from PIL import Image
            sm = im if scale == 1.0 else im.convert("RGBa").resize((w, h), Image.LANCZOS).convert("RGBA")
            convert.save_avif(sm, out)
            made += 1
    if sized or not os.path.exists(os.path.join(JA, "images.json")):
        with open(os.path.join(JA, "images.json"), "w") as f:
            json.dump(sized, f, separators=(",", ":"))
    print("img:", made, "pictures are Japanese's own,", len(sized), "of another size")


# ---- movies -------------------------------------------------------------------------------------------------------------------------
# The translation's patch has its own file of every movie but the staff roll's. Four of them, the title's backgrounds, are the game's pictures encoded again
# (frames of the two differ by 0.2 to 0.4 of a level, an encoder's noise); the others carry words: the logo, the prologue's text, the openings' and endings'
# credits and lyrics, each chapter's title. Those are the original's here, made as the shared ones are (convert.make_movie).
SAME_MOVIES = {"titlebg1", "titlebg2", "titlebg3", "titlebg4"}
# The openings and endings stay the translation's in Japanese too, at the user's word (2026-11-12: "keep the openings and endings from english version").
ENGLISH_MOVIES = {"op1_arc", "op2_ciel", "ed01_arc", "ed02_ciel", "ed03_ciel"}


def build_movies(root, rom):
    import convert
    import needed
    from concurrent.futures import ThreadPoolExecutor
    want = sorted(n for n in needed.needed(ASSETS)["movies"] if n not in SAME_MOVIES | ENGLISH_MOVIES and rom.origin(f"movie/{n}.mp4") == "base"
                  and os.path.exists(os.path.join(root, "mods/japan/tsukihimates_patch/romfs/movie", n + ".mp4")))
    dest = os.path.join(JA, "movie")
    os.makedirs(dest, exist_ok=True)
    todo = [n for n in want if not os.path.exists(os.path.join(dest, n + ".mp4"))]
    print("movie:", len(want), "are Japanese's own,", len(todo), "to make", flush=True)

    def one(n):
        convert.make_movie(rom, n, os.path.join(dest, n + ".mp4"))
        print("  ", n, round(os.path.getsize(os.path.join(dest, n + ".mp4")) / 1e6, 1), "MB", flush=True)
    with ThreadPoolExecutor(2) as pool:
        list(pool.map(one, todo))


def sync_sizes():
    """system.json's imageSizes lists the pictures the engine draws at another size than they are stored at. A picture stored at its drawn size in the
    original (ja/images.json) is not one of them in Japanese: the list without those, in ja/system.json."""
    a, b = os.path.join(JA, "images.json"), os.path.join(JA, "system.json")
    if not (os.path.exists(a) and os.path.exists(b)):
        return
    sized = json.load(open(a))
    over = json.load(open(b))
    base = json.load(open(os.path.join(ASSETS, "system.json")))["imageSizes"]
    mine = {n: v for n, v in base.items() if not (n in sized and abs(v[0] / sized[n][0] - 1) <= 0.002 and abs(v[1] / sized[n][1] - 1) <= 0.002)}
    over.pop("imageSizes", None)
    if mine != base:
        over["imageSizes"] = mine
    with open(b, "w") as f:
        json.dump(over, f, ensure_ascii=False, separators=(",", ":"))


EXTRA = {"tables": build_tables, "ui": build_ui, "img": build_img, "movie": build_movies}

if __name__ == "__main__":
    main()
