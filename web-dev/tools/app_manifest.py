#!/usr/bin/env python3
"""app_manifest.py --bundle OUT: what the Android and desktop apps' updates are worked out from.

The apps carry everything they play and bring themselves up to date from the site (web/app/js/update.js): they download only the files the
site has that they were not built with. For that each side says what it holds, in the same form:

    {"format": 1, "time": <when it was made, seconds>, "shell": <the app the page needs, apphost.js SHELL>, "version": "<12 hex>",
     "app": [["js/main.js", <size>, "<sha256>"], ...],            every file of web/app
     "assets": {"md5": "<of the list>", "size": <of the list>, "path": "update/assets-<12 hex>.txt"}}

and the list is the apps' part of the game's files, "md5 size path" a line as web-dev/assets-manifest.txt has them: everything but
web/assets/ja (the apps are English only) and the loose voices and sound effects (the packs carry them).

  the site   tools/cloudflare/deploy.py stores update/app.json and the list with every deployment (site_description, below), from the
             repository's web/app and web-dev/assets-manifest.txt
  an app     this script, run by web-dev/android/build_apk.sh and web-dev/desktop/build.sh, writes OUT/bundled.json and
             OUT/bundled-assets.txt from the files being packed, web/app and web/assets as they are on this computer

Needs nothing but Python's standard library.
"""
import hashlib
import json
import os
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FORMAT = 1
# What the apps are built without: Japanese's own files, and the loose voices and sound effects.
WITHOUT = ("ja", "voice", "se")


def shell(app=ROOT / "web/app"):
    """The app the page needs, as apphost.js says it."""
    found = re.search(r"^export const SHELL = (\d+);", (app / "js/apphost.js").read_text(encoding="utf-8"), re.M)
    if not found:
        raise RuntimeError("web/app/js/apphost.js no longer says which app the page needs (export const SHELL = n;)")
    return int(found.group(1))


def app_version(root, files):
    """The name of a set of app files (paths under `root`): the folder the site serves them from, v/<this>/. index.html is not part of it."""
    digest = hashlib.sha256()
    for path in sorted(files):
        if path.name != "index.html":
            digest.update(path.as_posix().encode() + b"\0" + (root / path).read_bytes() + b"\0")
    return digest.hexdigest()[:12]


def app_entries(root, files):
    return [[path.as_posix(), (root / path).stat().st_size, hashlib.sha256((root / path).read_bytes()).hexdigest()] for path in sorted(files, key=lambda p: p.as_posix())]


def apps_list(lines):
    """The apps' part of a list of the game's files ("md5 size path" lines, or (md5, size, path)), as the text both sides compare."""
    rows = []
    for line in lines:
        md5, size, path = line.split(" ", 2) if isinstance(line, str) else line
        if path.split("/")[0] not in WITHOUT:
            rows.append((path, f"{md5} {int(size)} {path}"))
    return ("\n".join(row for _, row in sorted(rows)) + "\n").encode()


def describe(root, files, listing, made=None, path=None):
    """The description of the app files `files` under `root` and the list `listing` (bytes, from apps_list)."""
    assets = {"md5": hashlib.md5(listing).hexdigest(), "size": len(listing)}
    if path:
        assets["path"] = path
    return {"format": FORMAT, "time": int(time.time() if made is None else made), "shell": shell(root), "version": app_version(root, files),
            "app": app_entries(root, files), "assets": assets}


def site_description(root, files, manifest, made=None):
    """For a deployment: (update/app.json's bytes, the list's key, the list's bytes). files: web/app's files, as paths under root."""
    listing = apps_list(line for line in manifest.read_text(encoding="utf-8").splitlines() if line.strip())
    key = f"update/assets-{hashlib.md5(listing).hexdigest()[:12]}.txt"
    return json.dumps(describe(root, files, listing, made, key), separators=(",", ":")).encode(), key, listing


def md5_of(path):
    digest = hashlib.md5()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def visible(folder):
    """Every file under `folder` that is not hidden, as paths under it (links followed, as the app builds follow them)."""
    found = []
    for here, folders, names in os.walk(folder, followlinks=True):
        folders[:] = [name for name in folders if not name.startswith(".")]
        found += [(Path(here) / name).relative_to(folder) for name in names if not name.startswith(".")]
    return sorted(found)


def bundle(out, app=ROOT / "web/app", assets=ROOT / "web/assets"):
    """OUT/bundled.json and OUT/bundled-assets.txt: what an app built now from `app` and `assets` holds."""
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    listing = apps_list((md5_of(assets / path), (assets / path).stat().st_size, path.as_posix()) for path in visible(assets) if path.parts[0] not in WITHOUT)
    description = describe(app, visible(app), listing)
    (out / "bundled-assets.txt").write_bytes(listing)
    (out / "bundled.json").write_text(json.dumps(description, separators=(",", ":")), encoding="utf-8")
    count = listing.count(b"\n")
    print(f"bundled.json: version {description['version']}, {len(description['app'])} app files, {count} of the game's files")
    return description


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] != "--bundle":
        raise SystemExit(__doc__)
    bundle(sys.argv[2])
