# Android app

The web port as one APK that plays with no connection: `web/app`, and `web/assets` without the loose voices and sound effects (the packs in `assets/pack` carry all 17,753 of them) and without `assets/ja`: the app is English only. The APK is 2.8 GB (2,801,384,376 bytes on 2026-11-13). It has one permission, the internet, which it uses only to bring itself up to date from arcueid.date ([Updates](#updates)); the game itself fetches nothing.

```bash
web-dev/android/build_apk.sh            # out/tsukihime.apk
web-dev/android/build_apk.sh --debug    # the page can be inspected from chrome://inspect
web-dev/android/build_apk.sh --install  # also installs it (adb install -r: saves are kept)
```

The game's files are not in the repository: `python3 web-dev/tools/fetch_assets.py` brings them from the site into `web/assets` first, once (the build stops and says so when they are missing).

It needs the Android SDK (`ANDROID_HOME`, default `~/Library/Android/sdk`) with platform android-36 and build-tools 35 or newer, plus a JDK and Python 3 (for the description of what is packed, below). It does not use Gradle. With more than one device connected, set `ANDROID_SERIAL`. A 2.8 GB APK installs over USB in about 80 s the first time, in seconds over an earlier one.

Tried on a phone (OnePlus CPH2749, Android 17, 2026-11-13): the opening page in landscape with its four plates in one row; Import of a real `savedata000` through the system's picker, Export through its save screen (the file compared byte for byte), Remove Data, Load 100% save; the GitHub link; PLAY; an update from a staged copy of the site, one cut off halfway, a second on top of the first, and one with a broken script, which the app took out again by itself. The saves made before were the same afterwards, entry for entry.

## How it works

- `MainActivity.java` opens a WebView at `https://appassets.androidplatform.net/`, a name that never reaches the network. Every request to it is answered from `assets/www` inside the APK (or from an update, below), and any other address is refused. The WebView is kept off the network altogether (`setBlockNetworkLoads`).
- It opens on the site's opening page (`web/app/js/home.js`), with four tabs: ABOUT, GITHUB, SAVE DATA and PLAY. There is no DOWNLOAD tab and no language choice; `lang.js` gives English in the apps whatever was kept or asked for.
- What a browser would do for that page the app does, asked through one object, `AndroidHost` (`web/app/js/apphost.js` lists the commands, `Bridge.invoke` answers them). SAVE DATA's Import opens the system's document picker (`onShowFileChooser`). Export hands the file to the app, which asks where to put it (`ACTION_CREATE_DOCUMENT`) and writes it there. A link (GITHUB) opens in the phone's browser.
- The files are stored uncompressed, so the app can seek in them. Movies use byte ranges. The WebView applies a `Range` itself: it skips into the stream it is given and takes `Content-Length` from `available()`. So the app hands over the file from byte 0 up to the range's last byte, and it never cuts the start itself.
- Landscape only, the opening page included, full screen, screen kept on. The phone's font size setting is ignored (`textZoom` 100). Saves stay in the page's `localStorage`, inside the app's data, and survive updates signed with the same key.
- System Back presses the game's own touch Back button wherever that button shows. Anywhere else it does nothing, so a stray swipe never leaves the story.
- Going to the background calls `appSuspend()` in `main.js`, which makes the automatic save that `pagehide` would make (Android can end the app without a `pagehide`). Then the page's timers stop until the app comes back.

## Updates

A fix must not mean downloading 2.8 GB again, so the app updates itself from the site. `web/app/js/update.js` describes the whole of it; in short:

- Every deployment stores `update/app.json` on the site: each file of `web/app` with its size and SHA-256, and the list of the game's files the apps carry with their MD5 (`web-dev/tools/app_manifest.py`). The build puts the same description of what it packed into the APK (`bundled.json`, `bundled-assets.txt`).
- When the opening page comes up and there is a connection, the page compares the two. What the site has that the APK was not built with is the update: usually a few scripts, sometimes a corrected picture. It asks first, in the game's Yes / No window, with the size. PLAY's page says where things stand and has a plate to look again.
- `Updates.java` downloads those files from `https://arcueid.date` (the only address it knows) into the app's own storage (`no_backup/update/<id>/files`), checks each against its size and hash, and only when all are there switches to them in one step (`state.json`). From then on a request is answered from the update first and from the APK otherwise. A download that is cut off, stopped or wrong changes nothing; what had arrived whole is kept for the next try.
- The saves are not touched: they are the page's `localStorage`, apart from all this.
- Should an update not come up (the page never reports in) twice running, the app goes back to what it had by itself and does not offer that update again unless asked.
- An update can only replace what the page loads. When a fix needs a new `MainActivity`, the site's description carries a higher number (`SHELL`, in `apphost.js`, here and in the desktop app), and the app says that a newer APK is needed instead of taking the update.
- A newer APK installed over this one drops the updates the old one had taken: it is the newer.

### Trying an update

A debug build (`--debug`) may take its updates from a copy of the site on the computer. In a clone of the repository:

```bash
python3 tools/cloudflare/deploy.py --stage /tmp/site       # the site as a deployment would store it
python3 -m http.server -d /tmp/site 8899                   # serve it
adb reverse tcp:8899 tcp:8899                              # the phone's 127.0.0.1:8899 is the computer's
adb shell am start -n date.arcueid.tsukirebuild/.MainActivity --es update_origin http://127.0.0.1:8899
```

Only `http://127.0.0.1:<port>` and `http://localhost:<port>` are accepted, and only by a debuggable build; a release build has no such switch.

## Signing key

`keystore/tsukihime.jks` is made on the first build. Keep it. An APK signed with another key cannot update the installed app: Android would have to uninstall it first, and the saves would go with it.

## Where it is published

[arcueid.date/android/tsukihime.apk](https://arcueid.date/android/tsukihime.apk), in the site's R2 bucket. The deployment does not upload it: at 2.8 GB it is too large for the repository. It was uploaded once from this Mac in 64 MB parts (boto3), with short-lived R2 credentials made by the R2 API's `temp-access-credentials` call for this one object only, from the deployment token's key ID. It is stored with the type `application/vnd.android.package-archive`, `Content-Disposition: attachment; filename="Tsukihime.apk"` and a five-minute lifetime. The site's opening page (`web/app/js/home.js`) links to it.
