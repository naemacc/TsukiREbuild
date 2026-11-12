# Parity audit: what was fixed

**2026-11-05.** Follow-up to [PARITY-AUDIT.md](PARITY-AUDIT.md) and its three detailed reports. Every finding was traced
again in the prepared image (`data/tsuki/analysis/main.bin`, SHA-256 `ac6b0120…7951`) with Ghidra 12.1.4 headless and
the recompiler's instruction listing, then fixed in the web port. Native addresses are module-relative. Statements
about the original are static analysis, not observations of it running.

Verification (first pass): `node --test web-dev/tests/*.test.mjs` passes 75/75 (60 existing, 15 new in `tests/parity.test.mjs`).
`/smoketest.html` runs all 549 scripts (1,059,371 commands, 84 choices) with no errors; it caught one regression during
this work (a TextBox setting shadowing the CLO5 method), now fixed and covered by a test. In the browser: a Ciel-sensei
episode with balloons, a page faded out by CLO4, both config pages, automatic saves in the load list, backlog Quick
Jump, CG zoom and pan, the noise-bar glyphs and the native help bar were checked on screen.
`build_core.py` now changes only `TEST_SCRIPT` (531.json); `build_images.py` raised 173 stored images, which were
reconverted.

## Most important fixes

| Audit item | Status | What the native does | Change |
|---|---|---|---|
| VM-01, UI-05 scripted saves, autosaves, capacity | Fixed | ATSV (`0x778e8`) records a checkpoint (`0x5a910`, `0x527f0` -> `0xf17ff0`), also while skipping (only the silent load run, `0x146e638`, passes it; corrected 2026-11-06), none for flag 8. Returning to the title from the system menu (`0x4cea0`) writes it to automatic slot 100, moving 100-137 down (`0x52aa0`; 39 slots), unless it equals slot 100 (`0x52a20`) or the scene is a gallery replay (`0x47b10`). 100 manual slots (`0x50790`). SELA (`0x7f6bc`) asks "Save Progress?" (SYSMES 216) when F1118 is 0 (skipping does not pass it; corrected 2026-11-06); Yes opens the save screen and the story resumes when it closes, then the window closes (`0x83e50` states 4-8). **WTSV is not a save wait**, and not a command at all (corrected 2026-11-06): the dispatch passes it over at `0x77814`; `0x7f69c` is WTVT, which no script uses. | `vm.js` op_ATSV / op_SELA / op_WTSV, checkpoints; `main.js` automatic saves (also on closing the page mid-story, a web adaptation); `ui.js` 100 slots, automatic saves listed first with `saveauto`, SELA's save screen, Continue counts automatic saves (2026-11-06: the list shows used manual slots only, as `0x50790` does; automatic saves are reached through Continue) |
| RA-06 voice wait | Fixed | `0x9c400` reports the channel busy from the start | `audio.js`: a requested voice counts as playing while it loads; `voiceDone` waits for loading and playing voices |
| RA-02-04 blend modes | Fixed, **corrected 2026-11-06** (below) | Formulas from each shader's SPIR-V (table in ANIMATIONS.md, "Blend modes"). The first pass keyed them by STBR n + 14; the native maps STBR through `0x34dd70` and `0xa2790`, so most numbers name a different shader (11 is `ps_add`, not `add_alpha`) | `renderer.js` BLEND_SHADER and composite() per shader |
| RA-05 sound effect loops | Fixed, extended | FWAV loop start/end; **music streams also loop from their own loop start** (bfsar StreamSoundInfo, reference 0x2210; the port looped them from 0) | `build_system.py` exports `seLoops` (196) and `musicLoops` (128); `audio.js` loops between them |
| VM-05, RA-01 STRA | **Corrected 2026-11-06: a defect** | Its fields (`+0x238..+0x240`) are written (`0x645f0`), committed and advanced (`0x3c970`) and restored (`0x5baf0`, `0x802c0`); this row said no drawing code reads them, but `0x362a0` does, record-relative (`+0x22c..+0x234`), and draws the heat haze | Drawn since FIX-CHECKLIST V1 (see "Function-map fixes, section 2") |
| VM-02 timed closes | Fixed | CLO2 clears and hides at once (`0x7f3dc`); CLO3 closes over four frames (`0x7f86c`); CLO4(ms) fades window and text out over ms (`0x7f898`); CLO5(ms) opens with a fade in (`0x7f918`). The page from the last click stays until the next message (`0xae0940`), so CLO4 fades it. A message on a closed or faded window fades it in over 18 frames (`0x6e0d0`). Panel x fade, text x 2(fade - 0.5) (`0x391a0`, `0x38d40`) | `textbox.js` window model ticked each frame; `vm.js` CLO handlers and deferred page clear |
| UI-01, UI-02 config | Fixed | BGM, SE and menu volumes with mutes, no master volume (`0x2dd20`, `0x2a9b0`); read lines use the read speed (`0x3b2b0` / `0x3b2d0`); read scenes auto skip is RDAS's (`0x79b78`); the samples type at the set speed and restart after the click wait (`0x2d570`) | `audio.js` menu group and mutes; `vm.js` read/unread speed and style per line; RDAS; `ui.js` typing samples |
| UI-06, UI-07 backlog | Fixed | Records chosen by cursor (`0x28a90`), "Quick Jump?" (dialog 23) restores the record (`0x28d50`); 800 records (`0x527a0`) | `ui.js` selectable rows, Up/Down/Page/Home/End, Quick Jump, voice replay icon; `vm.js` jumpTo over an 800-point trail; `textbox.js` records with sequence and voice |

## Other findings

| Audit item | Status | Notes |
|---|---|---|
| UI-03 missing config groups | Fixed | Widgets `0x37-0x4d` (`0x46cdb0`, `0x2a730`): Display whole text (unread / read: a line that does not end the page goes on without a click), Display confirmation, Fast forward Full / Read (Read stops held fast forward at unread text, `0x40ed0`), Text display and Read text display (letters fade in over min(0.5 s, speed·0.1/35 s) or appear at once). The page scrolls |
| UI-04 character voices | Fixed | 19 rows (`0x2d980`, `0x29fa0`): shown once the character's voice has played (bit 4 of global `0x34d4b4[i]`, set from a voice's first three letters, `0x2360` / `0x44d970` / `0xae04d8`), Shiki's face and name gated on scenes 485 and 1, hidden names until bit 2; volume, Mute and Test (the last line heard). Voiced effects (SEPL 070) follow the row |
| UI-08 CG rectangle / flag | Rectangle fixed; flag settled 2026-11-07 (a mirror) | The rectangle is the sprite's source rectangle in the 1.5x copy (`0x250a0`). The flag calls `0x1f688`, which sets a per-depth state bit (`+0x404`); its use when drawing was not found, so it is still ignored. *Corrected 2026-11-07* ([FUNCTION-MAP.md](FUNCTION-MAP.md) #11, [gallery](function-map/gallery-cg-music-movies.md) #7): `0x1f688(1)` is the picture sprite's vtable `+0xc0` and sets state bit 8, and the sprite draw `0x254bc` negates the x scale for bit 8 (the y scale for bit 9, `0x1f770`), so flag 1 is a horizontal mirror (IMG0850-0854, IMG1740). The port mirrors them since FIX-CHECKLIST G7, in the viewer and the grid thumbnails |
| UI-09 CG zoom / pan / reset | Fixed | Fit, zoom range fit..1 (or fixed for small pictures), fill/fit toggle, stick-rate zoom, clamped pan (`0xbe84`, `0xc56c`, `0xd270`) |
| UI-10 title stage | Fixed | Kept in G002 and moved at most one step per title entry (`0x90180`) |
| UI-11 substitute presentation | Fixed (approximate timing where noted) | Native notices `popup_ja` with the spring at `0x572bbc` (`0x3b4b0`); mode panel captions on `mode_help` (`0xae590`); help bars from the native per-screen tables with `help_key` / `help_txt_ja` (`0x4a8f0`; label rectangles measured, the engine loads them at run time); the gallery's column, header and sections fade in over 0.5 s, eased in (`0x6934` / `0x6bbc`, `0x5c4c`) |
| UI-12 controller input | Fixed | Gamepad API, mapped as the Controls page shows it. Touch was not extended |
| VM-03 PGST | Fixed | The page id is kept and saved (state `+0x8c4`). The native read state is per page (`0x53a60`); the port keeps its finer per-line bits |
| VM-04 IFSC | Fixed | Tests `0xb34af0`, set only by gallery scene playback (`0x48ac0`) and cleared by loading (`0x47af0`): the port branches except in gallery replays |
| VM-06 XSTP / XRSM | Fixed | Task type 1 (`0x40b70` / `0x40c60`): skip and auto off, input and menus locked, screen kept awake; its lines go on by themselves (`@e`) |
| VM-07 other stubs | Fixed / not a defect | RDAS: read scenes auto skip. SHAF: resets the text window movement (`0x2e560`). RTM2 / RTMN: keep the music past the script's end (`0x146e64d`, `0x5f200`). **TRPY: not a defect**, the Switch interpreter has no handler (its T commands are TOMP and TOMW) |
| RA-07 audio options | Fixed | 069 start offset in samples (StartInfo type 2, `0xee200`); 068 delay, counted down per channel (`0x66200`, `0x65e50`); 018 pan; 070 voice character; 049 play once |
| RA-08 window styles, Ciel mark | Fixed | F1105-F1107 (state `+0x8a2..`) pick the style and offsets, F1111-F1113 a second balloon (tables `0x34d94c`, `0x34d84c`, `0x34d8b8`, `0x34dad8`, `0x34defc`); balloons use the third click mark (`0x391a0`). The balloon textures had been overwritten in the UI build (clashing Shift-JIS names); `build_ui.py` now names them uniquely |
| RA-09 inline tags | Fixed | `0xa7ed8` / `0xa7f30` map tags to font characters; runs of [ber00] / [zap00] are strips of `bf_with_edge68x68_2` (21 bar lengths, 8 scribble lengths) |
| RA-10 image sizing | Fixed | Base scale x largest zoom (STZ4 values in effect and motion keys) x parent zoom and size class; 173 images now stored larger |
| VM-08 TEST_SCRIPT | Fixed | Scripts decoded as UTF-8; literal MSG text shown |

Found during the work and fixed as well: message marks (`@e` no click after text and voice, `^` new line; `0x6e0d0`),
quick load asks "Quick Load?" (dialog 9, `0x4e170`), F822 set for directly started scenes as ARCHIVE does, movie volume
follows the music volume (the removed master volume had driven it).

## Still open or approximate

- CG variant flag (above; settled 2026-11-07: a horizontal mirror, ported as FIX-CHECKLIST G7); shaders for modes 4, 5
  and 28 are not in the RomFS and modes 1-3 are fixed-function draws whose exact blend states were not traced.
