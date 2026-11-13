import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const out = join(import.meta.dir, "build");
const www = join(out, "www");

function run(cmd: string[], cwd = root) {
  const p = Bun.spawnSync(cmd, { cwd, stdout: "inherit", stderr: "inherit" });
  if (p.exitCode !== 0)
    throw new Error(`${cmd.join(" ")} exited with ${p.exitCode}`);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// The app itself only (engine, UI, fonts, index.html). Game assets are added
// to the .app after the build, so they are never copied twice.
run(["cp", "-R", join(root, "web/app"), www]);

// iOS only: go straight to the game instead of the opening page (home.js).
// Patches the staged copy, so web/app and the other platforms are untouched.
// ViewController.swift loads index.html?play, which this makes skip the opening page.
const homeJs = join(www, "js/home.js");
const needle = 'return !query.has("script");';
const homeSrc = await Bun.file(homeJs).text();
if (!homeSrc.includes(needle))
  throw new Error(
    "home.js changed: homeDue() was not found, update the patch in ios.ts",
  );
await Bun.write(
  homeJs,
  homeSrc.replace(needle, 'return !query.has("script") && !query.has("play");'),
);

if (!existsSync(join(www, "index.html")))
  throw new Error("index.html missing in web/app");
run(["du", "-sh", www]);
console.log("staged ->", www);
