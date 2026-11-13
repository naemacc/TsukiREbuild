#!/usr/bin/env python3
"""build_system.py <repo root>: engine tables the web version's sound settings, sound effects and system questions
need -> web/assets/system.json. Like build_effects.py it reads the owner's prepared Japanese main image (and rejects
any other) plus the sound archive and SYSMES_TEXT.DAT of the dump. No game data belongs in this file or in git.

voices (the sound page's 19 character rows, native 0x2d980 / 0x29fa0 / 0x2b930, and voice playback 0x6e0d0):
  prefixes   the first three letters of a voice file -> speaker id (table of 55 x 16 bytes at 0x44d970, 0x2360)
  speakers   speaker id -> character bit mask (24 ints the GOT slot 0xae04d8 points at; 0x29390 takes log2)
  rowFlags   character row -> global variable whose bit 4 says its voice has been heard (0x34d4b4; 0x29300 sets it,
             0x29fa0 only lists rows that have it); bit 1 reveals a hidden name, bit 2 a hidden face
  faces      face cells of CONF_PARTS_JA/conf_faceicon (0x34d500, 8 bytes each: x0, y0, x1, y1)
  names      name cells of CONF_PARTS_JA/conf_name (0x34d5a0)
seLoops: sound effect name -> [loop start, loop end, sample rate] for every looped wave of knife1.bfsar a script plays.
musicLoops: music stream name -> [loop start, loop end] in 48 kHz frames, from each stream sound's info in
  knife1.bfsar (StreamSoundInfo, reference 0x2210 at +0x18: flags, loop start, loop end). The Music Player's table at
  0x34bd6c repeats the same numbers.
windows: the text window's 33 styles (F1105; native 0x391a0): style -> [texture of DISP_PARTS_JA, x, y, text x, text y,
  line width], from the table at 0x34d94c (picture slot, x, y in 1280 x 720), the text offsets at 0x34dad8 and the
  line widths at 0x34defc (640 x 448 units) for the balloons (3-32); windowOffsets: the x and y offsets F1106 / F1107
  pick from (0x34d84c, 0x34d8b8). Styles 0-2 are the three full windows.
help: the help bars along the bottom of the screens (native 0x4a8f0): glyphs, the controller cells of
  DISP_PARTS_JA/help_key (0x590c1c); screens, each screen's items as [kind, id] (0x34fd48, 0xa0 bytes a screen; kind 0 a
  glyph, 1 a label); labels, the cells of help_txt_ja in its reading order (the engine reads their rectangles from a
  data file at run time, so they are measured from the picture here).
volumeCurve: the 101 values at 0x3355f0 that 0xca0 interpolates: the amplitude curve of music (after the 0.77 Bezier,
  0x9b5d0) and of sound effects (0x9b690); see audio.js. soundVolume: the per-sound volume byte every sound of
  knife1.bfsar carries (SoundInfo +8, 127 = full: 0x106880), the same for all of them.
messages: SYSMES strings the system questions use, by their message number.
dialogs: the system dialogs' SYSMES numbers by dialog number (table 0x3c9340; -1 none), as 0x49710 picks them.
config: the config's widgets as the engine lays them out (0x2aa80 draws them through the button system, 0xaeec0),
  in 1920 x 1080 pixels (the engine's 640 x 448 units x 3 and x 1080 / 448):
  buttons    widget id -> group, flags, hit box [x0, y0, x1, y1] from the widget's place, and five states (0 normal,
             1 lit, 2 on, 3 lit and on, 4 pressed), each a list of cells {tex: a CONF_PARTS_JA texture, x, y: offset
             from the place, rect: [x0, y0, x1, y1] in the texture}; from the 0x30-byte definitions at 0x46b370 (id,
             group, flags, hit box in units, image set pointer at +0x20) and their image sets (0x46eb20: five
             {count, cells} of 0x20-byte cells: slot, flags, blend, x, y, rect, colour)
  pages      the three pages' grids (0x46cdb0, 0x9d0 a page): 26 rows of up to 5 widgets in cursor order, each
             {kind, id, x, y} (x, y null where 0x29fa0 places the row at run time: the character rows), the row's
             widget count and its slider's maximum; scrollMax, the page's scroll range (0x46f820; the Sound page's is
             set from its character rows by 0x2a730)
saves: the system menu's and save screen's tables, by chapter number F023: phaseCells, the cell of
  MENU_PARTS_JA/system_phasetitle_ja the menu header draws (0x591558, 38 rects x0, y0, x1, y1; 0x4c370);
  saveTitleCells, the cell of SAVE_PARTS_JA/savetitle each save row draws (0x592484, 38; 0x4f240); infoPictures, the
  save screen's picture for F023 11-36 (0x3506b0: slots 548-550 = SAVE_PARTS_JA textures 3-5, saveinfobg_arc / _ciel
  / _unknown; others unknown); sceneNames, SYSMES 395 + F022 for F022 1-516, the scene name of the menu's band and of
  each save row (0x4c370, 0x50b10).
"""
import hashlib
import json
import math
import os
from pathlib import Path
import re
import struct
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE / "../../web-research/tools"))

