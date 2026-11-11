# Desktop app

The web port as a desktop app for Windows, macOS and Linux, made with Electron. Everything it plays is inside it: `web/app`, and `web/assets` without the loose voices and sound effects (the packs in `assets/pack` carry all 17,753 of them). It needs no connection and makes none.

```bash
web-dev/desktop/build.sh              # all three, into web-dev/desktop/out
web-dev/desktop/build.sh mac          # or any of: mac win linux
```

| File | Size | For | To play |
| --- | --- | --- | --- |
| `Tsukihime-mac-universal.dmg` | 3.0 GB | macOS 13 or newer, Apple silicon and Intel | Open it, drag Tsukihime to Applications |
| `Tsukihime-win-x64.zip` | 2.9 GB | Windows 10 or newer, 64-bit | Extract All into a folder of its own, run `Tsukihime.exe` |
| `Tsukihime-linux-x86_64.AppImage` | 2.9 GB | Linux, 64-bit | `chmod +x`, then run it |

It needs Node.js with npm; the first build downloads Electron and electron-builder (`npm install`). All three can be made on a Mac. The Linux one runs one of its tools under Rosetta there.

To try it without packaging, straight from `web/`:

```bash
cd web-dev/desktop && npm install && npm start
```

## How it works

- `main.js` opens one window at `app://tsukihime.desktop/`, a name that never reaches the network. Every request to it is answered from the files next to the app (`resources/www`), with byte ranges for the movies and the music. Requests to any other address are cancelled, and the page is given no permissions but full screen and the keyboard and pointer locks the game asks for.
- `web/app` is used as it is. `home.js` knows the app's address, so the app opens on the game itself and not on the site's opening page, as the Android app does.
- Sound starts without a first click (the site's opening page is that click in a browser).
- Saves, settings and unlocks are in the page's `localStorage`, in the app's own data folder: `%APPDATA%\Tsukihime` on Windows, `~/Library/Application Support/Tsukihime` on macOS, `~/.config/Tsukihime` on Linux. They are apart from the website's, and stay when the app is replaced by a newer one.
- Closing the window or quitting makes the automatic save. A closing window does not give the page its `pagehide`, so the app calls `appSuspend()` in `main.js` first, as the Android app does when it goes to the background.
- The game goes full screen on the first click, as on the site; F (or the quick bar's FULL) leaves it and returns.
- Only one copy runs at a time. The screen is kept awake while the window is in front.
- For testing: `--mute` (no sound) and `--devtools` (the inspector) after the app's name.

Tried on this Mac (2026-11-11): the packaged app plays the opening movie, the title and the story from its own files, keeps Esc for the menus in full screen, and has the automatic save after quitting. The Windows and Linux files were checked for their contents (the same 10,563 files as the Mac app) but have not been run on those systems. The first launch on macOS takes some seconds longer, while the system checks the 3 GB app.

## Why these three files

- **Windows is a zip, not an installer.** Installers made with NSIS cannot hold more than 2 GB, and the game is larger.
- **The Mac app is signed only for this computer's sake** ("ad hoc"), not with an Apple developer certificate, and it is not notarised. On another Mac the first launch is refused: open System Settings, Privacy & Security, and choose Open Anyway. Windows shows its SmartScreen notice for the same reason (More info, Run anyway).
- **The AppImage needs FUSE** (`libfuse2`) as every AppImage does; without it, `./Tsukihime-linux-x86_64.AppImage --appimage-extract-and-run`.

## Where it is published

Only the Windows file is: [arcueid.date/desktop/Tsukihime-win-x64.zip](https://arcueid.date/desktop/Tsukihime-win-x64.zip), in the site's R2 bucket. The site's opening page (`web/app/js/home.js`, the DOWNLOAD tab) links to it, and gives the steps above for building the macOS and Linux apps, which have no download: the bucket is kept within R2's free 10 GB, and with the site and the Android app in it there is room for one desktop file of about 3 GB.

The deployment does not upload it: it is too large for the repository. It was uploaded from this Mac in 64 MB parts (boto3), with short-lived R2 credentials made by the R2 API's `temp-access-credentials` call for that object only, as the Android app was. It is stored with the type `application/zip`, `Content-Disposition: attachment` with its file name, and a five-minute lifetime. After a rebuild it must be uploaded again, and the size in `home.js` (`DESKTOP`) and the README kept in step.

## Icon

`build/icon.png` is Arcueid's face from her standing picture (`ARU_A_00_00_N00`), as the site's and the Android app's icon; `build/icon-mac.png` is the same in the rounded shape macOS icons have.
