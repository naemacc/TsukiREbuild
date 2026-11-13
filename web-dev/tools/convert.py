"""convert.py - one game asset to a browser format. Used by server.py on demand and by convert_all.py in bulk.

  img    image of the archives -> AVIF, no larger than the scripts ever draw it (assets/images.json)
  voice  stream/<name>.opus (Nintendo's container) -> the same Opus packets in an Ogg file: lossless, no re-encoding
  bgm    the same for music, by its number in the scripts
  se     a sound of knife1.bfsar (DSP-ADPCM) -> Opus in Ogg, through ffmpeg
  sys    interface sound n (0-8), by the engine's own table of sound ids -> the same
  movie  the game's H.264 movie -> AV1 in MP4 through ffmpeg (libsvtav1), its AAC sound copied as it is
  font   the game's own file, copied
"""
import io
import json
import math
import os
import struct
import subprocess
import sys
import tempfile
import threading

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "../../web-research/tools"))
from romio import Rom
import packs
import sar

ASSETS = os.path.join(HERE, "../../web/assets")
_scales = None
_table = None
_table_guard = threading.Lock()
_sar = None
_sar_guard = threading.Lock()
_tex = None


def open_rom(root):
    return Rom(root)


def table():
    global _table
    with _table_guard:
        if _table is None:
            _table = json.load(open(os.path.join(HERE, "../data/image_table.json")))
    return _table


def write_atomic(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.{os.getpid()}.{threading.get_ident()}.tmp"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, path)


def load_image(rom, entry):
    global _tex
    if _tex is None:
        import tex as _t
        _tex = _t
    blob = rom.read(entry["p"] + ".mrg", entry["o"], entry["s"])
    if blob[:3] == b"\xff\xd8\xff":
        return Image.open(io.BytesIO(blob)).convert("RGBA")
    if blob[:4] not in (b"NXGX", b"NXCX"):
        return Image.open(io.BytesIO(blob)).convert("RGBA")
    _, raw, _, _ = packs.unwrap(blob)
    t = _tex.textures(raw)[0]
    return Image.fromarray(_tex.decode(t, raw), "RGBA")


def scales():
    global _scales
    if _scales is None:
        _scales = json.load(open(os.path.join(ASSETS, "images.json")))
    return _scales


# A sharp picture whose shape exists only in the game's own blurred copies: name -> (copy, its padding left, top).
# IMG0316 (a tree) is a JPEG with white round it, but the game only ever draws IMG0316_01_01 and _11_04 (09_01_CIEL09_6C,
# 14_01A_CIEL14A_3 and _4 all blur it), and those have the tree cut out. The port blurs the sharp picture itself, so it
# takes the copy's alpha, and the copy's colour where that alpha is partial (dark tree, not the JPEG's white-mixed edge),
# or the white shows as bright rotated rectangles (GitHub issue 7). Checked against all 1,795 blurred copies of opaque
# sharp pictures in the archives: this is the only one.
ALPHA_FROM = {"IMG0316": ("IMG0316_01_01", 8, 8)}


def borrow_alpha(rom, im, copy, dx, dy):
    src = np.asarray(load_image(rom, table()[copy]))[dy:dy + im.height, dx:dx + im.width]
    a = np.array(im)
    part = src[..., 3] < 255
    a[part, :3] = src[part, :3]
    a[..., 3] = src[..., 3]
    return Image.fromarray(a, "RGBA")


def make_img(rom, name, out):
    key = name.upper()
    e = table().get(key)
    if not e:
        return False
    im = load_image(rom, e)
    if key in ALPHA_FROM:
        im = borrow_alpha(rom, im, *ALPHA_FROM[key])
    s = scales().get(key, [0, 0, 1.0])[2]
    w, h = max(1, round(im.width * s)), max(1, round(im.height * s))
    # scale with premultiplied alpha, so transparent edges do not bleed dark
    sm = im if s == 1.0 else im.convert("RGBa").resize((w, h), Image.LANCZOS).convert("RGBA")
    return save_avif(sm, out)


def save_avif(im, out):
    buf = io.BytesIO()
    opaque = im.getextrema()[3][0] == 255
    (im.convert("RGB") if opaque else im).save(buf, "AVIF", quality=70, speed=6)
    write_atomic(out, buf.getvalue())
    return True


def copy_file(rom, rel, out):
    os.makedirs(os.path.dirname(out), exist_ok=True)
    tmp = f"{out}.{os.getpid()}.tmp"
    size, pos = rom.size(rel), 0
    with open(tmp, "wb") as f:
        while pos < size:
            chunk = rom.read(rel, pos, min(1 << 24, size - pos))
            if not chunk:
                raise IOError("short read: " + rel)
            f.write(chunk)
            pos += len(chunk)
    os.replace(tmp, out)
    return True


# Movies: the game's H.264 picture again as AV1 (SVT-AV1) at one constant quality, every frame and its time kept; the AAC sound
# is copied as it is. A key frame every 240 frames puts one on the title movie's loop point (frame 240). The encoder's temporal
# filter is off: it blends the frames around a key frame into it, which made each one in the title's slowly brightening sky 0.6 of
# a level too bright for a frame (measured; 0.05 with it off). A movie that AV1 does not make at least a tenth smaller stays the
# game's own file. No movie may be larger than MOVIE_MAX (hosts such as GitHub refuse a file over 100 MB): one that is, is made
# again at a coarser quality, a file shrinking by about 5.5% for each step of it.
MOVIE_CRF = 24
MOVIE_KEEP = 0.9
MOVIE_MAX = 95_000_000


def make_movie(rom, name, out):
    src, tmp = f"{out}.{os.getpid()}.src.mp4", f"{out}.{os.getpid()}.tmp.mp4"
    try:
        copy_file(rom, f"movie/{name}.mp4", src)
        crf = MOVIE_CRF
        while True:
            subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", src, "-map", "0:v:0", "-map", "0:a?", "-c:v", "libsvtav1", "-preset", "5",
                            "-crf", str(crf), "-svtav1-params", "tune=0:enable-tf=0", "-g", "240", "-pix_fmt", "yuv420p", "-c:a", "copy",
                            "-movflags", "+faststart", tmp], check=True, env={**os.environ, "SVT_LOG": "1"})
            size = os.path.getsize(tmp)
            if size <= MOVIE_MAX or crf >= 50:
                break
            crf = min(50, crf + max(1, math.ceil(math.log(0.93 * MOVIE_MAX / size) / math.log(0.945))))   # aimed a little under, the sound not shrinking
        if size > MOVIE_MAX:
            raise ValueError(f"{name}: {size} bytes at quality {crf}, over {MOVIE_MAX}")
        os.replace(tmp if size < MOVIE_KEEP * os.path.getsize(src) else src, out)
    finally:
        for f in (src, tmp):
            if os.path.exists(f):
                os.unlink(f)
    return True