IMAGE_SHA256 = "ac6b01203d0e82e33c38ca9ef2fa0d55f1e55d851919196f9073cdafc41b7951"
PREFIXES, PREFIX_COUNT = 0x44D970, 55
SPEAKER_GOT, SPEAKER_COUNT = 0xAE04D8, 24
ROW_FLAGS, FACES, NAMES, ROWS = 0x34D4B4, 0x34D500, 0x34D5A0, 19
# Rows whose name stays "????" until a script sets bit 1 of the row's flag (immediate 0x3cf36 tested at 0x2a268).
HIDDEN_NAMES = 0x3CF36
# SYSMES numbers: 216 "Save Progress?" (SELA, 0x92930 -> selector type 3), the system dialogs' table at 0x3c9340;
# 1433-1442 "0." .. "9.", which SELR puts before each choice row (row n gets 1433 + (n + 1) % 10, listing 0x7dab8).
MESSAGES = (160, 178, 179, 216, 229, 230, 231, 232, 233, 234, 1497) + tuple(range(1433, 1443)) + (
    180, 183, 184, 212, 239, 1496) + (
    # the config's samples (0x2d570) and the buttons' captions (their tables' +0x28: 0x46b370, 0x591438, 0x5918c8)
    138, 139, 1, 140, 158, 159, 161, 162, 163, 166, 168) + tuple(range(169, 177)) + (186,)
DIALOGS, DIALOG_COUNT = 0x3C9340, 32
PHASE_CELLS, SAVE_TITLE_CELLS, CELL_COUNT = 0x591558, 0x592484, 38
INFO_PICTURES, INFO_COUNT = 0x3506B0, 26
INFO_SLOTS = {548: "saveinfobg_arc", 549: "saveinfobg_ciel", 550: "saveinfobg_unknown"}
SCENE_NAMES, SCENE_COUNT = 395, 516
VOLUME_CURVE = 0x3355F0


def relocations(image):
    mod = struct.unpack_from("<I", image, 4)[0]
    if image[mod:mod + 4] != b"MOD0":
        raise ValueError("no MOD0 header")
    dyn = mod + struct.unpack_from("<i", image, mod + 4)[0]
    tags, p = {}, dyn
    while True:
        t, v = struct.unpack_from("<qQ", image, p)
        p += 16
        if t == 0:
            break
        tags.setdefault(t, v)
    rel = {}
    for q in range(tags[7], tags[7] + tags[8], 24):
        off, info, add = struct.unpack_from("<QQq", image, q)
        if info & 0xFFFFFFFF == 0x403:   # R_AARCH64_RELATIVE
            rel[off] = add
    return rel


def cstr(image, a):
    return image[a:image.index(b"\0", a)].decode("latin1")


def voices(image, rel):
    prefixes = {}
    for i in range(PREFIX_COUNT):
        p = PREFIXES + 16 * i
        prefixes[cstr(image, rel[p])] = struct.unpack_from("<i", image, p + 8)[0]
    speakers = list(struct.unpack_from(f"<{SPEAKER_COUNT}i", image, rel[SPEAKER_GOT]))
    return {
        "prefixes": prefixes,
        "speakers": speakers,
        "rowFlags": list(struct.unpack_from(f"<{ROWS}i", image, ROW_FLAGS)),
        "faces": [list(struct.unpack_from("<4h", image, FACES + 8 * i)) for i in range(ROWS + 1)],
        "names": [list(struct.unpack_from("<4h", image, NAMES + 8 * i)) for i in range(ROWS + 2)],
        "hiddenNames": HIDDEN_NAMES,
    }


