#!/usr/bin/env python3
"""build_ui.py <repo root> [pack ...]: the game's interface art (allui) -> web/assets/ui/<pack>/<texture>.webp, lossless,
with web-dev/data/ui_manifest.json: pack -> texture -> [width, height]. Generated from your dump; stays on this machine.
Packs named after the root are the only ones built (the manifest keeps the others). NOISE_PARTS keeps only its two
1920x1080 frames, used by STNS film grain."""
import io
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "../../web-research/tools"))
from PIL import Image
from romio import Rom
import packs
import tex

OUT = os.path.join(HERE, "../../web/assets/ui")
MANIFEST = os.path.join(HERE, "../data/ui_manifest.json")
SKIP = {"CG_THUMB_PARTS_JA", "DUMMY"}
ONLY = {"NOISE_PARTS": {"noisehd0", "noisehd1"}}


def safe(n):
    return re.sub(r"[^A-Za-z0-9_-]", "_", n)


def unique_names(textures):
    """File names for a pack's textures: the safe name, and where several textures would share one (the text window
    balloons of DISP_PARTS_JA have Shift-JIS names that differ only in characters safe() replaces), each of them gets
    its texture index after a hyphen. build_system.py names the balloons the same way."""
    names = [safe(t.name) for t in textures]
    count = {}
    for n in names:
        count[n] = count.get(n, 0) + 1
    return [f"{n}-{k}" if count[n] > 1 else n for k, n in enumerate(names)]


def boot_parts(rom, manifest):
    """parts.hed: the start-up pictures (native 0xb5650 loads entry 1, the notice shown after the TM_CI movie, with
    0xb4a20) and the cautions -> assets/ui/PARTS."""
    os.makedirs(os.path.join(OUT, "PARTS"), exist_ok=True)
    m = manifest.setdefault("PARTS", {})
    for i, name, off, stored, _ in packs.entries(rom, "parts"):
        blob = rom.read("parts.mrg", off, stored)
        if blob[:4] not in (b"NXGX", b"NXCX"):
            continue
        _, raw, _, _ = packs.unwrap(blob)
        for t in tex.textures(raw):
            key = safe(t.name)
            Image.fromarray(tex.decode(t, raw), "RGBA").save(os.path.join(OUT, "PARTS", key + ".webp"), "WEBP",
                                                             lossless=True, quality=80, method=2)
            m[key] = [t.width, t.height]
    print("PARTS", len(m), flush=True)


def main(root, wanted=(), out=None, manifest=None):
    """out, manifest: another folder and list to write (build_ja.py makes the original's art beside the translation's)."""
    global OUT
    OUT = out or OUT
    rom = Rom(root)
    wanted = set(wanted)
    path = manifest or MANIFEST
    manifest = json.load(open(path)) if wanted and os.path.exists(path) else {}
    done = set()
    for i, name, off, stored, _ in packs.entries(rom, "allui"):
        pack = name.split(".")[0]
        if pack in done or pack in SKIP or (wanted and pack not in wanted):
            continue
        blob = rom.read("allui.mrg", off, stored)
        if blob[:4] not in (b"NXGX", b"NXCX"):
            continue
        done.add(pack)
        _, raw, _, _ = packs.unwrap(blob)
        os.makedirs(os.path.join(OUT, pack), exist_ok=True)
        m = manifest.setdefault(pack, {})
        textures = tex.textures(raw)
        keys = unique_names(textures)
        for k, t in enumerate(textures):
            if t.width <= 4 and t.height <= 4:
                continue
            if pack in ONLY and t.name not in ONLY[pack]:
                continue
            key = keys[k]
            im = Image.fromarray(tex.decode(t, raw), "RGBA")
            im.save(os.path.join(OUT, pack, key + ".webp"), "WEBP", lossless=True, quality=80, method=2)
            m[key] = [t.width, t.height]
        print(pack, len(m), flush=True)
    if not wanted or "PARTS" in wanted:
        boot_parts(rom, manifest)
    json.dump(manifest, open(path, "w"), indent=0)
    print("done", sum(len(v) for v in manifest.values()))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:])
