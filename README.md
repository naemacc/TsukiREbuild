# Tsukihime remake: web version

The web version is the `web` folder: `app/`, `assets/` and `server.py`. The build tools, tests, audit and longer notes are in `web-dev`, and the first size research and its tools in `web-research` (see [web-research/FINDINGS.md](web-research/FINDINGS.md)). Below, `app/`, `assets/` and `server.py` are in `web`, and `tools/`, `tests/`, `smoketest/` and `audit/` in `web-dev`.

A rewrite of the game's engine in JavaScript and WebGL2 that runs the game's own scripts in the browser. The `assets/`
directory is generated from a game dump.

## Play it

- **Online:** [arcueid.date](https://arcueid.date/) opens on a page with four tabs: ABOUT (what this is and how it was made), GITHUB, ANDROID APP, and PLAY ONLINE, whose PRESS ANY BUTTON starts the game in the browser (Chrome or Firefox, not Safari).
- **Android app:** [Download Tsukihime.apk](https://arcueid.date/android/tsukihime.apk) (2.8 GB). The whole game in one app that needs no connection and asks for no permissions. It needs Android 8 or newer, plays in landscape, and needs as much space again free while it installs. Android asks you to allow installing apps from the browser you downloaded it with. Saves are kept in the app, separately from the website's. It is built from `web/` by `web-dev/android/build_apk.sh` (see [web-dev/android/README.md](web-dev/android/README.md)).

## Run it

```bash
python3 web/server.py 8765
```

Then open http://localhost:8765. It needs Python 3, with no packages, and the `web` folder: everything the game uses is in `web/assets/` (2.7 GB).
Nothing else in the repository is read, nor the game's own files, so that folder can be moved by itself. The browser needs WebGL2, AVIF, Opus and AV1 video: Chrome and Firefox have them all.

**It does not work in Safari.** The movies are AV1 video, which Safari plays only on Apple's newest hardware (it has no decoder of its own), and the game has not been tried there.

## Cloudflare deployment

The live version is [arcueid.date](https://arcueid.date/). Pushes to `main` that change `web/`, `tools/cloudflare/`, or the deployment workflow publish automatically through GitHub Actions (`tools/cloudflare/deploy.py`). The workflow can also be started manually from the Actions tab.

**How it is served.** The R2 bucket `tsukirebuild-assets` holds the whole site: the app's files (`web/app`) at its root and the game's files under `assets/`. The bucket is attached to the domain `arcueid.date` as its custom domain, so Cloudflare serves it directly, behind its cache. No Worker runs for it, so nothing counts against the Workers request allowance, and a file already in Cloudflare's cache is not read from R2 again. Three rules on the `arcueid.date` zone (set in the Cloudflare dashboard under Rules, not in this repository) make that work:

- a URL rewrite: `/` is the bucket's `index.html` (R2 has no index page of its own);
- a cache rule: everything from the bucket may be cached, each file for as long as it says;
- a cache rule: the game's media and the content-named sound packs are kept 30 days, at the edge and in the browser.

Each object is stored with its lifetime: 30 days for the game's media (`assets/voice`, `img`, `se`, `bgm`, `movie`, `sys`, `fonts`) and the sound packs and their index in `assets/pack`, which are named by their content; 5 minutes for `index.html`, the tables and the interface art, so that those follow a deployment by themselves.

**Versioned scripts.** The deployment also stores every app file but `index.html` (scripts, styles, icons, the Inter font) under `v/<version>/`, the version a hash of those files, and the `index.html` it stores loads them from there. Those copies are kept 30 days, since a changed app is a new folder. A page therefore runs only the set of scripts it was published with, never a new `main.js` against an old `vm.js` while caches catch up; earlier versions stay in the bucket for pages still open or still cached. The plain files stay at the bucket's root too (`/favicon.ico`, and the `web/app` layout the local server serves, which is unchanged). `python3 tools/cloudflare/deploy.py --stage DIR` writes the app as a deployment stores it into a folder, with `assets/` a link to `web/assets`, to try the site locally. When that rule changes in `deploy.py`, the next deployment sets it again on every object already stored. A media file converted again reaches players who already have it only when their copy expires: give it a new name if it must arrive at once.

**The earlier address.** [tsukirebuild.pages.dev](https://tsukirebuild.pages.dev/) is a Cloudflare Pages project that now forwards to the domain, path and query kept (a `_redirects` file written by the deployment). Its Worker (`web/cloudflare/worker.js`) still answers `/assets/*` from the bucket there. Saves are kept by the browser for each address separately, so progress made at the Pages address does not appear on the domain.

**The deployment** compares file checksums and uploads new or modified files to the bucket, then publishes the Pages project. Previous objects are retained for open browser sessions and rollbacks; nothing is deleted from the bucket.

**The Android app** is not part of the deployment. `android/tsukihime.apk` was uploaded to the bucket by hand, because at 2.8 GB it is too large for the repository. On this plan Cloudflare does not cache files over 512 MB, so each download is read from R2, which charges nothing for downloads. To replace it, upload a new build (`web-dev/android/build_apk.sh`) to the same key with the type `application/vnd.android.package-archive` and `Content-Disposition: attachment; filename="Tsukihime.apk"`, signed with the same key as before so that it installs over the old one.

GitHub stores the deployment credential in the encrypted repository secret `CLOUDFLARE_API_TOKEN` and its token ID in the repository variable `CLOUDFLARE_API_TOKEN_ID`. The credential needs account-level `Pages Write` and `Workers R2 Storage Bucket Item Write` scoped to `tsukirebuild-assets`. Update both values when rotating the credential.

## Making the assets again

Only if `assets/` has to be rebuilt. From the repository root, with the dump in place, the patch in `mods/japan`, the packages in
`web-research/.venv` and `ffmpeg` on the path, built with `libsvtav1` (the movies are encoded with it):

```bash
web-research/.venv/bin/python -I web-dev/tools/build_core.py "$PWD"
web-research/.venv/bin/python -I web-dev/tools/build_images.py
web-research/.venv/bin/python -I web-dev/tools/build_ui.py "$PWD"
web-research/.venv/bin/python -I web-dev/tools/build_flowchart.py
web-research/.venv/bin/python -I web-dev/tools/build_gallery.py "$PWD"
web-research/.venv/bin/python -I web-dev/tools/build_system.py "$PWD"
web-research/.venv/bin/python -I web-dev/tools/build_sounds.py "$PWD"
web-research/.venv/bin/python -I web-dev/tools/convert_all.py "$PWD" --jobs 6
python3 -I web-dev/tools/build_packs.py
python3 web-dev/tools/check_assets.py
```

`convert_all.py` makes what `tools/needed.py` lists: what the port can ask for, and nothing it makes for itself, so not the game's pre-blurred pictures. It is safe to stop and
resume. `check_assets.py` says whether anything is missing.

The core build also exports the original engine's motion tracks. To add them to an existing prepared web copy:

```bash
web-research/.venv/bin/python -I web-dev/tools/build_animations.py "$PWD"
```

The colour effect presets (`STEC`) come from the same image; to add them to an existing web copy:

```bash
web-research/.venv/bin/python -I web-dev/tools/build_effects.py "$PWD"
```

This needs the Japanese port's prepared `data/tsuki/analysis/main.bin` and `data/tsuki/gen/main`.
The exporter checks the image fingerprint before reading its tables. Motion, shake, and sway now run in the browser;
see [ANIMATIONS.md](web-dev/ANIMATIONS.md) for command coverage and remaining differences.

## The first page

The game opens on the same page every time, for everyone (`app/js/home.js`). It is built from the game's art: the mode panel's strip with four of its plates relettered (ABOUT, GITHUB, ANDROID APP, PLAY ONLINE), over Config's inner panel. Each plate shows its own page:

- **ABOUT**: what this project is and how it was made, from decompiling the game to testing the port against it (the sections are in `app/js/welcome.js`).
- **GITHUB**: what is in the repository, and a link to it.
- **ANDROID APP**: what the offline app is, how to install it, and the download.
- **PLAY ONLINE**: what the browser version needs, and the title's PRESS ANY BUTTON. A click or tap on that page, or Enter, starts the game. Browsers play no sound until the page has been clicked, so this press is that click, and the game opens with its sound on. On a touch device the page also says how to play by touch.

It opens with no tab chosen: the game's logo and a line naming the plates, so a stray tap starts nothing. On a first visit the game's Loading window waits for the first screens' files after PLAY ONLINE. The page is skipped only inside the Android app, which is the game itself, and for an address that opens a scene (`?script=...`).

## Loading

Nothing waits for the whole game: each file is fetched when it is first used, and the ones that will be needed soonest are fetched before that (`app/js/preload.js`).

- **From the first page on.** While the first page is being read (on later visits, while the logo plays) the game fetches, in this order: what the next screen needs (on a first visit the opening's script, picture and movie; later the logo, the title's art and its movie; the interface sounds and the title's music), then the story's own screen (the text window and its marks, the choices, the questions, the quick bar, the fonts, the first scene's pictures and sounds), then the menus (system menu, log, Save, Load, Config, the speech balloons), then the gallery and flowchart art. At most four of these are read at once, so a file the game asks for itself never queues behind them.
- **As the story runs.** At every message the script is read ahead: the pictures, sound effects, music and voices of the next 300 commands (about a dozen messages), and from 2,500 commands away the movies and the scripts it can jump to, which are read on from where they start. Voices are left out while skipping or switched off.
- **Movies.** A movie that is coming is given a player of its own, which starts reading the file as a browser reads any movie. When the movie plays, that player takes the place of the page's, so it starts at once from what has been read. Two are kept ready at most. The title's movie is made ready again whenever the title is about to come back (a story's end, Return to Title, the gallery).

- **Sounds in packs.** The 16,460 voices, 1,284 sound effects and 9 interface sounds are also kept in 658 packs of about 1.5 MB (`assets/pack`, made by `tools/build_packs.py`): the files end to end as they are, in the order the story first uses them, so the pack with a line's voice has the next lines' too. The game asks for the pack and cuts each sound from it, which is about 27 times fewer requests than a file a sound. A pack is named by a hash of its content, so a browser can keep it for good; `assets/pack/index.json` names the index in use. Music and movies are not packed. Where there are no packs, or a pack cannot be read, each sound is read from its own file as before. The repository carries the voices and sound effects as packs alone; the loose files, which `build_packs.py` makes the packs from, come from `convert_all.py` and stay with whoever builds the assets.
- **After START.** On a first visit, pressing START brings the game's "Loading" window with a count, until what the next screen and the story's first screen use has been read (the first pictures, voices and sounds among them) and the first movie can start. It is not shown when that is so already, and it never holds longer than 20 seconds.

What has not arrived when it is wanted is fetched then, as before.

## Opening a particular scene

Add these to the address:

| | |
|---|---|
| `/?script=00_02` | Opens that script by name (capitals matter) |
| `/?script=89` | The same by its number, 0 to 548 |
| `/?script=04_00_ARC04_4_1&pc=500` | Runs through to command 500, then plays normally |
| `/?script=04_00_ARC04_3&label=LBL_008` | Starts at a label inside the script. Nothing before it has run, so the screen stays empty until the scene next draws a picture |
| `&mute` | No sound at all, with any of these |

Script names start with the day, then 00 for Arcueid's route or 01 for Ciel's. `00_00` to `00_02` are the prologue and `QA_01` to `QA_24` the Teach Me, Ciel-sensei episodes. All 549 are in `assets/scripts/index.json`. A scene opened this way starts with the story's flags empty, so one that depends on earlier choices can branch differently than in play. It also skips the first page, so sound begins at your first click.

## Fonts

Only SeuratPro and Inter are in this folder. The rest are looked for on the system, and the next in line is used where one is missing.

| Font | Used for | Then |
|---|---|---|
| Georgia | The story, choices, the log, Yes / No questions | Times New Roman |
| SeuratPro M | Speech balloons (`assets/fonts/`, the game's own) | Georgia |
| Inter | Gallery lists, Music Player, the hints, Controls page (`app/fonts/`) | any sans-serif |
| Helvetica | Flowchart cards | Arial |
| Apple Chancery | Chapter names, the story's old-fashioned lettering | Lucida Calligraphy, Monotype Corsiva, URW Chancery L, TeX Gyre Chorus |
| Hoefler Text | Day numbers beside chapter names | Palatino Linotype, Palatino, Book Antiqua, Georgia |
| PT Sans Narrow | The words on the plates | Ubuntu Condensed, Arial Narrow, Segoe UI, Helvetica Neue, Arial |
| Ubuntu Condensed | Chapters on save rows and the flowchart | PT Sans Narrow, Arial Narrow, Roboto Condensed, Helvetica |
| Ubuntu | The day on a save row | Helvetica Neue, Segoe UI, the system font |
| Eurostile | The Audio Track label | Microgramma, DIN Alternate, Bahnschrift, Inter |
| System font | Scene names in the menus, short notices | |

The game itself carries `ja/TT_TsukuMin-D.ttf`, `ja2/TT_TsukuGo-D.ttf`, `ja3/FOT-SeuratPro-M.otf`, `ja3/SeuratPro-M.otf` and `exfont_nx01.bffnt`.

## Mouse and keys

The interface is made for a mouse and a keyboard. The story itself (pictures, text, sound, movies) plays as the game
plays it; the screens around it keep the game's art and are driven by one rule:

- **The mouse.** What is under the pointer lights up, one click chooses it, a right click goes back, and the wheel
  scrolls. On the story screen a click advances, a right click opens the system menu, the wheel up opens the log and
  down advances, and a middle click hides the text (any click shows it again). The pointer goes out of sight when it
  rests over the story. A click draws the game's touch ring. There is no Back button on the screens: a right click
  (or Esc) is Back everywhere, and a button's caption shows only while the pointer is on it.
- **The quick bar.** Move the mouse to the top of the picture. It is the game's own bar and buttons (previous scene,
  previous message, auto, skip, next scene, Q.SAVE, Q.LOAD, voice) with LOG, HIDE, SAVE, LOAD, CONFIG, FULL and MENU
  after them, cut from the same art. Pointing at a button shows what it does and its key. Any click sends the bar up
  again. The two scene buttons and Q.LOAD ask first, starting on No.
- **The keys.** One map for every screen, shown on the config's Controls page, where a click on a key (or Enter) and
  then the new key changes it; Esc cancels, Backspace clears, and "Reset to defaults" puts them back. The defaults:

| | |
|---|---|
| Advance text | Enter, Space |
| Fast forward while held | Ctrl (everything, or only read text when Fast forward is "Read") |
| Skip read text on / off | S |
| Auto mode on / off | A |
| Log | L, Page Up |
| Previous message | R |
| Hide text | H |
| Replay voice | V |
| Quick save, quick load | Q, W |
| Return to previous scene, jump to next scene | P, N |
| Quick bar by keys | Up (then Left / Right, Enter; Esc closes) |
| System menu | Esc |
| Full screen | F leaves it and enters it. The game goes full screen by itself at any click or tap, until F (or the quick bar's FULL) has taken it out; F again puts it back. Esc still opens the menu there, where the browser allows it |
| Save, Load, Config | none until you give them one |

In every menu: the arrows move, Enter or Space chooses, Esc or Backspace goes back, Tab changes the config's page
(Shift + Tab the other way), Page Up / Page Down scroll, Home / End go to the first / last. The bar along the bottom of
each screen says what is there.

Choices start with nothing selected: the pointer lights a row and a click takes it; Up / Down or the wheel pick a row
(Left / Right the first or last) and Enter takes it. Rows the story has not opened yet are shown but cannot be picked.
The story's own yes / no questions also start on neither: point and click, or Up for No and Down for Yes.

The log shows every page so far, the one on screen too, one under another as the text window drew them, opened at the
newest. The wheel, the scroll bar and Page Up / Page Down scroll it, and scrolling on past the end closes it. A click
on a line (or Up / Down and Enter) asks "Quick Jump?" (starting on No) and goes back to that line; a line with a voice
has a speaker mark at its left, and a click on it (or V on the cursor's line) plays the voice again.

The config's System page has its words at one size, 28 px, on every device: the translated art had the rows' names, the choices, the toggles and the samples at five different sizes, so the three pictures that carry them are drawn again as the game starts (`app/js/confart.js`). In the config a click on a slider's bar puts the knob there, and it can be dragged; minus and plus step 1 (50 for the
auto mode waits) and repeat when held; holding Enter on a slider, Left / Right step it; the wheel or a drag scrolls
the page. In the CG viewer a click or Left / Right change the picture, Enter toggles fill and fit, Up / Down, + / - or
the wheel zoom, dragging moves the picture and Home resets it. In the Music Player a click on the position bar moves
the track there.

The chapter in the system menu's header, on each save row and down the flowchart's left side is written out as text, one
line each, in the look of the game's pictures of them (the translated pictures had to break long names over two small
lines to fit the game's cells); the flowchart's are larger than the pictures were.

The system menu's header (and Save, Load and Config under it) names the music playing: "Audio Track", and under it
a turning disc and the title, to the left of the scene name. From the title the gallery opens on the game's own
one-second fade, without the 0.35 s stop the game makes after it.

A controller still works as a second way to play: A advance and choose, B cancel or stop skipping, Y system menu,
X log, up the quick bar, down advance, R skip, L auto (the config's page after / before in the menus), ZR fast forward
while held, ZL rewind. The right stick moves the cursor in the menus as the D-pad does and the left stick scrolls.

## Playing on a phone or a tablet

On a device played by touch the same game has a touch interface. It is used when the browser reports that the first pointer is a finger that cannot hover (`(hover: none) and (pointer: coarse)`): phones and tablets. A laptop with a touch screen, a narrow desktop window and a tablet with a mouse attached keep the mouse and keyboard interface, which is unchanged. Add `?touch=1` to the address to force the touch interface, or `?touch=0` to force the other. It is decided once, as the page loads.

**Landscape only.** Held upright, the game shows a screen asking for the device to be turned, and everything is held under it (the story's clocks, sound, movies, the screens' own motion) until it is. The picture is the same 1920 x 1080 stage, fitted inside the screen's safe area: on a phone wider than 16:9 it stands in the middle with black beside it, clear of a notch and of the home bar. As on a desktop, any tap takes the game to the full screen until the control panel's FULL plate has taken it out; where the browser lets a page do so, landscape is locked there. The page itself does not scroll, zoom or select: pull to refresh, double-tap and pinch zoom and the long-press menu are off. Sound starts at the first touch.

**The story.**

| | |
|---|---|
| Advance text | Tap |
| Control panel | Swipe down on the picture, or tap its top edge |
| Log | Swipe up |
| Fast forward while held | Keep a finger on the picture (everything, or only read text when Fast forward is "Read") |
| Hide text | Tap with two fingers (any tap shows it again) |
| Pass a movie | Tap (it asks first where a click does) |

The control panel is the quick bar at a finger's size: the same fifteen buttons, the game's own plates at one and a half times their size in three rows of five, each with its name under it. A tap on a plate does it and sends the panel up; a tap anywhere else, or a swipe up, only sends it up. The first time a story starts, a band across the top names the gestures until the panel has been pulled down once.

A choice takes two taps, as the game's own touch screen did: the first lights the row, a tap on the lit row takes it. The rows are the story's own, close together on a phone, and a choice is not lightly undone. Yes / No questions are drawn larger and answer at one tap.

**The menus.** Whatever is pressed lights up, and its tap chooses it. Lists move under the finger. Back is the game's own touch Back button, which slides in at the bottom right of every screen that has a way back (on a question it is No). There is no hint bar along the bottom on a touch device.

- **Title.** The logo is smaller and the rows twice their size under it.
- **System menu, Save, Load.** The column's rows stand further apart. Save rows are a finger's size as they are.
- **Config.** Drawn larger across the whole width, without the column (Back returns to it). A slider follows a finger that moves along it, and a tap on its bar puts the knob there; a finger that moves up or down scrolls the page instead, wherever it started. Minus and plus step at a tap and repeat when held. The Controls page lists these gestures in place of the keys.
- **Log.** Tap a line for Quick Jump, the speaker mark at its left to hear its voice again. Pulling on up past the newest line closes it.
- **Gallery.** In the CG viewer a tap or a swipe to the left goes to the next picture and a swipe to the right to the one before; two fingers zoom, up to four times the fitted size, and one moves a picture that has been made larger. The viewer's Back button leaves two seconds after the last touch and returns at the next. The Music Player's rows, titles and buttons are larger. In the flowchart a tap on a scene shows it at the right, and a tap on the scene shown opens it.
- **First page.** Its eight plates stand in two rows and its text is larger, with a paragraph on playing by touch.

All of it is made from the game's own interface art: the Back button, the panel's plates and strip, the notice window and the auto mode's ring on the rotate screen, the speaker mark in the log. Story playback is the same on every device. Not tried on a real phone yet: it was built and checked in Chrome's touch emulation at 667 x 375, 844 x 390, 932 x 430 and 1024 x 768. Safari on an iPhone or iPad has the limits given at the top (AV1 video).

## Skipping and rewinding

Skipping waits at text you have not read when Fast forward is "Read" (the default) and goes on by itself at read text;
on "Full" it passes everything. Choices do not turn it off; the Skip key or button does (the pad's B too), and so does
opening the system menu.

Rewinding (and the log's Quick Jump) goes back up to 800 points in the current session; loading a save starts the
trail again. What has been read is kept in the browser from now on, so text read before this existed counts as
unread. Quick load asks first, as the game does, and shows the quick save's picture.

## Movies

The movies are MP4 files with AV1 video (SVT-AV1 at constant quality 24, from the game's H.264) and the game's own AAC sound, copied without re-encoding. Every frame keeps its place and time. A movie that AV1 would not make at least a tenth smaller is left as the game's own file (none is: all 45 are AV1, 0.42 GB where the game's are 1.76 GB). No movie may be over 95 MB, so that no file in `web/` is too large for a host such as GitHub; one that would be is made at a coarser quality until it fits, which `ed03_ciel` and `op2_ciel` needed. The largest file is now `op2_ciel.mp4`, 82 MB.

The two opening songs cannot be passed the first time they play; after that a click or key asks "Skip opening animation?",
in the gallery too. The end credits ask "Skip Outro?" every time. The prologue asks "Skip intro video?" on its first showing
and passes without asking after that. Each question starts on No and holds the movie while it is up. The system menu does not open
over a movie.

## Saves

100 save slots, a quick save, and 39 automatic saves. As in the game a save holds the latest checkpoint (a scene's
start, a choice, or the first line of a page), so loading shows that page from its first line. The automatic save is
made when you return to the title from the system menu (which asks nothing outside a gallery replay), and here also
when the page is closed during a story. The save screen lists all 100 slots by number, starting on the lowest empty
one. The load screen lists everything there is to load, newest first: the slots in use, the quick save and the
automatic saves, each named. Continue loads the save written last.
In the story's Save and Load, Left gives the menu's column the cursor and Right gives it back to the row you were on.
Some chapters ask "Save Progress?"; Yes opens the save screen and the story goes on when it closes.

Saves and progress are kept in this browser, so clearing its site data removes them, and another browser starts empty. A save
of an ordinary scene is about 13 KB; the browser allows about 5 MB in all.

On the very first start (before the prologue has played) the game opens straight on the opening movie, which a try to
pass asks about first ("Skip intro video?"); the title, its cautions and the story follow. After that it starts with the logos and the
notice, and New Game goes straight to the story.

## Files

- `tools/build_core.py`: scripts, dialogue and tables
- `tools/build_images.py`: how large each image needs storing
- `tools/convert.py`, `tools/convert_all.py`: images to AVIF, voices and music to Ogg Opus without re-encoding, sound effects to Opus, the movies' pictures to AV1 with their sound copied, the balloon font copied
- `tools/needed.py`, `tools/check_assets.py`: what the game can ask for, and whether it is all there
- `tools/build_packs.py`: the voices and sounds in packs (see Loading); `check_assets.py` says when they are out of date
- `server.py`: static files with byte ranges, standard library only
- `app/js/vm.js`: script commands
- `tools/build_animations.py`, `app/js/animation.js`: the game's motion tracks, interpolation and animation clock
- `tools/build_effects.py`: the game's colour effect presets, drawn by the layer shader in `app/js/renderer.js`
- `app/js/transform.js`: where a layer goes: parents, pivots, panel clips and links
- `app/js/screenfx.js`: the RGB split, speed lines and film grain
- `app/js/effects.js`: screen and layer shake, ambient sway and text shake
- `app/js/random.js`: the game's `rand()`, which a sway and the speed lines draw from
- `app/js/renderer.js`: layers, blur, blend modes, crossfades
- `tools/build_ui.py`: the game's interface art (and the film grain static; `build_ui.py "$PWD" NOISE_PARTS` adds just that; `PARTS`, the start-up notice and cautions from `parts.hed`, likewise)
- `app/js/ui.js`: the game's screens, drawn with that art
- `app/js/welcome.js`: the first visit's page and its text
- `app/js/preload.js`: what is fetched before it is asked for: the start-up list and the script look-ahead (see Loading)
- `app/js/confart.js`: the config's System page with its words at one size
- `app/js/keys.js`: the keyboard map, shown and changed on the config's Controls page
- `app/js/touch.js`, `app/touch.css`: the touch interface for phones and tablets: which devices get it, the stage in the safe area, the story's gestures, the Back button, the rotate screen (see Playing on a phone or a tablet)
- `app/js/chapters.js`: the chapters' days and names, as text
- `app/js/touchfx.js`: the ring drawn where the screen is clicked
- `app/js/reflow.js`: takes out the English patch's forced line breaks, so the text box wraps the lines itself
- `tools/build_sounds.py`: the interface's own sounds (`assets/sys`)
- `tools/decode_save.py`: reads a save of the original game and prints its progress as the web version keeps it
- `app/js/uifx.js`: what moves on them, timed as the original: the title's fade, logo, glow, dust, background and
  music by progress, the cautions, and the system menu's fade, background bands, sparkles and cursor
- `tools/build_gallery.py`, `app/js/gallery.js`, `app/js/unlocks.js`: the title's GALLERY, as the game has it: one
  screen with CG Gallery, Music Player, Flowchart, Movie, Ending List and Title. The CG and music tables are read from
  the executable; a picture unlocks when it is shown (or by STCG), a track when it is played, a movie when it is played.
  The Ending List (`app/js/endings.js`) shows an ending or bad end once its "Teach Me, Ciel-Sensei!" episode has
  begun, and plays the episode again; see [ANIMATIONS.md](web-dev/ANIMATIONS.md#endings-and-ciel-sensei).
- `tools/build_flowchart.py`, `tools/native_flowchart.py`, `app/js/flowchart.js`, `app/js/flowchart-model.js`: the
  flowchart, from the game's own rows, links, titles, notes and thumbnails. Scenes appear once played; scenes that
  every path to a played scene must pass count as played too (for progress from saves or older read history).
- `tools/build_system.py`: tables for the sound page's character rows, sound effect and music loop points, the text
  window's balloon styles, the help bars and the system questions' wording (`assets/system.json`)
- `app/js/textbox.js`, `audio.js`, `main.js`: text, sound, input and settings
- `smoketest/`: runs every script at full speed and lists errors: `python3 web-dev/tools/dev_server.py 8770`, then open http://localhost:8770/smoketest.html

Regression checks (Node.js, no packages needed): `node --test web-dev/tests/*.test.mjs`. What the parity audit in
`audit/` found and what changed is in [audit/FIXES.md](web-dev/audit/FIXES.md).

## Ciel-sensei and endings

After a bad end the game offers its "Teach Me, Ciel-Sensei!" episode: a card, then "Enter hint corner (No. n)?".
Yes plays the episode and then returns to the title; No returns to the title at once. The Ending List in the gallery
lists the episodes begun, and endings reached before this version could play them are counted once from the scenes
completed and text read. Rebuild `gallery.json` with `build_gallery.py` to get the list.
