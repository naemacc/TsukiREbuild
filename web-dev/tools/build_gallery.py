#!/usr/bin/env python3
"""build_gallery.py [repo root]: the gallery's tables from the owner's local game -> web/assets/gallery.json,
and the CG thumbnail atlas -> web/assets/ui/CG_THUMB_PARTS_JA/cg_thumb_all.webp. Generated files stay local.

Read from the verified Japanese image (see native_flowchart.py, which checks it):
- CG gallery: 0x1CA entries at 0x44EC88, 32 bytes each; the first field points to the entry's variants, 32-byte
  records ending in a null name: image name, thumbnail cell, x, y, width, height, flag. Native 0xB830 lists an entry
  when any of its variants is unlocked; 0xAF78 draws cell n of the 36-column atlas (154 x 87) at 1.5x, in a 6-column
  grid at x 392 + 240c, y 109 + 139r. The entry's second field (+8) is its gate code, which 0xB58C turns into a route
  day's scene (app/js/unlocks.js CG_GATES).
- What unlocks a variant (0x4470): the gate, then the alias rule 0x51E0 over the 105 rows of 0x4525C8 (a picture and
  up to four alternates shown in its place), then the picture's own seen bit, then RDED 557. Seen bits (0xae07a8,
  3,200 of them) are set when a layer shows a picture (0x5D3A0 -> 0x774F0) and by STCG: the picture's index in the
  name table (*0xAE0888, the image table's names) is the bit when it is 2700 or less; a record flagged at +0x43
  stands for its name without the last six characters (IMG0003_04_04 -> IMG0003); a larger index has a bit only
  through the 0x6533C0 table (0x77360: sprite names; some poses' sizes A / L / M / S share one bit, others not). Each
  variant gets the bits that unlock it ("bits": its own, then its alias rule's), and "seen" maps every picture name
  that sets one of those bits to it.
- Ending list: 25 rows of (scene, message, -) at 0x3374EC, read by native 0xDAF8 / 0xDDA4: Arcueid's and Ciel's two
  endings, the 21 bad ends, then the completion episode. The scene is the "Teach Me, Ciel-Sensei!" episode (QA_k is
  532 + k); the message number m gives the title (SYSMES 1380 + m) and the play prompt (SYSMES 1443 + m). The SELS
  question in QACALL is SYSMES 1445 + F027 (native 0x83B20).
- Music player: 95 records of 56 bytes at 0x34BD68, read by native 0x19EC4 (row <= 0x5E): the music number (field 0,
  the number MPLY plays; it is sound 0x01000000 + n - 1, 0x6F0 / 0x333F90, so stream audio_tables bgm[n - 1]), the
  title string (1), singer, lyrics, composer and arrangement strings (2-5; labels SYSMES 245-248), length in ms (6),
  loop start and end in samples at 48 kHz (7, 8) and up to five more music numbers that also unlock the row (9-13).
  The rows for music 80 and 124 also unlock once movie op1_arc / op2_ciel has played (G005 bits 0 and 1, set by
  0x40A00 for movies 5 and 6), and 82 and 126 once scene 560 / 562 has started (0x926B0). A locked row reads
  SYSMES 244 and the credits are labelled with SYSMES 245-248 (0x1DEC4), exported as "musicText".
- Movie gallery (0x17DD0): list index k plays movie k + 4 (0x18EA4: prologue, op1_arc, op2_ciel); index 0 is always
  listed, index k > 0 once G005 bit k - 1 is set (0x92400). Its movie_cur cells come from the descriptors at 0x469350
  (row = (y - 8) / 152 of the first cell), exported as "movieList".
"""
import json
import os
from pathlib import Path
import re
import struct
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from native_flowchart import _image, _messages, _pack_tools