- Premultiplied textures recover the source colour as rgb/a, imprecise at very low alpha.
- The skip a read scene starts ends at the next JUMP; the native end condition (`0xae06b8` = 4) was not traced.
  *Settled 2026-11-06* ([FUNCTION-MAP.md](FUNCTION-MAP.md) #17, [script machine](function-map/script-machine-state.md)
  #5): `0xae06b8` = 4 is not the end but a 4-frame countdown (20 after a Yes to dialog 10) in `0x40ed0` state 3; then
  `0x802c0` runs the interpreter in one frame until the next ATSV, SELD, RTM_ / END_ or an ending RDED, XSTP, an
  unread message with fast forward on "Read", or any message while F998 is set. The port does this since
  FIX-CHECKLIST S16; "until the next JUMP" is gone.
- `@k` (a line the next one continues) keeps the line bright while its continuation is the current line (0x391a0's
  page loop, in every layout): reproduced 2026-11-07 with the earlier lines' dimming (FIX-CHECKLIST T2).
- The full-screen window layout for F822 = 0 is not drawn (scripts set F822 = 1 at the start); the window
  transparency setting (config +0) has no control in the shipped config pages and stays at full.
- Automatic save thumbnails are taken when leaving the story, not at the checkpoint.
- The fidelity approximations listed in PARITY-AUDIT.md (AVIF, regenerated blur, curve details, random sampling, fonts,
  click-mark phase, processed-picture cache, audio phase in saves, save history) are unchanged.
- No synchronized original/web frame or audio comparison was made.

## Follow-up, 2026-11-06: the green orb and the Music Player

Two reports after the first pass, both traced in the same image.

| Report | Cause | What the native does | Change |
|---|---|---|---|
| A large green disk over the left of the classroom when Arihiko asks "Hey, where's my greeting?" (`01_00_ARC01_2`, op 882), skipped to or not | Layer 13, `IMG2228` with STEC 58 and STBR 11, was drawn with `add_alpha` (b(1 - a op) + s): the picture's colour is a full-strength green disk whose alpha is a soft falloff, so it showed as a hard orb | The draw (`0x89ad0`) maps STBR n through `0x34dd70` (identity) and `0xa2790` to a shader, not entry n + 14: 11 is **`ps_add`** (mix(b, min(1, b + s), a op)), a soft glow. Type-7 shaders draw the layer alone with `default` (blend type 4, One/Zero: straight colour), then composite with colour (1, 1, 1, op) and blending off (blend states from `0xd3914`). The whole STBR table changed: e.g. 24 (1,032 calls on a black vignette) is `softlight`, 10 is `sub`, 5 is `dodge`, 23 and 9 `ps_screen`; under n + 14 several common uses were no-ops | `renderer.js`: `BLEND_SHADER` (STBR -> shader position), `composite()` keyed by shader, STBR 1 through `ps_add` too; table in ANIMATIONS.md |
| Music Player titles do not match what plays | `build_gallery.py` read the table 4 bytes late (`0x34bd6c`): its "field 13" was the next row's music number, so 87 of 90 rows played another row's track; and music numbers are 1-based | Rows at `0x34bd68` (`0x19ec4`, 95 rows): music number, title, singer, lyrics, composer, arrangement, ms, loop start / end, five more numbers that also unlock the row. Music n is sound `0x01000000 + n - 1` (`0x6f0`, `0x333f90`): **MPLY n plays stream bgm[n - 1]** (`0x649e0` passes n unchanged). The port played bgm[n] in the story as well, one stream later than the native everywhere (the title's music 2 played `MOON01_BGM03` instead of `MOON01_BGM02`); 14 MPLY 069 start offsets lie past the end of bgm[n] and inside bgm[n - 1]. Songs 80 / 124 also unlock by movie `op1_arc` / `op2_ciel` (G005 bits 0 / 1, `0x40a00`), 82 / 126 by scene 560 / 562 started | `build_gallery.py` reads 95 rows with `music`, `stream`, `also`, `credits` (and `movie` / `scene` for the songs); `audio.js` `streamOf` = bgm[n - 1]; `gallery.js` plays the row's stream; `unlocks.js` `musicUnlocked` |

Every row's loop points now equal its stream's bfsar loop points (95/95; 3/90 before). Saved music unlocks keep
working: they were and are MPLY numbers.

Verification: `node --test web-dev/tests/*.test.mjs` passes 78/78 (3 new: the STBR table, the music numbering with every
Music Player row checked against `musicLoops`, the row unlock rule; one fixture renumbered). `/smoketest.html` runs
549 scripts (1,059,371 commands, 84 choices) with no errors. In the browser: the Arihiko line skipped to (`?pc=882`)
and played in from op 794 shows a soft light at the top left, no disk; a softlight vignette scene (`01_00_ARC01_2_2`)
looks right; the title loads `MOON01_BGM02`, and the Music Player loads `MOON01_BGM15A` for "Light: re" and
`MOON01_BGM08` for "Ciel's Theme", the streams whose loop points those rows carry. The test profile's storage was
restored to its state before the checks.

Still open: `noalpha` (STBR 8, 10 calls) is drawn only over the layer's rectangle, where a texel with no alpha shows
black; the native's full-screen pass reads the layer's render target, whose clear value was not traced. `0x40a00`
(a task's handler, reached through `0x5737b0`) was read as running when movie 5 / 6 plays; the port takes a movie the
VM has played (`unlocks.movies`) as that bit.

### Flowchart confirmation dialog

Reported: the flowchart showed through the dialog asking whether to jump to a scene, its selection cursor at full
brightness over the window. The cursor (`.fc-cursor`, z-index 1) escaped the flowchart and painted above the dialog;
`.fc-view` now isolates it (`isolation: isolate`). The rest of the flowchart staying faintly visible is native: the
flowchart object keeps drawing in state 4 (`0x11a58`) while dialog 26 is open, under `dialog_BG` at 0.75 (`0x4ae90`)
and the window art, whose sides are 82-93% opaque. The port's question "Start reading from this scene?" was not the
game's: dialog 26 is SYSMES 1497 (table `0x3c9340`, `0x49710`), "Rewind to the selected scene? / Any progress will be
lost.", now exported by `build_system.py` and shown on two lines (`white-space: pre-line`; the second line keeps the
block centred on y 184, an approximation of the text anchor). Checked in the browser (selection under the dialog dimmed
with the rest, the new text, No returns to the flowchart); the test profile's storage was restored. Tests 78/78.

### Start-up movie

Reported: the game opens with the TM_CI movie before the title. Native `0xb5650` runs before the title: movie 38
(`TM_CI`) over white, which a press passes only after 120 frames of it (table `0x3c98fc`), then the notice in `parts`
entry 1 (`caution2_1920x1080`, here the translation patch's), in and out at 0.025 a frame with a hold of up to 480
frames. The port went straight to the title. Now `main.js` `boot()` plays `TM_CI` (white behind it, a click or key
passes it once `currentTime` is 2 s; story movies still pass at once), then `ui.notice()` shows the picture, then the
title. `build_ui.py` exports the `parts` archive to `assets/ui/PARTS` (built with `build_ui.py <root> PARTS`). A browser
refuses a movie with sound before the first click; `playMovie` then plays it muted rather than skipping it (a web
adaptation). Checked in the browser: the movie plays, a click at 0.3 s is ignored and one at 2.2 s passes to the
notice, the notice passes to the title, which waits for its press. `?script=` test starts skip the start-up. The test
profile's storage was restored. Tests 78/78.

### Gallery background

Reported: the gallery's leafy blue background was missing. The port drew `conf_BG`, which is an empty texture in the
game data (all pixels 0), so only black showed. What the native shows is the system menu's background (`0x4b880`:
`menuBG01`, the top and bottom bands, the sparkles), which the title's GALLERY raises (`0x49630(0.02)`, state 0x11
item 5) and which stays up while the gallery is open (the gallery's return to the title lowers it, `0x48ac0`; a
replay's return raises it again, `0x47a90`). The gallery page, and the flowchart opened from it, now draw
`ui.menuBackground(page, { settled: true })` (the bands already in place) over black. The title's Load and Config
screens do not raise it in the native and are unchanged. Checked in the browser against the reported screenshot; the
test profile's storage was restored. Tests 78/78.

*Corrected 2026-11-07* ([FUNCTION-MAP.md](FUNCTION-MAP.md), [backlog, config,
dialogs](function-map/backlog-config-dialogs-choices.md) #10): right for Load, wrong for Config. Opened from the title,
the config raises the system menu's background itself (`0x2b680` -> `0x49630(0.024)` when it is down, alongside the
screen's own 0.024 fade; `0x2b770` stops it there) and lowers it at 0.024 as it leaves (`0x2c500`); in the game,
`0x4d8c0` case 10 leaves it up under the config. The title's Load raises nothing (`0x8f568`: `0x506e0` /
`0x4ea20(0)`; `0x50fc0` only stops or lowers a background already up). The port does this since FIX-CHECKLIST M18.

### Touch ring

Reported: a click shows a small expanding ring in the game, missing in the port. On PC a left click is a touch
(`hle_hid_tsuki.cpp`), and the engine marks each new touch (`0xad4e0` -> `0x1034`, run by `0xe00`): a 32-segment disc,
clear at the centre and white at half alpha at the rim, growing to radius 48 (cubic out) while fading (quadratic in)
over 0.5 s, up to 16 at once. New `touchfx.js` draws it on a canvas above the stage (`#touchfx`, z-index 50) for each
left press or touch, in a capture listener so screens that stop the event still show it; right clicks (the B button)
draw none. Checked in the browser by reading the canvas (the rim at radius 30 about 45% white at 0.15 s, the centre
clear, nothing left after the 0.5 s, nothing for a right click); a test covers the curve. The draw's blend state was
not traced. Tests 79/79; the test profile's storage was restored.

### Panels and sprite pivots

Reported with native screenshots (`01_01_CIEL01_1_3`, "――――――" and "Alas, the sad truth..."): a bokeh panel ended in
a hard edge on the right; in the split screen the top panel's sprite was missing and the bottom panel's background was
black. Two placement rules caused these, and both apply everywhere:

| Cause | What the native does | Change |
|---|---|---|
| The port moved every layer with a panel clip by the clip's origin, the panel's own picture too: `img2237` with clip (-230, 110, ...) ended 230 px early; the bottom panel's picture (clip y 520) was pushed 520 px down, leaving black | `0x884f0` at `0x88cc8` reads the layer's link and skips the move when there is none: only layers linked to a panel move by its origin (unless SACL). The decompiled C had lost that test | `transform.js` `place()` moves linked layers only |
| The port anchored every picture at its centre | STCH gives the layer its picture's pivot from the image table (`0x60840`: `+0x374`/`+0x414` from `*0xae0540` record `+0x34`/`+0x38`); the draw anchors the picture there (`0x89ad0` -> `0xb0710`) and children are placed from it (`0x892b0`). 874 used pictures have an off-centre pivot; `sie_l_32_32_n00`'s is 13% across, on Ciel's body, so drawn about its centre her legs fell outside the top panel | `build_system.py` exports the off-centre pivots (`system.json` `pivots`, fractions of the size, 7,068 pictures); `vm.js` adds them to the image info; `transform.js` `pivotOf` / `defaultPivot` use them when no STPV is given |

Checked in the browser: the first frame's bokeh now reaches both sides; in the split screen the top panel shows the
thigh, hand and skirt and the bottom panel its grey and bokeh, as in the native screenshots (the panels' motions run
30-50 s, so framing depends on time); a Ciel-sensei scene with an off-centre sprite. Tests 80/80 (one test changed to
the native rule, one added); `/smoketest.html` clean; the test profile's storage restored.

(Corrected 2026-11-07: those 7,068 pictures were keyed by each record's file name at +8, which for a pose's
expressions is the pose's shared file; the engine finds a record by its name table at `*0xae0888`, and with it 3,725
more used pictures have their off-centre pivot. See "Sprite pivots by the engine's picture names (V14)".)

The draw's extra shift for a pivot moved by STPV (once noted as `(pivot - table pivot) x 0.4`, `0x89ad0`, the
thumbnail draw) was reproduced 2026-11-07: see "Function-map fixes, section 2". (SCH2 keeping an STPV pivot as an absolute point, where the native keeps its offset from the new picture's
table pivot, was fixed 2026-11-07: see "Function-map fixes, section 2".)

### Backlog voice icon

Reported: two speaker icons on each voiced backlog row. `DISP_PARTS_JA/voice_icon` is a 168 x 80 sheet of two 84 x 80
cells (plain blue, lit white); the port drew the whole sheet. It now draws one cell, the lit one for the chosen row or
under the pointer. The backlog's replay icon is a port addition from the first pass: the native backlog (`0x27d10`
draw, `0x28470` rows, `0x28f80` input, `0x28d50` restore) has no voice replay and no draw of `voice_icon` was found, so
which cell the game would use is taken from its other button sheets (normal first, lit beside it).

### Back button

Reported: the backlog's Back button looked wrong (the help bar covered its lower half), and it should appear wherever
the game has it. The native button (`0x4a410` update, `0x4a7a0` draw, `0x4a790` on / off) is one overlay drawn after
everything else (`0xafa40`), over the help bar: `back_btn` (8, 16)-(288, 144) at (1640, 952), top-left anchored,
sliding in from 1920 as t rises 0.04 a frame (easing type 3 in-out) and out as it falls, with the pressed cell (8, 168)
for 10 frames after a press; a press once it is fully in is the B button (`0x4a410` writes 0x18e to the input). Screens
that turn it on: backlog (`0x28f80`), config (`0x2c6e0`), save and load (`0x50ed0` / `0x50fc0`), flowchart
(`0x110d4`) and gallery (`0x8d08`, `0x9384`, `0x42760`); they turn it off for their questions and the full-screen CG
(`0x29bf0`, `0x2b930`, `0x50fc0`, `0x8d08`). (The game draws it at alpha 0 in console mode, `0xfbed4`, which the PC build
runs in; at the user's request the port always shows it.) `ui.js` `setBack()` is that overlay (`#backbtn`, over `#ui`):
`begin()` turns it on for `log`, `config`, `save`, `load`, `flowchart` and `gallery` and off elsewhere, `close()` and
dialogs turn it off, the gallery's CG viewer and movies turn it off and on, and a click runs the screen's own Back.
The backlog's separate button is gone. Checked in the browser on the backlog, config, save, load (with a dialog over
it), flowchart, gallery and CG viewer; the system menu and story have none.

### Title GALLERY and the gallery's open and close

Reported: on the title, GALLERY and then any option of its submenu (CG Gallery, Music Player, Flowchart, Back) did not
animate as in the game. There is no submenu in the game: GALLERY's handler (`0x8e200` state 0x11 item 5, `0x8f5c4`;
the same in the recompiled `code_011.cpp`) writes state 0x29 and overwrites it with 0x30 a few instructions later, so
states 0x29-0x2c never run and the title goes straight to the CG gallery. What it does: sound 1 with no pressed hold;
the system menu's background raised (`0x49630(0.02)`), drawn after the title (task priority 83 over 10, `0xb80b0`) and
about a third opaque, so it tints the title, buttons included; the title's black rising 0.02 a frame to 1.2 under it
(60 frames); the logo fading 1/60 a frame while the background is up until the black reaches 0.5. Then the gallery
(`0x48ac0` case 7, `0x47ae0`): its column's pieces and the section's header come in from 0 to 1 over 0.5 s, quadratic
in (`0x6934`, `0x6bbc`, `0x5c4c`; tween modes from the class at `0x46ad80`), with no input until then. Title in the
column (or Back) takes them out 1 -> 0 over 0.5 s, quadratic out (`0x7ac4`), and the title starts again from black
(0.012 a frame) under the background lowering at 0.02 a frame with its bands in place, the cursor on GALLERY (`0x48ac0`
mode 4 -> 0 with 10, `0x1536158`). The gallery's Flowchart cross-fades: the column out and the flowchart in, each over
0.5 s (`0x8400`, `0x7624`, `0x110d4` / `0x1121c`), and back the other way (`0x11bec`).

The port had a submenu from an earlier reading, faded everything including the background to black and then showed
the gallery at once with only the section fading (linear), and switched to the flowchart and back to the title at
once. Now `ui.js` `titleMenu` goes straight to the gallery with the background over the title (`MenuBgFade`,
`menuBackground(page, { fade })`, `titleLogo`; the lumi's glow at the native 1/120 a frame), `titleMenu(fresh,
{ fromGallery })` comes back under the lowering background, `gallery.js` fades the column, header and section with
`fadeIn` / `fadeOut` (`Tween`), and `ui.ghost` keeps the page being left over the next one for the flowchart's
cross-fade. `titleSubmenu` and its test are gone; new tests cover the logo, the background's level and bands, and the
tweens. Checked in the browser with frames driven by a timer: GALLERY to the gallery in 1.07 s with the background
the top layer and the logo held at 0.59 once the black passed half; the column at 0.19 / 0.44 / 0.83 / 1 through the
first half second and blocked for input until then; Title out over 0.5 s; the return with the background from 1 to 0
over 50 frames, the bands in place, the cursor on GALLERY and the logo waiting for the black; the flowchart and the
gallery cross-fading both ways. Not changed: the port still stops the title music on entering the gallery (the
native's CG Gallery path was not seen stopping it; the music player's own playback would overlap it). The test
profile's storage was restored. Tests 83/83.

Follow-up report: in the gallery's flowchart, No to "Rewind to the selected scene?" showed the gallery for a moment.
No shows the flowchart again by rebuilding it (`reopen`) with the same options, which still held the gallery's page
for the cross-fade, so the gallery was put back over it and faded out a second time, and the flowchart faded in
again. `reopen` now passes no ghost and `opts.reopened`, which starts the flowchart's fade finished: after No the
flowchart is simply back, as in the native, which keeps drawing it under the dialog (`0x11a58`). Checked in the
browser: after No only the flowchart's page is there, at full; Back from it still cross-fades to the gallery. The
test profile's storage was restored. Tests 83/83.

### FADS showed the changes before its wipe

Reported: in `01_01_CIEL01_1_3` (and `01_00_ARC01_1_2`), reached from the flowchart, the game wipes white over the
train interior from left to right before the station fades in; the port only faded from white to the station. The
script shows the train (op 1834, z 518) over white, then moves it behind the white (`STCP 9 0`, op 1846) and wipes
(`FADS 2 1200 13`, `RULE_13`). The port applies `STCP` to the live layer at once and then waited in `fade()` for the
new white layer and the rule picture; frames drawn during that wait already had the train behind the white, so the
wipe went from white to white. The engine copies the last drawn frame when FADS starts (`0xa4560`) and shows that copy
at full while it waits (`0xa46f0(1.0)`, `0x77790` / `0x60610`), then transitions from it (`0x4b740`, `0x47dd0` type 2,
`0xa48c0`). Now `vm.js` `fade()` holds the renderer's last frame (`renderer.js` `hold`, released by `beginFade` or when
the FADS ends) for the whole preparation. Checked in the browser with frames captured through the transition: the
train is on screen at the start and the white sweeps over it from the left over 1.2 s, then the 2 s fade to the
station. A test covers the hold order. The test profile's storage was restored. Tests 84/84.

Follow-up: the user confirmed the game's wipe comes from the other side. The engine's transition shader keeps the old
picture where the rule is bright and lets the new one in where it is dark first (`0xa48c0` constants, the
`transition` shader: old alpha smoothstep((r - lo) / s), lo = ((255 + 2s) x - 1.5 s) / 255, x the progress). The
port's `FS_FADE` let the new picture in where the rule is bright; it now follows the engine for every rule
transition. Checked in the browser: the white now covers the train from the right edge leftwards over 1.2 s. The test
profile's storage was restored. Tests 84/84.

### Fast forward too fast

Reported: holding Ctrl skipped far faster than the game. The engine steps the script once a frame (`0x802c0`): the
dispatcher runs to the next wait, and fast forward clears one message's click wait a frame, so text goes by at most
one message a frame with every frame drawn. The port's skip returned from each message wait at once and only yielded
every 2,000 commands. Now a skipped message waits for the next frame (`vm.js` `waitAdvance`); test jumps, restores and
the smoke test (`skipPaced = false`) are unchanged. Checked in the browser with a timer standing in for frames (the
pane was in the background, about 20 frames a second): holding Ctrl passed 61 messages in 3 s, one a frame; with the
old behaviour the same run passed 121 in 1 s and ran into the next script. A test covers the frame wait and its
exceptions. The test profile's storage was restored. Tests 85/85.

### Italics and special letters as boxes

Reported: italics and other special text showed as missing-glyph boxes. The translation writes them as private-use
code points drawn from the game's own font (the patched `ja/TT_TsukuMin-D.ttf`, whose cmap covers U+E000-E07E,
E080-E0FE, E100-E17E, E180-E1FD, E200, E21A and E280-E2FE): U+E000 + ASCII is italic (about 41,000 letters), U+E080
and U+E100 + ASCII are mirrored letters (lines seen in a mirror, stored back to front), U+E180 + ASCII a serif italic
for archaic speech ("Insolent fool. If thou art not swine..."), U+E280 upside-down letters, U+E200 an exponent. The
port draws story text in Georgia, which has none of them, and its italic converter had lost its characters: the
ranges in `textbox.js` read `[-]`, so no italic was ever converted. Now the italic ranges are written as escapes
(`\uE020-\uE07E`) and become `<i>` text as intended, and the other ranges come from the game font through a
`unicode-range` face ("Tsuki Glyphs", first in `--story-font` and the intro style), fetched at start-up
(`main.js`) so a line does not show boxes while the 6 MB font arrives. Checked in the browser: "*Pitter patter*" in
italics (`00_00`), the mirrored "I want to run my filthy tongue all over her." (`03_00_ARC03_5B`) and the archaic
line (`04_00_ARC04_10`) in the game font's letters. A test covers the italic and pass-through ranges. The test
profile's storage was restored. Tests 86/86.

Follow-up: drawn from the game font, the mirrored letters overlapped (its glyph advances do not suit the story
font's layout). Mirrored letters (U+E100, and the unused U+E080 set) now become the story font's own letters, kept in
the stored order and each flipped on its own (`#text .ch.mirror`: an inline block with `scaleX(-1)`; words kept whole
with `.mirror-word`), which is what the game's mirrored glyphs draw, with the typing still going left to right. The
backlog and save notes read the line the right way round (the run, spaces included, reversed back). (At that point the archaic
serif, the upside-down letters and the exponent still came from the game font; see below.) Checked in
the browser on `03_00_ARC03_5B`: the line reads as a mirror image in Georgia with even spacing, and the backlog has
"I want to run my filthy tongue all over her." The test profile's storage was restored. Tests 86/86.

