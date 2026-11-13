# Where the original engine breaks a row

`web-dev/data/ja_rows.json` says, for every Japanese line, where the game's own engine starts a new row. `web-dev/tools/build_ja.py` writes those breaks
into `web/assets/ja/text.json` (and, for messages laid out together with others, into the scripts' `rows`), and the port shows the rows as they are. This
folder is how that file was made, on 2026-11-11.

## Why it is read from the engine and not worked out in the port

The translation's lines come already broken (its injector wraps them at 55 cells), and its patch switches the engine's own wrapping off. The original
wraps Japanese itself, in two steps (addresses are in the unpatched `main`, update v131072, sha256 `6c3e4e38…`):

1. `0xbf0f8` lays a line out. A row is 28 cells (`(1392 + 45.6 / 2 - 45.6) / 49.6 + 1`: the text object is 1392 px wide, a letter 45.6 px with 4 px after
   it). `0x148988` finds where a row may end by Unicode line breaking (UAX #14: a class table of 1,986 ranges at `0x3d0dca`, pair tables at `0x3d3ae4` and
   `0x3d2cd4`), measuring the row through the font.
2. `0xc471c` then applies the game's own rules with three lists: characters that may not start a row (`0x31ddb0`: `、。」』）！？ー` and the small kana
   among them), characters that may not end one (`0x2f764c`: `・「『（【“‘`), and the first list with `…―─—` added (`0x29a164`). A character of the
   last list that would start a row hangs on the row above, a 29th cell, unless the next is one too, in which case the row's last letter goes down with
   it. `c471c.py` here is that function, transcribed, and agrees with all 14,636 calls the engine made over the game's lines.

The patch (seven changes to `main`, 71 bytes) overwrites the function `0xbf0f8` calls to insert a break (`0xc4dd8`, now a test for a narrow letter) and
skips the insertion in `0xc5610`, so a run of the patched build cannot show any of this. Reproducing step 1 exactly would mean the font's own measuring;
reading the result from the engine is exact by construction.

## How it was read

The PC build in `framework/` is the game's code recompiled from the *patched* `main`. A second copy was made from the unpatched one:

- `python -m recomp data/tsuki/updates/update_v131072/exefs/main <gen>/main --name main --base 0x4000000000` into a copy of `data/tsuki/gen/main`
  (with `NX_RECOMP_JT_LSR=1 NX_RECOMP_JT_MOV=1`, as `tools/internal/regen_tsuki.ps1` does). Three files differ: `code_015.cpp`, `code_016.cpp`,
  `code_021.cpp`.
- `hook_015.cpp.txt` and `hook_016.cpp.txt` are appended to the first two, and the three functions they wrap renamed (`main_000BD7EC`, `main_000BF0F8`,
  `main_000C471C` become `static … _orig`). `build_engine.sh 015 016 021` compiles those files with the flags of the existing build, reuses its other
  objects, and links `tsukihime_jp`.
- It runs in a sandbox data root as in the notes on native runs, with two differences: `analysis/main.bin` is the unpatched image
  (`framework/tools/nso2bin.py`) and `analysis/main_source.txt` the unpatched NSO's sha256, and the mods folder has one layer, the update's romfs under a
  name that does not start with `_` (a layer named `_…` is skipped).

The hook on the engine's "set text" (`0xbd7ec`) waits for the story's text object (28 cells) and then sets every line of a batch file on it in turn
(`NX_LAYOUT_BATCH`: `id<TAB>text[<TAB>x]`), writing the laid-out buffer of each to `NX_LAYOUT_OUT`. All 43,960 lines take a few seconds. A third column
is for a glued line (`@x`): the x at which the row before ended plus 2 px (what the window passes, `+0x18aa8`); the hook then places the object and lays
it out again as the window does (`0xc3710`), so its first row has only the room left.

- every line by itself: the default rows (`lines` in the JSON);
- messages that are not one line by itself (1,398: text an MSAD adds to, two lines joined by `^`, the 287 glued lines), laid out as the whole text the
  engine has for them, glued ones in up to three passes since each needs the end of the one before: `glue_pass.py`. Where the rows differ from the
  line's default they are in `ops`, by script and command.

`rows_lib.py` reads the engine's buffer (control codes: 1 … 2 3 … 4 a ruby group, `0x0d n glyph 6` a run of dashes or blocks, `0x10` / `0x11` narrow
letters, `0x0a` a row break) back onto the line's own markup. `make_mod2.py` puts a test scene in the scripts' first slot (MZX0 with back-references, so
long scenes fit).

## What was checked against frames

A scene of chosen lines (long lines, punctuation at the 28th and 29th cell, ruby, dashes, narrow digits, `@g`, `@b`) was run on the unpatched build and
in the port: rows, letters, ruby and emphasis dots fall within one pixel (row tops 166, 247, 328 …; ruby 139 to 160 over a row at 166 to 208).
Balloon pages (the Ciel-sensei corners) need no wrapping in the original (no row is longer than its balloon) and were not compared with a native frame.

Five commands of the original scripts are mistyped (`build_ja.py` `mend`). A scene with `_STGS(3,,0,800,0)#);` on the unpatched build fades its
picture as the command written correctly does, so the four with stray letters after the bracket run; the one with no opening bracket was not run.
