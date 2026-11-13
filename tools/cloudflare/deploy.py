#!/usr/bin/env python3
"""Sync the app to R2 and publish the frontend to Cloudflare Pages; with --assets, sync the game's assets to R2 from a folder.

The game's own files (web/assets: pictures, music, voices, movies, scripts, tables) are not in the repository. They are in the bucket,
under assets/, and a deployment leaves them alone: it stores the app, and never deletes anything. To change them, run this with
--assets on a machine that has them (see main), which also writes the list of them the repository does keep, web-dev/assets-manifest.txt
(web-dev/tools/fetch_assets.py brings the files back from the site by that list).

Two ways in serve the same files:
  https://arcueid.date            the R2 bucket itself, attached to the domain and behind Cloudflare's cache: the app's files at the
                                  bucket's root, the game's under assets/. No Worker runs, so nothing counts against the Workers
                                  request allowance. A zone rule turns "/" into "/index.html"; cache rules set how long things are kept.
                                  The page loads its scripts, styles, icons and font from v/<version>/, a copy of web/app named by
                                  its content, so a page only ever runs the one set of files it was published with (VERSIONED).
  https://tsukirebuild.pages.dev  Pages: the app as static files, and web/cloudflare/worker.js reading assets/ from the bucket.

The Android and desktop apps bring themselves up to date from the first: each deployment also stores update/app.json, which says what the
site serves now (every app file with its hash, and the list of the game's files the apps carry), and the apps download what they were not
built with (web/app/js/update.js; web-dev/tools/app_manifest.py makes the description, here and in the app builds).
"""

import base64
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import re
import subprocess
import time
import urllib.error
import urllib.request
import sys
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import nullcontext


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "web-dev/tools"))
import app_manifest  # noqa: E402  (the apps' description of the site: update_objects)

SITE = "https://arcueid.date"   # where the game is served from: the bucket, attached to this domain
API = "https://api.cloudflare.com/client/v4"
CONTENT_TYPES = {
    ".avif": "image/avif",
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mp4": "video/mp4",
    ".ogg": "audio/ogg",
    ".otf": "font/otf",
    ".webp": "image/webp",
    ".woff2": "font/woff2",
}


# What a browser may keep for 30 days: the game's converted media, which do not change with the code, and the sound packs and their
# index, which are named by their content (web/cloudflare/worker.js has the same rule for the Pages way in). Everything else, the app
# included, is kept 5 minutes so that a deployment reaches players by itself; the versioned copy of the app (VERSIONED) is kept 30 days,
# since a new version is a new folder.
MEDIA = re.compile(r"^(assets/((voice|img|se|bgm|movie|sys|fonts)/|pack/[a-z]+-[0-9a-f]{10}\.)|v/[0-9a-f]{12}/)")


LONG, SHORT = "public, max-age=2592000, immutable", "public, max-age=300"
# The lifetimes are stored with each object. This names the rule that set them: when it changes, every object already in the bucket is
# given its lifetime again (a copy onto itself, no bytes sent), since an unchanged file is otherwise never touched. The bucket keeps
# the name of the rule it was last brought to in POLICY_KEY.
POLICY = hashlib.sha256(f"{MEDIA.pattern}|{LONG}|{SHORT}|types-1".encode()).hexdigest()[:16]
POLICY_KEY = ".deploy/cache-policy"


def cache_control(key):
    return LONG if MEDIA.match(key) else SHORT


def content_type(path):
    return CONTENT_TYPES.get(path.suffix) or mimetypes.guess_type(path)[0] or "application/octet-stream"


# The app's files are named the same in every deployment, so while index.html and the scripts sit in caches for their 5 minutes, a
# browser could run a new main.js against an old vm.js (or the other way round) and fail at start. So the deployment also stores every
# app file but index.html under v/<version>/, the version a hash of all of them, and the index.html it stores loads them from there.
# The scripts import each other by relative paths and the styles name the font by one, so a page reached through v/<version>/ only
# ever loads files of that version; the versions before stay in the bucket for pages still open or still cached. The files at the
# bucket's root stay too, for addresses asked for directly (/favicon.ico) and for the plain web/app layout the local server serves.
VERSIONED_REFERENCE = re.compile(r'(\s(?:href|src)=")([^"/:#?][^":#?]*)(")')


