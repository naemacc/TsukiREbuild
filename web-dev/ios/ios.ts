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

if (!existsSync(join(www, "index.html")))
  throw new Error("index.html missing in web/app");
run(["du", "-sh", www]);
console.log("staged ->", www);