Second follow-up: the rest no longer uses the game font either, and the "Tsuki Glyphs" face and its start-up fetch
are gone. The archaic serif (U+E180 + ASCII) first became the story font's italic (since replaced, see below). The upside-down letters (U+E280 + ASCII, in
reading order) are the story font's letters each flipped top to bottom (`#text .ch.flip`, `scaleY(-1)`): the game
font's glyphs are vertical flips (b shows as p, d as q), not turns. The one exponent (U+E200, the game font's raised
"-35" in "10^-35 m", which overlapped too) is "−35" in a `<sup>`; the backlog has "10⁻³⁵m". Checked in the browser
with lines from `13_01_01_CIEL13_1` ("Shiki-san? How are you holding up?..." upside down), the exponent line and the
archaic line from `04_00_ARC04_10`. The test profile's storage was restored. Tests 86/86.

Third follow-up: as plain italics the archaic lines looked like every other italic, where the game sets them in a
face of their own. They now have their own style (`.archaic`, a run with its spaces): a calligraphic face the system
has (Apple Chancery on macOS; Lucida Calligraphy or Monotype Corsiva on Windows with Office; URW Chancery L or TeX
Gyre Chorus on Linux), at 1.08 em, falling back to the story font's italic. The generic `cursive` is left out (Comic
Sans on Windows). No font file is shipped or fetched. Checked in the browser: "Insolent fool. If thou art not
swine..." in Apple Chancery beside ordinary italics. The test profile's storage was restored. Tests 86/86.

### Story transitions swept against the engine

The scripts use `FADS` types 0, 1 and 2 and `FANX 1 0 0` only; the special draws in `0x47dd0` (0x12 pixelate,
0x14, 0x44-0x46 falling pieces, flash, spinning zoom) are never called, so they were not added. Four differences
were found and fixed (details and addresses in `ANIMATIONS.md`, "Transitions, grain and screen effects"):

- Type 0 never reads the rule (`0x47dd0` default -> `0xa46f0`); the port wiped `FADS 0 200 1` (`02_00_ARC02_1D` op
  46) through `RULE_01`. It is a 200 ms crossfade now; only type 2 uses a rule.
- `FANX` does nothing when it runs (no handler in `0x77790`, passed over at `0x77814`; only the look-ahead `0x6f4d0`
  reads it). The port put the staged layers on screen at each FANX, so in `05_01_CIEL05_2_2B` ops 1158-1184 two
  pictures showed before the `FADS 2 700 29` wipe that brings in the rest. It is passed over now. Re-checked
  2026-11-07: 0x77790 sends 'F' to 0x77a00 (table 0x350bd6), which matches the other three letters against ADE and ADS
  only (CCL, CLN, CSP, LNT, LOP and LSP further on), so `ANX` falls to 0x77814, which only counts it toward the 1,000
  commands of a frame; the look-ahead (0x6f4d0 at 0x6f7bc) parses FANX as FADS, for a rule picture that `FANX 1 0 0`
  (all 2,741 calls, 318 scripts, mostly between a layer's set-up and its STMA) never names. The scripts were written
  for a FANX that commits: a replay with it as `FADS 1 0 0` draws differently at the waits of one scene only,
  `14_01B_03_CIEL14B_4_1D` ops 1608-1623, where layer 32's STRA 509 / STRA 0 300 heat-haze flash would fade out over
  300 ms; in the Switch game the STCH before the FANX is still staged, so the wait's commit cuts the fade and no haze
  shows, as in the port.
- Staged layers show at the next wait: after each frame's run `0x802c0` applies a staged STCH / SCH2 / STCC / STNS
  at once (`+0x7ca` -> `0x5d3a0(0, 0)`). The port kept them hidden until the next FADS, about 530 places
  (`05_00_ARC05_9_1` ops 1586-1609 showed a black screen through an 800 ms motion and a line of text). `vm.js`
  `WAITS` / `settle()` now commit them before MSG, MSAD, WTTM, WTSV, VCWT, STCF, SELA, SELS, SELD and TOMW.
  (2026-11-06: WTSV is out, being no command, and CLO2-CLO5 are in; see the function-map fixes below.)
- FADS's fourth argument closes the text window (`0x60610` -> `+0x89e`): 1 always, 2 for a timed FADS with no
  CLO4 / CLO5 fade running (config `+0x63` defaults to 1, `0x2c810`, and nothing changes it). The text and click mark
  go at once, the panel stays, and the next message fades the window in over 18 frames (`0x6e0d0`). The port ignored
  the argument (54 timed FADS pass 2 or 1, mostly mid-page expression changes in fights). The text box now draws no
  text while closed, which also applies to CLO3 (the engine sets the same flag there).

Checked and unchanged: the rule wipe and its direction, the linear level (`0x48ac0`), SHOK's wave (sin, linear decay
over period x count, default period 300 and count 3; `0x5f8f0`, `0x2ee70`, `0x2ef30`). Not settled: how large
SHOK's offset is on screen (the engine scales x by 640/1280 and y by 480/720 and adds it twice in `0x34440`; the
port's 4 px a unit was kept); FADE 40/41, FCLN/FCSP, STTR, STNS and MSQK were not re-derived in this pass.

Checked in the browser with frames captured from the WebGL canvas: `05_00_ARC05_9_1` from op 1586 (the panel and its
motion play during the WTTM), `05_01_CIEL05_2_2B` from op 1158 (every picture comes in through the RULE_29 wipe from
black), `10_00_ARC10_3_2` ops 499-509 (the text goes at `FADS 0 300 0 2`, the panel stays, and message 509 fades the
window in over about 0.3 s), `02_00_ARC02_1D` op 46 (an even 200 ms fade from black). Tests cover type 0 with a rule,
the window-closing argument and the text box, FANX and the commit at waits. The test profile's storage was restored.
Tests 89/89.

### Screen effects at the engine's scale (SHOK, MSQK, STTR, speed lines)

The open items from the transitions sweep, settled from the engine (details in `ANIMATIONS.md`):

- SHOK was about 2.5 times too strong. The engine composes the scene in a 640 x 448 view and draws its buffers at the
  shake offset cut to whole view units (`0x3c490` -> `0x3fdd0`); the offset is x x 640/1280 and y x 480/720 of the
  script's amplitude (`0x2ef30`). At 1920 x 1080 that is 3 px across and 2.41 px down a unit, and amplitudes under 2
  never move across. The port drew 4 px a script unit. `SHOK 0 7 120 5` (`12_00_ARC12_2` op 1811) now peaks at
  7.2 px instead of 22 px, in 2.41 px steps.
- MSQK shook the text 2.7 times too far, every other frame, and defaulted to 300 ms. The engine picks a new offset
  every frame within +-x x 640/1280 and +-y x 448/720 view units (1.5 px a unit) for ms (1000 if blank, 1000 if over
  10000) (`0x39110`, `0x3c970`, `0x391a0`).
- STTR was a fixed mask. In the engine the layer's alpha drives a wipe through the rule laid over the screen, dark
  parts first, and the third argument flips the rule (1 across, 2 up and down, 3 both), not a softness (`0x36520` ->
  `0xa7190`: threshold = alpha, softness 128, direction -1, w = the flip; the shader that reads w is SPIR-V
  `4ee51e76b468223e`, matched by the PC build's shader hashes). The scripts always tween the alpha after STTR, so
  those layers now sweep in or out (`03_01_CIEL03_3_2` op 639: a black card from the left over 600 ms) instead of
  fading in partly masked.
- Speed lines were 14 px wedges of the whole FocusLine picture. The engine draws each as a 960 x 2 px strip of it,
  1:1 at the default scale, longer for some types by the line's angle, from a per-type strip of the picture
  (`0x87150`, table `0x3527c0`).

Checked and unchanged: FADE 40's offset scale (`0x2fc50` scales by render width / 960, the port's x2), FCLN/FCSP
fades (`0x86470`). Checked in the browser on the scenes named above: the STTR wipe with the alpha held at 0, 100
and 200 (left of the screen covered first), SHOK's offsets, the speed lines in `06_00_ARC06_1_3` op 1257 and MSQK
in `QA_02` op 1354 (within +-7.5 / +-1.5 px, over in 500 ms). Tests cover the scales, the wipe, the flip and the
line strips. The test profile's storage was restored. Tests 92/92.

Still open: the per-layer quake, shake and sway (SQK2/STQK, SHK2, SSW2) are drawn at 4 px a unit; their offsets are
the raw amplitudes (`0x3c970` writes amplitude x random(-1, 1) to layer `+0x178`/`+0x180`) but the units they are
added in (`0x32050`, x x 3 / 3, y x 2.41 / 3, inside draws that work in screen pixels) were not settled. The speed
lines' blend modes (`0xb0640(0x1e)`, `0xb04e0(1)`) were not traced. The engine keeps one rule picture for STTR and
FADS together; a FADS with a rule while an STTR layer shows would change that layer's rule in the engine but not in
the port.

### Layer shakes, SHOK corrected, and the last open items

- **SHOK, corrected.** The previous entry's scale was taken from `0x3fdd0`, which only composes screen-task buffers
  (`XSTP`, `0x3f600`); the story's layers are drawn by task 10 (`0x3bba0` -> `0x37f50` -> `0x34440`, 640 x 448 view),
  which adds the offset twice to each layer, with no rounding. SHOK now moves the layers 3 px across and 3.21 px down
  a unit of amplitude (`SHOK 0 18 900 1` in `05_00_ARC05_1B` op 4800: 44 px at the peak; the port's original 4 px a
  unit gave 55, last turn's version 26), and a panel's clip moves with them (`0x32050`): checked in the browser, the
  clip went from y 192 to 236.3 at the peak with its pictures.
- **Layer quake, shake and sway** (SQK2/STQK, SHK2, SSW2) were 4 times too wide across and 5 times too tall: the engine
  adds a third of amplitude x wave (or random) in view units (`0x3c970`, `0x34440`), 1 px across and 0.80 px down a
  unit. Most of the scripts' quakes are 1-3 units, so they now move 1-3 px. A panel's clip moves with its owner's
  quake.
- **Shared rule slot** (STTR and FADS): checked against the scripts and left unmodelled; every STTR layer present at
  a FADS or at a second STTR has reached alpha 255, where the rule no longer matters (details in `ANIMATIONS.md`).
- **Speed-line blend**: not settled. The lines use `default_mesh`; the blend value they set (`0xb04e0(1)`, which would
  be additive in `0xd3914`'s table) reaches the draw objects through virtual setters that were not followed, and the
  same call with 9 elsewhere cannot be that table's "min". The port keeps normal blending.

Tests cover the SHOK and layer-effect scales. The test profile's storage was restored. Tests 92/92.

## Second native pass, 2026-11-06

A further comparison against the engine, concentrating on the commands earlier passes had left as "handler present"
(variables, choices, voices, music and sound-effect channels, tweens, easing, motion splines) and on the config
defaults and menu structure. Thirteen differences were fixed: `WKAD C847 0` adding a blank row, `SELD`'s flowchart
marks for untaken branches, `VPLY` starting its voice before the line, `MPLY`'s old-track cut and same-track rule,
re-issued loops restarting, the `068` slot's flush rule, one-shot effects during fast forward, easing ids 26-29 / 32 /
36, the mode-1 motion spline, blank tween arguments (three `STGS` fade-outs that never happened), F1123 keeping a voice
through a click, and the game's defaults (volumes 40 / 40 / 10 / 50, confirmation off, fast forward "Read"). Details,
addresses, what was checked and matches, and what is still open: [NATIVE-PARITY.md](NATIVE-PARITY.md). Tests 104/104;
`/smoketest.html` clean.

## Function-map fixes, section 1: story and progress, 2026-11-06

The first group of [FIX-CHECKLIST.md](FIX-CHECKLIST.md) (from [FUNCTION-MAP.md](FUNCTION-MAP.md)): 31 of its 32 items fixed,
one dropped as wrong, each re-checked in the instruction listing (and Ghidra where the listing alone was unclear) before
the change. Per-item notes, with what was checked, are in the checklist; the new tests are in
`tests/function-map.test.mjs`. Tests 138/138; `/smoketest.html` clean (549 scripts, 1,059,371 commands, 84 choices, no
errors or warnings).

- **Jumps and commands.** `build_core.py` exports the jump table at `0x350d58` instead of guessing (2000-2007 were
  swapped, so F069 flipped at five scene ends; also 110 / 3000 / 4000 / 8000 now, and no made-up numbers). `SNX4`,
  `STQK` and `WTSV` are no commands (`0x77814`) and do nothing. CLO2-CLO5 end the frame (`0x7fef0`), committing staged
  layers.
- **Choices.** SELR rows keep their value (`0xae09d8`), "1." numbering (SYSMES 1433 + (row + 1) % 10) and lock flag
  (`0xae09e0`); the selector `0x83e50` starts on nothing, skips locked rows, wraps only on a fresh press or the wheel,
  takes a row on a second tap and makes no sound for key moves; SELS / SELA start on neither answer, Up = No,
  Down = Yes. A locked row is not greyed: nothing but SELR and the selector reads the flag.
- **Flowchart marking.** RTST / RDED / JUMP follow `0x92770` / `0x92440` / `0x95790`: the current scene (F110) comes
  from the JUMP, RTST sets it only for 533-557 or in a replay, RDED completes only the current scene; `0x93d10`'s 84
  special pairs replace the breadth-first search; SELD's hand-written extras run at run time (1168 / 1120 appear on the
  F069 = 0 side, not never); the in-game rewind keeps what `0x178c8` records (274 + 42 variables, route flags rolled
  back by `0x95800`, later rows off the path). Gallery replays start as ARCHIVE does and end at the scene's RDED.
- **Start-up and movies.** No logos or notice before the prologue has started; the opening plays at once and cannot be
  passed the first time; then "press any button", the cautions and START_SCRIPT; New Game later goes straight to
  START_SCRIPT. Story movies play through skipping, six wait for their G005 bit, the prologue starts music 2 at 360 s,
  and the chapter titles play interface sound 7 as they start (a call the evidence had not listed, `0x40930`).
- **Skipping.** RDAS's read-scene skip is an instant run to the next ATSV, choice, script end, XSTP, TOMP or unread
  line; the skip toggle waits at unread text on "Read" and goes on at read text; choices keep it; VCWT ends on a click;
  XRSM restores what XSTP put aside; checkpoints move at ATSV (also while skipping), SELD and a page's first line; the
  mode panel's first and fifth buttons are "Return to Previous Scene" (`0x81a50`, ATSV's ring) and "Jump to Next
  Scene".
- **Saves and the title.** Saves hold the checkpoint; the list shows used manual slots newest first (plus the lowest
  empty slot when saving); "Saving", "Overwrite?" (on No), "Loading", "Data not Found"; a 180-frame quick-save cooldown;
  Quick Load shows its picture; Return to Title asks nothing outside replays and fades to black, as a script's end
  does; replays refuse Save / Load / quick save and offer "End Scene Playback?"; chapter cells, pictures and scene
  names come from F023 / F022 (`0x591558`, `0x592484`, `0x3506b0`, SYSMES 395 + F022); Continue only with a record;
  the completion banner (SYSMES 239, G069); the flowchart is refused before scene 1 and in the Ciel-sensei episodes.

Dropped: S31 ("SELS is not asked while skipping"). `0x92800` tests `0x5afb0`, which reads `0xae0900` -> `0x146e638`,
the load's silent-run flag, not the skip toggle (`0x1916dec`). The same was true of SELA, which the port had skipped
while skipping; it now asks.

Checked in the browser (on an emptied test profile for the first launch; the user's storage was backed up first and
restored afterwards, all eight keys verified by hash): Noel sharp in `08_01_CIEL08_5`, no quake in `QA_14`, the
numbered choices of `07_00_ARC07_3_1` with their keys and taps, the shared scene end of `01_00_ARC01_4_1`, a gallery
replay of scene 54 and of 49, a rewind from `12_01_CIEL12_5`, the first launch and a later boot, a chapter-title movie
through a forced skip, the instant run, the skip toggle at unread text, XSTP / XRSM, the checkpoints, both new panel
buttons, the save screen, Return to Title, Continue, quick save and load, a script's end, the banner and the
flowchart refusals.

## Function-map fixes, section 2: look (V1-V10), 2026-11-06