def se_loops(root):
    import convert
    rom = convert.open_rom(str(root))
    archive = convert.get_sar(rom)
    names = set()
    for f in (root / "web/assets/scripts").glob("[0-9]*.json"):
        for op in json.loads(f.read_text())["ops"]:
            if op[0] == "SEPL" and len(op) > 3 and op[3]:
                names.add(op[3].upper())
    loops = {}
    for n in sorted(names):
        try:
            info = archive.loop_of(n)
        except Exception as e:   # a name the archive does not have
            print("no sound", n, e)
            continue
        if info and info["loop"] and info["end"] > info["start"] >= 0:
            loops[n] = [info["start"], info["end"], info["rate"]]
    return loops, rom


WINDOW_STYLES, X_OFFSETS, Y_OFFSETS, TEXT_OFFSETS, LINE_WIDTHS = 0x34D94C, 0x34D84C, 0x34D8B8, 0x34DAD8, 0x34DEFC


def ui_slots(image, rel, pack):
    """Picture slot -> texture index for one interface pack: rows (flag, slot, name pointer, index, -1) found through
    the relocations that point at the pack's file name."""
    slots = {}
    for a, v in rel.items():
        try:
            name = cstr(image, v)
        except ValueError:
            continue
        if name.lower() == pack:
            slot = struct.unpack_from("<i", image, a - 4)[0]
            slots[slot] = struct.unpack_from("<i", image, a + 8)[0]
    return slots


def texture_names(rom, pack):
    """The file names build_ui.py gives the pack's textures (its unique_names rule)."""
    import packs
    import tex
    for _, name, off, stored, _ in packs.entries(rom, "allui"):
        if name.split(".")[0] != pack:
            continue
        blob = rom.read("allui.mrg", off, stored)
        _, raw, _, _ = packs.unwrap(blob)
        names = [re.sub(r"[^A-Za-z0-9_-]", "_", t.name) for t in tex.textures(raw)]
        count = {}
        for n in names:
            count[n] = count.get(n, 0) + 1
        return [f"{n}-{k}" if count[n] > 1 else n for k, n in enumerate(names)]
    return []


def windows(image, rel, rom):
    slots = ui_slots(image, rel, "disp_parts.nxgz")
    names = texture_names(rom, "DISP_PARTS_JA")
    styles = []
    for i in range(33):
        slot, x, y = struct.unpack_from("<iff", image, WINDOW_STYLES + 12 * i)
        idx = slots.get(slot)
        tx, ty = struct.unpack_from("<2f", image, TEXT_OFFSETS + 8 * i) if i >= 3 else (0.0, 0.0)
        width = struct.unpack_from("<f", image, LINE_WIDTHS + 4 * (i - 3))[0] if i >= 3 else 0.0
        styles.append([names[idx] if idx is not None and idx < len(names) else None, x, y, tx, ty, round(width, 3)])
    return {"styles": styles, "x": list(struct.unpack_from("<27f", image, X_OFFSETS)),
            "y": list(struct.unpack_from("<37f", image, Y_OFFSETS))}


HELP_GLYPHS, HELP_SCREENS = 0x590C1C, 0x34FD48


