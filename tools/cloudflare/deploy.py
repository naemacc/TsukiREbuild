#!/usr/bin/env python3
"""Sync tracked game assets to R2 and publish the frontend to Cloudflare Pages."""

import base64
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import subprocess
import time
import urllib.error
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor

import boto3
from botocore.config import Config


ROOT = Path(__file__).resolve().parents[2]
API = "https://api.cloudflare.com/client/v4"
CONTENT_TYPES = {
    ".avif": "image/avif",
    ".js": "text/javascript",
    ".mp4": "video/mp4",
    ".ogg": "audio/ogg",
    ".otf": "font/otf",
    ".webp": "image/webp",
    ".woff2": "font/woff2",
}


def content_type(path):
    return CONTENT_TYPES.get(path.suffix) or mimetypes.guess_type(path)[0] or "application/octet-stream"


def tracked_files(directory):
    output = subprocess.check_output(["git", "ls-files", "-z", "--", directory], cwd=ROOT)
    files = [Path(os.fsdecode(name)) for name in output.split(b"\0") if name]
    if not files:
        raise RuntimeError(f"No tracked files found in {directory}")
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


def sync_assets(client, bucket):
    remote = {}
    for page in client.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix="assets/"):
        for item in page.get("Contents", []):
            remote[item["Key"]] = item["ETag"].strip('"')

    def upload(path):
        md5 = hashlib.md5()
        sha256 = hashlib.sha256()
        with (ROOT / path).open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                md5.update(chunk)
                sha256.update(chunk)
        key = path.relative_to("web").as_posix()
        if remote.get(key) == md5.hexdigest():
            return 0
        with (ROOT / path).open("rb") as source:
            result = client.put_object(
                Bucket=bucket,
                Key=key,
                Body=source,
                ContentLength=(ROOT / path).stat().st_size,
                ContentType=content_type(path),
                CacheControl="public, max-age=300",
                ChecksumSHA256=base64.b64encode(sha256.digest()).decode(),
                Metadata={"sha256": sha256.hexdigest()},
                StorageClass="STANDARD",
            )
        if result["ETag"].strip('"') != md5.hexdigest():
            raise RuntimeError(f"R2 checksum mismatch for {key}")
        print(f"Uploaded {key}", flush=True)
        return 1

    # Retain previous objects for open browser sessions and deployment rollbacks.
    files = tracked_files("web/assets")
    with ThreadPoolExecutor(max_workers=8) as pool:
        uploaded = sum(pool.map(upload, files))
    print(f"R2: uploaded {uploaded} new or modified files, skipped {len(files) - uploaded} unchanged files", flush=True)


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


def main():
    names = ("CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_API_TOKEN_ID")
    for name in names:
        if not os.environ.get(name):
            raise RuntimeError(f"Missing required environment variable {name}")
    account = os.environ["CLOUDFLARE_ACCOUNT_ID"]
    token = os.environ["CLOUDFLARE_API_TOKEN"]
    project = os.environ.get("CLOUDFLARE_PAGES_PROJECT", "tsukirebuild")
    bucket = os.environ.get("CLOUDFLARE_R2_BUCKET", "tsukirebuild-assets")
    client = boto3.client(
        "s3",
        endpoint_url=f"https://{account}.r2.cloudflarestorage.com",
        region_name="auto",
        aws_access_key_id=os.environ["CLOUDFLARE_API_TOKEN_ID"],
        aws_secret_access_key=hashlib.sha256(token.encode()).hexdigest(),
        config=Config(
            retries={"mode": "standard", "total_max_attempts": 5},
            max_pool_connections=8,
            request_checksum_calculation="when_required",
            response_checksum_validation="when_required",
        ),
    )
    sync_assets(client, bucket)
    manifest = frontend_assets(account, project, token)
    deploy(account, project, token, manifest)


if __name__ == "__main__":
    main()