CG_TABLE, CG_COUNT = 0x44EC88, 0x1CA
MUSIC_TABLE, MUSIC_STRIDE, MUSIC_ROWS = 0x34BD68, 56, 95
# Music numbers whose row has a second unlock condition in 0x19EC4.
MUSIC_MOVIE = {80: "op1_arc", 124: "op2_ciel"}
MUSIC_SCENE = {82: 560, 126: 562}
# movie_cur rows, top to bottom: the movies the gallery can play (names as in audio_tables.json).
MOVIES = ["op1_arc", "op2_ciel", "prologue"]
ENDING_TABLE, ENDING_COUNT = 0x3374EC, 25
FIRST_EPISODE, FINAL_EPISODE = 533, 557
# Seen bits (0x77610 / 0x774F0) and the alias rule (0x51E0).
NAMES_SLOT, IMAGE_TABLE, IMAGE_STRIDE = 0xAE0888, 0x46F830, 0x48
FIRST_SLOT, FIRST_COUNT = 0xAE09B8, 0xA8C        # 0x75900 looks a name up among the first 2700 only
SEEN_BITS = 0xC80
SPRITE_SEEN = 0x6533C0                           # 16-byte records: name, (index, filled in at start-up), bit
ALIAS_TABLE, ALIAS_COUNT = 0x4525C8, 0x69        # 0xB7C8 / 0xB798: 40-byte rows, a picture and four alternates
MOVIE_CELLS, MOVIE_COUNT = 0x469350, 3           # 0x17DD0: each index's movie_cur cell descriptors


def _key(name):
    """What 0x55D30 / 0x56720 compare: the name upper-cased up to its '.'."""
    return name.upper().split(".")[0]


def _seen_model(image):
    """The native seen-bit rules over the static tables: (lookup, first, bit, names)."""
    names_at = struct.unpack_from("<Q", image, NAMES_SLOT)[0]
    names, flags = [], []
    while struct.unpack_from("<Q", image, IMAGE_TABLE + IMAGE_STRIDE * len(names) + 8)[0]:
        k = len(names)
        names.append(image[names_at + 32 * k:names_at + 32 * (k + 1)].split(b"\0")[0].decode("ascii").upper())
        flags.append(image[IMAGE_TABLE + IMAGE_STRIDE * k + 0x43] & 1)
    if len(names) < 10000:
        raise ValueError(f"Picture name table looks wrong ({len(names)} names)")
    first_at = struct.unpack_from("<Q", image, FIRST_SLOT)[0]
    if image[first_at:first_at + 32 * FIRST_COUNT] != image[names_at:names_at + 32 * FIRST_COUNT]:
        raise ValueError("0x75900's table is not the first 2700 names")
    index = {}
    for k, n in enumerate(names):
        index.setdefault(n, k)
    lookup = lambda n: index.get(_key(n), -1)
    first = lambda n: (lambda k: k if k < FIRST_COUNT else -1)(lookup(n))
    sprite, p = {}, SPRITE_SEEN
    while (at := struct.unpack_from("<Q", image, p)[0]) != 0:
        k = lookup(image[at:image.index(b"\0", at)].decode("ascii"))
        if k >= 0:
            sprite[k] = struct.unpack_from("<i", image, p + 12)[0]   # 0x77360: a later record replaces an earlier one
        p += 16

    def bit(k):
        if k >= 0 and flags[k]:
            k = lookup(names[k][:-6])
        if k > FIRST_COUNT:
            k = sprite.get(k, -1)
        return k if 0 <= k < SEEN_BITS else None
    return lookup, first, bit, names


def _alias_bits(image, cstr, lookup, first, bit):
    """0x51E0 for each of the 105 alias rows: the bits whose seen state lists the row's picture. Alternates are tried in
    turn; one found among the first 2700 names (or shorter than 6 characters) decides with its own bit and ends the
    search; any other is tried with character 4 set to A, L, M and S (0x62110)."""
    out = {}
    for k in range(ALIAS_COUNT):
        row = [cstr(p) if p else None for p in struct.unpack_from("<5Q", image, ALIAS_TABLE + 40 * k)]
        bits = []
        for a in row[1:]:
            if a is None:
                break
            i = first(a)
            if i >= 0 or len(a) < 6:
                b = bit(i)
                if b is not None:
                    bits.append(b)
                break
            for letter in "ALMS":
                b = bit(lookup(a[:4] + letter + a[5:]))
                if b is not None and b not in bits:
                    bits.append(b)
        out[row[0]] = bits
    return out