def help_tables(image, rom):
    import numpy as np
    import packs
    import tex
    glyphs = [list(struct.unpack_from("<4h", image, HELP_GLYPHS + 8 * i)) for i in range(23)]
    screens = []
    for scr in range(11):
        items = []
        for k in range(20):
            kind, ident = struct.unpack_from("<2i", image, HELP_SCREENS + scr * 0xA0 + 8 * k)
            if kind < 0:
                break
            items.append([kind, ident])
        screens.append(items)
    labels = []
    for _, name, off, stored, _ in packs.entries(rom, "allui"):
        if name.split(".")[0] != "DISP_PARTS_JA":
            continue
        _, raw, _, _ = packs.unwrap(rom.read("allui.mrg", off, stored))
        t = next(t for t in tex.textures(raw) if t.name == "help_txt_ja")
        alpha = tex.decode(t, raw)[..., 3]
        rows = np.where(alpha.max(axis=1) > 20)[0]
        bands, start, prev = [], rows[0], rows[0]
        for r in rows[1:]:
            if r != prev + 1:
                bands.append((start, prev))
                start = r
            prev = r
        bands.append((start, prev))
        # A label is a run of columns. The spaces inside an English one are under 7 pixels, but a Japanese word can have wider ones (ロ|ー|ド 7 and 8,
        # データ|コピー 7, 拡大|・|縮小 9 and 9, where the words are 13 or more apart): so the runs are cut at every space over 6 pixels, and then the
        # narrowest spaces between runs are closed until there are as many labels as the screens name (27 in both games).
        runs = []        # [x0, x1, y0, y1, the space before it on its row or None]
        for y0, y1 in bands:
            cols = np.where(alpha[y0:y1 + 1].max(axis=0) > 20)[0]
            run, gap = [cols[0], cols[0]], None
            for c in cols[1:]:
                if c - run[1] > 6:
                    runs.append([int(run[0]), int(run[1]), int(y0), int(y1), gap])
                    run, gap = [c, c], int(c - run[1])
                else:
                    run[1] = c
            runs.append([int(run[0]), int(run[1]), int(y0), int(y1), gap])
        wanted = 1 + max((ident for items in screens for kind, ident in items if kind == 1), default=len(runs) - 1)
        while len(runs) > wanted:
            k = min((i for i in range(1, len(runs)) if runs[i][4] is not None), key=lambda i: runs[i][4])
            runs[k - 1][1] = runs[k][1]
            del runs[k]
        assert len(runs) == wanted, (len(runs), wanted)
        labels = [[x0 - 2, y0 - 3, x1 + 3, y1 + 4] for x0, x1, y0, y1, _ in runs]
        break
    return {"glyphs": glyphs, "screens": screens, "labels": labels}


def music_loops(root, archive):
    b = archive.b
    u16 = lambda o: struct.unpack_from("<H", b, o)[0]
    s32 = lambda o: struct.unpack_from("<i", b, o)[0]
    u32 = lambda o: struct.unpack_from("<I", b, o)[0]
    wanted = set(json.loads((root / "web/assets/audio_tables.json").read_text())["bgm"].values())
    loops = {}
    for _, file_id, at in archive.by_name.values():
        if u16(at + 0x0C) != 0x2201:       # stream sound
            continue
        typ, fat = archive.files[file_id]
        if u16(fat) != 0x220D:              # external file: its path
            continue
        loc = fat + s32(fat + 4)
        path = b[loc:b.index(b"\0", loc)].decode("ascii", "replace")
        name = path.rsplit("/", 1)[-1].rsplit(".", 1)[0]
        if name not in wanted:
            continue
        det = at + s32(at + 0x10)
        if u16(det + 0x18) != 0x2210:
            continue
        ext = det + s32(det + 0x1C)
        start, end = u32(ext + 4), u32(ext + 8)
        if end > start:
            loops[name] = [start, end]
    return loops


IMAGE_TABLE, IMAGE_STRIDE = 0x46F830, 0x48
IMAGE_NAMES, IMAGE_NAME_STRIDE = 0xAE0888, 0x20   # the slot holding the address of the pictures' name table


def image_records(image, rel):
    """The image table (*0xae0540 at run time, records of 0x48 bytes: +0x2c/+0x30 the size and +0x34/+0x38 the pivot
    in the 640 x 362 screen), each record under the name a script finds it by. STCH looks a picture up with 0x55d30:
    it upper-cases the name up to its '.', hashes it and returns the index the name has in the name table at *0xae0888
    (32-byte names, one per record, indexed by 0x55ac0), and 0x60840 reads the image table at that same index. The
    record's own +8 is a file name and is not what scripts match: the expressions of a pose (3,768 records) name the
    pose's shared file there (SIE_A_46_00_N00_B) and their own at +0x10 (SIE_A_46_00_N06), which is their name in the
    name table. Yields (name, (w, h, pivot x, pivot y))."""
    names, k = rel[IMAGE_NAMES], 0
    while (IMAGE_TABLE + IMAGE_STRIDE * k + 8) in rel:
        e = IMAGE_TABLE + IMAGE_STRIDE * k
        raw = image[names + IMAGE_NAME_STRIDE * k:names + IMAGE_NAME_STRIDE * (k + 1)]
        yield raw.split(b"\0")[0].decode("ascii").upper().rsplit(".", 1)[0], struct.unpack_from("<4f", image, e + 0x2C)
        k += 1
    if k < 10000:
        raise ValueError(f"Image table looks wrong ({k} records)")


