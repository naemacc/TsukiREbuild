// main.js - the web port as a desktop app (Windows, macOS, Linux): one window showing web/app, with everything it
// plays inside the app. The page lives at app://tsukihime.desktop/, a name that never reaches the network: every
// request to it is answered here from the files next to the app (resources/www = web/app, resources/www/assets =
// web/assets), and any other address is refused. Run from this folder without packaging (npm start), it reads
// ../../web directly.
// The page itself reaches nothing outside. What it needs of the app it asks for by name (`host`, below; the commands
// are listed in web/app/js/apphost.js): a place for an exported save, a link opened in the computer's browser, and
// the update: files newer than the app's own, fetched from the site into the app's data folder and answered from
// there first (updater.js).
const { app, BrowserWindow, Menu, dialog, ipcMain, powerSaveBlocker, protocol, screen, session, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");
const { Updater } = require("./updater.js");

const HOST = "tsukihime.desktop";            // apphost.js knows this name: the page there is the app's
const HOME = `app://${HOST}/`;
const SHELL = 1;                             // what this app does for the page, as a number (apphost.js SHELL): an update made for a higher one is not taken
const SITE = "https://arcueid.date";         // the one place updates come from
const flag = (name) => { const a = process.argv.find((v) => v.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null; };
// For testing: --www=DIR (unpackaged only) serves a prepared copy of the app's files, as a packaged app has them;
// --update-origin=http://127.0.0.1:PORT takes updates from a copy of the site on this computer (no other address is
// accepted); --test-dir=DIR puts an exported save there without asking, and writes the links that would have been
// opened to DIR/opened.txt.
const WWW = !app.isPackaged && flag("www") ? path.resolve(flag("www")) : null;
const TEST_DIR = flag("test-dir") ? path.resolve(flag("test-dir")) : null;
const ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(flag("update-origin") || "") ? flag("update-origin") : SITE;
const WEB = path.join(__dirname, "..", "..", "web");
const APP_DIR = app.isPackaged ? path.join(process.resourcesPath, "www") : WWW || path.join(WEB, "app");
const ASSETS_DIR = app.isPackaged || WWW ? path.join(APP_DIR, "assets") : path.join(WEB, "assets");
const TYPES = {
  html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8",
  json: "application/json", svg: "image/svg+xml", avif: "image/avif", webp: "image/webp", png: "image/png", jpg: "image/jpeg",
  ico: "image/x-icon", ogg: "audio/ogg", mp4: "video/mp4", otf: "font/otf", ttf: "font/ttf", woff: "font/woff", woff2: "font/woff2",
  txt: "text/plain; charset=utf-8",
};
const WHOLE = 4 << 20;   // an answer up to this size is read in one go; a longer one (a movie, the music) is streamed

protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } }]);
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");   // music and movies start as the game says

const plain = (status, text) => new Response(text, { status, headers: { "Content-Type": "text/plain" } });

// A byte range, as server.py reads it: [first, last], or null for the whole file.
function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec((header || "").trim());
  if (!m || (!m[1] && !m[2])) return null;
  const a = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const b = m[1] && m[2] ? Number(m[2]) : size - 1;
  return a < size && a <= b ? [a, Math.min(b, size - 1)] : null;
}

// The updates (updater.js), kept in the app's data folder beside the saves. What the app was built with is named by
// bundled.json (web-dev/tools/app_manifest.py writes it into the app's files): updates made for another build are dropped.
let updater = null;
function loadUpdater() {
  let bundle = "unpackaged";
  try { const m = JSON.parse(fs.readFileSync(path.join(APP_DIR, "bundled.json"), "utf8")); bundle = `${m.version}-${m.assets.md5}`; } catch { /* no description: no updates are offered */ }
  const net = () => session.fromPartition("update");   // a session of its own, in memory: the page's is cut off from the network
  updater = new Updater({ dir: path.join(app.getPath("userData"), "update"), origin: ORIGIN, bundle, fetch: (url, options) => net().fetch(url, options) });
  try { updater.load(); } catch (e) { console.error("updates:", e.message); }
}

