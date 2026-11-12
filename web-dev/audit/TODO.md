# What's left to do

Regenerated on 2026-11-10: every item still open, in the order to do them. Finished work is not listed. It is in
[TODO-2026-11-09.md](TODO-2026-11-09.md) (with what was done on each item, 2026-11-09 and before) and
[TODO-2026-11-08.md](TODO-2026-11-08.md), and the fixes are written up in [FIXES.md](FIXES.md).

| Group | Open |
|---|---:|
| 1. Story: differences a player can meet | 5 |
| 2. Story: checks that could find more | 7 |
| 3. The web app | 2 |
| 4. Story: exactness while skipping, in the stored files, or in rare cases | 9 |
| 5. Mouse and keyboard: leftovers | 6 |
| 6. The game's look, screen by screen | 45 |
| **Total** | **74** |

**How it's ranked.** The story comes first, as it has since the redesign: what is drawn and heard on the story screen,
which scene plays, what a save resumes and what unlocks. Inside a group, what a player meets most often comes first,
and known differences come before checks that might find some. Anything you report while playing jumps the queue.

**Numbers.** Items keep their numbers from earlier lists, so "do 58" always means the same thing and the other audit
files' references hold (where they say "priority 1 of TODO.md" they mean the list of that date, now in the archives). New items
start at 162. `N2-n` is a finding in [FUNCTION-MAP.md](FUNCTION-MAP.md), with its
evidence in [function-map/](function-map/).

**How sure.** Most findings were read from the game's code and not seen running, so compare each with the game as it
is fixed (the method is in FIXES.md). Before this list was written, the story and app items were re-read against
today's code and the counts below re-measured. The look items in group 6 were looked up by finding, and 8 of them
checked in the code (marked *code*); the others can lag it, so re-read the code before starting one.

**Mark an item** by changing `[ ]` to `[x]`.

## 1. Story: differences a player can meet

- [ ] **138. A rewind onto a first line that ends in `@n` shows the page as it stood at its `MSAD`.** The game goes back
  to the MSG: it types that part, waits for a click and plays what lies between (pictures, sounds, waits) again. 935
  pages start that way. A load of such a page has been right since item 58; the rewind and Quick Jump still land on the
  `MSAD`'s wait. From the listing and the load's native run; a rewind onto an `@n` line was not captured.
- [ ] **145. A taken choice's rows.** On one native run the row not taken lost its label at once and only a glow faded
  over about 35 frames, and the taken row stayed whole until the screen went, 50 frames on. The port fades every row
  with the screen. It shows at every choice. Read from the rows' ink on one run; whether the letters fade in with "Text
  display" on fade was not looked at (the reference save has it on Insta).
- [ ] **141. Quick Jump onto a line that went on without a click** (`@e`, Display whole text) runs the line again and goes
  on by itself, from the listing; not seen on the game.
- [ ] **147. The story's clock as the system menu closes.** On the native run the scene's clock moved again 35 presents
  before the text window was whole; the port starts it when the menu has gone. Seen on a clock mark only.
- [ ] **144. A rewind with nothing before it.** On the game's first line a rewind clears the screen and plays the scene
  again from its start (a white frame, the opening's waits, the line typed again about a second later, twice on native
  runs); `0x814c0` falls through to the oldest record. The port does nothing there.

## 2. Story: checks that could find more

- [ ] **50a. Re-read the 23 sound and script functions never re-checked.** Sound 22, script machine 1. They differed at
  the first audit, were fixed, and nobody read them again. The same gap in rendering (item 11) gave six more differences
  from 11 functions, so this is the best next check.
- [ ] **50b. Re-read the rules for what plays and what unlocks.** Among the flowchart's 30 and the gallery's 55 functions
  never re-checked: how scenes get marked, what a rewind from the chart puts back (the route flags decide which branch
  plays next), what a replay starts with, and the unlock rules. Items 4 and 5 (a replay playing the wrong scene) were of
  this kind.
- [ ] **121. Run every branch.** The smoke test takes the first row at all 84 choices. Run each row and both sides of the
  route-flag branches, and list any command or script stretch never reached.
- [ ] **52a. Look again at the story functions already marked different.** The re-check confirmed each reported
  difference in rendering, text, sound and the script machine, but did not trace those functions again for others.
- [ ] **122. Sweep whole scenes against the game.** Every comparison so far was aimed at one fix. Compare sampled frames
  and sound across every route by machine: the native build runs headless with frame dumps and scripted presses, and the
  port can draw a scene at a chosen moment and read it back. The largest check; do it after the others so it finds what
  they could not.