def app_version(files):
    return app_manifest.app_version(ROOT / "web/app", [path.relative_to("web/app") for path in files])


def versioned_index(path, version, names):
    """index.html with each reference to an app file sent to that file's copy under v/<version>/."""
    seen = set()

    def swap(match):
        name = match.group(2)
        if name not in names:
            raise RuntimeError(f"index.html refers to {name}, which is not a tracked app file")
        seen.add(name)
        return f"{match.group(1)}v/{version}/{name}{match.group(3)}"

    text = VERSIONED_REFERENCE.sub(swap, (ROOT / path).read_text(encoding="utf-8"))
    if "js/main.js" not in seen:
        raise RuntimeError("index.html no longer loads js/main.js: the versioned page would not run the game")
    return text.encode("utf-8")


def site_objects(files):
    """(key, source path, bytes or None) for every object a deployment stores, the app's index.html last: it is uploaded only once
    everything it refers to is in place."""
    app = [p for p in files if p.is_relative_to("web/app")]
    version = app_version(app)
    names = {p.relative_to("web/app").as_posix() for p in app}
    clash = sorted(n for n in names if n.startswith(("assets/", "v/", "update/")))
    if clash:
        raise RuntimeError(f"App files that would be stored among the game's assets, the app's versions or the apps' updates: {clash}")
    objects, index = [], None
    for path in files:
        if not path.is_relative_to("web/app"):
            objects.append((path.relative_to("web").as_posix(), path, None))
            continue
        name = path.relative_to("web/app").as_posix()
        if name == "index.html":
            index = (name, path, versioned_index(path, version, names))
            # (as it is in web/app, beside the files it names: the page the Android and desktop apps take with an update)
            objects.append((f"v/{version}/{name}", path, None))
            continue
        objects.append((name, path, None))
        objects.append((f"v/{version}/{name}", path, None))
    if index is None:
        raise RuntimeError("No web/app/index.html")
    return objects, index, version


def update_objects(files):
    """What the Android and desktop apps read to bring themselves up to date (web/app/js/update.js): the list of the game's files they
    carry, under a name made from its content, and update/app.json, which names that list and every app file with its hash. The second is
    stored after everything else but the page: an app that reads it finds all of it there."""
    app = [path.relative_to("web/app") for path in files if path.is_relative_to("web/app")]
    description, key, listing = app_manifest.site_description(ROOT / "web/app", app, ROOT / "web-dev/assets-manifest.txt")
    return (key, Path(key), listing), ("update/app.json", Path("update/app.json"), description)


def tracked_files(directory):
    output = subprocess.check_output(["git", "ls-files", "-z", "--", directory], cwd=ROOT)
    files = [Path(os.fsdecode(name)) for name in output.split(b"\0") if name]
    if not files:
        raise RuntimeError(f"No tracked files found in {directory}")
    if directory == "web/app" and subprocess.check_output(["git", "ls-files", "--", "web/assets"], cwd=ROOT).strip():
        raise RuntimeError("web/assets is tracked again: the game's files stay out of the repository (web/.gitignore)")
    for path in files:
        if (ROOT / path).is_symlink() or not (ROOT / path).is_file():
            raise RuntimeError(f"Expected a regular file: {path}")
    return files


def cloudflare(method, path, token, body=None, content_type="application/json", absent=False):
    if isinstance(body, (dict, list)):
        body = json.dumps(body).encode()
    request = urllib.request.Request(
        API + path,
        data=body,
        method=method,
        headers={"Authorization": f"Bearer {token}", "Content-Type": content_type},
    )
    for attempt in range(5):
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                result = json.load(response)
            if not result.get("success"):
                raise RuntimeError(f"Cloudflare {path}: {result.get('errors')}")
            return result.get("result")
        except urllib.error.HTTPError as error:
            if absent and error.code == 404:
                return None   # not there (yet): the caller decides whether that is a failure
            if error.code not in (408, 429) and error.code < 500:
                raise RuntimeError(f"Cloudflare {method} {path}: HTTP {error.code}, {error.read().decode()}") from None
            if attempt == 4:
                raise RuntimeError(f"Cloudflare {method} {path}: HTTP {error.code}") from None
        except (urllib.error.URLError, TimeoutError):
            if attempt == 4:
                raise
        time.sleep(2 ** attempt)