The layer-drawing items of [FIX-CHECKLIST.md](FIX-CHECKLIST.md) section 2 (the T items, the text window, were not part
of this group): all ten fixed, each re-read in the instruction listing (Ghidra for the larger functions) before the
change. Per-item notes are in the checklist; the new tests are in `tests/function-map.test.mjs` ("V1" to "V10"), and
two older tests were changed to the native rule (the panel edge test in `transform.test.mjs`, the split test in
`screenfx.test.mjs`). Tests 150/150; `/smoketest.html` clean (549 scripts, 1,059,371 commands, 84 choices, no errors or
warnings).

- **STRA's heat haze is drawn** (V1). `build_effects.py` exports the 557-entry table at `0x352bd4` (effects.json
  `haze`); the layer shader shifts the picture's texture coordinate as `nexl_nxshader_haze` does, with `0x362a0`'s
  constants. STRA keeps its state per layer number, as `0x645f0` does: the record on screen and the per-layer state
  `+0x1364` that each commit copies into it (`0x5d3a0` -> staged `+0x238` -> `0x3c970`), so a STRA with a time comes on
  (or is cut) at the next commit, STCH / SCH2 clear the record but keep the state (`0x32930`), STCC clears the state.
  STNS now also ends the frame with a commit (`+0x7ca`).
- **Placement** (V2-V4). STZ4's eighth argument makes the zoom a stretch along the screen's axes after the rotation
  (`0xbbb28` scales the x / y parts of the finished matrix's axis vectors, not its translation); a layer linked to a
  layer that is not there gets alpha 0 (`0x37f50`); layers with z below 1 are not drawn (`0x3bba0`) and a blank STCH z
  is the layer number x 10 (`0x60840`).
- **Panels and blends** (V5, V6). The mask and the band (`0x32e30`, `0x34a70`) cut their width to half the clip's
  size, feather a side unless the clip's edge is the width or more past the screen's, and skip a side only for a clip
  exactly as wide or tall as the screen; style 7 doubles the mask's width and draws no band, other styles past 6 no band
  either; the mask's width is rounded up to even. SCH2 resets the blend to normal, as STCH does (`0x62088`). SCH2's
  zoom (checked afterwards): `0x60840` sets STZ4's zoom target to 1000 and its flag to 0, then copies both from a named
  source layer; every commit then puts each layer's zoom at its target with no tween (`0x5d3a0` -> `0x31f30(.., 0)`).
  All but one of the 4,674 SCH2 calls name a source, so the port, which copied the source's zoom, already matched on
  screen; `op_SCH2` now takes the target and flag exactly (correcting V2's "SCH2 clears the flag") and `commit()` ends
  running zoom tweens (2 STZ4 calls tween; neither is cut visibly).
- **STCH's source layer** (V6, 2026-11-07). STCH's argument 18 goes through `0x60840`'s copy branch as SCH2's does:
  the new layer starts as a copy of the named layer (placement, zoom target and flag, panel, link and SBAS parent,
  SACL, SOXY, colour, SNX2 / SNX3, motion, quakes, haze state), STCH's defaults (alpha 255 and z = layer x 10 when
  blank, rotation 0, the picture's pivot) apply after it, and the layers linked to the source or parented to it move
  to the new layer; STTR's rule and the blend reset, STNS's grain stays with the layer number. The port's STCH ignored
  the argument: 50 of its 201 calls now draw differently (20 in the layer itself, 33 through the moved links and
  children; a headless replay of every script), e.g. `10_01_CIEL10_5`'s focus pull, where Ciel's sprite turned round
  and grew. SCH2 got the same relink, rule and grain rules and, without a source, the reset of SACL, quakes, SNX2 /
  SNX3, STEC, link and motion (39 of its 4,535 calls draw differently: 37 relinks, one rule, one grain). Blank
  arguments without a source (the same day): `0x60840` writes x, y, the scale and the panel only when given, so STCH
  and SCH2 keep the layer number's own (and its SBAS parent and SOXY), and a number with no layer holds x 0, y 0,
  scale 1000 (`0x57450`, `0x62140`), as does an empty source; the port had started such layers at 240, 136. 485 calls
  start differently; the 7 the replay shows drawn elsewhere are solid black pictures (img5007 panels, the img0597 card
  under a scene), so no pixel changes. Then the pivot and empty numbers: SCH2 moves a source's STPV pivot with the
  picture's own (`0x60840` at `0x60cd0`; without a source it takes the new picture's own, `0x62024`), and a layer
  number keeps its state with no picture on it (STCP, STGS, STRT, STZ4, STBR, SBAS, SOXY, SACL, STPV, STCL and STNS
  write it, STCC resets it), which the next STCH / SCH2 starts from; STCP's blank z is 0. Four scripts change, visibly
  `08_01_CIEL08_3B` op 4200, a sprite 15 px across. Left: without a source the table pivot is truncated to whole 640 x
  362 units (`0x62024`). function-map.csv and FUNCTION-MAP.md's counts now show the section-2 rows as fixed (nine
  moved to explicit).
- **The last open look items** (2026-11-07). STCH / SCH2 without a source give the table's pivot cut to whole 640 x
  362 units (`0x62024`; `system.json` `pivotCuts`), and the draw (`0x34440`) adds the pivot plus the record's whole
  -pivot (`+0x48`) to the position, so an STPV pivot shifts its picture by its fraction and STCH from a source keeps
  the copied placement (the `x 0.4` term in `0x89ad0` is the same thing in the thumbnail draw): most pictures move by
  under 3 px. Panel edges take the blob of their width (`0x34d81c` / `0x34d7d4`; style 7's mask the `_2` one), and the
  band is the engine's: twice the width in, peaking at the width, plain corners outside and `_inv` ones inside
  (`0x34a70`, UV rects `0x572990`). Checked and left: a SACL layer stays inside its panel (the draw task groups by
  link, `0x3bba0`); `0x37f50`'s owner `+0x20` is set by `0x3c970` only after a per-layer transition type, which
  nothing but a reset ever writes (and FANX is not dispatched), so that check never fires and the port, without it,
  matches. No rendering row of function-map.csv is divergent now.
- **Motions and the window** (V7). STMA's third argument closes the text window (1, or 2 when the window's fade rate
  `0xae05a8` is 0), its fourth makes the track move on every n frames (`0x95938`).
- **Screen effects** (V8-V10). The RGB split moves every sixth frame, starts at full alpha for a level other than 0,
  and FADE 40 while it is on keeps it going (counters reset only when it was off, `0x5f420` -> `0x2e280`); its pulse
  counter after the first lap was 100 off. The menu's background is the engine's Gaussian (13 taps 1.75 px apart,
  s = 2.25: sigma about 3.9 px) of the frozen frame, faded in over 12 frames with no darkening (`0x2e000`, `0x3bba0`,
  `0xa0a90`), drawn by the renderer instead of a CSS `blur(7px) brightness(.82)`. Each layer's quake draws its own
  random offsets (`0x3c970`); SQK2's mode not 0 makes layers 2 and up copy layer 1's; `0x34440` / `0x32050` decide what
  linked and parented layers add, so panels and SBAS groups still move as one.

Corrections to the evidence found on the way (also in FUNCTION-MAP.md, "Corrections found while fixing"): the haze
shader is SPIR-V `33906951eb996a33`; `4bbde4e2ca02d2dc` is `nexl_nxshader_wave`. The three QA_21 SCH2 calls named for
V6 copy from other layers whose blend is already 0, so they did not change; 17 other SCH2 calls did. V4's one "visible"
case (`14_01B_03_CIEL14B_5` op 491) is covered by an opaque picture in the port too. STMA's "no CLO4 / CLO5 fade"
condition is the window's fade rate, which a message's own 18-frame fade-in also sets.

Not done: the six feather blob sizes by width and the two open panel questions (RE 5c-5e); sway's per-cycle period and
sign, SHOK's fractional periods and STCL stopping a motion (RE 10's other notes); an owner record's flag `+0x20`, which
also hides its linked layers (V3; no port counterpart); `0x2e280` not resetting the split's 6-frame counter.

Checked in the browser (the user's storage backed up first and restored afterwards, all eight keys verified by hash):
the haze on `12_00_ARC12_2`'s silhouettes, the level swirl of `05_00_ARC05_1C`, the orphaned layer of
`13_01_01_CIEL13_5B`, the z-0 layer of `14_01B_03_CIEL14B_5`, the style-7 panel of `04_00_ARC04_6_2C`, the SCH2 blend of
`05_01_CIEL05_4`, STMA's window close in `09_00_ARC09_3_1` and its frame step in `14_01B_02_CIEL14B_3B`, the re-issued
split of `02_00_ARC02_1`, the system menu's blur, and the independent quakes of `05_00_ARC05_9`.

## Motion fields (V11), 2026-11-06

Prompted by a report that Ciel Sensei 17 (QA_17, op 331) cut Neco-Arc off at the right, where the original game shows
her whole. Her layer is drawn in a panel (STCH args 12-15: x 646, width 910) that her motion track (23539) moves from
x 646 to 843 as it slides her right; the port's export never read the panel fields, so the panel stayed and cut her.
The function map had the motion code as done; it was re-read in full (`0x99ff0`, `0x97710`, `0x97b80`, `0x99620`,
`0x9a270`, with `0x3b30` / `0x3c10` / `0x3de0` for the colour, `0x648a0` for grain, `0x639a0` for the pivot and
`0x3bba0` for the depth order).

- **Export.** A keyframe has 28 fields; `build_animations.py` now writes them all: the first eleven as before, the rest
  in `EXTRA` order (depth, blend, colour preset, panel x / y / width / height, frame style, edge width, red, green,
  blue, brightness, contrast, pivot x / y, grain) without trailing holds. 6.13 -> 6.59 MB; the first eleven are
  byte-identical to the old export.
- **Sampling.** `animation.js` ports `0x97710` line by line. Against the old sampler it differs only where the old one
  did not follow the engine: a key that skips a field gives it no ease (tracks 2290, 2719, 7801), the mode comes from
  the last earlier key even when that key skips the field (2453, 2906, 6787), a hold on the next key keeps the value
  (4353, 4638), and the frame style and fields 17-27 (blur included) step.
- **Writing.** As `0x97b80`: a field is written only when the track's flags allow it, and position, opacity, zoom,
  blur and blend only at time 0 unless a later key gives them. STMA bakes those time-0 values into the layer (the
  engine writes the record), so script tweens move them afterwards: 33 timed STGS fades on such layers now run.
  Field rules: panel width and height even; blend 0 normal, 8 normal unless fully opaque; a track's preset 1 colours a
  layer that is not a silhouette (the preset itself never changes); flag bit 33 sets the colour; brightness and
  contrast in SNX2 / SNX3 units; depth only when not 0 and the layer's own depth is not 0; flag bit 34 turns the panel
  with the rotation. SGMA writes the key its third argument names, and the panel. STEC resets the multiply colour.
- **Drawing.** `renderer.js` builds a view of each layer per frame with what its track wrote (`motionView`), so
  placement and drawing see the moving panel (and the layers linked to it), depth, blend, colour and the rest; the
  layer shader multiplies by the colour (`0xb03e0`).

Checks: `tests/motion-fields.test.mjs` (11 tests) and two older motion tests changed to the engine's rule; 162/162. A
sweep of 428,294 samples over the 24,019 tracks the scripts use finds no unfinished value. `/smoketest.html` clean (549
scripts, 1,059,371 commands, 84 choices, no errors or warnings). Browser (the user's storage backed up first and
restored afterwards, all eight keys verified by hash): QA_17 at op 331 (Neco-Arc whole, matching the original game),
`04_00_ARC04_4_1` op 913 (layer 4 fades 191 -> 47 over 3 s instead of staying), `05_01_CIEL05_4` op 1083 (layer 20
tinted navy at depth 1782; not compared with the original), `04_00_ARC04_9_2` op 877 (the fire that "fills the room"
now covers it: its four layers' tracks put them at depth 8214-8382, over the room's 5886-7558).

## Linked layers as clipping masks (V12), 2026-11-06

After V11 the user reported that QA_17's shadow was still in the wrong place, with a capture from the original game.
Layer 26 there is Neco-Arc's own picture as a dark orange silhouette (STEC 1 0xFF8913, SNX2 -157, alpha 114, blur 4),
linked to her layer 25 and drawn over her, 22 px right and 16 px down. In the original her head is one even shade with
a light rim down its left edge and nothing outside her outline: the overlay is clipped to her picture. The port
clipped it to the panel rectangle only, so it spilled past her ears and edges.

- `0x32e30`'s linked branch draws the owner's texture (slot `0x189` + link), opaque, at the owner's position, zoom and
  rotation, scissored to the clip, as the mask a linked layer is drawn through; `0x36520` uses it when the clip is not
  empty, SACL layers keep their own clip (`0x37f50`), and a panel drawn as one run goes through a group target that
  composites through the owner (`0xa2ba0` modes, `0xa4bc0`, `0xa2c30`). renderer.js `maskOwner` / `drawOwnerMask`
  render the owner's picture into a 1920 x 1080 mask target and the layer shader multiplies the linked layer by it.
- STCH appends `_XX_YY` to a blurred picture's name before looking it up (`0x60840`), so a blurred layer takes the
  pre-blurred picture's pivot; transform.js `blurName` places it by that entry. (QA_17's overlay has the same pivot
  either way.)

Checks: tests 164/164 (two new in `motion-fields.test.mjs`). Browser, storage backed up and restored by hash: QA_17 op
331 rows sampled under the text bubble give a head of b95f3a with a rim of ffac69 about 20 px wide on the left and
nothing past her outline, the same pattern as the capture (c8713c, ffbb74); `09_01_CIEL09_2_1` op 1232 (Noel's purple
light stays on her) and `05_00_ARC05_9` op 119 (a full-screen mask picture, nothing cut); no WebGL errors. Left open
(V13): the web's Neco-Arc is about 15 levels darker in green and blue than in the capture. Checked on 2026-11-07 and dropped:
the capture is a YouTube recording, and the web's effect pass matches the original's `pre_alter` shader (SPIR-V
`7e70751d45de6bdc`) line by line; only its gamma round trip on near-black tones is unsettled (see V13).

## Menu column cursor row, 2026-11-07

Reported: Config opened from the title drew the column's cursor line near the top of the screen, not under Save. The
port placed the line and light only when a column button was selected, and Config from the title selects none, so both
stayed at top 0. The game keeps one row for the whole run (0xb359f0, .bss, so Save at start-up), written only by the
column's input (0x4cea0), and draws the line and light there from the first frame (0x4c370). `ui.column()` now keeps
`menuRow` and one `MenuCursor` for the run; the pause menu's keys start from that row; a new row restarts the line's
stretch and the light but not its alpha. Checklist M19. Tests 169/169; checked in the browser (line 136 px, light 32 px
for Save; row 1 after pointing at Load, kept on reopening); storage backed up and restored from the manifest page,
8 keys verified. Left open: the game fades the line and light out while the open screen's own controls have the focus.

## An ended page leaves the window at once (F823), 2026-11-07

Reported: QA_17's balloon ("It's sad, but this is who Ciel really is.") showed the previous page's text for a moment as
it opened. The game's window draw (0x391a0) clears the page (0x53ab0) on any frame its panel is up while F823, the
page counter every script sets to 0 right after a page's last click, is below 1; the port kept an ended page until the
next message began, so waits, scene changes and a CLO5 fade-in in between could show it (here from half the 400 ms
fade until the MSG). `TextBox.clearEndedPage`, run each tick with [F822, F823] from main.js, now clears it as the game
does. Checklist T13. Tests 184/184; checked in the browser at QA_17 op 241-332; storage backed up and restored from
the manifest page, 8 keys verified.

## Sprite pivots by the engine's picture names (V14), 2026-11-07

Reported: in `14_01B_01_CIEL14B_1D` ("Integrate the first, third, and fourth causes of death...") Ciel's bust ended
about 100 px above the bottom of the screen. The engine finds a picture through its name table, not the file name in
its image record: STCH calls 0x55d30, which upper-cases the name, hashes it and returns the index the name has in the
table at *0xae0888 (32-byte names, one per record, indexed by 0x55ac0), and 0x60840 reads the image table (*0xae0540,
0x48-byte records) at that same index. For a pose's expressions the record's +8 is the pose's shared file
(`SIE_A_46_00_N00_B`) and +0x10 the expression's own (`SIE_A_46_00_N06`), which is its name in the name table.
`build_system.py` had keyed the pivots by +8, so 3,768 records (3,725 pictures the scripts use: most character
expressions) fell back to the centre. Ciel's pivot is 0.4935, 0.36996 of her picture; drawn about the centre at y 60,
zoom 500 (track 16613), her cut-off edge sat at 982 px instead of below the screen.

