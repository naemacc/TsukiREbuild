#!/usr/bin/env python3
"""make_fullsave.py <savedata000>: writes web/app/js/fullsave.js, the progress of a finished game for SAVE DATA's "Load 100% save".

What is kept of the save is its system data alone (the first 0x1740 bytes: the global variables with the flowchart's bits, the pictures seen
and music heard, the read marks, the choices taken; web/app/js/gamesave.js has the layout), about 6 KB. Not its 140 records, which the port
does not read. The config in it is replaced by the game's first one, so that nobody's settings travel with it (the port does not load a
100% save's settings anyway), and the newest-record and last-slot numbers are cleared, there being no records.
"""
import base64
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SIZE, SYSTEM, CONFIG, CONFIG_SIZE, NEWEST, LAST_SLOT = 0x3E7000, 0x1740, 4, 0x68, 0x161E, 0x1622


def main(argv):
    if len(argv) != 1:
        raise SystemExit(__doc__)
    save = Path(argv[0]).read_bytes()
    if len(save) != SIZE or save[:2] != b"\xed\x03":
        raise SystemExit("not a savedata000 of this game")
    gamesave = (ROOT / "web/app/js/gamesave.js").read_text(encoding="utf-8")
    default = bytes(int(h, 16) for h in re.search(r'DEFAULT_CONFIG = Uint8Array\.from\("([0-9a-f ]+)"', gamesave).group(1).split())
    assert len(default) == CONFIG_SIZE
    system = bytearray(save[:SYSTEM])
    system[CONFIG:CONFIG + CONFIG_SIZE] = default
    system[NEWEST:NEWEST + 2] = b"\0\0"
    system[LAST_SLOT:LAST_SLOT + 2] = b"\0\0"
    text = base64.b64encode(bytes(system)).decode()
    lines = "\n".join(f'  "{text[i:i + 160]}",' for i in range(0, len(text), 160))
    (ROOT / "web/app/js/fullsave.js").write_text(f'''// fullsave.js - a finished game's progress, for SAVE DATA's "Load 100% save" (home.js). Written by web-dev/tools/make_fullsave.py from a 100% save of
// the original game: its system data alone (gamesave.js: the globals with the flowchart's bits, the pictures seen and music heard, the read marks, the
// choices taken), with the game's first config in place of the player's and no records.
import {{ GAME }} from "./gamesave.js";

const SYSTEM = [
{lines}
].join("");

// The save as a file of the game's size: the system data, and 140 empty records.
export function fullSaveFile() {{
  const file = new Uint8Array(GAME.size), system = atob(SYSTEM);
  for (let i = 0; i < system.length; i++) file[i] = system.charCodeAt(i);
  return file;
}}
''', encoding="utf-8")
    print(f"wrote web/app/js/fullsave.js ({len(text)} characters of base64 for {len(system)} bytes)")


if __name__ == "__main__":
    main(sys.argv[1:])
