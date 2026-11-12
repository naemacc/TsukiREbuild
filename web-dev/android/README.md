# Android app

The web port as one APK that plays with no connection: `web/app`, and `web/assets` without the loose voices and sound effects (the packs in `assets/pack` carry all 17,753 of them). The APK is 2.8 GB (2,800,601,406 bytes on 2026-11-11, with the bundled backup fonts). It has no permissions at all, internet included.

```bash
web-dev/android/build_apk.sh            # out/tsukihime.apk
web-dev/android/build_apk.sh --debug    # the page can be inspected from chrome://inspect
web-dev/android/build_apk.sh --install  # also installs it (adb install -r: saves are kept)
```

The game's files are not in the repository: `python3 web-dev/tools/fetch_assets.py` brings them from the site into `web/assets` first, once (the build stops and says so when they are missing).

It needs the Android SDK (`ANDROID_HOME`, default `~/Library/Android/sdk`) with platform android-36 and build-tools 35 or newer, plus a JDK. It does not use Gradle. With more than one device connected, set `ANDROID_SERIAL`. A 2.8 GB APK installs over USB in about 80 s.

## How it works

- `MainActivity.java` opens a WebView at `https://appassets.androidplatform.net/`, a name that never reaches the network. Every request to it is answered from `assets/www` inside the APK, and any other address is refused.
- The files are stored uncompressed, so the app can seek in them. Movies use byte ranges. The WebView applies a `Range` itself: it skips into the stream it is given and takes `Content-Length` from `available()`. So the app hands over the file from byte 0 up to the range's last byte, and it never cuts the start itself.
- Landscape only, full screen, screen kept on. The phone's font size setting is ignored (`textZoom` 100). Saves stay in the page's `localStorage`, inside the app's data, and survive updates signed with the same key.
- System Back presses the game's own touch Back button wherever that button shows. Anywhere else it does nothing, so a stray swipe never leaves the story.
- Going to the background calls `appSuspend()` in `main.js`, which makes the automatic save that `pagehide` would make (Android can end the app without a `pagehide`). Then the page's timers stop until the app comes back.

## Signing key

`keystore/tsukihime.jks` is made on the first build. Keep it. An APK signed with another key cannot update the installed app: Android would have to uninstall it first, and the saves would go with it.

## Where it is published

[arcueid.date/android/tsukihime.apk](https://arcueid.date/android/tsukihime.apk), in the site's R2 bucket. The deployment does not upload it: at 2.8 GB it is too large for the repository. It was uploaded once from this Mac in 64 MB parts (boto3), with short-lived R2 credentials made by the R2 API's `temp-access-credentials` call for this one object only, from the deployment token's key ID. It is stored with the type `application/vnd.android.package-archive`, `Content-Disposition: attachment; filename="Tsukihime.apk"` and a five-minute lifetime. The site's opening page (`web/app/js/home.js`) links to it.