`build_system.py` `image_records` reads each record's name from the name table, and `image_pivots` /
`image_pivot_cuts` use it: `system.json` pivots 7,068 -> 9,609 and pivotCuts 11,749 -> 14,290 (dropped: 1,226 `_B` file
names no script uses; the rest of the file is unchanged). The change is broad: 6,517 sprite calls move by 50 px or
more at zoom 1. Some close-ups were placed by the scripts far off-screen for a pivot near the picture's edge and
showed only a sliver; `05_01_CIEL05_3E` op 4743 (y 537, pivot 85% down) and `14_01B_01_CIEL14B_1G` op 3189 (y 610,
pivot below the picture) now fill the screen.

Checks: test "V14" in transform.test.mjs (the table's pivots for the pose and its file name, and Ciel's bottom edge
below 1080 px); 195/195. A native frame from a copy of the user's save (`01_00_ARC01_2` op 826, Arihiko's
`ari_l_00_03_n02`, zoom 942, turned -14.7°) against the port's frame rendered both ways: over the 287,653 pixels where
the two placements differ, its luminance correlates 0.992 with the new pivot and 0.33 with the centre. Browser: the
reported line shows the bust running off the bottom; no console errors; storage backed up and restored from the
manifest page, 8 keys verified. (Native runs advance text only when started from `framework/build/tsukihime`.)

## Panel groups with a blended first layer, 2026-11-08

Reported: the flashing in `02_00_ARC02_1` (the bedroom on "After opening my eyes...", op 586) looked different from the
game. The port's whole background swung between black and full brightness every 1.25 s; the game holds it steady and
only blips by about 2 levels. Layers 23 (a grey card with `STBR 6`, alpha pulsing 255 -> 0 -> 255 on track 506), 25 (the
room) and 24 (the lines, `STBR 10`) are one panel group, over layer 26 (the room again) and under `FADE 40`.

The port made a group's buffer only when its first layer was translucent, and laid it over the scene with a plain
draw. `0xa4bc0` / `0xa6570` draw the first layer into the buffer with no blend and at full alpha and keep its type, shader and
alpha (`0xae0d30` / `0xae0d38` / `0xae0d40`), and `0xa2c30` / `0x37ea0` lay the buffer over the scene with them at any alpha.
So at alpha 255 the group's opaque room and subtracted lines went straight onto the screen and wiped out layer 26 (black),
where the game's `ps_lighten` of that nearly black buffer leaves it alone.

`transform.js` `groupNeedsBuffer` / `groupCoverage`, `renderer.js` `compositeGroup`: a group whose first layer has a blend
shader always goes through the buffer, its first layer unblended, and the buffer goes over the scene with that shader at
opacity A; the buffer's own alpha is A with no edge width and 1 with one, which keeps N2-6's A^2 / A for shaders using
a x op and gives dodge (op alone) its A. Static census: 7 scripts have such a group.

Checks: test in `reverify.test.mjs`. Native frames against the port, Playwright (own profile, storage untouched): 40 steps of 10
blend modes x 4 alphas on a test panel all within 1-5 levels (worst 10, `sub` at full alpha); 8 cut-downs of the real
scene at 3 alphas within a few levels; the real scene is steady and matches a native frame.

## The flicker in that scene, the display curve and the working space, 2026-11-08

After the fix above the room held steady but the game's faint flicker (twice per 1.25 s pulse, about 2.5 levels on the
ceiling) was missing. Read off the native build with `NX_TRACE_DRAWS` and `NX_SNAP_DRAWS` + `NX_SNAP_RAW` (each pass's target,
alpha included; docs/nvn/DEBUG.md):

- A later blended layer of a panel group draws no mask of its own (`0x36520`: linked, in a group), so its alpha pass (exalpha,
  the shader `d8c6f5ebc4620f7f`) reads the mask target left by the first layer: the first layer's picture at the first alpha.
  The layer's texel alpha is scaled by the first alpha and the blend's opacity is the layer's own (measured on a black `sub`:
  0.497 left at A = 128, 0.746 at A = 64, 0.872 at A = 64 with own alpha 128). A weak `sub` leaves the group's buffer bright,
  and `ps_lighten` lets a little of it through: the flicker. `renderer.js` passes it as `coverage`.
- Every frame ends with shader `138dd8be4ccf62ce`: x^2.2 into an sRGB screen. Pictures are read through an sRGB view and
  baked into the targets as x^(1/2.2), the inverse, so an untouched picture comes out as stored and blends happen in that
  space. The two cancel except where something is blended in the darks: A^2 white over black shows 7 at A = 64, not 16.
  `FS_DISPLAY` / `working()` in `renderer.js`; ANIMATIONS.md's "stays in gamma space" no longer holds.

Checks: test in `reverify.test.mjs` (a byte round trip, the measured curve within 1.2 levels at 15 alphas). Native frames against
the port, own profile: the real scene's flicker has native's shape and size (ceiling base 27.3 and peak 30.0, native 25.2 and
27.65); 40 blend steps within 1-5 levels (worst 9, `dodge`); plain pictures and ordinary scenes with sprites differ by 1-1.6 levels
on average with no drift in any tone. Left open: the text window's veil is a DOM element over the canvas, so it is applied after the
display curve where the game applies it before; in dark areas behind the window the port stays about 4 levels bright
(`F(v x) < v F(x)` at the toe). Doing it right means drawing the window picture into the canvas.

## Panel groups that are not plain runs, and the blend-layer brightness, 2026-11-09

