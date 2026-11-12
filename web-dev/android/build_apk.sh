#!/usr/bin/env bash
# build_apk.sh [--debug] [--install]: the web port as one Android APK with everything in it (web/app, and web/assets
# but the loose voices and sound effects, which the packs carry). Writes web-dev/android/out/tsukihime.apk.
#   --debug    the page can be inspected from chrome://inspect on the computer (USB debugging)
#   --install  installs it on the connected phone or emulator (adb install -r keeps the saves)
# Needs the Android SDK (ANDROID_HOME, default ~/Library/Android/sdk) with platform android-36 and build-tools 35+,
# and a JDK. No Gradle. The signing key is made once, in web-dev/android/keystore: keep it, or a later APK cannot
# update the installed one (Android would have to remove it, and the saves with it).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
web="$(cd "$here/../../web" && pwd)"
debug=0; install=0
for a in "$@"; do
    case "$a" in
        --debug) debug=1 ;;
        --install) install=1 ;;
        *) echo "unknown argument: $a" >&2; exit 2 ;;
    esac
done

# The game's files are not in the repository: fetch_assets.py brings them from the site into web/assets, once.
[ -f "$web/assets/text.json" ] || { echo "the game's files are not in web/assets: run python3 web-dev/tools/fetch_assets.py first" >&2; exit 1; }

sdk="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
bt="$sdk/build-tools/$(ls "$sdk/build-tools" | sort -V | tail -1)"
jar="$sdk/platforms/android-36/android.jar"
[ -f "$jar" ] || { echo "no $jar (sdkmanager 'platforms;android-36')" >&2; exit 1; }
out="$here/out"
work="$out/work"
rm -rf "$work"; mkdir -p "$work/classes" "$work/stage/assets/www/assets"

# The signing key, made once.
ks="$here/keystore/tsukihime.jks"
if [ ! -f "$ks" ]; then
    mkdir -p "$here/keystore"
    keytool -genkeypair -keystore "$ks" -storepass tsukihime -keypass tsukihime -alias tsukihime -keyalg RSA \
        -keysize 3072 -validity 36500 -dname "CN=Tsukihime web port" >/dev/null
    echo "made the signing key: $ks (keep it)"
fi

# Resources, manifest -> base.apk
"$bt/aapt2" compile --dir "$here/res" -o "$work/res.zip"
version=$(date +%y%m%d%H)
link=("$bt/aapt2" link -o "$work/base.apk" -I "$jar" --manifest "$here/AndroidManifest.xml" "$work/res.zip"
      --min-sdk-version 26 --target-sdk-version 36 --version-code "$version" --version-name "$(date +%Y.%m.%d)")
[ "$debug" = 1 ] && link+=(--debug-mode)
"${link[@]}"

# Java -> classes.dex
javac -nowarn --release 11 -cp "$jar" -d "$work/classes" \
    $(find "$here/src" -name '*.java') 2>&1 | grep -v 'warning: \[options\]' || true
[ -n "$(find "$work/classes" -name '*.class')" ] || { echo "javac failed" >&2; exit 1; }
"$bt/d8" --release --min-api 26 --lib "$jar" --output "$work" $(find "$work/classes" -name '*.class')

# The game: assets/www = web/app, assets/www/assets = web/assets without voice/ and se/ (in the packs). Linked, not
# copied; zip follows the links. Stored, not compressed, so the app can seek in them (the files are compressed already).
for f in "$web/app"/*; do ln -s "$f" "$work/stage/assets/www/"; done
for f in "$web/assets"/*; do
    case "$(basename "$f")" in voice|se) ;; *) ln -s "$f" "$work/stage/assets/www/assets/" ;; esac
done
cp "$work/base.apk" "$work/unsigned.apk"
(cd "$work" && zip -q -X "unsigned.apk" classes.dex)
(cd "$work/stage" && zip -q -X -0 -r "../unsigned.apk" assets -x '*.DS_Store' -x '*/.*')

"$bt/zipalign" -f -p 4 "$work/unsigned.apk" "$work/aligned.apk"
"$bt/apksigner" sign --v1-signing-enabled false --ks "$ks" --ks-pass pass:tsukihime --ks-key-alias tsukihime --key-pass pass:tsukihime \
    --out "$out/tsukihime.apk" "$work/aligned.apk"
rm -rf "$work"
ls -lh "$out/tsukihime.apk" | awk '{print $5, $9}'

if [ "$install" = 1 ]; then
    "$sdk/platform-tools/adb" install -r "$out/tsukihime.apk"
fi
