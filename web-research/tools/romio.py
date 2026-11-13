"""romio.py - read the game's RomFS straight from the dump, using the table the Mac build already made.

Rom(root): the base RomFS (data/tsuki/romfs_source.bin + base_game.nsp), with mods/japan/<patch>/romfs on top when
overlay=True. A .nxrcp layer (a big patched file kept as a recipe over the dump) is read through its extents.
Nothing here needs prod.keys: the content key is in the table.
"""
import bisect
import os
import struct

from Crypto.Cipher import AES
from Crypto.Util import Counter


class Rom:
    def __init__(self, root, patch=None, overlay=True):
        # the layer read on top of the dump: the translation, unless TSUKI_LAYER names another (build_ja.py: "_update_v131072", the original game)
        patch = patch or os.environ.get("TSUKI_LAYER") or "tsukihimates_patch"
        self.root = root
        raw = open(os.path.join(root, "data/tsuki/romfs_source.bin"), "rb").read()
        assert raw[:8] == b"NXRSRC1\0"
        self.pid, self.nca_off, self.nca_size, self.l6, self.l6_size = struct.unpack_from("<QQQQQ", raw, 16)
        self.upper, self.key = raw[56:64], raw[64:80]
        p = 0x150
        n = struct.unpack_from("<I", raw, p)[0]; p += 4 + n
        n = struct.unpack_from("<I", raw, p)[0]; p += 4
        for _ in range(n):
            s = struct.unpack_from("<I", raw, p)[0]; p += 4 + s
        n = struct.unpack_from("<I", raw, p)[0]; p += 4
        self.base = {}
        for _ in range(n):
            o, s, ln = struct.unpack_from("<QQI", raw, p); p += 20
            self.base[raw[p:p + ln].decode()] = (o, s); p += ln
        self.dump = open(os.path.join(root, "base_game.nsp"), "rb")
        self.layer = {}
        if overlay and patch:
            top = os.path.join(root, "mods/japan", patch, "romfs")
            for d, _, fs in os.walk(top):
                for f in fs:
                    full = os.path.join(d, f)
                    rel = os.path.relpath(full, top)
                    if rel.endswith(".nxrcp"):
                        self.layer[rel[:-6]] = ("rcp", full)
                    else:
                        self.layer[rel] = ("file", full)
        self._rcp = {}

    def names(self):
        return sorted(set(self.base) | set(self.layer))

    def size(self, name):
        if name in self.layer:
            kind, full = self.layer[name]
            if kind == "file":
                return os.path.getsize(full)
            return self._recipe(full)["size"]
        return self.base[name][1]

    def origin(self, name):
        return "patch" if name in self.layer else "base"

    def _read_l6(self, off, n):
        abs_ = self.l6 + off
        start = abs_ & ~0xF
        pad = abs_ - start
        self.dump.seek(self.nca_off + start)
        ct = self.dump.read((n + pad + 15) & ~0xF)
        ctr = Counter.new(64, prefix=self.upper[::-1] if False else self.upper, initial_value=start >> 4)
        return AES.new(self.key, AES.MODE_CTR, counter=ctr).decrypt(ct)[pad:pad + n]

    def _recipe(self, full):
        r = self._rcp.get(full)
        if r:
            return r
        f = open(full, "rb")
        hd = f.read(48)
        assert hd[:8] == b"NXRCP1\0\0" or hd[:2] == b"NX", hd[:8]
        _, n, size, _, _, data = struct.unpack_from("<IIQQQQ", hd, 8)
        rows = f.read(16 * n)
        ext, at = [], 0
        for k in range(n):
            m, src = struct.unpack_from("<QQ", rows, 16 * k)
            ext.append((at, m, src)); at += m
        r = {"f": f, "size": size, "data": data, "ext": ext, "starts": [e[0] for e in ext]}
        self._rcp[full] = r
        return r

    def read(self, name, off=0, n=None):
        size = self.size(name)
        if n is None:
            n = size - off
        n = max(0, min(n, size - off))
        if name in self.layer:
            kind, full = self.layer[name]
            if kind == "file":
                with open(full, "rb") as f:
                    f.seek(off)
                    return f.read(n)
            r = self._recipe(full)
            out = bytearray()
            k = bisect.bisect_right(r["starts"], off) - 1
            LIT = 1 << 63
            while n > 0 and 0 <= k < len(r["ext"]):
                at, m, src = r["ext"][k]
                i = off - at
                c = min(m - i, n)
                if src & LIT:
                    r["f"].seek(r["data"] + (src & ~LIT) + i)
                    out += r["f"].read(c)
                else:
                    out += self._read_l6(src + i, c)
                off, n, k = off + c, n - c, k + 1
            return bytes(out)
        o, _ = self.base[name]
        return self._read_l6(o + off, n)