TODO items 9 and 10. Item 9 needed no code. The "5 to 10 levels" (N2-12's add at alpha 0.5, 8 levels) was measured before the
display-curve fix above, and a fresh native run of 24 blend modes (STBR 1, 4-7, 9-25, 28, 29) at alpha 128 and 255 over a photo,
and 12 of them with a soft-edged picture and a sprite, compares with the port at about 1 level on average in every tone
(`stbr3 28 128`, the original add case, 0.5), the same as plain pictures.

Item 10: a headless replay of every script counted the arrangements the group model did not cover: **83 waits in 18 scripts**
(the owner not first in its run in 58 waits; owner and child split by an unlinked layer in 36, some with both; for example 05_01_CIEL05_4B,
13_00_ARC13_1, 09_01_CIEL09_4, 13_01_02_CIEL13_7C, 10_00_ARC10_3_2, QA_17). The worst, 05_01_CIEL05_4B op 366: a child at alpha 159
below a full-screen opaque owner drew the whole flashback panel at 0.39 opacity.

Read off the native build with `NX_TRACE_DRAWS` and `NX_SNAP_DRAWS` (per-draw targets) and test scenes of each arrangement:

- `0x9f020` sets the group's first flag at the start of every frame (`0xae0d20` = 1); `0xa2ba0(1)` after state 0 sets it again. The
  first layer of a group to be drawn clears the buffer (`c8bec(G1, ..., flag)`), so a member alone in the depth order that is not
  first adds to whatever the buffer holds, and every member alone (state 2, no first flag) composites the buffer again.
  An unlinked layer between owner and child is covered inside the panel by the second composite.
- The owner writes the mask target and the stored alpha every time it is drawn (`0xa74b0`); a linked layer writes neither, except that
  as the frame's first layer it leaves the stored alpha at 1 (its vertex colour alpha is 255: the shaders take its alpha from a constant)
  and a mask of its own alpha times the mask left from the previous frame. So the group's opacity is the owner's alpha, wherever
  the owner sits; a linked layer is relative to the group's opacity and the owner, drawn later than a child, goes in at its own alpha.
- A link to an owner with no clip goes down `0x36520`'s plain path and draws plainly with own alpha x owner's alpha, as the port already did.
  The first layer's blend shader remains the composite's shader (`0xae0d30` / `0xae0d38`), also for later members alone in the frame.

`renderer.js` runs that machine (`drawTangled`, with `groupModes` and `plainGroups` in `transform.js`) in frames that have any of these
arrangements; frames with only plain groups keep their path unchanged. Edge widths keep the group's fade out of the buffer the next
member adds to (`groupCopy`), since the mask lives in its own target on the native side.

Checks: tests in `reverify.test.mjs`. Native frames against the port (own profile, no user progress touched): about 65 steps of the
arrangements (child below owner, a member cut off by an unlinked layer, a child first, earlier groups left in the buffer, with and
without edge widths and blend shaders), every step within about 1 to 2 levels on average; before the fix, up to 131. Real scripts run from their first
line on the native build and in the port: 14_01A_CIEL14A_2 at the affected lines, 1.2 and 1.6 levels on the picture with the text window excluded;
05_01_CIEL05_4B, 3.6 and 4.5 (part of that was a sprite over-blurred by the port, fixed next).

Not settled: one synthetic frame with a panelled group first and an unpanelled group after it stays 14 levels off. No script
has that combination in one frame (the 45 samples of unpanelled groups come from 05_01_CIEL05_3E, 13_01_01_CIEL13_5B and QA_19, each with no other group).
A blank clip argument on `STCH` keeps the slot's old clip in the native build (synthetic test scenes); the port's `panelArgs` was not changed for that.

## Blur numbers are not pixel radii, 2026-11-09

Found while checking item 10: in 05_01_CIEL05_4B `vrv_s_28_05_a00` with blur 15 is sharp in the game and a smear in the port. The game has
no live blur (ANIMATIONS.md): STCH's blur arguments pick a pre-blurred file, `<name>_XX_YY`, and 7,286 of those exist. The port doesn't ship
them and regenerates the blur, and used the number as a box radius in stored pixels. The files say otherwise. Fitted on about 120 base and
variant pairs from the archives, every class and blur from 1 to 64: a Gaussian of sigma 0.65 x n x the size class (A and backgrounds 1, L 0.5,
M 0.25, S 0.125), on top of about 0.55 px from the variant being resampled, so n = 15 is about 9.8 px on a background and 1.3 px on an S
sprite. The old box radius has a sigma of 0.58 n whatever the class, so backgrounds were close (8,040 of the 9,130 blurred calls), but L
sprites were about 2 times too strong (623 calls), M 4 times (313) and S 7 times (154). An axis of 0 stays sharp.

`renderer.js` `blurred` now draws a true Gaussian with `blurSigma` (`transform.js`). It still regenerates the blur: shipping the game's files would be exact, but
that is 4,631 more pictures (the variants the scripts use, about 500 MB as AVIF by this set's average).

Checks: test in `reverify.test.mjs`. 42 test steps on the native build and in the port (S, M, L and A sprites and a background, blur 0 to 17):
1.0 to 2.9 levels on average around the picture, the same as the unblurred steps of each picture. 05_01_CIEL05_4B on both builds from its first
line: the sprite's area 3.0 levels, with matching sharpness.

## Gallery items 34, 35, 37, 38, 41 and 42, 2026-11-09

The six gallery items of [TODO.md](TODO.md), each compared with the native build (reference save) and the port hand-stepped in an isolated browser.

- **The column's window, inner panel and underline** (`N2-58`) are at (56, 0), (365, 0) and (0, 72). The best offset of each against a native frame is (0, 0).
- **Music rows** (`N2-67`) are white at 0.55, the cursor's row white. The code's alpha is 0.5, but that gives letter peaks of 140 where the game shows 148 to 151, so 0.55 is measured. The glow and the locked and playing colours are gone: a row playing with the cursor on the panel looks like any other.
- **Choosing the open section** (`N2-60`) enters it with a key and keeps everything as it was. A click on that row only plays the sound.
- **The section reopened** (`N2-56`) is the one left on in this run. It is no longer stored: the native value is in `.bss`, so a restart opens on the CG Gallery, and so does the column's Title row.
- **Sub-grids** (`N2-64`, `N2-186`) crossfade: the old thumbnails and scroll bar go out over half a second, quadratic out, under the new cascade, and every grid brings its cursor and scroll bar in by itself, also after the viewer, which has no crossfade.
- **Replays** (`N2-57`, `N2-62`, `N2-63`) leave over half a second. From the Ending List the column, section and band go, from the answer on, as the dialog does its own fade. From the flowchart a black cover rises. Both lower the menu's background at 0.04 a frame and fade the music at 3.33 a frame.

Checks: tests in `function-map.test.mjs`; native frames for every item. In dumped native frames the menu's sky runs about 1.36 game ticks a present, so per-frame fades counted in ticks finish a little sooner there than the 25 frames the code gives.

The menu's sky is 5 to 8 levels too red in the port and the gallery's help band sits under a question's backdrop. Neither was changed here (items 112 and 113).

## TODO items 11, 12 and 13: the rendering functions never re-read, and 16 fixes compared with the game, 2026-11-09

**Item 11.** The 11 rendering functions that differed at the first audit and were fixed later had never been re-read. Each was read
again in Ghidra's output and the listing, with its callers and a survey of the scripts' arguments. Seven agree with the port. Four gave six
differences (`N2-212` to `N2-217` in FUNCTION-MAP.md), each confirmed on native frames before it was changed:

- **STCP waits for a commit** (`0x62a40`). It writes the layer number's state; the draw order is the record's table, which only a commit
  fills. On a picture already on screen the new depth therefore shows at the next FADS, or the next wait with a staged picture. `vm.js` keeps
  it as `zNext` until `commit()`. 17 waits in 8 scripts drew differently, the longest in `05_01_CIEL05_2_2B`, where a sprite given `STCP 31 0`
  (then FANX, which does nothing) stays up through six waits and a line while its track plays.
- **SOXY is in screen pixels** (`0x37f50`). `transform.js` had the thumbnail path's units (`0x884f0`): about 0.89 px a unit across and 0.82
  down, in whole steps. 208 calls.
- **The menu's blur** (`0xa0a90`) runs its two passes twice and has 15 taps, a sigma of 5.6 px where the port had 3.7.
- **A choice's glow** is that same blur over the labels (sigma about 4.3 px). The port's sharp copy showed nothing.
- **No mipmaps.** A picture drawn smaller than stored is sampled from the full picture. Found on the native frame for `N2-99`.
- **Speed lines are drawn after the RGB split.** No script has both on; under a FADS the lines are in both pictures, as they were here.

**Item 12.** Native runs of test scenes in the sandbox (the scene put in 00_00's slot, started with New Game), with the port run on the same
scene in an isolated browser. Timed effects were read against a clock on screen: a mark moved by `STCL` over 20 s, which the engine steps
3 / 4096 of the way a tick (1.289 px). 14 of the 16 match as they were; the comparison is on each finding's line in FUNCTION-MAP.md and in
the evidence file. Two were wrong:

- **The rewind icon** (`N2-9`) was lit for 0.3 s. The game's level moves 0.25 a frame, up on a frame that rewinds: one frame at a quarter
  for one tap. `main.js` now sets the level each frame.
- **The skip icon stopped at unread text** (`N2-8`) stayed at 0.6. The level only rises while the skip runs, so it fades out there.

**Item 13.** The same captures settle the speed lines' blend: blended, not added (types 19, 7 and 6 over half-grey and black).

Checks: 381 tests (three new in `reverify.test.mjs`, V9 and V10 updated); `/smoketest.html` clean (549 scripts, 1,059,371 commands, 84
choices). Seen and left: holding rewind goes back a page a frame in the game (TODO 114), and the menu's sky and the window's veil are
laid on after the display curve (TODO 115). Not captured: the |<< of Return to Previous Scene's countdown.

## Priority 1 of TODO.md: the story's known differences, 2026-11-09

The ten items ranked first on 2026-11-09 (58, 116, 64, 63, 62, 61, 66, 111, 67, 68). Nine changed the port and one (66) could not be
reproduced on the game. Each was run on the native build in the sandbox, with a test scene in 00_00's slot or the reference save, and the
same scene in the port in an isolated browser.

**58. A page whose first line goes on without a click.** Every MSG makes a record as it starts (`0x5a910` in `0x6e0d0`), and on a page's
first line that record is the checkpoint a save takes (`0x527f0`). The port took its checkpoint at the page's first wait, which is the
same thing only when that line waits. It does not on 49 pages whose first line ends in `@e` (the next line follows by itself, usually the
second half of a voiced sentence), on 935 whose first line ends in `@n` with pictures, sounds or waits before the `MSAD` that finishes it,
and on every page with "Display whole text" on. Native runs (Return to Title, then Continue): the `@e` line types again and the next line
follows; an `@n` line types again, the fade after it plays again, then the `MSAD`. `vm.js` now keeps the MSG's own record for such a line
(`messagePoint`) and a load runs the message again, voice included. An `MSAD` after `@n` copies that record again with its own text
(`0x6e950` makes none of its own while nothing else has made one, `0x146e644`), so the checkpoint stays and only the save's note changes.

The same record is what a rewind lands on. A native run of a rewind from the page after an `@e` page lands on its first line, types it
and waits there with the line mark; the port had no record for that line and went back two pages. The line now keeps one (`passed`), and
a record a task held back is passed over as in `0x814c0`. A Quick Jump onto such a line runs it again and goes on, from the listing only.

Found on the way: a record made inside an instant run (the unread line a read scene's skip stops at, which is also the checkpoint) held
the silence the run plays in, so a save made there loaded with no music. Records now take the run's own sound record (`soundState`).

**116. The text window is drawn in the canvas.** `renderer.js` blends the window's pictures into the frame before the display pass
(`drawWindow`, read through `working()` like any picture), `textbox.js` hands them over (`pictures()`), and the page's own elements only
stand in until the art has loaded. The text stays a page element. The window is left out of a save's picture, hidden with the text and in
the backlog, and goes with the system menu's rise, as before. Native frames of six grey steps and a photo behind the full window: a stored
35 shows as 16 in the game, 17 in the port (21 before), and the whole frame below the text differs by 0.06 levels on average. Balloons
(a single one, and the two of QA_09): 1.2 and 1.0 levels from native, a little closer than the page elements were.

**64. A voice wait ends with the newest voice** (`0x9c400`). Voices take two handles in turn and the game asks only the one in use.
`audio.js` `voicePlaying` and `voiceDone` do the same. Native: a 0.8 s voice started over an 8.6 s one, then `VCWT`: the wait ends after
0.81 s (8.40 s with the long voice alone). Port: 0.80 s and 8.32 s.

**63. A muted speaker's line cuts nothing** (`0x9c300`, the test at `0x6e6dc`). MSG, MSAD, VPL2 and Replay Voice all test the speaker's
row before they stop or start anything. `audio.js` `playVoice` now returns first, and the line has no voice of its own to wait for.
Native, with the row switched off in the save: the voice of the line before plays out, 8.4 s; with the row on it is cut after 3.2 s.

**62. Delayed sounds count behind a menu** (`0x65e50`). The mixer runs the countdown every frame in any state; only a rewind holds it.
The port counted on the story's clock, which stands still under a menu. `vm.js` has a clock for the slots (`soundClock`) that only the
port's own holds stop (pictures loading, a hidden tab). Native: a sound delayed 8 s plays on time with the system menu open, 6.28 s of it
in the same 10 s of the audio log as without the menu.

**61. A stop leaves the old track of a crossfade alone** (`0x9c650`, `0x9c610`). The stop is of the music handle in use. `audio.js`
`stopAll`, `stopPlaying` and `restore` no longer kill the track still falling on the other handle; the next track to start takes that
handle, as before. Native: Quick Load 13 s into a 30 s crossfade, to a point with no music: the old track is heard falling for another
16 s.

**66. Not reproduced.** The game was said to play nothing when a save with a delayed sound waiting was loaded in the same run as a Return
to Title. Two native runs, the same run and a fresh start: the sound plays 15 s after the load in both, and so does a plain `SEPL` after
it. The first attempt here showed how the earlier observation can come about: a scripted press was dropped, the line that queues the
sound was never reached, and nothing played. The port was already right; a test now covers the case.

**111. Panel edges.** Two causes, neither the one the lead named.

- A turned panel's band. `0x34a70`'s turned branch works out the points pieces would need if they were hung by their middle, half a width
  in from each side, and then hangs them by a corner or a side. So the top and left bands peak half a width inside the edge and are gone
  at 1.5 widths; the bottom and right ones rise over two widths, from 2.5 widths inside, and peak half a width before the edge; and each
  corner's square sits half a width out of place, leaving a small notch. `FS_FRAME` draws the sixteen pieces as placed (`turnedBand`).
  A turned panel on its own is now made in a buffer, picture, band, then the mask over both, as its group would be, because that band
  lies over the picture where the mask is still falling. 36 `STRR` calls land on such panels.
- Style 7. Its edge blobs (`alphagradationNNN_2`) are not the same on both sides: the lower and right halves reach their plateau a texel
  sooner. The game's mask draws each side from that side's half of the blob (`0x32e30`, rectangles `0x572990`); the port read the upper
  half for every side, which is 2 px at a width of 60. `edgeFade` now reads the right half.

Native frames on black and on white backgrounds (alpha and colour separately), nine cases: a turned band alone from 15.3 levels of colour
difference to 2.5 (p99 129 to 7), with a linked picture 19.1 to 1.6, the panel of `03_00_ARC03_3` op 1517 4.8 to 3.0 (what is left is the
sprite's line art), style 7's alpha 1.5 to 0.15 (p99 29 to 2); the unturned band unchanged at 0.06.

**67. A story movie counts as seen from its end** (`0x92400`; `0x40a00` is G005's one writer). `vm.js` `op_TOMP` recorded the movie as it
started; the record is now made where G005's bit is set, when the showing ends or is passed. A page closed during a first
showing therefore leaves the movie unseen: not in the Movie list, its songs locked, not passable next time. Native, with G005 cleared in the
save copy and a scene that plays movie 5 twice: the first showing runs its whole 107 s through presses of B and +, and the second is passed
by B nine seconds in. Port, same scene: no record and nothing stored during the first showing, both after it. (The game passes a movie
with B or +; A does nothing.)

**68. Jump to Next Scene is off in a replay from the gallery's flowchart** (`0x4e0c0`). `ui.js` tests the replay's source. Native frames
of the mode panel in such a replay: Jump to Next Scene, Q.SAVE and Q.LOAD unlit, all three lit in the story.

Checks: 399 tests (`tests/priority1.test.mjs` is new; one older test follows the delay slots' clock and one the frame shader's new
shape); `/smoketest.html` clean (549 scripts, 1,059,371 commands, 84 choices). Seen and left for later: a rewind onto a first line that ends in `@n` shows the page as it stood at
its `MSAD`, where the game goes back to the MSG and plays the stretch again; with two balloons up (QA_09 op 1657, the only place) the game
types in the second one and the port in the first; the game passes a movie with B or + only, the port with a click or the advance keys.

## The page with two balloons, 2026-11-09

TODO item 139, found while checking item 116. QA_09 has the one page where two characters speak in turn with a balloon each (ops
1647-1666: style 22 for "You're dead, punk!", then `F1111` = 4 for "Come at me!"). The port drew the second balloon as a picture and typed
both lines in the first.

`0x391a0` draws the page's earlier lines in its loop, at the first balloon's text origin, and the current message afterwards. With `F1111`
of 3 or more that trailing draw takes the second balloon's style and its offsets (`F1112`, `F1113`) for the origin and moves the line up
one row, so the page's second line sits on the second balloon's first row; the click mark follows it; and the earlier lines aim at full
brightness instead of dimming (the port had that part). The row width stays the first style's.

`textbox.js` `placeCurrent` moves the current line's segments into an element placed at that origin when the line is added, and puts a
line back into the page's flow once it is an earlier one or the balloon goes. Setting the variables alone moves nothing, as the game draws
the line on screen again only with the next message.

Checks: a test in `tests/priority1.test.mjs` (400 pass); `/smoketest.html` clean. Native frames of a test scene with QA_09's two lines
and variables against the port on the same scene: the second line's text starts at (889, 848) in both, the first line stays at full
brightness in both (255), and on a later one-balloon page the earlier line dims to 128 in the game and 127 in the port. The real page in
the port has each line in its speaker's balloon; a record of the second line restored (rewind, Quick Jump) and a load of the page's
checkpoint both come back right. The click mark sits about 10 px further from the text in the game here, as it does in a single balloon
(the game's balloon text is set in fixed cells, the port's proportionally).

## The game's random numbers (TODO item 120), 2026-11-09

The question was whether the game's random sequence repeats between runs. It has two generators, and the answer differs.

**The engine's own** is a TinyMT (`nn::util::TinyMt`, a 0x20-byte object at system `+0x50`, vtable `0xad39f8`: `0xfe2bc` a raw
number, `0xfe2c4` a fraction of 24 bits, reached through `0xa8f70`, `0xa8f90`, `0xb5290`). The settings' default constructor
`0xfac30` fills the seed with four bytes from `nn::os::GenerateRandomBytes`, the main function `0x14d0` leaves it alone, and the
engine's start-up `0xfb044` hands it to `0xfe234`, which takes the system clock instead when the bytes read as a negative number. So
it starts differently at every launch. It gives a quake its offsets (SQK2 `0x3ca00`, MSQK `0x3d6b0`), a shake its multiplicity
(`0x3d3e4`: one frame in five), the grain its place (`0x361c8`), a speed line its angle (`0x86398`), and the title, the menu
background and SE Test theirs. There is no sequence to copy; the port's stand-ins have the same spread (checked again against the
listing: +-amplitude evenly, one in five, 0 to 160 by 0 to 90 px, a whole short).

**The C library's `rand()`** (import `0x1527f0`; the SDK's `0x557850` is musl's: the 64-bit state x 6364136223846793005 + 1, the
top 31 bits returned). The game does not import `srand`, the SDK never calls it, and the state is in zeroed memory: the numbers are
the same at every launch. 17 calls use it: a sway's amplitude, period and sign (`0x3d224`-`0x3d560`), the speed lines' count for a
batch (`0x86ab4`) and each line's distance from the centre (`0x863a4`), and the falling notes no script uses.

What the port had wrong besides the sequence:

- A sway's two ends were sorted. The game computes r x (b - a) + a from them as given, in single precision, cut towards zero
  (`SSW2(7, 4, ..)` and the two `3000, 2000` periods in the scripts).
- The speed lines' count included its upper end. The game takes first + rand() % (second - first). Their distances are whole
  numbers, min + rand() % span, and a batch keeps the centre and alpha of the frame it was made on.
- A rewind or a load put a running sway back where it was when the line was saved. The game's restore (`0x5baf0`) writes the
  command's numbers into the live record and nothing else, so the cycle under way goes on.
- A sway with a factor of 0 (the script's `0.5`) drew nothing; the game still draws its numbers, which moves everything after it.

The port: `random.js` has `crand` (BigInt, state 0 at page load) and the game's way of turning a number into a range.
`effects.js` keeps a sway's cycle per axis beside the effect and `advanceRandom`, called once a frame from `main.js`, draws every
number that has come due in the game's order: frame by frame, layers by number, x before y, then the speed lines' batch
(`screenfx.js` `linesDue` / `linesBatch`). A sample taken without it settles its own effect. `vm.js` carries a running sway's cycle
over a restore and over a layer staged again from itself.

Checks: `tests/random.test.mjs` (9 tests; 409 pass in all); `/smoketest.html` clean (549 scripts). Native runs of test scenes, the
box's position read from every third present against an on-screen clock:

- One sway (`SSW2(3, 7, 15, 1000, 2000, 1, -1, 0)`), run twice: both runs move alike, and alike the port from a fresh `rand()`:
  first cycles x 7 / 80 frames, 8 / 96, 10 / 92, 12 / 119 and y 13 / 106, 9 / 100, 12 / 86, 11 / 87, signs - and +. Over the clock's
  22.7 s (1,365 ticks, about 12 cycles an axis) the first run is 0.2 to 0.5 px from the port on average, on whole-pixel positions.
  The second run parts from it at tick 974, where x and y renew one frame apart: its frames were uneven there and y went first, so
  the two axes swapped numbers (x 11 / 115, y 10 / 88 instead of 10 / 88 and 11 / 115).
- Two layers at once, the second `SSW2(4, 15, 7, 2000, 1000, ..)`: both within 0.2 to 0.6 px of the port for 20 s, which settles the
  layer order and the unsorted ends.
- Speed lines of type 19 for a second, then a sway: the sway matches the port (0.21 and 0.34 px, at most 1.0, over 18 s) only when
  the lines made 29 batches, each taking 1 + count numbers; one batch more or fewer is 7 to 10 px off. The port in a browser made
  29 in three runs of three and drew the same first cycles (x 12 / 87, y 10 / 110).
- The scripts' usual order (STCH, SSW2, FADS): the sway starts on the commit's frame with the same numbers; a commit of another
  layer does not disturb it; a plain STCH of the swaying layer stops it dead (the port did that already).
- A rewind 8.5 s into a sway: afterwards y moves at 7 / 85 and x at 7 / 116, the next four numbers of the sequence, signs kept.
  That is the cycle going on through two frames of 30 ticks at the restore (the engine cuts a long frame to half a second): modelled
  so, the 330 presents after the rewind are 0.84 px (x and y summed) from the prediction, against 9 to 16 px for no long frame, one or three.

Not done: items 142 (a cycle left in a record that a second restore finds again) and 143 (uneven frames) of TODO.md.

## TODO item 51: 25 text and script fixes compared with the game, 2026-11-09

The 16 text and 9 script fixes of 2026-11-08 that had been made from the listing and unit tests were each run on the native PC build. A
test scene went into script 00_00's slot and was started with New Game, with frame dumps and scripted presses; the port ran the same raw
scene in an isolated headless Chrome, stepped one 60 Hz frame at a time on a clock of its own (timers, animation frames and
`performance.now`), so both sides give frame numbers. Timed things were read against a clock on screen (a mark moved by `STCL`, 1.289 px a
tick; two marks restarted in turn for runs over 20 s). Text speeds were set apart in the save copy (unread 100 ms, read 250 ms) so that
each letter and each speed can be told on the frames.

**19 match the game**, with the numbers on each finding's CSV row: the pair of spaces, the dash and block runs and the removed break as
letters of the typing (`N2-117`, `118`, `122`: seven lines, every letter within 3 ticks of the port over 750); the page mark over its
loop's end (`111`); an MSAD after a page-end line waiting the page's auto delay (`110`); the read speed after a rewind and after a
load (`112`); `@k@e@n` waiting for its voice, also with the character's volume at 0 (`19`, `116`); the rewind that passes a choice
(`4`), the point dropped by a rewind past its ATSV (`76`), Quick Jump typing the line again (`77`); the blank row before the line after
a choice (`78`); a held key (`82`); the RGB split's preset change, restart at a rewind and end at a new story (`106`, `107`, `108`:
the offset at each of the first 34 steps within 0.1 px of the port's); SHAF ending a SHOK (`109`); no Skip notice and the notice
growing from its top left (`18`, `113`).

**Six needed correcting:**

- **The two-frame hold** (`N2-115`). After a click the line before dims and the mark goes on one frame, and the new line's first letter
  is there on the next. The port waited two frames, three when the frame time fell a hair short. `textbox.js` `firstFrame`.
- **Ruby** (`N2-120`). The reading fills in across its base as written: "w o r l d   " is twelve characters, its "d" at 8 of 12. The port
  spread the five letters evenly, so the later ones came up to a letter interval late. `rubyLetters`.
- **Choice rows** (`N2-80`). They type at the read speed whatever the lines were: 250 ms after read and after unread lines, 60 ms with
  read at 60. The fix had made them the unread speed, from the listing.
- **The instant run's end** (`N2-83`). All lines above the one it stops at are dim at once. The port left the last of them to fade.
- **The auto wait and the menu** (`N2-85`). The wait starts again in full when the menu closes: the game went on 183 frames after the
  window was back, where the remainder was 32. The fix had made it the remainder.
- **The history's length** (`N2-75`). A message's Z command makes a record too when layers changed before it. Over 380 pages of a
  picture move, a FADS and a line the game rewinds 199 pages; the port went back all 361, and now 199.

**Found on the same frames and fixed:**

- **A line's end.** The game counts a line as typed when the typing front is one letter past its last letter, and acts on the frame
  after: the wait mark, the auto countdown and an `@e` line's next command all came a letter interval and a frame early in the port (at
  the default speeds two to three frames a line). `typingEnd`, and `type` ending on the next frame.
- **MSAD.** The text it adds has its first two letters at once, the third a letter interval later.
- **The front's arithmetic.** Single precision, 16.666668 / speed a frame, used when the port's frames are whole: at 250 ms a letter the
  second letter shows on the sixteenth frame, not the fifteenth.
- **A press while a line types** shows it whole at once and counts as typed on the next frame, as a line typed out does (`rush`).
- **Choice rows** have two steps of typing on their first frame, show a letter as soon as the front passes it (the port waited for the
  letter to be complete, a whole interval at slow speeds), and their labels are whole from the first frame: only the backdrop fades in.
- **Switching auto on** leaves what is left of the wait: the game's countdown runs from the line's end whether auto is on or not. L
  pressed 4.5 s into a page's wait turned the page on that frame; the port waited 3 s more.
- **Return to Previous Scene** never goes to the first checkpoint since the story was started or loaded. The button is unlit through
  the first scene and for the first two lines of the second. The port lit it two lines into the first scene.

Seen and left: TODO items 144 to 148 (a rewind with nothing before it restarts the scene, a taken choice's rows, whole frames, the
story's clock as the menu closes, two side cases of the split). The fast forward of item 110 was measured in passing: the game passes
about 10 pages a second of a page made of a picture move, a FADS and a line; the port passes one a frame.

Checks: 418 tests (nine new in `item51.test.mjs`; `N2-115`, `N2-80`, `N2-85`, `N2-120`, `S21`, `T4`, `T8` and the choice test updated);
`/smoketest.html` clean (549 scripts, 1,059,371 commands, 84 choices). Scenes, runners and measurements are in the session's
scratchpad (`nat/mk51.py`, `plib.mjs`, `p_*.mjs`).

## TODO item 110: fast forward at the game's speed, 2026-11-09

Fast forward in the port passed every timed thing at once: tweens and motions jumped to their ends, FADS changed the picture with no
transition, quakes and shakes were dropped, a WTTM took no time, and a message took one frame. The game does none of that. It keeps
running its frames, 60 a second, and makes each one worth more.

**How it was measured.** Test scenes in script 00_00's slot, started with New Game on the native PC build with ZR held (and once the
real 00_00), every frame dumped. A small white box moved to a new place before each wait, so the frames a wait takes can be counted; two
marks on 60 s `STCL` tweens give the frames' worth (0.43 px a tick, 14.2 px a frame of fast forward). The port ran the same raw scenes
in an isolated headless Chrome stepped one 60 Hz frame at a time, read at the moment each frame is drawn.

**What the game does** (`0x40ed0`, `0x4a5b0`, `0x48ac0`, `0x802c0`, `0x81b30`, `0x3c970`, `0x38d40`):

- The speed is 64, for the key held and for the toggle alike (table `0x34e054`). The layer update, the window and the transition's level
  get 64 / 2 + 1 = **33** frames a frame: tweens (STGS, STRT, STZ4, STCL), motion tracks, quakes, shakes, sways, SHOK, the speed lines,
  CLO4 / CLO5 and the window's opening.
- A **WTTM** loses **64** frames a frame: 1000 ms is one frame, 1067 ms (64 frames) one, 1084 ms (65) two, 5000 ms five. Whether a
  click may pass it makes no difference, and fast forward never ends one early.
- **FADS** always waits: the level starts at the draw of the command's frame, falls from the next frame on (1 / (ms / 16.666) a step,
  33 steps a frame), the wait is cleared the frame after the level is down and the script runs the frame after that. So: no time, 100 ms
  and 500 ms take 3 frames, 1700 ms 6, 3000 ms 8. The first frame of a timed one still shows the old picture whole.
- **STCF** waits for the tweens, which run 33 times as fast: a 3000 ms STGS and its STCF take 6 frames (83, 65, 47, 29 % of the picture,
  then none), a 1000 ms one 2.
- **A message takes 3 frames**, an MSAD 2: nothing on the frame the line is set, the whole line on the next, and on the third the
  game sees it typed; the script runs on the frame after. That is 20 pages a second, and 10 with a FADS a page, which is the "about 10
  pages a second" noted under item 51. A voice, `@e`, `@n` or `@k` changes nothing. With the game's default "Fade" text display the count
  is the same; the lines above keep dimming at their usual pace.
- The **window commands** (CLO2 to CLO5) take one frame each. A window closed by a FADS is whole again on the next message's first frame
  (its 18-frame fade is over in one).
- The **RGB split** is not sped up (`0x2f910` takes no step): after a FADE 41 it fades for its 60 frames while the script runs on.
- **Voices are not heard.** The listing starts each line's voice and cuts it a frame later; the game's sound output over 60 voiced
  lines of fast forward is silence (peak 0), where one voiced line at normal speed just before is heard. The port already played none.
- Quakes, shakes, sways and SHOK with a time are played, 33 frames a frame (a 6 s SHOK is seen for eleven frames).

**What changed in the port.**

- `vm.js` has a frame step, `tick`, which `main.js` calls once a 60 Hz frame before the text window's frame. While fast forward runs
  (`speeding`: the key or the toggle, not a test jump, an instant run, a restore or the smoke test, which still pass everything at once:
  `fast`), the story's clock stands between frames and each step moves it 33 frames; the timed waits are looked at once a step, as the
  game looks at its waits once a frame. A WTTM's wait counts 64 frames a step.
- FADS waits as above (`fade`), also at normal speed, where it was short: the game takes 3 frames for a change with no time and the
  time plus 3 frames for a timed one (chains at normal speed: 3 frames each, 9 for 100 ms, 33 for 500 ms). The port took none and the bare
  time. The level runs in the game's frames of 16.666 ms.
- A WTTM is counted in frames, ms x 3 / 50 cut to a whole number, at least one: `WTTM(17)` is one frame, where the port waited 17 ms,
  which is two.
- CLO2 to CLO5 and an STCF with nothing to wait for take their frame.
- Tweens, motions and effects are no longer cut or dropped under fast forward, and fast forward coming on no longer puts everything
  at its end (`finishAnimations` is for the runs that draw nothing). SHOK started under it counts the clock's step as its first.
- Text: a line under fast forward is typed by the window's own frames with the front at the end at once (`rush`), and the machine
  holds a message to three frame steps and an MSAD to two whatever the text box (`ticksSince`). The window's fades take the step
  (`TextBox.tick(dt, step)`).
- The split has its own clock (`frameClock`), the display's frames, so it keeps its pace.
- The mixer's fades run 65 times as fast (`Audio.setSpeed`: the frame's own call of `0x9b7f0` and one with 64), so a music change
  under fast forward is over in a few frames, as in the game; this one is from the listing, not heard on a recording.
- Speed lines make one batch a frame of fast forward (`screenfx.js` `LATE`), not one for each of the 33 frames it stands for.
- `main.js` steps the game's frames by the clock, not by the display: one a frame at 60 Hz, one every second frame at 120 Hz. The text
  window's frame goes with it, so its frame counts (a line's first frame, the typed frame, the fades) no longer run double on a 120 Hz
  display. Part of item 123.

