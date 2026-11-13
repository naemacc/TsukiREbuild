# Desktop app

The web port as a desktop app for Windows, macOS and Linux, made with Electron. Everything it plays is inside it: `web/app`, and `web/assets` without the loose voices and sound effects (the packs in `assets/pack` carry all 17,753 of them) and without `assets/ja`: the app is English only. It needs no connection to play. With one, it looks on arcueid.date for an update when it opens ([Updates](#updates)); that is the only thing it reaches.

```bash
web-dev/desktop/build.sh              # all three, into web-dev/desktop/out
web-dev/desktop/build.sh mac          # or any of: mac win linux
```

The game's files are not in the repository: `python3 web-dev/tools/fetch_assets.py` brings them from the site into `web/assets` first, once (the build stops and says so when they are missing).

| File | Size | For | To play |
| --- | --- | --- | --- |
| `Tsukihime-mac-universal.dmg` | 3.0 GB | macOS 13 or newer, Apple silicon and Intel | Open it, drag Tsukihime to Applications |
| `Tsukihime-win-x64.zip` | 2.9 GB | Windows 10 or newer, 64-bit | Extract All into a folder of its own, run `Tsukihime.exe` |
| `Tsukihime-linux-x86_64.AppImage` | 2.9 GB | Linux, 64-bit | `chmod +x`, then run it |

It needs Node.js with npm and Python 3; the first build downloads Electron and electron-builder (`npm install`). All three can be made on a Mac, in about seven minutes. The Linux one runs one of its tools under Rosetta there. The Mac app is signed with the system's own `codesign` (`build/sign-mac.js`): electron-builder's signer opens all 10,500 files at once, more than macOS allows a process on a Mac with 8 GB.

To try it without packaging, straight from `web/`:

```bash
cd web-dev/desktop && npm install && npm start
```

## How it works

- `main.js` opens one window at `app://tsukihime.desktop/`, a name that never reaches the network. Every request to it is answered from the files next to the app (`resources/www`), or from an update (below), with byte ranges for the movies and the music. The page's requests to any other address are cancelled, and it is given no permissions but full screen and the keyboard and pointer locks the game asks for.
- `web/app` is used as it is. The app opens on the site's opening page (`home.js`) with four tabs: ABOUT, GITHUB, SAVE DATA and PLAY. There is no DOWNLOAD tab and no language choice; `lang.js` gives English in the apps whatever was kept or asked for.
- What a browser would do for that page the app does, asked through `preload.js` (`web/app/js/apphost.js` lists the commands, `host` in `main.js` answers them). SAVE DATA's Export opens the system's Save dialog, starting in Downloads, and the file is written where you choose; Import is the system's Open dialog. A link (GITHUB) opens in the computer's browser.
- Only a press of Save writes an export. A Save dialog still open when the app closes is taken down with it, and Electron then reports it as accepted, with the name it opened on; `main.js` writes nothing once the app has begun to close (`closing`). Without that, quitting with the dialog up replaced a `savedata000` that was already in Downloads, with no question asked (seen on macOS, 2026-11-13).
- Sound starts without a first click.
- Saves, settings and unlocks are in the page's `localStorage`, in the app's own data folder: `%APPDATA%\Tsukihime` on Windows, `~/Library/Application Support/Tsukihime` on macOS, `~/.config/Tsukihime` on Linux. They are apart from the website's, and stay when the app is replaced by a newer one.
- Closing the window or quitting makes the automatic save. A closing window does not give the page its `pagehide`, so the app calls `appSuspend()` in `main.js` first, as the Android app does when it goes to the background.
- The game goes full screen on the first click, as on the site; F (or the quick bar's FULL) leaves it and returns.
- Only one copy runs at a time. The screen is kept awake while the window is in front.
- For testing: `--mute` (no sound) and `--devtools` (the inspector) after the app's name; `--test-dir=DIR` puts an exported save in DIR without asking and writes the links that would have been opened to `DIR/opened.txt`; `--update-origin=http://127.0.0.1:PORT` takes updates from a copy of the site on the same computer (no other address is accepted); and, unpackaged only, `--www=DIR` serves a prepared copy of the app's files.

Tried on this Mac. 2026-11-11: the packaged app plays the opening movie, the title and the story from its own files, keeps Esc for the menus in full screen, and has the automatic save after quitting. 2026-11-13, the packaged app with a scratch profile: it opens on the four plates; against a staged copy of the site it says "Up to date" when the site has what it was built with, and takes an update when the site is newer (also one cut off halfway, which changes nothing, and across a restart); Import, Export (the file compared byte for byte), Remove Data and Load 100% save work, the link opens outside, PLAY starts the game in full screen. The Windows and Linux files were checked for their contents (the same `resources/www` and the same three scripts in `app.asar` as the Mac app) but **have not been run on those systems**. The first launch on macOS takes some seconds longer, while the system checks the 3 GB app.

## Updates

A fix must not mean downloading 2.9 GB again, so the app updates itself from the site. `web/app/js/update.js` describes the whole of it; in short:

- Every deployment stores `update/app.json` on the site: each file of `web/app` with its size and SHA-256, and the list of the game's files the apps carry with their MD5 (`web-dev/tools/app_manifest.py`). `build.sh` puts the same description of what it packed into the app (`resources/www/bundled.json`, `bundled-assets.txt`).
- When the opening page comes up and there is a connection, the page compares the two. What the site has that the app was not built with is the update: usually a few scripts, sometimes a corrected picture. It asks first, in the game's Yes / No window, with the size. PLAY's page says where things stand and has a plate to look again.
- `updater.js` downloads those files from `https://arcueid.date` (the only address it knows) into the app's data folder (`update/<id>/files`, beside the saves), checks each against its size and hash, and only when all are there switches to them in one step (`state.json`). From then on a request is answered from the update first and from the app's own files otherwise. A download that is cut off, stopped or wrong changes nothing; what had arrived whole is kept for the next try.
- The saves are not touched: they are the page's `localStorage`, apart from all this.
- Should an update not come up (the page never reports in) twice running, the app goes back to what it had by itself and does not offer that update again unless asked.
- An update can only replace what the page loads. When a fix needs a new `main.js` or a newer Electron, the site's description carries a higher number (`SHELL`, in `apphost.js`, here and in the Android app), and the app says that a newer download is needed instead of taking the update.
- A newer app put in place of this one drops the updates the old one had taken: it is the newer.

To try one against a copy of the site, in a clone of the repository: `python3 tools/cloudflare/deploy.py --stage /tmp/site`, `python3 -m http.server -d /tmp/site 8899`, then start the app with `--update-origin=http://127.0.0.1:8899`.

## Why these three files

- **Windows is a zip, not an installer.** Installers made with NSIS cannot hold more than 2 GB, and the game is larger.
- **The Mac app is signed only for this computer's sake** ("ad hoc"), not with an Apple developer certificate, and it is not notarised. On another Mac the first launch is refused: open System Settings, Privacy & Security, and choose Open Anyway. Windows shows its SmartScreen notice for the same reason (More info, Run anyway).
- **The AppImage needs FUSE** (`libfuse2`) as every AppImage does; without it, `./Tsukihime-linux-x86_64.AppImage --appimage-extract-and-run`.

## Where it is published

Only the Windows file is: [arcueid.date/desktop/Tsukihime-win-x64.zip](https://arcueid.date/desktop/Tsukihime-win-x64.zip), in the site's R2 bucket. The site's opening page (`web/app/js/home.js`, the DOWNLOAD tab) links to it, and gives the steps above for building the macOS and Linux apps, which have no download: the bucket is kept within R2's free 10 GB, and with the site and the Android app in it there is room for one desktop file of about 3 GB.

The deployment does not upload it: it is too large for the repository. It was uploaded from this Mac in 64 MB parts (boto3), with short-lived R2 credentials made by the R2 API's `temp-access-credentials` call for that object only, as the Android app was. It is stored with the type `application/zip`, `Content-Disposition: attachment` with its file name, and a five-minute lifetime. After a rebuild it must be uploaded again, and the size in `home.js` (`DESKTOP`) and the README kept in step.

## Icon

`build/icon.png` is Arcueid's face from her standing picture (`ARU_A_00_00_N00`), as the site's and the Android app's icon; `build/icon-mac.png` is the same in the rounded shape macOS icons have.