# The game's assets in a folder, as the objects a deployment would store: every file but the loose voices and sound effects (the site plays
# them from the packs, web-dev/tools/build_packs.py) and hidden files.
LOOSE = ("voice", "se")


def asset_objects(folder):
    folder = Path(folder).resolve()
    if not (folder / "scripts").is_dir() or not (folder / "pack").is_dir():
        raise RuntimeError(f"{folder} does not look like web/assets (no scripts/ or pack/)")
    objects = []
    for path in sorted(folder.rglob("*")):
        rel = path.relative_to(folder)
        if path.is_file() and not path.is_symlink() and rel.parts[0] not in LOOSE and not any(part.startswith(".") for part in rel.parts):
            objects.append(("assets/" + rel.as_posix(), path, None))
    return objects


def write_manifest(objects):
    """web-dev/assets-manifest.txt: "md5 size path" for each asset, by path (fetch_assets.py reads it)."""
    lines = []
    for key, path, _ in sorted(objects):
        digest = hashlib.md5()
        with path.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
        lines.append(f"{digest.hexdigest()} {path.stat().st_size} {key[len('assets/'):]}")
    (ROOT / "web-dev/assets-manifest.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote web-dev/assets-manifest.txt ({len(lines)} files): commit it with the change", flush=True)


def sync_assets(client, bucket, assets=None):
    """The app (assets None), or the game's assets from the folder `assets`, into the bucket. Nothing is ever deleted."""
    remote = {}
    for page in client.get_paginator("list_objects_v2").paginate(Bucket=bucket):
        for item in page.get("Contents", []):
            remote[item["Key"]] = item["ETag"].strip('"')

    try:
        stored = client.get_object(Bucket=bucket, Key=POLICY_KEY)["Body"].read().decode()
    except client.exceptions.NoSuchKey:
        stored = None
    restamp = stored != POLICY
    if restamp:
        print(f"R2: the cache rule changed ({stored} -> {POLICY}): every object's lifetime and type are set again", flush=True)

    def upload(item):
        key, path, data = item
        md5 = hashlib.md5()
        sha256 = hashlib.sha256()
        if data is None:
            with (ROOT / path).open("rb") as source:
                for chunk in iter(lambda: source.read(1024 * 1024), b""):
                    md5.update(chunk)
                    sha256.update(chunk)
        else:
            md5.update(data)
            sha256.update(data)
        if remote.get(key) == md5.hexdigest():
            if restamp:   # the same bytes, their lifetime and type as the rule now has them
                client.copy_object(
                    Bucket=bucket,
                    Key=key,
                    CopySource={"Bucket": bucket, "Key": key},
                    MetadataDirective="REPLACE",
                    ContentType=content_type(path),
                    CacheControl=cache_control(key),
                    Metadata={"sha256": sha256.hexdigest()},
                    StorageClass="STANDARD",
                )
            return 0
        with (ROOT / path).open("rb") if data is None else nullcontext(data) as source:
            result = client.put_object(
                Bucket=bucket,
                Key=key,
                Body=source,
                ContentLength=(ROOT / path).stat().st_size if data is None else len(data),
                ContentType=content_type(path),
                CacheControl=cache_control(key),
                ChecksumSHA256=base64.b64encode(sha256.digest()).decode(),
                Metadata={"sha256": sha256.hexdigest()},
                StorageClass="STANDARD",
            )
        if result["ETag"].strip('"') != md5.hexdigest():
            raise RuntimeError(f"R2 checksum mismatch for {key}")
        print(f"Uploaded {key}", flush=True)
        return 1

    def restamp_stored(key):
        # an object this run has no file for (the game's assets, in a deployment of the app): the same bytes, with their lifetime and
        # type as the rule now has them and the checksum they were stored with
        kept = client.head_object(Bucket=bucket, Key=key).get("Metadata", {})
        client.copy_object(
            Bucket=bucket,
            Key=key,
            CopySource={"Bucket": bucket, "Key": key},
            MetadataDirective="REPLACE",
            ContentType=content_type(Path(key)),
            CacheControl=cache_control(key),
            Metadata=kept,
            StorageClass="STANDARD",
        )

    if assets is not None:
        # The game's assets alone, from a folder: new and changed files go up, and the list of them is written for the repository.
        objects = asset_objects(assets)
        with ThreadPoolExecutor(max_workers=8) as pool:
            uploaded = sum(pool.map(upload, objects))
        write_manifest(objects)
        print(f"R2: uploaded {uploaded} new or modified assets, skipped {len(objects) - uploaded} unchanged", flush=True)
        return

    # Retain previous objects for open browser sessions and deployment rollbacks.
    objects, index, version = site_objects(tracked_files("web/app"))
    listing, description = update_objects(tracked_files("web/app"))
    objects.append(listing)
    with ThreadPoolExecutor(max_workers=8) as pool:
        uploaded = sum(pool.map(upload, objects))
        if restamp:
            mine = {key for key, _, _ in objects}
            stored_assets = [key for key in remote if key.startswith("assets/") and key not in mine]
            list(pool.map(restamp_stored, stored_assets))
            print(f"R2: {len(stored_assets)} stored assets given their lifetime and type again", flush=True)
    uploaded += upload(description)   # what the apps update from, once every file it names is there
    uploaded += upload(index)   # last: the page a player gets only once every file it names is there
    print(f"R2: the page loads the app from v/{version}/", flush=True)
    if restamp:
        client.put_object(Bucket=bucket, Key=POLICY_KEY, Body=POLICY.encode(), ContentType="text/plain", CacheControl=SHORT)
    in_bucket = sum(1 for key in remote if key.startswith("assets/"))
    print(f"R2: uploaded {uploaded} new or modified files, skipped {len(objects) + 2 - uploaded} unchanged files; {in_bucket} assets in the bucket, left as they are", flush=True)