def image_pivots(image, rel):
    """Each picture's pivot (image_records). STCH copies the pivot to the layer (0x60840: +0x374/+0x414) and the draw
    (0x89ad0 -> 0xb0710) puts that point of the picture at the layer's position and turns it about it; SBAS children
    are placed from it (0x892b0). Kept as fractions of the size, for the pictures whose pivot is not their centre."""
    out = {}
    for name, (w, h, px, py) in image_records(image, rel):
        if name in out or w <= 0 or h <= 0:
            continue
        out[name] = [round(px / w, 5), round(py / h, 5)]
    return {n: a for n, a in out.items() if abs(a[0] - 0.5) > 1e-4 or abs(a[1] - 0.5) > 1e-4}


def image_pivot_cuts(image, rel):
    """What STCH and SCH2 without a source lose of each picture's pivot: 0x60840 (listing 0x62024) stores the table's
    pivot cut to whole units (fcvtzs) as the layer's pivot. Kept as fractions of the size, for the pictures whose pivot
    is not whole (most: the centre of an odd size, or of a height like 728.357)."""
    out = {}
    for name, (w, h, px, py) in image_records(image, rel):
        if name in out or w <= 0 or h <= 0:
            continue
        out[name] = [round((px - math.trunc(px)) / w, 6), round((py - math.trunc(py)) / h, 6)]
    return {n: c for n, c in out.items() if c[0] or c[1]}


def image_sizes(image, rel):
    """The size the engine draws each picture at when the table's (+0x2c / +0x30, 640 x 362 units) differs from its stored
    pixels (1,143 x 3,155 against 1,113 x 3,080 for Z20_L_10_00_N00, the colour cards' 640 x 362 against 1920 x 1080): the
    draw (0x89ad0 -> 0xb0710) lays the texture over the table's rectangle. Kept as stored-pixel sizes (x 2 and x 720 / 362), only
    for the pictures whose size differs (name -> [w, h])."""
    out = {}
    for name, (w, h, px, py) in image_records(image, rel):
        if name in out or w <= 0 or h <= 0:
            continue
        out[name] = [round(w * 2, 2), round(h * 720 / 362, 2)]
    # only what differs from the stored sizes (assets/images.json), when those are known here
    sizes_path = Path(HERE) / "../../web/assets/images.json"
    if sizes_path.exists():
        stored = json.loads(sizes_path.read_text())
        out = {n: v for n, v in out.items() if n in stored and (abs(v[0] / stored[n][0] - 1) > 0.002 or abs(v[1] / stored[n][1] - 1) > 0.002)}
    return out


def messages(root, rom):
    import native_flowchart as nf
    packs, _ = nf._pack_tools(root)
    langs, digest = nf._messages(rom, packs)
    text = langs[0]
    return {str(k): text[k] for k in MESSAGES if k < len(text)}, digest, text


def sound_volume(archive):
    vols = {archive.b[at + 8] for _, at in archive.sounds}
    if len(vols) != 1:
        raise ValueError(f"sounds with different volumes: {sorted(vols)}")
    return vols.pop()


def save_tables(image, text):
    rects = lambda at: [list(struct.unpack_from("<4h", image, at + 8 * i)) for i in range(CELL_COUNT)]
    info = [INFO_SLOTS.get(v, "saveinfobg_unknown") for v in struct.unpack_from("<%di" % INFO_COUNT, image, INFO_PICTURES)]
    return {"phaseCells": rects(PHASE_CELLS), "saveTitleCells": rects(SAVE_TITLE_CELLS), "infoPictures": info,
            "sceneNames": [""] + [text[SCENE_NAMES + n] for n in range(1, SCENE_COUNT + 1)]}


CONF_BUTTONS, CONF_BUTTONS_END, CONF_PAGES, CONF_PAGE_SIZE, CONF_SCROLL = 0x46B370, 0x46CD80, 0x46CDB0, 0x9D0, 0x46F820
UNIT_X, UNIT_Y = 3.0, 1080 / 448     # the engine's 640 x 448 units in 1920 x 1080 pixels


