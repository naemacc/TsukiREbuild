#!/usr/bin/env python3
"""check_assets.py: is everything the game can ask for in web/assets, and nothing else? Standard library only.

Checks needed.py's list, the interface art's manifest and the interface sounds, and every fixed /assets/... address in the app's code. Prints what is missing or left
over, and exits 1 if anything is missing.
"""
import glob
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import needed
import build_packs

WEB = os.path.join(HERE, "../../web")
A = os.path.join(WEB, "assets")


def have(folder, ext):
    d = os.path.join(A, folder)
    return {n[:-len(ext)] for n in os.listdir(d) if n.endswith(ext)} if os.path.isdir(d) else set()


def packed(folder):
    """The files of a folder that the sound packs carry (build_packs.py): a copy of the game may have a voice or a sound in a pack alone."""
    try:
        pack = os.path.join(A, "pack")
        index = json.load(open(os.path.join(pack, json.load(open(os.path.join(pack, "index.json")))["index"])))
    except (OSError, ValueError, KeyError):
        return set()
    return {name.split("/", 1)[1] for _, listing in index["packs"] for name in listing[0::2] if name.startswith(folder + "/")}


def main():
    missing, extra = {}, {}
    want = needed.needed(A)
    counts = {}
    for key, folder, ext in (("images", "img", ".avif"), ("voices", "voice", ".ogg"), ("sounds", "se", ".ogg"), ("music", "bgm", ".ogg"), ("movies", "movie", ".mp4")):
        got = have(folder, ext) | (packed(folder) if folder in ("voice", "se") else set())
        counts[key] = len(got)
        if want[key] - got:
            missing[key] = sorted(want[key] - got)
        if got - want[key]:
            extra[key] = sorted(got - want[key])
    if not os.path.isfile(os.path.join(A, "fonts", "SeuratPro-M.otf")):
        missing["fonts"] = ["SeuratPro-M.otf"]
    gone = [str(n) for n in range(9) if not os.path.isfile(os.path.join(A, "sys", f"{n}.ogg"))]
    if gone:
        missing["interface sounds"] = gone
    manifest = json.load(open(os.path.join(HERE, "../data/ui_manifest.json")))
    gone = [f"{p}/{k}" for p, v in manifest.items() for k in v if not os.path.isfile(os.path.join(A, "ui", p, k + ".webp"))]
    if gone:
        missing["interface art"] = gone
    fixed, outside = set(), set()
    for f in glob.glob(os.path.join(WEB, "app", "js", "*.js")) + glob.glob(os.path.join(WEB, "app", "*.css")) + glob.glob(os.path.join(WEB, "app", "*.html")):
        text = open(f, encoding="utf-8").read()
        fixed |= {m[0] for m in re.finditer(r"""/assets/[^"'`()\s$]+\.[a-z0-9]+(?=["'`)])""", text)}
        if "/rom/" in text:
            outside.add(os.path.basename(f))
    gone = sorted(p for p in fixed if not os.path.isfile(os.path.join(A, p[8:])))
    if gone:
        missing["fixed addresses in the code"] = gone
    if outside:
        missing["code asking the server for the game's own files"] = sorted(outside)
    # The sound packs (build_packs.py), where there are any: they must be the ones the loose files make, or the game would play an old copy of a sound.
    packs = ""
    if os.path.isdir(os.path.join(A, "pack")):
        if build_packs.has_sources(A):
            ok, made, gone = build_packs.check(A)
            packs = f", sound packs {made['packs']}"
            if not ok:
                missing["sound packs (run build_packs.py)"] = gone or ["index.json names another index"]
        else:   # the packs alone: each must be whole
            ok, n, _, wrong = build_packs.intact(A)
            packs = f", sound packs {n} (no loose voices or sounds here)"
            if not ok:
                missing["sound packs"] = wrong
    print(", ".join(f"{k} {v}" for k, v in counts.items()) + f", interface art {sum(len(v) for v in manifest.values())}" + packs)
    for what, names in missing.items():
        print(f"MISSING {what}: {len(names)}, for example {names[:8]}")
    for what, names in extra.items():
        print(f"not needed, in assets: {what}: {len(names)}, for example {names[:8]}")
    if missing:
        sys.exit(1)
    print("nothing missing")


main()
