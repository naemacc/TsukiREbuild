#!/usr/bin/env python3
"""build_packs.py: the voices, sound effects and interface sounds in packs, so that a player's browser asks for one file where it asked for dozens.

    python3 -I web-dev/tools/build_packs.py            make web/assets/pack from web/assets/voice, se and sys
    python3 -I web-dev/tools/build_packs.py --check    say whether the packs on disk are the ones the loose files make

A pack is its files end to end, as they are (Ogg Opus, nothing re-encoded), about TARGET bytes of them. The files go in the order the story first uses
them (the scripts in their order, each one's commands in theirs), so the pack that has a line's voice has the next lines' too; what no script names
follows by name. A pack's name carries a hash of its content, so a browser may keep it for good: a pack that changes has a new name.

    web/assets/pack/<kind>-<hash>.pack     the files of one pack
    web/assets/pack/index-<hash>.json      { "version": 1, "packs": [[pack name, [file, bytes, file, bytes, ...]], ...] }: a file's place in its
                                           pack is the sum of the sizes before it; a file is "<folder>/<name>" as in web/assets, without ".ogg"
    web/assets/pack/index.json             { "index": "index-<hash>.json" }: the one short-lived file, which names the index in use

The port reads a sound from its pack when the index names it and from its own file otherwise (app/js/audio.js), so the loose files stay the source and
a copy of the game without packs still plays. Standard library only.
"""
import glob
import hashlib
import json
import os
import sys

TARGET = 1_500_000          # bytes a pack is filled to; a file that would take it past this starts the next
KINDS = ("voice", "se", "sys")
HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.normpath(os.path.join(HERE, "..", "..", "web", "assets"))


def first_use(assets):
    """The voices and sound effects in the order the scripts first name them."""
    names = json.load(open(os.path.join(assets, "scripts", "index.json")))["names"]
    order = {"voice": [], "se": []}
    seen = {"voice": set(), "se": set()}
    for i in range(len(names)):
        path = os.path.join(assets, "scripts", f"{i}.json")
        if not os.path.exists(path):
            continue
        for o in json.load(open(path))["ops"]:
            if o[0] in ("VPLY", "VPL2") and len(o) > 1 and o[1]:
                kind, name = "voice", o[1]
            elif o[0] == "SEPL" and len(o) > 3 and o[3]:
                kind, name = "se", o[3].upper()
            else:
                continue
            if name not in seen[kind]:
                seen[kind].add(name)
                order[kind].append(name)
    return order


def plan(assets, target=TARGET):
    """[(kind, [(name, path, size), ...]), ...]: every loose file of KINDS once, in packs."""
    used = first_use(assets)
    packs = []
    for kind in KINDS:
        on_disk = {os.path.basename(f)[:-4]: f for f in glob.glob(os.path.join(assets, kind, "*.ogg"))}
        ordered = [n for n in used.get(kind, []) if n in on_disk]
        named = set(ordered)
        rest = sorted((n for n in on_disk if n not in named), key=lambda n: (len(n), n) if kind == "sys" else n)
        cur, size = [], 0
        for name in ordered + rest:
            n = os.path.getsize(on_disk[name])
            if cur and size + n > target:
                packs.append((kind, cur))
                cur, size = [], 0
            cur.append((name, on_disk[name], n))
            size += n
        if cur:
            packs.append((kind, cur))
    return packs


def build(assets=ASSETS, write=True):
    out = os.path.join(assets, "pack")
    entries, wanted, total = [], set(), 0
    for kind, files in plan(assets):
        data = b"".join(open(path, "rb").read() for _, path, _ in files)
        name = f"{kind}-{hashlib.sha1(data).hexdigest()[:10]}.pack"
        listing = []
        for file, _, size in files:
            listing += [f"{kind}/{file}", size]
        entries.append([name, listing])
        wanted.add(name)
        total += len(data)
        target = os.path.join(out, name)
        if write and not (os.path.exists(target) and os.path.getsize(target) == len(data)):
            os.makedirs(out, exist_ok=True)
            with open(target + ".part", "wb") as f:
                f.write(data)
            os.replace(target + ".part", target)
    index = json.dumps({"version": 1, "packs": entries}, separators=(",", ":")).encode()
    index_name = f"index-{hashlib.sha1(index).hexdigest()[:10]}.json"
    pointer = json.dumps({"index": index_name}).encode()
    wanted |= {index_name, "index.json"}
    if write:
        os.makedirs(out, exist_ok=True)
        open(os.path.join(out, index_name), "wb").write(index)
        open(os.path.join(out, "index.json"), "wb").write(pointer)
        for old in os.listdir(out):          # packs and indexes of an earlier build
            if old not in wanted and (old.endswith(".pack") or old.endswith(".json") or old.endswith(".part")):
                os.remove(os.path.join(out, old))
    files = sum(len(listing) // 2 for _, listing in entries)
    return {"packs": len(entries), "files": files, "bytes": total, "index": index_name, "index_bytes": len(index), "wanted": wanted}


def check(assets=ASSETS):
    """True when web/assets/pack holds exactly what the loose files make."""
    made = build(assets, write=False)
    out = os.path.join(assets, "pack")
    have = set(os.listdir(out)) if os.path.isdir(out) else set()
    missing = sorted(made["wanted"] - have)
    try:
        pointed = json.load(open(os.path.join(out, "index.json")))["index"]
    except (OSError, ValueError, KeyError):
        pointed = None
    return (not missing and pointed == made["index"]), made, missing


if __name__ == "__main__":
    if "--check" in sys.argv[1:]:
        ok, made, missing = check()
        print(f"packs: {made['packs']} for {made['files']} files" + ("" if ok else f"; out of date ({len(missing)} missing): run build_packs.py"))
        sys.exit(0 if ok else 1)
    made = build()
    print(f"{made['files']} files in {made['packs']} packs, {made['bytes'] / 1e6:.0f} MB; index {made['index']} ({made['index_bytes'] / 1e3:.0f} KB)")