**Compared, port against game, frame by frame:**

- The chain scene under fast forward (12 changes with no time, six 100 ms and four each of 500, 1700 and 3000 ms FADS, four STGS with
  STCF, six WTTM, then 16 one-line pages, 10 pages with a FADS, 10 voiced pages, 6 with a WTTM and 6 lines down one page): 88 of 89 steps
  take the same number of frames. The one that differs is a FADS that brings a new picture: the game holds two frames more while it loads.
- The same chains at normal speed: equal by the game's ticks (its presents sometimes carry two).
- The text scene (long lines, lines down a page, `@n` with MSAD, `@e`, `@k` with MSAD, the window closed by FADS, CLO4 / WTTM / CLO5,
  CLO3, CLO2, voiced lines, VCWT, MSQK, 18 more pages): 48 steps, each frame's window (up, half, gone) and text (showing or not) the same,
  with "Insta display" and with the default "Fade"; the key held and the toggle give the same frames.
- Tweens: the STGS levels and the STCL positions frame by frame are the game's to the pixel; SHK2's offsets too. The split's fade-out
  takes its 60 frames in both.
- The real 00_00 under 20 s of fast forward: the port follows the game's pictures within about half a second throughout and ends two or
  three messages short of it (the key's timing in the native run is good to about a third of a second).

**Seen and left** (TODO items 149 to 152):

- SHOK does not move plain colour pictures in the game (`WHITE`, `BLACK` ...: marks and boxes stood still while a real picture shook);
  the port moves every layer.
- A sway started under fast forward shows its first offset a frame early in the port.
- A FADS that brings a picture not yet loaded holds the old frame two or three frames more in the game. The port holds while its own
  loading lasts, which is a different length.
- JUMP and NOP_ end the game's frame; in the port they take none. Movies, choices and the haze under fast forward were not looked at.
- Not in any script: a page's last line ending in `@n` with a new page after it (no MSAD). The game clears the page, the port keeps the
  line. And a crossfade's old picture is the frame before last in the game (a box shown for one frame before a FADS is not in it).

Checks: 434 tests (16 new in `item110.test.mjs`; seven older ones moved to the new rules); `/smoketest.html` clean (549 scripts, 1,059,371
commands, 84 choices); the typing scenes of item 51 run frame for frame as before at normal speed, apart from the first line's phase
against the opening window. Scenes, runners and measurements are in the session's scratchpad (`nat/mk110.py`, `bx.py`, `tx.py`,
`p_ff.mjs`, `p_tx.mjs`, `cmpsteps.py`, `cmptx.py`).

## Film grain, 2026-11-09

Reported as stronger than the game's, in `13_01_01_CIEL13_2` (STNS 9 11 and 16 11). The port dropped the layer's pixels wherever the
static was under half, so a layer was either fully there or not at all. Earlier notes read `0xb2900(0x80)` as that threshold. It is not:
the trace of one frame has the static in one target, the picture in another, then exalpha (`d8c6f5ebc4620f7f`) over the frame.

- Native frames, a colour picture over black and white: red at full alpha shows as plain grey static, and half alpha mixes the static
  with what is under it, in the working space (the darks follow the display curve as any picture does). So the static replaces the
  layer's colours, and the picture is only the shape. `renderer.js` does that now; the `discard` is gone.
- 161 of the 196 STNS calls are `STBR(n,5,,1)` (dodge) on `img2345`, a plain white picture: the port dodged by white through holes.

Checks: the same scene in both builds, a photo alone, with 14 grain layers over it in turn (STBR 5 at alpha 100, 160, 255, normal at 128, ten
more blend modes with STNS 2), and with the picture without grain. Screen mean, spread and frame-to-frame change are within 0.5, 0.5 and 0.15 levels of
the game in all 16. Frame-to-frame change before the fix was 20.7, 35.7 and 68.6 for dodge at alpha 100, 160 and 255, against the game's
8.7, 13.1 and 28.9. 435 tests.

**Seen and left:** the backlog page that runs under the help bar in that scene (`'Ahhh---'` to `My left hand darts out`) does the same in
the game: an MSAD's WNTY(1) sets no page end in its record, so two screens of text make one page. Kept, at the user's word.

## Fixes and checks of 2026-11-10

Reported while playing, except the "Measured" group. 455 tests pass.

**The title's Load (half of TODO item 60, N2-128).** The port cut from the fading list straight to the story. Now the list fades,
the title stands alone with its logo still down, the music falls at 1.5 a frame and the picture goes to black at 0.01 a frame up to
1.2, then the story starts, as Continue does (`0x8ea94` -> `0x8f2b0`; `ui.js` `savesScreen`). The fade was compared with native
frames; the music with the code only, the captures being muted. Ending replays still cut the music.

**New Game's black flash.** On native frames the screen is full white (255) from the end of the fade until the story appears. The port
removed the title's white, then fetched the script while its canvas stayed black until the first `FADS`: two black frames in a
capture, longer on a slower load. `main.js` `holdWhite` keeps a white sheet up until that picture has been drawn, `vm.onFirstFade`
says when, and stopping the script lifts it too, so it cannot stay up. Two captures after the fix have no dark frame.

**The quick bar's first opening.** It was built the first time it opened, and until its art was assembled (about 0.75 s, most of it
work that held up the page) it showed the plain placeholder buttons, and the slide did not animate. It is now built at start-up, on
the black before the first screen (`ui.buildPanel`, `panel.ready`, about 0.15 s). The first opening now slides down with the real
buttons from its first frame.

**The log snapping back under the wheel.** The log adds older pages above the view for a moment after opening, up to about 1.7 s on
a long log. The browser's scroll anchoring holds the view steady when that happens, and the port moved the list by the same distance
again, so each scroll up was undone within a frame or two: all eight notches in one run. The port now moves it itself only where the
browser does not anchor: at the very top, or with no anchoring at all (`ui.js` `backlog`, `more`). Checked with simulated wheel notches
and a trackpad-like stream on a log of about 200 pages, at delays from 40 ms to 3 s after opening: the full distance every time.

**The server's terminal.** A browser dropping a kept-open connection printed a traceback from `socketserver`; `server.py`
`Server.handle_error` passes over `ConnectionError` and reports anything else.

**Compared with the game and left alone.** The gap below the flowchart: when the last authored row (276) is not shown, the game's scroll
also ends with the chart's edge at y 962, 60 px above the help band (measured with a mouse drag past the end), and the port is the
same. Back to the title from Load: the same shape frame for frame (a 21-frame fade, a cut to the title, the logo over 120 frames). Load
from the story's system menu: the game holds black about 2.2 to 2.9 s before the scene, probably its file loading, and the port does
not (TODO item 157).

**Measured for the regenerated list.** A save of an ordinary scene is about 13 KB (the layers 7.8 KB, the picture 2.7 KB), and 399 fit in the
browser's 5 MB, so item 135 is about losing saves with the browser's data, not about running out of room. None of the 870 `SHOK` calls has a
colour fill up from earlier in its own script (item 149).

**Questions before a movie is passed (at the user's request; the game has none).** `uifx.js` `movieQuestion`: the opening songs (5, 6) cannot be
passed the first time, as in the game, and ask "Skip opening animation?" from the second showing, in the gallery too; the end credits (35, 36, 37)
always ask "Skip Outro?", though the game cannot pass their first showing at all; the prologue still asks "Skip intro video?" on its first showing
only. Every way of passing goes through `main.js` `passMovie`, the gallery's too (`endMovie`), and it holds the movie under the question, which starts
on No; a second try while it asks, or during the fade after Yes, does nothing. Also: a right click or Esc opened the system menu over a movie, which
the game's menu does not do (it opens on a text wait); it no longer does. Checked with real clicks and keys in a separate Chrome, each movie first
and later showings, No and Yes, and the gallery.

**The title's still over its movie in Firefox.** `title_bg` lies over the movie until the movie has a picture, and the port tested that every frame by `readyState >= 2`. When the movie loops back to 8 s, Firefox reports 1 for 0.12 s (0.2 to 0.3 s on a seek near the end), so the still showed over the movie for that long; it is a bright picture on the later title stages, and a stall in playback would do the same at any moment. `uifx.js` `titleMovieUp` keeps the still away once the movie has had a picture, as long as it is on screen; the video goes on showing its last frame through a seek. In a separate Firefox 159 window, five loops in a row: the still up for 7 to 18 frames each time before, none after. The screen itself could not be recorded here (macOS refuses this app), so this was measured from the page's state, and what the user saw was not filmed; the video's decoded frames were clean (1,752 of them) with none dropped.

**The white flashes themselves.** The user reported them still there after that, so the still was a real bug but not this one. A visible Firefox's decoded frames are clean too (1,123 frames, no local rise over 4 levels) and none are dropped, which left how Firefox puts the video on the screen, where the port cannot look (the screen cannot be recorded from this app). Three changes made one at a time did not cure it: not drawing a cover at level 0 or a title row's flash (`ui.js` `drawCover`), hiding the story's canvas under the title's movie (`main.js` `titleVideo`), and an opacity of 0.9999 on `#movie` in Firefox to keep the video off a surface of its own (taken out again). What cured it, by the user's eye on 2026-11-10: in Firefox the title's movie is no longer drawn by the browser's video path at all. The element stays, at opacity 0, and goes on decoding; each new frame is painted onto an opaque canvas over it (`main.js` `paintMovie`, `#movie-pic`, by `requestVideoFrameCallback`). It keeps 60 frames a second with no slow frame, goes on through the loop and the title's Config, and goes away cleanly at New Game. The two harmless changes above were left in, since whether they matter alongside the canvas cannot be told from here. The same day, at the user's word, every other movie in Firefox went the same way (`paintMovie`, `#movie-pic`: the start-up logo, story movies, chapter titles, staff cards, the gallery's), one canvas for all, since all 45 movies are 1920 x 1080; a story movie's fade cover stays over it.

## web/ runs by itself, 2026-11-10

Everything the game asks for is now in `web/assets` (3.9 GB), and `server.py` is a plain file server with byte ranges and nothing but the standard library; it no longer converts on demand or reads the dump. The movies and the balloon font moved from `/rom/...` to `/assets/movie/` and `/assets/fonts/`.

What goes in is `tools/needed.py`, worked out from what the code can load, 8,903 pictures: what the scripts draw (STCH, SCH2, SPFC, SPRD), the CG viewer's (gallery.json), the flowchart's previews (flowchart.json) and the 49 transition masks. 16,460 voices, 1,284 sounds, 128 music tracks, 45 movies. Left out on purpose: the game's 7,286 pre-blurred `<name>_XX_YY` pictures, which the port makes for itself, and the 7,426 small copies the game draws save pictures from; a first run that converted those was stopped at the user's word and its 2,423 extra files removed. Thirty sound names in 31 lines of the scripts are in no archive of the game, so they are silent there too.

Checked from a folder holding only `app`, `assets` and `server.py`, run by Python with `-I -S` (no packages): title movie, New Game, a CG, a flowchart preview, a movie by byte range; `server.py` itself is not served; `tools/check_assets.py` finds nothing missing; the smoke test runs all 549 scripts without an error (it does not load pictures).