async function serve(request) {
  let url, rel;
  try { url = new URL(request.url); rel = decodeURIComponent(url.pathname); } catch { return plain(400, "bad request"); }
  if (url.host !== HOST) return plain(403, "forbidden");
  if (request.method !== "GET" && request.method !== "HEAD") return plain(405, "method not allowed");
  if (rel === "/") rel = "/index.html";
  const [base, name] = rel.startsWith("/assets/") ? [ASSETS_DIR, rel.slice(8)] : [APP_DIR, rel.slice(1)];
  // the update in use has the file: that one; else the app's own
  const full = updater?.fileFor(rel.slice(1)) || path.normalize(path.join(base, name));
  if (!full.startsWith(base + path.sep) && !full.startsWith(updater?.dir + path.sep)) return plain(404, "not found");
  let size;
  try {
    const st = await fs.promises.stat(full);
    if (!st.isFile()) return plain(404, "not found");
    size = st.size;
  } catch { return plain(404, "not found"); }

  const range = parseRange(request.headers.get("Range"), size);
  const [a, b] = range || [0, size - 1];
  const length = b - a + 1;
  const headers = {
    "Content-Type": TYPES[path.extname(full).slice(1).toLowerCase()] || "application/octet-stream",
    "Content-Length": String(length),
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-cache",
  };
  if (range) headers["Content-Range"] = `bytes ${a}-${b}/${size}`;
  const status = range ? 206 : 200;
  if (request.method === "HEAD" || length <= 0) return new Response(null, { status, headers });
  if (length <= WHOLE) {
    if (!range) return new Response(await fs.promises.readFile(full), { status, headers });
    const fh = await fs.promises.open(full, "r");
    try {
      const buf = Buffer.allocUnsafe(length);
      const { bytesRead } = await fh.read(buf, 0, length, a);
      return new Response(buf.subarray(0, bytesRead), { status, headers });
    } finally { await fh.close(); }
  }
  return new Response(Readable.toWeb(fs.createReadStream(full, { start: a, end: b, highWaterMark: 1 << 20 })), { status, headers });
}

let win = null;
let closing = false;   // the app or its window has begun to close