- [ ] **117. Check the `noalpha` blend's area.** FIXES.md still says `noalpha` (`STBR 8`, 10 calls) is drawn only over the
  layer's rectangle where the game's pass covers the screen. Item 9's blend comparison may have settled it: confirm on one
  of the 10 calls.
- [ ] **153. Voice marks in the log were checked with stand-in voices.** The save used for the checks has no voiced lines:
  play a voiced scene and click a mark.

## 3. The web app

- [ ] **136. Try Safari and Firefox, a real controller and mouse, and a 120 or 144 Hz display.** Item 123 ran the display rates on a
  virtual clock in headless Chrome; a real high-refresh screen (a ProMotion Mac at 120 Hz) has not been watched. Firefox 159 has now run the title (two faults there, fixed 2026-11-10: a flash of its still over the movie, and white flashes from Firefox's own drawing of video, cured by painting movies on a canvas, every movie since then); the rest of the game has not been played in it. The notes otherwise record Chrome; the port leans on
  WebGL2, AVIF and Ogg Opus. Also pointer events and the keyboard lock in full screen, a real controller since the change
  to actions (was 154), and a real mouse wheel in the log: the fix of 2026-11-10 relies on the browser's scroll anchoring
  and was tried with simulated wheel events (a browser without anchoring takes the older code path).
- [ ] **161. Save records to and from the game's save file.** Import and Export on the opening page (2026-11-12, `app/js/gamesave.js`) carry the
  settings and all progress of a `savedata000`, but not its 140 records: they are kept and written back untouched, not listed in the port, and the
  port's own saves are not written into the file. A record's snapshot (0x3aa8 bytes, read by 0x5baf0) has to be mapped both ways to the port's save:
  the script's byte position to the port's command number (needs the positions kept when the scripts are converted), the two layer state blocks
  (0x19b8 bytes each: about 80 arrays of 40), the sound slots, the story variables, the page's text. The 13 records of the reference save and
  records made in the native sandbox are the check: a record written from the port's state at the same point should equal the game's bytes.

## 4. Story: exactness while skipping, in the stored files, or in rare cases

- [ ] **160. A transition's old picture when a display frame carries two game frames.** Since item 123 the story is drawn once a
  display frame, after all the game frames it carries, so on a 30 Hz display, or after a stall, a FADS that comes on the second of two
  takes the frame drawn before the first as its old picture, where the game's is one frame newer: a moving picture is a frame behind on
  the transition's first frame. Drawing every game frame would cure it at twice the cost on such displays.
- [ ] **151. Frames that end with no wait.** JUMP and NOP_ end the game's frame; in the port they take none (1,741 JUMPs, one
  NOP_ in the scripts; a JUMP also loads the next script). A FADS that brings a picture not yet loaded holds the old frame
  two or three frames more in the game, where the port holds for as long as its own loading takes.
- [ ] **152. Fast forward, not looked at:** movies (TOMP / TOMW), a choice reached while skipping, the heat haze and the film
  grain (do they take the step of 33?), and the mixer's speed, which is from the listing.
- [ ] **150. A sway started under fast forward** shows its first offset a frame early in the port. One frame, only while
  skipping.
- [ ] **148. Two side cases of the split after a restore** (`N2-107`), not run: a split of level 0 loaded in a fresh session
  should fade in over 60 frames, and a point saved in the 60 frames after a FADE 41 should show no split.
- [ ] **142. A sway's cycle left behind in a layer's record.** The game keeps a layer number's cycle in its record until SSW2,
  a stop or the sway's own end clears it, and a later restore that puts a sway back on that number goes on from it. The port
  starts a new one. It needs two restores in a row. From the listing (`0x5baf0`, `0x63680`); not seen on the game.