def _endings(image, text, scripts_dir):
    """The ending list rows, with what earlier progress can be judged from (see app/js/endings.js)."""
    index = json.loads((scripts_dir / "index.json").read_text())
    names = index["names"]
    script = lambda i: json.loads((scripts_dir / f"{i}.json").read_text())
    # Which completed scene leads into each episode: the last RDED before a bad end's JUMP 3100 (QACALL) to it.
    lead = {}
    for i in range(len(names)):
        last = None
        for op in script(i)["ops"]:
            if op[0] == "RDED":
                last = int(op[1])
            elif op[0] == "JUMP" and op[1] == "3100" and len(op) > 2 and last is not None:
                lead.setdefault(op[2], []).append(last)
    rows = []
    for k in range(ENDING_COUNT):
        scene, message, _ = struct.unpack_from("<3i", image, ENDING_TABLE + 12 * k)
        if not FIRST_EPISODE <= scene <= FINAL_EPISODE or not 28 <= message <= 52:
            raise ValueError(f"Unexpected ending row {k}: {scene}, {message}")
        name = f"QA_{scene - 532:02d}"
        ops = script(names.index(name))["ops"]
        lines = [int(m) for op in ops if op[0] in ("MSG", "MSAD") for m in re.findall(r"\$(\d+)", op[1] if len(op) > 1 else "")][:3]
        kind = "main" if k < 3 else "final" if scene == FINAL_EPISODE else "bad"
        rows.append({"kind": kind, "scene": scene, "episode": scene - 532, "script": name,
                     "label": "LBL_COMPOK" if kind == "final" else None,
                     "title": text[1380 + message], "prompt": text[1443 + message].replace("？", "?"),
                     "from": sorted(set(lead.get(name, []))), "lines": lines})
    if [r["kind"] for r in rows].count("bad") != 21:
        raise ValueError("Ending table does not have 21 bad ends")
    return {"list": rows, "hint": [text[1445 + n].replace("？", "?") if n else "" for n in range(26)],
            "complete": text[239]}