def config_tables(image, rel, rom):
    slots = ui_slots(image, rel, "conf_parts.nxgz")
    names = texture_names(rom, "CONF_PARTS_JA")
    i32 = lambda a: struct.unpack_from("<i", image, a)[0]
    f32 = lambda a: struct.unpack_from("<f", image, a)[0]
    px = lambda v, k: round(v * k, 3)

    def cell(q):
        slot, _flags, blend = struct.unpack_from("<3i", image, q)
        x, y = struct.unpack_from("<2f", image, q + 12)
        colour = struct.unpack_from("<I", image, q + 28)[0]
        if blend or colour != 0xFFFFFFFF:     # every config cell is drawn plainly: no blend of its own, white
            raise ValueError(f"config cell at {q:#x}: blend {blend}, colour {colour:#x}")
        return {"tex": names[slots[slot]], "x": px(x, UNIT_X), "y": px(y, UNIT_Y),
                "rect": list(struct.unpack_from("<4h", image, q + 20))}

    buttons = {}
    for a in range(CONF_BUTTONS, CONF_BUTTONS_END, 0x30):
        bid, group, flags = struct.unpack_from("<3i", image, a)
        hx0, hy0, hx1, hy1 = struct.unpack_from("<4H", image, a + 0xC)
        sets = rel[a + 0x20]
        states = [[cell(rel[sets + 0x10 * s + 8] + 0x20 * k) for k in range(i32(sets + 0x10 * s))] for s in range(5)]
        buttons[str(bid)] = {"group": group, "flags": flags, "caption": i32(a + 0x28), "states": states,
                             "hit": [px(hx0, UNIT_X), px(hy0, UNIT_Y), px(hx1, UNIT_X), px(hy1, UNIT_Y)]}
    pages = []
    for p in range(3):
        b = CONF_PAGES + p * CONF_PAGE_SIZE
        rows = []
        for r in range(26):
            widgets = []
            for c in range(5):
                wid = i32(b + 0x280 + 0x14 * r + 4 * c)
                if wid <= 0:
                    continue
                x, y = f32(b + 0x488 + 0x28 * r + 8 * c), f32(b + 0x48C + 0x28 * r + 8 * c)
                placed = x > -9999
                widgets.append({"kind": i32(b + 0x78 + 0x14 * r + 4 * c), "id": wid,
                                "x": px(x, UNIT_X) if placed else None, "y": px(y, UNIT_Y) if placed else None})
            rows.append({"count": i32(b + 0x10 + 4 * r), "max": i32(b + 0x968 + 4 * r), "widgets": widgets})
        while rows and not rows[-1]["widgets"]:
            rows.pop()
        pages.append({"rows": rows, "scrollMax": i32(CONF_SCROLL + 4 * p)})
    return {"buttons": buttons, "pages": pages}


def build(root, out=None):
    root = Path(root).resolve()
    out = Path(out) if out else root / "web/assets"
    image = (root / "data/tsuki/analysis/main.bin").read_bytes()
    digest = hashlib.sha256(image).hexdigest()
    if digest != IMAGE_SHA256:
        raise ValueError(f"Unsupported main image for the system tables: {digest}")
    rel = relocations(image)
    loops, rom = se_loops(root)
    import convert
    archive = convert.get_sar(rom)
    music = music_loops(root, archive)
    msgs, msg_digest, text = messages(root, rom)
    dialogs = list(struct.unpack_from("<%di" % DIALOG_COUNT, image, DIALOGS))
    for n in dialogs:
        if n >= 0:
            msgs[str(n)] = text[n]
    data = {"version": 1, "source": digest, "voices": voices(image, rel), "seLoops": loops, "musicLoops": music,
            "volumeCurve": list(struct.unpack_from("<101f", image, VOLUME_CURVE)), "soundVolume": sound_volume(archive),
            "windows": windows(image, rel, rom), "pivots": image_pivots(image, rel), "pivotCuts": image_pivot_cuts(image, rel), "imageSizes": image_sizes(image, rel), "help": help_tables(image, rom), "messages": msgs,
            "messagesSource": msg_digest, "dialogs": dialogs, "saves": save_tables(image, text),
            "config": config_tables(image, rel, rom)}
    target = out / "system.json"
    temp = target.with_suffix(".json.tmp")
    temp.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    os.replace(temp, target)
    print(f"voice rows {ROWS}, looped sound effects {len(loops)}, music loops {len(music)}, messages {len(msgs)},"
          f" off-centre pivots {len(data['pivots'])}, cut pivots {len(data['pivotCuts'])}")
    return data


if __name__ == "__main__":
    build(sys.argv[1] if len(sys.argv) > 1 else HERE.parents[1])