- [ ] **149. SHOK moves plain colour pictures.** In the game a SHOK leaves `WHITE`, `BLACK` and the other colour fills where
  they are (the picture's flag +0x41); the port moves every layer. Measured 2026-11-10: none of the 870 SHOK calls has a
  colour fill up from earlier in its own script, so it could only show on one carried over from the script before. Check the
  layers' own quakes and shakes at the same time.
- [ ] **118. Pictures and sound effects are stored lossy.** Pictures are AVIF at quality 70, 729 of them smaller than the
  game's, and sound effects are re-encoded to Opus at 64 or 96 kbit/s. Plain pictures differ from native frames by 1 to 1.6
  levels on average, and how much of that is the encoding has not been separated. Measure a sample against the source, then
  decide on higher quality or lossless for sprites and CGs.
- [ ] **119. Blurred pictures are regenerated, not the game's files.** The port blurs the sharp one with a fitted Gaussian
  (9,130 calls, 1 to 3 levels off on average). Shipping the game's own files would be exact, but the port makes them itself, and you
  chose on 2026-11-10 to leave them out of `assets`.

## 5. Mouse and keyboard: leftovers

- [ ] **156. Opening the log at a choice** is still refused (keys, wheel and the bar), as before the redesign.
- [ ] **140. Which buttons pass a movie.** The game passes a seen movie with B or + only. The port passes it with a click or
  the advance keys, except the phase titles (movies 8-34), which a click no longer passes, at your word on 2026-11-09. The
  prologue's first showing asks "Skip intro video?" in the port, and since 2026-11-10 the two opening songs ask "Skip opening
  animation?" from their second showing and the end credits always ask "Skip Outro?", all at your request. What is left is
  to decide the keys and the other story movies.
- [ ] **155. The log's Quick Jump goes to any line**, where the game's went to a page's first line. It worked on the lines
  tried; lines that share a row (`@x`) were not tried.
- [ ] **157. Load from the story's system menu goes straight to the scene.** After the list's fade the game cuts to black and
  holds it about 2.2 to 2.9 s before the scene. It looks like the game reading its files (a Continue right after Return to
  Title had no hold), but that is not proven, so it was left out.
- [ ] **158. Three fixes of 2026-11-10 not seen in every case.** New Game's white staying up was captured on New Game, but the
  first launch's route into the story uses the same code and was not. The title's Load: the music's fall was checked
  against the code, not heard. The quick bar's and the log's fixes were captured in a separate Chrome.
- [ ] **60. Ending replays cut the music at once** (should fall over 0.5 s). The title's Load, the other half of this item, is
  done. `N2-128`

## 6. The game's look, screen by screen

Each of these makes a screen match the game more closely. They come last because the screens were kept on the game's art and
motion when they were redesigned for the mouse. Within a screen, the findings rated medium come first.

### System menu, save and load

- [ ] **54.** Saves made from the system menu have softened thumbnails. Worth keeping in any design. `N2-141`
- [ ] **55.** *code* Quick save's 3-second cooldown differs in three ways. `N2-138`, `N2-139`
- [ ] **57.** Load with an empty list lights Save in the column. `N2-134`
- [ ] **59.** Some save pictures place layers differently. `N2-140`, `0x884f0`
- [ ] **113.** The menu's sky is 5 to 8 levels too red in its darker parts.
- [ ] **115.** Under a menu the blurred story's darks are a little off.

### Title

- [ ] **69.** The glow and particles run while the logo is still at zero. `N2-144`
- [ ] **70.** *code* Dust spawns per browser frame: 27% more at 120 Hz, half at 30. `N2-146`
- [ ] **94.** *code* The copyright line sits 4 px left and 8 px high. `N2-143`

### Config

- [ ] **65.** Voice Test shares a slot with menu sounds, so a menu sound can cut the sample. `N2-129`
- [ ] **72.** *code* Scrolling takes twice as long, and a press on the bar's strip should move the page at once. `N2-149`
- [ ] **74.** Changing page doesn't restart the tab's caption. `N2-151`

### Flowchart

- [ ] **24.** *code* The bottom strip behind the help band is too dark. `N2-52`
- [ ] **26.** *code* A rewind from the flowchart cuts instead of fading over two half-seconds. `N2-54`
- [ ] **77.** The cursor's timing on opening. `N2-165`
- [ ] **79.** The preview panel fades as one layer. `N2-168`
- [ ] **101.** *code* The preview's title colour is 6 levels low in green and 3 high in blue. `N2-169`

### Gallery

- [ ] **39.** After an Ending List replay the cursor is lost. `N2-59`, `N2-66`
- [ ] **40.** The CG grid loses its scroll. `N2-65`, `N2-184`
- [ ] **43.** The section and help band come back early after the Flowchart. `N2-61`
- [ ] **44.** *code* Movie gallery pictures cut instead of fading. `N2-55`
- [ ] **45.** The Music list scrolls differently. `N2-68`
- [ ] **46.** Repeat off after a loop doesn't start the fade. `N2-70`
- [ ] **47.** Play goes out while paused. `N2-73`
- [ ] **48.** Entering the panel doesn't start on Play once the volume has been used. `N2-71`
- [ ] **84.** Re-entering the Ending List goes to the last entry, not the first seen. `N2-195`
- [ ] **85.** Ending buttons have no 10-frame arrival flash. `N2-192`
- [ ] **88.** The help band returns half a second late after a gallery movie. `N2-173`
- [ ] **89.** The help band fades too fast as a CG picture opens.
- [ ] **90.** The cursor's line and light are drawn under the row buttons. `N2-175`
- [ ] **91.** The cursor's line and light restart at the wrong times. `N2-177`, `N2-181`, `N2-188`
- [ ] **92.** A help band change reverses when the cursor moves away and back. `N2-174`
- [ ] **93.** Section titles sit 3 px low. `N2-183`
- [ ] **95.** Ending button art is 2.67 px off. `N2-191`
- [ ] **96.** Music row separators are 6.6 px high and 1 px right. `N2-196`
- [ ] **97.** Music Player art and knobs are a few pixels off. `N2-200`, `N2-201`, `N2-203`
- [ ] **98.** Lit Play, Pause and Repeat are at full strength, not 0.8. `N2-199`
- [ ] **99.** The Music Player's clock runs past the loop end. `N2-202`
- [ ] **100.** The Ending List fades as one layer. `N2-194`
- [ ] **102.** Delayed CG thumbnails run one frame behind. `N2-170`
- [ ] **112.** The gallery's help band is dimmed by a question.
- [ ] **159.** The Music list's background does not scroll with its rows (`0x1b078`). New on this list; the note is from 2026-11-08.

### Touch ring

- [ ] **103, 104.** The ring's centre is too bright, and a press can lose its ring. `N2-147`, `N2-164`

### Checks

- [ ] **50c.** Re-read the rest of the gallery, flowchart, backlog, config and title functions never re-checked (the drawing
  and motion ones). REVERIFY.md has 93 boxes left for this and 50a and 50b.
- [ ] **52b.** Look again at the interface functions already marked different.

## Only if the controller gets attention again

These describe the pad's cursor, which the redesign left as a second way to play. They are not ranked.

- **71.** Row 0's column isn't kept across pages and openings. `N2-148`
- **73.** A refused direction doesn't bring the page back to the cursor. `N2-150`
- **78.** A direction pressed during a scroll moves the view, not the cursor. `N2-166`
- **80.** Right into a section plays no sound. `N2-178`
- **81.** The column wraps on a held key. `N2-179`
- **82.** Keys work before a section or grid has finished appearing. `N2-185`, `N2-193`
- **83.** The cursor doesn't return to column 0 when the grid gets the focus back. `N2-187`
- **86.** The volume knob stays lit after Back. `N2-204`
- **87.** No flash when the volume takes the cursor. `N2-206`

## Closed by this list

- **Gone with the redesign:** 14 (help bar labels), 15, 16, 17, 76 (the mode panel), 75 and 105 (the Back button, which is not
  drawn any more), 114 (holding rewind), and the Back button half of 77. 154 is merged into 136.
- **The touch rule, dropped on 2026-11-09:** 18, 25, 36, 49, 56.
- **137 (finish converting the assets), done 2026-11-10:** everything the game asks for is in `web/assets` (`tools/needed.py` is the list), and `web/` runs by itself.
- **123, 143 and 146 (story timing away from 60 Hz, the order of the random numbers, whole frames), done 2026-11-10:** the story's
  clocks move a whole game frame at a time with the frame loop, the script takes its step between two game frames in one display frame,
  and what moved once a display frame on the story's screen moves once a game frame. At 120 and 144 Hz every game frame of 12 test scenes
  is the 60 Hz one; at 30 Hz every drawn frame is. FIXES.md, "TODO item 123". New: 160.
- **Records, all done on 2026-11-10:** 53 (ANIMATIONS.md), 106 (`N2-44`), 107 (62 old rows of function-map.csv), 108 (S38, S39), 109
  (the reference saves' README).

## Not on this list

Differences you chose, which stay as they are unless you say otherwise: the story text in a proportional face with the patch's
forced line breaks taken out, choices drawn on one row, the flowchart's and gallery's fonts, and the card text's quick swap. They are
in [NATIVE-PARITY.md](NATIVE-PARITY.md). The first of them is a story difference, so it is the one to reconsider if "exactly as the
game" should cover the text's layout too.

Oddities that the game has too, so the port keeps them: a backlog page in `13_01_01_CIEL13_2` that runs under the help bar, and the
gap below the flowchart when the very last row is not unlocked (the chart's edge stops at y 962, 60 px above the help band). Say so if
the flowchart should stop at its edge anyway.
