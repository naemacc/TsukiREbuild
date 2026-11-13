# iOS app

The web port as one unsigned IPA, to be sideloaded: `web/app`, and `web/assets` (optionally without the game's files, see below). GitHub Actions builds it; nothing here is signed, so whoever installs it signs it with their own Apple ID through a sideloading tool ([AltStore](https://altstore.io/), [SideStore](https://sidestore.io/), [Sideloadly](https://sideloadly.io/), [LiveContainer](https://github.com/LiveContainer/LiveContainer)). Those tools' own guides cover installing, refreshing and their limits; this page is only about how the app is made. It needs iOS 16 or newer, and plays in landscape, in English, by touch.

## Building

`.github/workflows/build-ios.yml`, started by hand from the Actions tab (**Build iOS IPA**, `workflow_dispatch`) on a `macos-15` runner (timeout 120 minutes). Two options:

| Option             | Default | What it does                                                                                                                                                                                                                                                                  |
| ------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bundle_assets`    | on      | Fetches the game's files (`web-dev/tools/fetch_assets.py`, 2.8 GB) and puts them inside the IPA. Off makes a lite IPA without them: the app then fetches each file from `https://arcueid.date/` as the page asks for it, as the website does (see "Online game files" below). |
| `transcode_movies` | on      | Re-encodes the movies from AV1 to H.264 (`libx264`, CRF 22, `yuv420p`, sound copied, `faststart`), because iPhones decode AV1 in hardware only on the newest models. It is meant for iPhone 14 and older, and only runs together with `bundle_assets`.                        |
| `ignore_cache`     | off     | Ignores what earlier runs saved (below) and starts from nothing.                                                                                                                                                                                                              |

The steps, in order:

1. Tools: `xcodegen` (Homebrew), Bun, Python 3.13. `ffmpeg` is installed only when a movie has to be converted.
2. `bun web-dev/ios/ios.ts` copies `web/app` into `web-dev/ios/build/www` (the page itself: engine, interface, fonts, `index.html`). The game's files are not copied there, so they are never on the runner twice.
3. `web-dev/ios/make_bundled.py` writes `bundled.json` and `bundled-assets.txt` into that folder: what this IPA was built with, which the app's updates are worked out from (`web/app/js/update.js`). It reads `https://arcueid.date/update/app.json` for that; when the site cannot be read it says so and writes nothing, and that IPA never looks for updates.
4. `xcodegen generate` makes `Tsukihime.xcodeproj` from `project.yml` (bundle id `date.arcueid.tsukihime`, iOS 16, iPhone and iPad, `build/www` as a resource folder).
5. `xcodebuild` builds a Release for `iphoneos` with code signing off.
6. The app icon is added by hand (there is no asset catalog): `web/app/apple-touch-icon.png`, flattened onto black as iOS wants an opaque icon, is written at 120, 180, 152 and 167 px into the `.app`, and `Info.plist` is given its `CFBundleIcons` entries with `PlistBuddy`.
7. The IPA is packed: the `.app` goes into `Payload/`, and the game's files are _moved_ (not copied) into `Tsukihime.app/www/assets`. It is zipped with no compression (`zip -0`; the files are compressed already, and the app seeks in them).
8. It is uploaded as the artifact `Tsukihime-ipa`, kept 14 days.

## What a run keeps for the next one

With the game's files bundled, a run does not start from nothing. It uses GitHub's Actions cache (10 GB for the repository, and a cache not used for 7 days is deleted, after which the next run does everything again):

- **The game's files** (`web/assets`, about 2.8 GB): restored first, then `fetch_assets.py` checks every file against `web-dev/assets-manifest.txt` and downloads only what is missing or different. A new copy is saved only when the check changed something. It is saved before the movies are converted, so the saved copy always holds the originals.
- **The converted movies** (`movie-h264-cache`): each movie is converted once. Its source's MD5 is kept beside the result, so a movie is converted again only when its source changed, and a run that reuses every one never installs `ffmpeg`. When the encoder settings change (the `SETTINGS` line in the workflow), all are converted again. A new copy is saved only when a movie was converted, and one that was cut off is kept up to the movie it had reached.

The restore picks the newest saved copy. `ignore_cache` skips both restores. None of this applies to a lite IPA, which downloads and converts nothing.

## The files

| File                       | What it is                                                                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `project.yml`              | The Xcode project, for XcodeGen: target, `Info.plist` values (landscape only, status bar hidden, file sharing on), build settings |
| `ios.ts`                   | Stages `web/app` into `build/www` (step 2)                                                                                        |
| `make_bundled.py`          | Writes `bundled.json` and `bundled-assets.txt` (step 3)                                                                           |
| `src/AppDelegate.swift`    | The window, and the screen kept on while playing                                                                                  |
| `src/ViewController.swift` | The web view, the page's bridge to the app, downloads, the update check at launch                                                 |
| `src/SchemeHandler.swift`  | Answers the page's requests from files                                                                                            |
| `src/Updates.swift`        | Downloads, checks and switches to an update (the twin of `Updates.java`)                                                          |

## How it works

- **The page.** A `WKWebView` opens `tsuki://tsukihime.desktop/index.html?play`. A custom scheme handler (`SchemeHandler`) answers every request to it, so nothing reaches the network. The host name `tsukihime.desktop` is one that `web/app/js/apphost.js` knows as an app, so the page takes its app path: four plates, English only, no language choice. (Its first page is skipped, see below.)
- **Where a file comes from.** First the active update (`Updates.activeRoot`), then `Documents/assets` for anything under `assets/` (reachable through the Files app, which is also a way to add the game's files by hand), then the app's own `www`, then the files fetched earlier (Caches). A file under `assets/` found in none of them is fetched from the site (below). Files are read in 1 MiB pieces and handed over one at a time, so a movie never sits whole in memory. `Range` requests are answered (movies need them), `HEAD` too, and a range past the end gets a 416.
- **The bridge.** `apphost.js` asks the app for what a browser would do through `window.desktopHost`, an object the app injects before the page's scripts (`bootScript` in `ViewController`). Its `invoke` goes to a message handler named `host`, answered by `ViewController.host`; progress comes back through `window.__hostEvent`. The app reports itself as `kind: "desktop"`. The commands are the ones `apphost.js` lists: `info`, `open` (an http or https page, in Safari), `saveFile` (the iOS share sheet), `fetchText`, `stage`, `cancel`, `apply`, `confirm`. A link in the page opens in Safari, and a download from the page (`Export`) goes to the share sheet.
- **The screen.** Landscape only, full screen under the notch and home bar (`contentInsetAdjustmentBehavior = .never`), status bar and home indicator hidden, the edge swipes deferred so a swipe from the screen's edge does not leave the app at once, and the idle timer off.
- **Leaving the app.** `willResignActive` calls `appSuspend()` in `main.js`, which makes the automatic save, as on Android.
- **Memory.** iOS ends a web view's process when memory is short. The app loads the page again after 1.5 s, 3 s and 4.5 s for the first three times within a minute. After that it stops, says so on screen, and loads again at a tap, so it never turns into an endless black flicker.
- **Saves** stay in the web view's own storage (`localStorage`), inside the app's data. They survive an app installed over the old one and go when the app is deleted. The bundle id is part of that: a sideloading tool that gives the app another one is installing another app.

## Online game files (lite IPA)

A lite IPA (`bundle_assets` off) carries only the page. `SchemeHandler.proxy` answers any request under `assets/` that no local file can, by asking `https://arcueid.date/` for the same path and handing the answer over as it arrives (status, type, `Content-Range`, body; a `Range` request is passed on as it is). Nothing else is ever fetched this way: the address is built from the site's host and the request's path and query only.

- **Kept.** A complete answer (status 200, no `Range`, no query) for the media the site stores for 30 days (`assets/voice`, `img`, `se`, `bgm`, `movie`, `sys`, `fonts` and the packs in `assets/pack`, but not `assets/pack/index.json`) is also written to `Library/Caches/www/assets/...`, to a `.part-` file first and moved into place only when every byte has come, so a cut-off download is never kept. Each such file is downloaded once. iOS may clear Caches when storage is short; the files are then fetched again. A request with a query (`?v=`, a corrected picture) always goes to the site.
- **Not kept.** Movies, which the player asks for in ranges, and the tables and interface art (the site stores those for 5 minutes), which follow their headers in a small URL cache.
- **Updates.** A lite IPA has no `bundled-assets.txt`, since the game's files are the site's own. `ViewController.updateScript` therefore answers that one request with the site's current list, so that an update is worked out from the page's files alone.
- **Movies.** They are the site's AV1 files. They play where the web view can decode AV1, which is the newest iPhones; `transcode_movies` only reaches IPAs that carry the files.
- **A full IPA** uses the same path for any file it happens to lack, and is otherwise offline.

## The opening page is skipped

The site's opening page (`web/app/js/home.js`) is where the other apps offer SAVE DATA and look for updates. The iOS app goes straight to the game instead: it loads the page with `?play`, and `SchemeHandler` makes that work as it serves `js/home.js`, by changing the one line, `homeDue()`, to `return !query.has("script") && !query.has("play");`. It is done on the way out, not in the build, so that it holds for the copy in the IPA and for a copy an update downloaded, and so that `web/app` and the other apps stay as they are. When the line is not found (the page was changed upstream), nothing is changed and the opening page shows: the app still works, and this has to be updated.

## Updates

`Updates.swift` keeps an update in `Application Support/update/<id>/files` (left out of backups) with a `state.json`, switches to it in one step once every file is in and checked against its size and hash, and serves it before the app's own files. An update that does not come up twice running is taken out again by itself and not offered again unless asked. The rules are those of the Android app ([web-dev/android/README.md](../android/README.md#updates)). `Updates.shell` must match `SHELL` in `apphost.js`.

With the opening page skipped, the check is made from `ViewController` (`updateScript`), at every launch:

1. When the page is up (`window.preload` exists, for up to 30 seconds) it calls `confirm`, which keeps the update it runs. A page that never gets that far is never confirmed, so a broken update is taken out again.
2. It asks the site (`update.js` `checkUpdate`, the same one the opening page uses).
3. If there is an update, a native alert shows its size: **Download** or **Not now**. Download shows the progress over the game, switches to the update (`runUpdate`) and loads the page again.

An update for a newer app shell (`state: "shell"`) is ignored: there is no download page to send an IPA's owner to, so a new IPA has to be built.

## Not the same as Android

- Nothing is signed, and the build has no key to keep: signing is done by whoever sideloads it.
- The IPA is built from the repository by the workflow and is not hosted on the site. A lite IPA (a few megabytes) fetches the game's files from the site as it plays, which the Android app does not do.
- The movies are re-encoded to H.264 by default; the Android app carries the AV1 files as they are.
- The opening page is skipped (above), so there is no SAVE DATA page, and updates are asked at the title screen instead of on PLAY's page.