def frontend_assets(account, project, token):
    assets = []
    manifest = {}
    for path in tracked_files("web/app"):
        if (ROOT / path).stat().st_size > 25 * 1024 * 1024:
            raise RuntimeError(f"Pages frontend file exceeds 25 MiB: {path}")
        data = base64.b64encode((ROOT / path).read_bytes()).decode()
        digest = hashlib.sha256((data + path.suffix[1:]).encode()).hexdigest()[:32]
        manifest["/" + path.relative_to("web/app").as_posix()] = digest
        assets.append({"key": digest, "value": data, "base64": True, "metadata": {"contentType": content_type(path)}})
    upload_token = cloudflare("GET", f"/accounts/{account}/pages/projects/{project}/upload-token", token)["jwt"]
    batch = []
    size = 0
    for asset in assets:
        if batch and size + len(asset["value"]) > 50 * 1024 * 1024:
            cloudflare("POST", "/pages/assets/upload", upload_token, batch)
            batch, size = [], 0
        batch.append(asset)
        size += len(asset["value"])
    cloudflare("POST", "/pages/assets/upload", upload_token, batch)
    cloudflare("POST", "/pages/assets/upsert-hashes", upload_token, {"hashes": list(manifest.values())})
    return manifest


def deployment_body(manifest):
    boundary = uuid.uuid4().hex
    revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    parts = []
    fields = {
        "manifest": (None, "application/json", json.dumps(manifest).encode()),
        "branch": (None, "text/plain", b"main"),
        "commit_hash": (None, "text/plain", revision.encode()),
        "commit_message": (None, "text/plain", b"Automatic deployment from GitHub Actions"),
        "_worker.js": ("_worker.js", "application/javascript+module", (ROOT / "web/cloudflare/worker.js").read_bytes()),
        "_routes.json": ("_routes.json", "application/json", b'{"version":1,"include":["/assets/*"],"exclude":[]}'),
        "_headers": ("_headers", "text/plain", b"/*\n  Cache-Control: public, max-age=300\n"),
        # The Pages address forwards to the site's own domain, path and query kept. Not the assets, which the Worker still answers there
        # (redirects do not apply to what a Function serves): a page loaded a moment before the forward began can finish loading.
        "_redirects": ("_redirects", "text/plain", f"/* {SITE}/:splat 302\n".encode()),
    }
    for name, (filename, kind, data) in fields.items():
        disposition = f'Content-Disposition: form-data; name="{name}"'
        if filename:
            disposition += f'; filename="{filename}"'
        parts.append(f"--{boundary}\r\n{disposition}\r\nContent-Type: {kind}\r\n\r\n".encode() + data + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


def deploy(account, project, token, manifest):
    path = f"/accounts/{account}/pages/projects/{project}/deployments"
    body, kind = deployment_body(manifest)
    deployment = cloudflare("POST", path, token, body, kind)
    # A deployment just created can be unknown to the next request for a moment (HTTP 404 with the upload already accepted,
    # 2026-11-11): for the first minute that is waited out, after that it is a failure.
    created, identifier = time.monotonic(), deployment["id"]
    deadline = created + 600
    while time.monotonic() < deadline:
        found = cloudflare("GET", path + "/" + identifier, token, absent=True)
        if found is None:
            if time.monotonic() - created > 60:
                raise RuntimeError(f"Pages deployment {identifier} was created but cannot be found")
            time.sleep(3)
            continue
        deployment = found
        stage = deployment["latest_stage"]
        if stage["name"] == "deploy" and stage["status"] == "success":
            print(f"Published https://{project}.pages.dev at {deployment['deployment_trigger']['metadata']['commit_hash']}")
            return
        if stage["status"] in ("failure", "canceled"):
            raise RuntimeError(f"Pages deployment {deployment['id']} failed at {stage['name']}")
        time.sleep(3)
    raise RuntimeError(f"Timed out waiting for Pages deployment {deployment['id']}")


def stage(directory):
    """Write the app's objects as a deployment would store them into a folder, keys as paths, with assets/ a link to web/assets (where
    fetch_assets.py puts the game's files), to try the site locally (python3 -m http.server)."""
    objects, index, version = site_objects(tracked_files("web/app"))
    out = Path(directory).resolve()
    out.mkdir(parents=True, exist_ok=True)
    if not (out / "assets").exists():
        (out / "assets").symlink_to(ROOT / "web/assets")
    for key, path, data in objects + list(update_objects(tracked_files("web/app"))) + [index]:
        target = out / key
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes((ROOT / path).read_bytes() if data is None else data)
    print(f"Staged {len(objects) + 3} objects in {out}; the page loads the app from v/{version}/ ({cache_control('v/' + version + '/js/main.js')})")


def main():
    """deploy.py                 the app to the bucket and to Pages (what a push to main runs)
    deploy.py --stage DIR     the app as it would be stored, into a folder
    deploy.py --assets DIR    the game's assets from DIR (a web/assets) to the bucket, and the manifest written. For whoever has the
                              files: with CLOUDFLARE_ACCOUNT_ID and either the deployment's token pair or R2 keys of their own
                              (R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and, for temporary ones, R2_SESSION_TOKEN)."""
    if len(sys.argv) == 3 and sys.argv[1] == "--stage":
        return stage(sys.argv[2])
    assets = sys.argv[2] if len(sys.argv) == 3 and sys.argv[1] == "--assets" else None
    if len(sys.argv) > 1 and assets is None:
        raise SystemExit(main.__doc__)
    import boto3
    from botocore.config import Config

    own_keys = bool(os.environ.get("R2_ACCESS_KEY_ID") and os.environ.get("R2_SECRET_ACCESS_KEY"))
    names = ("CLOUDFLARE_ACCOUNT_ID",) if assets is not None and own_keys else ("CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_API_TOKEN_ID")
    for name in names:
        if not os.environ.get(name):
            raise RuntimeError(f"Missing required environment variable {name}")
    account = os.environ["CLOUDFLARE_ACCOUNT_ID"]
    token = os.environ.get("CLOUDFLARE_API_TOKEN", "")
    project = os.environ.get("CLOUDFLARE_PAGES_PROJECT", "tsukirebuild")
    bucket = os.environ.get("CLOUDFLARE_R2_BUCKET", "tsukirebuild-assets")
    keys = dict(aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"], aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
                aws_session_token=os.environ.get("R2_SESSION_TOKEN") or None) if assets is not None and own_keys else dict(
        aws_access_key_id=os.environ["CLOUDFLARE_API_TOKEN_ID"], aws_secret_access_key=hashlib.sha256(token.encode()).hexdigest())
    client = boto3.client(
        "s3",
        endpoint_url=f"https://{account}.r2.cloudflarestorage.com",
        region_name="auto",
        **keys,
        config=Config(
            retries={"mode": "standard", "total_max_attempts": 5},
            max_pool_connections=8,
            request_checksum_calculation="when_required",
            response_checksum_validation="when_required",
        ),
    )
    if assets is not None:
        return sync_assets(client, bucket, assets)
    sync_assets(client, bucket)
    manifest = frontend_assets(account, project, token)
    deploy(account, project, token, manifest)


if __name__ == "__main__":
    main()
