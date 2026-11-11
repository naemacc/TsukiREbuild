#!/usr/bin/env bash
# build.sh [mac] [win] [linux]: the web port as a desktop app with everything in it (web/app, and web/assets but the
# loose voices and sound effects, which the packs carry). With no argument, all three. Writes web-dev/desktop/out:
#   Tsukihime-mac-universal.dmg     macOS 13 or newer, Apple silicon and Intel
#   Tsukihime-win-x64.zip           Windows 10 or newer: unzip, run Tsukihime.exe
#   Tsukihime-linux-x86_64.AppImage Linux: chmod +x, run
# Needs Node.js with npm; on a Mac all three can be made (the Linux one uses Rosetta for one of its tools).
set -euo pipefail
cd "$(dirname "$0")"
args=()
for a in "$@"; do
    case "$a" in
        mac|win|linux) args+=("--$a") ;;
        *) echo "unknown argument: $a (mac, win, linux)" >&2; exit 2 ;;
    esac
done
[ ${#args[@]} -gt 0 ] || args=(--mac --win --linux)
[ -d node_modules/electron-builder ] || npm install
npx electron-builder "${args[@]}"
ls -lh out/Tsukihime-* | awk '{print $5, $9}'