Then the same day `web/` was cut down to what the game runs from, `app/`, `assets/` and `server.py`. The tools, tests, audit and notes moved to `web-dev/`, the smoke test to `web-dev/smoketest/` (`tools/dev_server.py` serves it), and the two tables only the tools read, `image_table.json` and the interface art's manifest, to `web-dev/data/`.

## The first visit's page, 2026-11-10

At the user's request a first visit now opens on a page before anything else (`app/js/welcome.js`): a browser plays no sound until the page has been clicked, so START is that click, and the prologue opens with its sound on where it used to fall back to muted. It says what the project is and how it was built, in seven sections, and shows once (`tsuki.welcomed`; `/?welcome` opens it again; `?script=` passes it by). It is built as the quick bar is, from the game's art: the mode panel's strip with eight plates at the panel's own width and spacing (`quickBarArt`), the title's picture under the system menu's sky, the question window's backdrop, Config's inner panel, the game's scroll bar and help band. Checked under each browser's real autoplay rules: Chrome with `document-user-activation-required` and a clean Firefox.

Later the same day: the page says "Tsukihime remake" (and so do its tab title and the README), and an eighth section, EXTRAS, lists the address options (`?script=`, `&pc=`, `&label=`, `&mute`, `?welcome`), every font with its fallbacks, the game's own font files and the developer tools. Nine plates now stand on the strip, cut from 220 to 200 px as the quick bar's are.

## TODO item 123: story timing away from 60 Hz (with 143 and 146), 2026-11-10

The game draws 60 frames a second whatever the screen, and every wait, tween, typing step and countdown counts those frames. The port
counted the game's frames from the display's (`main.js` `gameFrames`: one on every display frame at 60 Hz, one on every second at
120 Hz), but the story's clocks read the real time, the script's timed waits ran on timers, and several things on the story's screen
moved once a display frame. At 60 Hz the two agree; elsewhere they did not.

**How it was measured.** The port in an isolated headless Chrome on a virtual clock (timers, animation frames and `performance.now`
move only when the harness steps them), at 30, 60, 120 and 144 display frames a second, on twelve test scenes from items 51 and 110 and
two new ones: wait chains and FADS levels (`ff2n`, `ff1n`), typing with and without clicks (`ty1`, `ty2`), fast forward (`ff2`, `ff3`),
delayed sounds (`dl1`), the RGB split (`sp1`), speed lines and sways with their random numbers (`rn1`), auto mode and its notice
(`au1`), rewinds and the << icon (`rw1`) and a choice (`ch1`). Each drawn frame was read at the moment `main.js` draws it (and the
page's own elements once the frame's callbacks had run), tagged with its game frame (`vm.ticks`), and compared with the 60 Hz run's
frame of the same number. At 60 Hz the 60 Hz run is the reference the earlier items matched to native frames.

**What was wrong** (the code before, the same scenes):

- At 120 and 144 Hz a game frame ran up to a quarter of a frame early (the tolerance that absorbs a 60 Hz display's jitter), ahead of
  the timers due on that frame, and every level was read from the real time between frames. 290 of 679 frames of the wait chains and
  93 of 679 of the tween scene showed a level between two of the game's; the speed lines' and sways' random numbers came in another
  order on 81 of 655 frames (item 143's "batch made or not depending on whether the timer fires first"); auto mode's page turn came a
  frame late on 20 of 1156.
- At 30 Hz the script's step after a line was typed ran only after both game frames of a display frame, so each line started a frame
  later than the last: the fourth line of `ty1` was three frames late, and 111 of its 128 letters.
- Counted per display frame: the << icon (0.25 a display frame, so 2.4 times too fast at 144 Hz), the scene skip's countdown (20 display
  frames: a third of a second at 60 Hz, a seventh at 144), the notices (Auto, Auto Save, Quick Save), the choice screen, the end of a
  script's fade to black, and the read-scene skip's wait for a notice to go.
- Item 146: a tween's level, a FADS's level and a wait's end fell on the real time, not on whole frames, so a step due exactly on a frame
  could come a frame early or late.

**What changed.**

- `vm.useFrameTime` (called by `main.js`): the story's three clocks (the story's, the split's and the sound clock) read the game's time,
  which `vm.frameStep` moves one whole frame at the start of each game frame (a frame count, so no rounding piles up). A timed wait, a
  delayed sound's countdown and auto mode's wait are looked at in that step instead of on timers (`sleepers`, `framePolls`), so each ends
  on its frame. Without `main.js` (the tests, the smoke test) everything reads the real time as before.
- `main.js` `frame`: for each game frame in the display frame, the clocks' step, the script's step (`vm.settleScript`: the micro-task
  queue's turns until no command has run for a while), the tick, the text window's frame, the random numbers' draws, the skip black and
  the << icon, then `vm.endFrame`; the frame is drawn once after them, and a display frame with no game frame in it is not drawn (a 120
  or 144 Hz display shows the last frame again, as the game would). A stall gives as many game frames as it lasted (the game takes up to
  half a second from a frame); a gap of over a quarter of a second, the page not drawing at all, counts as one, and a hidden page
  catches up nothing.
- `vm.everyFrame` steps the notices, the choice screen and the fade to black once a game frame; `vm.nextFrame` (the scene skip's
  countdown and its wait for a notice) waits for the end of a game frame.
- A delayed sound's countdown takes the waits' half-millisecond allowance, so that 60 frame steps make its 1000 ms (on frame time the
  sum of 60 steps falls a hair short). The notice now shows for 100 frames, the listing's 75 up and 25 down; the old one ran 102 in the stepped runs, from
  the rounding of its per-frame time step, and hides after t = 0.04 as the native frames of item N2-10 show.
- Item 146's MSAD case: the game's typing front is one single-precision number for the whole line, so an MSAD's added part goes on from
  the old count + 1 and its steps are rounded at that size. The port started the part's front at 1; it now rounds as the line's would
  (`advanceFront` with the line's letter count, `units`). At 50 ms a letter the third added letter comes on the third frame, not the
  fourth; across the speeds 15-250 and lines of 1-59 letters 176 of 1062 cases differed.

**After** (differing game frames / frames compared; the shift is the alignment that fits, -1 at 30 Hz being a state first seen on a
drawn frame that began the frame before):

| Scene | 60 Hz, old code = new | 30 Hz | 120 Hz | 144 Hz |
|---|---|---|---|---|
| `ff2n` | 0/672 | 0/327 (-1) | 0/675 (0) | 0/679 (0) |
| `ty1` | 0/673 | 0/339 (-1) | 0/684 (0) | 0/684 (0) |
| `ff1n` | 0/666 | 0/334 (-1) | 0/676 (0) | 0/676 (0) |
| `ff2` | 1/2315 | 0/1160 (-1) | 0/2325 (0) | 0/2325 (0) |
| `ff3` | 1/2327 | 0/1166 (-1) | 0/2330 (0) | 0/2329 (0) |
| `dl1` | 7/316 | 0/155 (-1) | 0/316 (1) | 0/316 (1) |
| `sp1` | 0/618 | 0/309 (0) | 0/618 (0) | 0/618 (0) |
| `rn1` | 0/651 | 0/319 (-1) | 0/665 (0) | 0/665 (0) |
| `au1` | 24/1158 | 0/575 (0) | 0/1158 (0) | 0/1158 (0) |
| `ty2` | 0/1160 | 10/577 (0) | 0/1159 (0) | 0/1160 (0) |
| `rw1` | 0/797 | 8/397 (0) | 0/797 (0) | 0/797 (0) |
| `ch1` | 0/796 | 7/397 (0) | 0/796 (0) | 0/796 (0) |

At 60 Hz the new code draws what the old drew on every frame but at a script's end (`ff2`, `ff3`: the fade to black under which the
picture clears, now on game frames), the notice's hold and fall a frame sooner (`au1`, above), and `dl1`, where a picture's load
moved the whole run by a frame (its delayed sounds take 60 frames in both). At 120 and 144 Hz every game frame is the 60 Hz one.
At 30 Hz every drawn frame is, apart from what a 30 Hz display cannot do: a state that lasts one game frame is never drawn (the rewind's
<< at a quarter, a one-frame step box), a key lands on a drawn frame and so can be a frame later (`ty2`, `rw1`, `ch1`), and a picture's
load can end between the two game frames of a display frame. A shift of 1 in `dl1` at 120 and 144 Hz is the same load.

Item 143's native half, the game's own uneven frames swapping two renewals (one sandbox run of two), is the game's timing, not
something to copy: the port's order is now the same at every rate and matches the even run.

**Not done:** item 160 (on a display frame that carries two game frames, a FADS on the second takes the frame drawn before the first as
its old picture). A real 120 or 144 Hz screen has not been watched (now part of item 136). The menus, dialogs, gallery, flowchart and
title still animate on the display's time, as interface: item 70 (the title's dust made once a display frame) is the same kind of
fault there. Tests: `tests/item123.test.mjs` (9).

## Saves as a file: Export and Import on the opening page (TODO item 135), 2026-11-12

The opening page has a fifth tab, SAVE DATA, left of PLAY ONLINE (the user, 2026-11-12: "put this in a new tab left side of play online called
save data"): what the file is, and two of the panel's plates, EXPORT SAVES and IMPORT SAVES (`app/js/home.js` savesBlock, keys E and I; at a
finger's size on a touch device). By touch the five tab plates are three over two, ABOUT, GITHUB, DOWNLOAD over SAVE DATA, PLAY ONLINE, each row
centred, on the game's stage and on the upright one (the user: "on touch put 3 tabs on top and the 2 play online and save data in second line";
`touch.js` TOUCH.home / homeUpright). The page names the format ("the Nintendo Switch game's own save format"), lists what the browser holds now
as four figures side by side across the page (`savefile.js` loadedData: scenes completed, pictures and songs as the game's own screens count
them, the saves made here; two a row on a phone held upright; the user: "make this spread out horizontally theres space"), with a line under
them when a file is loaded, and has a third plate, REMOVE DATA.

**The file** (0xa8e30: one buffer of 0x3e7000 bytes): the system data, 0x1740 bytes at 0, then 140 records of 0x7140 bytes at
0x1800 + 0x7200 n (0xb6710 / 0xb67a0; 0-99 the list, 100-138 automatic, 139 quick). The system data as 0x4ec60 writes it and 0x4ea30
reads it: `0x3ed`, 1; the config, 0x68 bytes at +4 (0x2dd20); G0-G499 at +0x6c, with the flowchart's bits among them (started from
G110, completed from G300, lines from G400) and the opening movies in G005; 0x213 bytes of bits at +0x454, pictures seen (0-0xc7f) and
music heard from bit 0xc80 by its number (0x64f60 / 0x77740); the read marks at +0x667, 0xfb4 bytes; the newest record at +0x161e; the
rows taken of each choice at +0x1624, 0x118 bytes (0x83e50), which the port has no use for. A record: `0x3f2` when used, 1 at +2, a
count at +4, the 0x3aa8 snapshot at +8, the first 0x3688 bytes of a history record at +0x3ab0, the date at +0x7138 (year, month, day,
hour, minute, second). The game's first config (0x46b080) read through the map gives exactly the port's own defaults.

- **Import** loads the file's settings, volumes, globals, flowchart, gallery and read marks over the browser's own, which are put aside
  first (`tsuki.own`: each name's stored value), and keeps the file itself in the browser's database. It asks nothing, since nothing is
  lost. Then the page loads again (everything was read from storage when it loaded) and comes back on SAVE DATA, where the list shows
  what is loaded. `main.js`'s pagehide does not write the page's own read marks and gallery over it (`savesReplaced`). A second file
  over the first leaves what is aside alone.
- **Remove** (the user, 2026-11-12: "Remove data should just remove the external file that got loaded and then your own save should
  work") takes the imported file out: after a question in the game's Yes / No window, starting on No, the names an import wrote go back
  to what was put aside, the kept file is dropped, and the page loads again. With no file loaded it does nothing and says so. The saves
  made in the port are never touched by either.
- **Export** writes the system data from the port's state, with a file loaded over that file, so what the port has no copy of (the choices
  taken, config fields with no setting, the records) comes out as it went in, and no progress the file had is taken away (as the
  game's own merge, 0x4ea30). With no file imported before it starts from the game's first config and empty records.
- **Global variables are their numbers**: `G70`, as one script spells it (13_01_02_CIEL13_7B), is `G070` (`vm.js` globalKey). The two
  were different variables in the port before.
- **The records are left alone** (the user, 2026-11-12: "no need for save slot"). The file's 140 records are neither read into the
  port's saves nor written from them; with a file loaded they go out again untouched. A record is the engine's state at a checkpoint
  (the script's byte position, two 0x19b8-byte layer state blocks, the sound slots, the story variables), which would have to be mapped
  both ways to the port's own save. The Android and desktop apps have no opening page, so no Export or Import there.

Checked with the 100% save the user gave (`~/Downloads/savedata000`, the reference save's SHA-256): read, it has 556 scenes started,
553 completed, 630 lines (as `decode_save.py`), 2,716 pictures, 116 music numbers, both movies; in Chrome (Playwright) imported into an
empty browser the gallery lists all 458 entries, 1,977 pictures and 95 of 95 songs, and the Export made after it is the same file, byte
for byte. Over a browser with progress of its own (2 scenes, text speed 50, one save) the file loaded shows 495 of 495 scenes and its own text
speed; removed, the browser's flowchart, globals and settings are the strings they were, and the save is still there. Tests:
`tests/savefile.test.mjs` (13; the one that reads the real save runs where the game's data is).

Also removed that day, at the user's word: the flowchart's Unlock All (one unpushed commit, kept on the local branch
`shelved/unlock-all`) and the Japanese language option (never committed; set aside in the working folder's `web-dev/shelved/`). A
flowchart drawn again after a question now takes the pointer at once: with its fade already done nothing gave the pointer back, so
after No to the rewind question the chart was dead to the wheel, drags and clicks.

## SAVE DATA: Load 100% save, 2026-11-12

The user: "Add my 100% save file in the save data tab as an load 100% save option. show a warning saying its not recommended and only do
it if you've finished the game. using remove data should remove this file too." Then, of a first version with a part of its own and
the warning on the page: "no just put it next to remove data button and show the warning when someone clicks on it".

LOAD 100% SAVE is a fourth plate in SAVE DATA's row, after REMOVE DATA (the panel's plate made 80 wider for the words, `home.js`
FULL_PLATE). Pressed, it shows its warning as the question of the game's Yes / No window, starting on No: "Not recommended. / Only do
this if you have finished the game. / Load the 100% save?" (three lines, set a little smaller: `ui.js` dialog `three`). On Yes it loads
as an import does: the browser's own progress is put aside (`tsuki.own`, which now also keeps a label of what is loaded, for the page's
line), and REMOVE DATA takes it out and puts the player's own back. Unlike an import it leaves the settings and volumes alone
(`importSaves` keepSettings).

The save is `app/js/fullsave.js`, 9 KB: the system data of the 100% reference save (`web-dev/tools/make_fullsave.py <savedata000>`),
with the game's first config in place of the player's and the record numbers cleared. Read back it has 556 scenes started, 553
completed, 630 lines, 2,716 pictures, 116 music numbers and both movies. In Chrome over a browser with 2 scenes, text speed 50 and one
save: loaded, 495 of 495 scenes, 1,977 pictures, 95 songs, text speed still 50, the save still there; removed, all as before.
Tests: `tests/savefile.test.mjs` (14).

**The question window on a phone held upright** (the user, 2026-11-12: "dialog box doesnt show right on phones"). The opening page held
upright has a stage 1080 wide and as tall as the window, but the game's Yes / No window is laid out for 1920 x 1080 and scaled 1.5 by
touch, so it lay off the right edge with Yes out of reach; REMOVE DATA's question had the same fault. `touch.css` now sets the window's
layout in the upright stage's middle at 1.2 (824 -> 989 of the 1080) and stretches its backdrop over the stage's height. In Chrome at
390 x 844, 360 x 880, 320 x 568 and 768 x 1024 the window and both buttons are inside the screen and centred, and a tap on No closes it;
landscape is as it was.

**The tabs followed the question's cursor** (the user: "moving cursor around on dialog box is moving it on the top tabs too"). The Yes /
No window has items of its own, No 0 and Yes 1, and the opening page lit its plates by the same cursor number, so ABOUT lit with No and
GITHUB with Yes. The page now lights a plate only while its own items are the current ones (`home.js` cursor). Held upright the window
also covers the plates above it, so they cannot be tapped while it is up. In Chrome: moving between No and Yes by pointer and by arrows
leaves the strip as it was; after No the page's own cursor lights its plates again.