def make_font(rom, name, out):
    return copy_file(rom, name, out)


# ---- Ogg Opus ---------------------------------------------------------------------------------------------------
_crc = []
for i in range(256):
    r = i << 24
    for _ in range(8):
        r = ((r << 1) ^ 0x04C11DB7) & 0xFFFFFFFF if r & 0x80000000 else (r << 1) & 0xFFFFFFFF
    _crc.append(r)


def ogg_crc(data):
    c = 0
    for b in data:
        c = ((c << 8) & 0xFFFFFFFF) ^ _crc[((c >> 24) ^ b) & 0xFF]
    return c


def ogg_page(serial, seq, granule, flags, packets):
    segs = bytearray()
    body = bytearray()
    for p in packets:
        n = len(p)
        while n >= 255:
            segs.append(255)
            n -= 255
        segs.append(n)
        body += p
    head = bytearray(b"OggS\0" + bytes([flags]) + struct.pack("<qIII", granule, serial, seq, 0) + bytes([len(segs)]) + bytes(segs))
    crc = ogg_crc(bytes(head) + bytes(body))
    head[22:26] = struct.pack("<I", crc)
    return bytes(head) + bytes(body)


_DUR = [480, 960, 1920, 2880] * 3 + [480, 960] * 2 + [120, 240, 480, 960] * 4