def build(root, out=None):
    """out: where gallery.json and the thumbnail sheet go (build_ja.py: web/assets/ja); everything read is the shared web/assets."""
    root = Path(root).resolve()
    assets = root / "web/assets"
    dest = Path(out) if out else assets
    image = _image(root)
    packs, Rom = _pack_tools(root)
    rom = Rom(str(root))
    text = _messages(rom, packs)[0][0]

    def cstr(p):
        return image[p:image.index(b"\0", p)].decode("ascii")

    lookup, first, bit, names = _seen_model(image)
    alias = _alias_bits(image, cstr, lookup, first, bit)
    cg = []
    for g in range(CG_COUNT):
        p = struct.unpack_from("<Q", image, CG_TABLE + 32 * g)[0]
        gate = struct.unpack_from("<i", image, CG_TABLE + 32 * g + 8)[0]
        if not 0 <= gate <= 19:
            raise ValueError(f"Unexpected gate code {gate} in entry {g}")
        variants = []
        while (name := struct.unpack_from("<Q", image, p)[0]) != 0:
            cell, x, y, w, h, flag = struct.unpack_from("<6i", image, p + 8)
            raw = cstr(name + 1)   # 0x4470 reads the name from its second character
            m = re.search(r"IMG\d{4}", raw)
            if not m or not 0 <= cell < 36 * 55:
                raise ValueError(f"Unexpected gallery variant in entry {g}")
            own = bit(first(raw))
            bits = ([own] if own is not None else []) + [b for b in alias.get(raw, []) if b != own]
            variants.append({"image": m[0], "cell": cell, "x": x, "y": y, "w": w, "h": h, "flag": flag, "bits": bits})
            p += 32
        if not variants:
            raise ValueError(f"Gallery entry {g} has no variants")
        cg.append({"gate": gate, "variants": variants})
    if not {_key(a) for a in alias} <= {v["image"] for e in cg for v in e["variants"]}:
        raise ValueError("Every alias row should name a gallery picture")
    wanted = {b for e in cg for v in e["variants"] for b in v["bits"]}
    seen = {n: b for k, n in enumerate(names) if (b := bit(k)) in wanted}

    bgm = json.loads((assets / "audio_tables.json").read_text())["bgm"]
    music = []
    for k in range(MUSIC_ROWS):
        r = struct.unpack_from("<14i", image, MUSIC_TABLE + MUSIC_STRIDE * k)
        stream = bgm.get(str(r[0] - 1))
        if not 0 <= r[1] < len(text) or not stream:
            raise ValueError(f"Unexpected music row {k}: {r}")
        credits = {role: text[i] for role, i in zip(("singer", "lyrics", "composer", "arrangement"), r[2:6]) if i >= 0}
        names = list(dict.fromkeys(credits.values()))
        row = {"title": " ".join(text[r[1]].replace("^", " ").split()), "composers": names, "credits": credits,
               "music": r[0], "stream": stream, "also": [n for n in r[9:14] if n > 0],
               "ms": r[6], "loopStart": r[7], "loopEnd": r[8]}
        if r[0] in MUSIC_MOVIE:
            row["movie"] = MUSIC_MOVIE[r[0]]
        if r[0] in MUSIC_SCENE:
            row["scene"] = MUSIC_SCENE[r[0]]
        music.append(row)

    endings = _endings(image, text, assets / "scripts")

    films = json.loads((assets / "audio_tables.json").read_text())["movies"]
    movie_list = []
    for k in range(MOVIE_COUNT):
        record = struct.unpack_from("<Q", image, MOVIE_CELLS + 8 * k)[0]
        cell = struct.unpack_from("<Q", image, record + 8)[0]
        y = struct.unpack_from("<i", image, cell + 20)[0] >> 16
        name = films.get(str(k + 4))
        if not name or (y - 8) % 152 or not 0 <= (y - 8) // 152 < 3:
            raise ValueError(f"Unexpected movie gallery row {k}")
        movie_list.append({"name": name, "number": k + 4, "row": (y - 8) // 152, "bit": k - 1 if k else None})
    music_text = {"locked": text[244], "labels": [text[245 + i] for i in range(4)]}

    data = {"version": 1, "cg": cg, "seen": seen, "music": music, "musicText": music_text, "movies": MOVIES,
            "movieList": movie_list, "endings": endings,
            "layout": {"thumbCell": [154, 87], "thumbColumns": 36, "thumbScale": 1.5,
                       "grid": {"x": 392, "y": 109, "dx": 240, "dy": 139, "columns": 6}}}
    out = dest / "gallery.json"
    out.with_suffix(".json.tmp").write_text(json.dumps(data, ensure_ascii=bool(dest == assets), separators=(",", ":")))
    os.replace(out.with_suffix(".json.tmp"), out)

    # The thumbnail atlas: 5544 x 4840, too large to keep lossless like the other interface art.
    import tex
    from PIL import Image
    for _, name, off, stored, _ in packs.entries(rom, "allui"):
        if name.upper().startswith("CG_THUMB_PARTS_JA"):
            _, raw, _, _ = packs.unwrap(rom.read("allui.mrg", off, stored))
            t = next(iter(tex.textures(raw)))
            folder = dest / "ui/CG_THUMB_PARTS_JA"
            folder.mkdir(parents=True, exist_ok=True)
            Image.fromarray(tex.decode(t, raw), "RGBA").convert("RGB").save(folder / "cg_thumb_all.webp", "WEBP", quality=86, method=4)
            break
    else:
        raise ValueError("CG_THUMB_PARTS_JA not found")
    print(f"gallery: {len(cg)} CG entries ({sum(len(e['variants']) for e in cg)} pictures,"
          f" {sum(1 for e in cg if e['gate'])} gated, {len(seen)} names setting {len(wanted)} seen bits),"
          f" {len(music)} tracks, {len(MOVIES)} movies, {len(endings['list'])} ending list rows")


if __name__ == "__main__":
    build(sys.argv[1] if len(sys.argv) > 1 else HERE.parents[1])
