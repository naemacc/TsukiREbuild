#!/usr/bin/env python3
"""fetch_assets.py [--tables] [--check] [--jobs N] [--from URL]: the game's files into web/assets.

The game's own files (pictures, music, voices, movies, scripts, tables: about 2.8 GB) are not in this repository. The site serves them, and
this brings them from there, so that web/server.py, the tests and the app builds have them:

    python3 web-dev/tools/fetch_assets.py            everything
    python3 web-dev/tools/fetch_assets.py --tables   only the scripts and tables (about 66 MB, Japanese's own included): what the tests read
    python3 web-dev/tools/fetch_assets.py --check    downloads nothing; says what is missing or different

web-dev/assets-manifest.txt lists every file: its MD5, its size, its path under web/assets. A file already there with that size and MD5 is
left alone, so a run that was stopped goes on where it was. Needs nothing but Python's standard library. (To make the files from your own copy
of the game instead, see "Making the assets again" in the README.)
"""
import hashlib
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "web-dev/assets-manifest.txt"
ASSETS = ROOT / "web/assets"
SITE = "https://arcueid.date/assets/"
# The media, by their folder: everything else is a script or a table.
MEDIA = ("img/", "ui/", "bgm/", "movie/", "pack/", "sys/", "fonts/")   # (and the same under ja/, the original game's own: is_media)


def is_media(path):
    return path.removeprefix("ja/").startswith(MEDIA)


def manifest(path=MANIFEST):
    """[(md5, size, path under web/assets)] as the manifest lists them."""
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            md5, size, name = line.split(" ", 2)
            out.append((md5, int(size), name))
    return out


def md5_of(path):
    digest = hashlib.md5()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def have(entry, folder=ASSETS):
    md5, size, name = entry
    path = folder / name
    return path.is_file() and path.stat().st_size == size and md5_of(path) == md5


def fetch(entry, base=SITE, folder=ASSETS):
    md5, size, name = entry
    target = folder / name
    target.parent.mkdir(parents=True, exist_ok=True)
    part = target.with_name(target.name + ".part")
    request = urllib.request.Request(base + urllib.parse.quote(name), headers={"User-Agent": "TsukiREbuild-fetch-assets"})
    for attempt in range(4):
        try:
            digest = hashlib.md5()
            with urllib.request.urlopen(request, timeout=120) as response, part.open("wb") as out:
                for chunk in iter(lambda: response.read(1 << 20), b""):
                    digest.update(chunk)
                    out.write(chunk)
            if part.stat().st_size != size or digest.hexdigest() != md5:
                raise ValueError("not the file the manifest lists")
            os.replace(part, target)
            return None
        except (urllib.error.URLError, TimeoutError, ValueError, ConnectionError) as error:
            failure = f"{name}: {error}"
    part.unlink(missing_ok=True)
    return failure


def main(argv):
    args = list(argv)
    jobs, base = 8, SITE
    if "--jobs" in args:
        i = args.index("--jobs"); jobs = int(args[i + 1]); del args[i:i + 2]
    if "--from" in args:
        i = args.index("--from"); base = args[i + 1].rstrip("/") + "/"; del args[i:i + 2]
    tables, check = "--tables" in args, "--check" in args
    if set(args) - {"--tables", "--check"}:
        raise SystemExit(__doc__)
    entries = [e for e in manifest() if not (tables and is_media(e[2]))]
    with ThreadPoolExecutor(max_workers=jobs) as pool:
        wanted = [e for e, there in zip(entries, pool.map(have, entries)) if not there]
        size = sum(e[1] for e in wanted)
        print(f"{len(entries) - len(wanted)} of {len(entries)} files are in web/assets; {len(wanted)} to fetch ({size / 1e6:.0f} MB)", flush=True)
        if check or not wanted:
            for e in wanted[:20]:
                print("  missing or different:", e[2])
            return 1 if wanted else 0
        failed, done = [], 0
        for n, failure in enumerate(pool.map(lambda e: fetch(e, base), wanted), 1):
            if failure:
                failed.append(failure)
            done += wanted[n - 1][1]
            if n % 250 == 0 or n == len(wanted):
                print(f"  {n} / {len(wanted)} files, {done / 1e6:.0f} / {size / 1e6:.0f} MB", flush=True)
    for failure in failed[:20]:
        print("  failed:", failure, file=sys.stderr)
    print("Done." if not failed else f"{len(failed)} files failed; run it again to fetch them.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