def nx_opus_to_ogg(b):
    if b[:4] != b"\x01\x00\x00\x80":
        raise ValueError("not Nintendo Opus")
    ch = b[9]
    rate = struct.unpack_from("<I", b, 12)[0]
    off = struct.unpack_from("<I", b, 0x10)[0]
    pre = struct.unpack_from("<I", b, 0x1C)[0]
    size = struct.unpack_from("<I", b, off + 4)[0]
    p = off + 8
    end = min(len(b), p + size)
    serial = 0x7473756B
    out = bytearray()
    head = b"OpusHead" + bytes([1, ch]) + struct.pack("<HIhB", pre, rate, 0, 0)
    tags = b"OpusTags" + struct.pack("<I", 4) + b"web0" + struct.pack("<I", 0)
    out += ogg_page(serial, 0, 0, 2, [head])
    out += ogg_page(serial, 1, 0, 0, [tags])
    seq, granule = 2, 0
    pend, segs = [], 0
    while p + 8 <= end:
        ln = struct.unpack_from(">I", b, p)[0]
        pkt = b[p + 8:p + 8 + ln]
        p += 8 + ln
        toc = pkt[0]
        c = toc & 3
        fc = 1 if c == 0 else 2 if c in (1, 2) else (pkt[1] & 0x3F)
        need = ln // 255 + 1
        if segs + need > 255 or len(pend) >= 50:
            out += ogg_page(serial, seq, granule, 0, pend)
            seq += 1
            pend, segs = [], 0
        pend.append(pkt)
        segs += need
        granule += _DUR[toc >> 3] * fc
    out += ogg_page(serial, seq, granule, 4, pend)
    return bytes(out)


def make_voice(rom, name, out):
    rel = f"stream/{name}.opus"
    if rel not in rom.base and rel not in rom.layer:
        low = {n.lower(): n for n in rom.names() if n.startswith("stream/")}
        rel = low.get(rel.lower())
        if not rel:
            return False
    write_atomic(out, nx_opus_to_ogg(rom.read(rel)))
    return True


def bgm_names(rom):
    return sorted(n[7:-5] for n in rom.names() if n.startswith("stream/MOON"))


def make_bgm(rom, name, out):
    # name is a stream name; assets/bgm_table.json maps the scripts' numbers to it
    return make_voice(rom, name, out)


def get_sar(rom):
    global _sar
    with _sar_guard:
        if _sar is None:
            _sar = sar.Archive(rom.read("knife1.bfsar"))
    return _sar


def make_se(rom, name, out):
    return encode_wave(get_sar(rom).wave(name), out)


# The interface's own sounds: the engine plays sound n (0-8) through 0xacef0(n) -> 0x710(n), which reads item ids
# from the table at 0x3341a0 of the main image (0x010040d4-0x010040dc: sounds 16596-16604 of knife1.bfsar,
# WSD_MOON_SE00001 ... 00014, nine waves of one wave sound file). The ids are read from the image, not kept here.
SYS_TABLE, SYS_COUNT = 0x3341A0, 9
IMAGE_SHA256 = "ac6b01203d0e82e33c38ca9ef2fa0d55f1e55d851919196f9073cdafc41b7951"
_sys_ids = None


def sys_ids():
    global _sys_ids
    if _sys_ids is None:
        import hashlib
        image = open(os.path.join(HERE, "../../data/tsuki/analysis/main.bin"), "rb").read()
        if hashlib.sha256(image).hexdigest() != IMAGE_SHA256:
            raise ValueError("unsupported main image for the interface sounds")
        _sys_ids = list(struct.unpack_from(f"<{SYS_COUNT}I", image, SYS_TABLE))
    return _sys_ids


def make_sys(rom, name, out):
    if not name.isdigit() or int(name) >= SYS_COUNT:
        return False
    item = sys_ids()[int(name)]
    if item >> 24 != 1:   # item type 1: a sound
        return False
    return encode_wave(get_sar(rom).wave_at(item & 0xFFFFFF), out)


def encode_wave(w, out):
    if not w:
        return False
    pcm, ch, hz = w
    fd, tmpn = tempfile.mkstemp(suffix=".ogg")
    os.close(fd)
    try:
        p = subprocess.run(
            ["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "s16le", "-ac", str(ch), "-ar", str(hz), "-i", "pipe:0",
             "-c:a", "libopus", "-b:a", "96k" if ch > 1 else "64k", "-vbr", "on", tmpn],
            input=pcm, capture_output=True)
        if p.returncode:
            raise RuntimeError(p.stderr.decode()[:200])
        write_atomic(out, open(tmpn, "rb").read())
    finally:
        os.unlink(tmpn)
    return True


def make(rom, kind, name, out):
    return {"img": make_img, "voice": make_voice, "bgm": make_bgm, "se": make_se, "sys": make_sys, "movie": make_movie, "font": make_font}[kind](rom, name, out)
