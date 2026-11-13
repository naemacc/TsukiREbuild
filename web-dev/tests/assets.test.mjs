// The game's own files are not in the repository: the site's bucket has them, the repository keeps their list (web-dev/assets-manifest.txt), and
// web-dev/tools/fetch_assets.py brings them back by it. The deployment (tools/cloudflare/deploy.py, in the repository only) stores the app alone.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const at = (name) => new URL(`../../${name}`, import.meta.url);
const read = (name) => readFileSync(at(name), "utf8");
const lines = read("web-dev/assets-manifest.txt").split("\n").filter(Boolean).map((l) => { const [md5, size, ...rest] = l.split(" "); return { md5, size: Number(size), path: rest.join(" ") }; });

test("the manifest lists every asset the site serves: an MD5, a size and a path each, in order, the loose voices and sounds left out", () => {
  assert.equal(lines.length, 10974);   // 10,517 the translation's, 457 Japanese's own (ja/)
  for (const l of lines) {
    assert.match(l.md5, /^[0-9a-f]{32}$/, l.path);
    assert.ok(Number.isInteger(l.size) && l.size > 0, l.path);
    assert.ok(l.path && !l.path.startsWith("/") && !l.path.includes(".."), l.path);
  }
  const paths = lines.map((l) => l.path);
  assert.deepEqual(paths, [...paths].sort(), "by path");
  assert.equal(new Set(paths).size, paths.length);
  assert.ok(!paths.some((p) => p.startsWith("voice/") || p.startsWith("se/")), "the site plays those from the packs");
  for (const p of ["text.json", "system.json", "scripts/index.json", "pack/index.json", "gallery.json", "flowchart.json"]) assert.ok(paths.includes(p), p);
  assert.equal(lines.reduce((n, l) => n + l.size, 0), 2901539839, "2.9 GB");
  assert.ok(paths.includes("ja/index.json") && paths.filter((p) => p.startsWith("ja/")).length === 457, "Japanese's own, under ja/");
});

test("fetch_assets.py reads that list, fetches from the site, and can take the scripts and tables alone", () => {
  const tool = read("web-dev/tools/fetch_assets.py");
  assert.match(tool, /MANIFEST = ROOT \/ "web-dev\/assets-manifest\.txt"/);
  assert.match(tool, /SITE = "https:\/\/arcueid\.date\/assets\/"/);
  assert.match(tool, /MEDIA = \("img\/", "ui\/", "bgm\/", "movie\/", "pack\/", "sys\/", "fonts\/"\)/);
  assert.match(tool, /return path\.removeprefix\("ja\/"\)\.startswith\(MEDIA\)/, "Japanese's own media are media too");
  const media = ["img/", "ui/", "bgm/", "movie/", "pack/", "sys/", "fonts/"];
  const tables = lines.filter((l) => !media.some((m) => l.path.replace(/^ja\//, "").startsWith(m)));
  assert.ok(tables.every((l) => l.path.endsWith(".json")), "everything else is a script or a table");
  assert.ok(tables.reduce((n, l) => n + l.size, 0) < 70e6, "small enough to fetch for the tests");
  assert.match(tool, /part\.stat\(\)\.st_size != size or digest\.hexdigest\(\) != md5/, "a download is checked against the list before it is kept");
});

test("what needs the files says how to get them", () => {
  assert.match(read("web/server.py"), /python3 web-dev\/tools\/fetch_assets\.py/);
  for (const script of ["web-dev/desktop/build.sh", "web-dev/android/build_apk.sh"]) assert.match(read(script), /assets\/text\.json" \] \|\| \{ echo "the game's files are not in web\/assets: run python3 web-dev\/tools\/fetch_assets\.py first"/, script);
});

// (the deployment and git are the repository's; the working folder this is developed in has neither)
test("in the repository nothing under web/assets is tracked, and the deployment stores the app alone and refuses if that changes", { skip: !existsSync(at("tools/cloudflare/deploy.py")) }, () => {
  assert.equal(execFileSync("git", ["ls-files", "--", "web/assets"], { cwd: at("."), encoding: "utf8" }).trim(), "");
  assert.match(read("web/.gitignore"), /^assets\/$/m, "fetched files are ignored");
  const deploy = read("tools/cloudflare/deploy.py");
  assert.match(deploy, /objects, index, version = site_objects\(tracked_files\("web\/app"\)\)/);
  assert.doesNotMatch(deploy, /tracked_files\("web\/assets"\)/);
  assert.match(deploy, /raise RuntimeError\("web\/assets is tracked again/);
  assert.doesNotMatch(deploy, /delete_object/, "a deployment never deletes from the bucket");
});