// What the page asks of the app (preload.js; the commands and their answers are listed in web/app/js/apphost.js).
const host = {
  info: () => ({ kind: "desktop", shell: SHELL, version: app.getVersion(), update: updater.info() }),
  // a web page, in the computer's own browser
  open: ({ url }) => { outside(String(url)); return {}; },
  // An exported save: the system's own question of where to put it, then written there.
  saveFile: async ({ name, data }) => {
    if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/.test(name) || typeof data !== "string" || data.length > 24 << 20) throw Error("not a file to save");
    let to = TEST_DIR ? path.join(TEST_DIR, name) : null;
    if (!to) {
      const asked = await dialog.showSaveDialog(win, { title: "Export save data", defaultPath: path.join(app.getPath("downloads"), name) });
      // A dialog still open when the app closes is taken down with it, and then answers as if Save had been pressed, with the
      // name it opened on (seen on macOS, 2026-11-13: quitting with the dialog up wrote over a savedata000 already in Downloads,
      // with no "Replace?" asked). Nothing is written once the app has begun to close: only a press of Save writes.
      if (closing || asked.canceled || !asked.filePath || !win || win.isDestroyed()) return { saved: false };
      to = asked.filePath;
    }
    await fs.promises.writeFile(to, Buffer.from(data, "base64"));
    return { saved: true, name: path.basename(to) };
  },
  fetchText: (args) => updater.fetchText(args),
  stage: (args, tell) => updater.stage(args, tell),
  cancel: () => { updater.cancel(); return {}; },
  apply: (args) => updater.apply(args),
  confirm: () => { updater.confirm(); return {}; },
};
// A link to a web site opens in the computer's own browser; anything else goes nowhere.
function outside(target) {
  if (!/^https:\/\//i.test(target)) return;
  if (TEST_DIR) fs.appendFileSync(path.join(TEST_DIR, "opened.txt"), target + "\n"); else shell.openExternal(target);
}

function createWindow() {
  closing = false;
  // A 16:9 window as large as fits comfortably, up to 1600 x 900; the game goes full screen itself on the first click (F leaves it).
  const area = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.max(640, Math.min(1600, Math.floor((area.width * 0.85) / 16) * 16, Math.floor((area.height * 0.85) / 9) * 16));
  win = new BrowserWindow({
    width, height: (width / 16) * 9, minWidth: 640, minHeight: 360, useContentSize: true, center: true,
    title: "Tsukihime", backgroundColor: "#000000", show: false, autoHideMenuBar: true,
    icon: process.platform === "linux" && app.isPackaged ? path.join(process.resourcesPath, "icon.png") : undefined,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, preload: path.join(__dirname, "preload.js"),
      devTools: !app.isPackaged || process.argv.includes("--devtools") },
  });
  win.once("ready-to-show", () => win.show());
  win.on("page-title-updated", (e) => e.preventDefault());
  win.on("closed", () => { win = null; });
  // Closing the window is leaving the game, and a closing window does not give the page its pagehide: so the page is
  // asked for the saves it makes there (main.js appSuspend: the automatic save, the read marks, the unlocks) and the
  // window closes once it has answered (or after 2 s, should the page be stuck).
  let leaving = false;
  win.on("close", (e) => {
    closing = true;
    if (leaving) return;
    e.preventDefault();
    leaving = true;
    const saved = win.webContents.executeJavaScript("globalThis.appSuspend && globalThis.appSuspend(), 1").catch(() => {});
    Promise.race([saved, new Promise((ok) => setTimeout(ok, 2000))]).then(() => { if (win && !win.isDestroyed()) win.close(); });
  });

  // Alt+F4 closes the window (through the saves above) whatever the page does with the key: the game takes every key
  // itself during its fades and the story's locked moments (main.js, ui.js), and in this window a key the page keeps
  // also keeps Windows' own Alt+F4 from closing it. Seen here, before the page has it.
  if (process.platform !== "darwin") {
    win.webContents.on("before-input-event", (e, input) => {
      if (input.type === "keyDown" && input.key === "F4" && input.alt && !input.control && !input.shift && !input.meta) { e.preventDefault(); win.close(); }
    });
  }

  // No leaving the game: a link to a web site opens in the computer's own browser, anything else goes nowhere.
  win.webContents.setWindowOpenHandler(({ url }) => { outside(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, target) => { if (!target.startsWith(HOME)) { e.preventDefault(); outside(target); } });

  // The screen stays awake while the game is in front (auto mode and the movies have no key presses to keep it so).
  let awake = null;
  const keepAwake = (on) => {
    if (on && awake === null) awake = powerSaveBlocker.start("prevent-display-sleep");
    else if (!on && awake !== null) { powerSaveBlocker.stop(awake); awake = null; }
  };
  win.on("focus", () => keepAwake(true));
  win.on("blur", () => keepAwake(false));
  win.on("closed", () => keepAwake(false));

  if (process.argv.includes("--mute")) win.webContents.setAudioMuted(true);   // for testing
  if (process.argv.includes("--devtools")) win.webContents.openDevTools({ mode: "detach" });
  win.loadURL(HOME);
}

if (!app.requestSingleInstanceLock()) app.quit();   // one copy at a time: two would overwrite each other's saves
else {
  app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    loadUpdater();
    protocol.handle("app", (request) => serve(request).catch((e) => plain(500, String(e))));
    // The page's requests of the app: from the game's own page only, and only the commands above.
    ipcMain.handle("host", async (event, name, args) => {
      if (!event.senderFrame || !String(event.senderFrame.url).startsWith(HOME) || !Object.hasOwn(host, name)) throw Error("not available");
      return host[name](args && typeof args === "object" ? args : {}, (value) => { if (!event.sender.isDestroyed()) event.sender.send("host-event", value); });
    });
    // Nothing of the page's goes to the network, and it is given nothing it does not use (camera, location, notifications...).
    const ses = session.defaultSession;
    ses.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] }, (details, done) => done({ cancel: true }));
    const allowed = new Set(["fullscreen", "keyboardLock", "pointerLock"]);
    ses.setPermissionRequestHandler((contents, permission, done) => done(allowed.has(permission)));
    ses.setPermissionCheckHandler((contents, permission) => allowed.has(permission));
    // The game's keys are the page's own (keys.js); the default menu's shortcuts (reload, zoom, close) would get in their way.
    Menu.setApplicationMenu(process.platform === "darwin" ? Menu.buildFromTemplate([{ role: "appMenu" }, { role: "windowMenu" }]) : null);
    createWindow();
    app.on("activate", () => { if (!win) createWindow(); });
  });
  app.on("before-quit", () => { closing = true; });
  // The saves are in the page's localStorage, under the app's own data folder: written to disk before the app ends.
  app.on("window-all-closed", () => { session.defaultSession.flushStorageData(); app.quit(); });
}
