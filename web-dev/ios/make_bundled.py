#!/usr/bin/env python3

# Writes bundled.json and bundled-assets.txt into the staged www folder
# So the page can tell what this IPA was built with (see web/app/js/update.js).
# Usage: make_bundled.py <www folder> <1|0: game assets are bundled>

import hashlib, json, os, re, sys, urllib.request

SITE = "https://arcueid.date/"
SAFE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.-]*(/[A-Za-z0-9_][A-Za-z0-9_.-]*)*$")
www, with_assets = sys.argv[1], sys.argv[2] == "1"


def get(path):
    req = urllib.request.Request(SITE + path, headers={"User-Agent": "tsuki-ios-build"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


try:
    site = json.loads(get("update/app.json"))
except Exception as e:
    print(
        f"WARNING: could not read the site's update description ({e}); "
        "this IPA will not check for updates"
    )
    sys.exit(0)

app = []
for root, _, names in os.walk(www):
    for n in names:
        full = os.path.join(root, n)
        rel = os.path.relpath(full, www).replace(os.sep, "/")
        if rel.startswith("assets/") or rel in ("bundled.json", "bundled-assets.txt"):
            continue
        if not SAFE.match(rel):
            print("skipping unsafe name:", rel)
            continue
        data = open(full, "rb").read()
        app.append([rel, len(data), hashlib.sha256(data).hexdigest()])
app.sort()

bundled = {
    "format": site["format"],
    "time": site["time"],
    "shell": site["shell"],
    "version": site["version"],
    "app": app,
    "assets": site["assets"],
}

if with_assets and site["assets"].get("path"):
    path = f'{site["assets"]["path"]}?h={site["assets"]["md5"][:12]}'
    text = get(path)
    if hashlib.md5(text).hexdigest() != site["assets"]["md5"]:
        print("WARNING: the asset list does not match its hash; skipping it")
    else:
        open(os.path.join(www, "bundled-assets.txt"), "wb").write(text)

json.dump(bundled, open(os.path.join(www, "bundled.json"), "w"), separators=(",", ":"))
print(f"bundled.json: {len(app)} app files, version {bundled['version']}")
