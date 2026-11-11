// main.js - the web port as a desktop app (Windows, macOS, Linux): one window showing web/app, with everything it
// plays inside the app. The page lives at app://tsukihime.desktop/, a name that never reaches the network: every
// request to it is answered here from the files next to the app (resources/www = web/app, resources/www/assets =
// web/assets), and any other address is refused. Run from this folder without packaging (npm start), it reads
// ../../web directly.
const { app, BrowserWindow, Menu, powerSaveBlocker, protocol, screen, session, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");

const HOST = "tsukihime.desktop";            // home.js knows this name: the app opens on the game, not the site's opening page
const HOME = `app://${HOST}/`;
const WEB = path.join(__dirname, "..", "..", "web");
const APP_DIR = app.isPackaged ? path.join(process.resourcesPath, "www") : path.join(WEB, "app");
const ASSETS_DIR = app.isPackaged ? path.join(process.resourcesPath, "www", "assets") : path.join(WEB, "assets");
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

async function serve(request) {
  let url, rel;
  try { url = new URL(request.url); rel = decodeURIComponent(url.pathname); } catch { return plain(400, "bad request"); }
  if (url.host !== HOST) return plain(403, "forbidden");
  if (request.method !== "GET" && request.method !== "HEAD") return plain(405, "method not allowed");
  if (rel === "/") rel = "/index.html";
  const [base, name] = rel.startsWith("/assets/") ? [ASSETS_DIR, rel.slice(8)] : [APP_DIR, rel.slice(1)];
  const full = path.normalize(path.join(base, name));
  if (!full.startsWith(base + path.sep)) return plain(404, "not found");
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

function createWindow() {
  // A 16:9 window as large as fits comfortably, up to 1600 x 900; the game goes full screen itself on the first click (F leaves it).
  const area = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.max(640, Math.min(1600, Math.floor((area.width * 0.85) / 16) * 16, Math.floor((area.height * 0.85) / 9) * 16));
  win = new BrowserWindow({
    width, height: (width / 16) * 9, minWidth: 640, minHeight: 360, useContentSize: true, center: true,
    title: "Tsukihime", backgroundColor: "#000000", show: false, autoHideMenuBar: true,
    icon: process.platform === "linux" && app.isPackaged ? path.join(process.resourcesPath, "icon.png") : undefined,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, devTools: !app.isPackaged || process.argv.includes("--devtools") },
  });
  win.once("ready-to-show", () => win.show());
  win.on("page-title-updated", (e) => e.preventDefault());
  win.on("closed", () => { win = null; });
  // Closing the window is leaving the game, and a closing window does not give the page its pagehide: so the page is
  // asked for the saves it makes there (main.js appSuspend: the automatic save, the read marks, the unlocks) and the
  // window closes once it has answered (or after 2 s, should the page be stuck).
  let leaving = false;
  win.on("close", (e) => {
    if (leaving) return;
    e.preventDefault();
    leaving = true;
    const saved = win.webContents.executeJavaScript("globalThis.appSuspend && globalThis.appSuspend(), 1").catch(() => {});
    Promise.race([saved, new Promise((ok) => setTimeout(ok, 2000))]).then(() => { if (win && !win.isDestroyed()) win.close(); });
  });

  // No leaving the game: a link to a web site opens in the computer's own browser, anything else goes nowhere.
  const outside = (target) => { if (/^https:\/\//i.test(target)) shell.openExternal(target); };
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
    protocol.handle("app", (request) => serve(request).catch((e) => plain(500, String(e))));
    // Nothing goes to the network, and the page is given nothing it does not use (camera, location, notifications...).
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
  // The saves are in the page's localStorage, under the app's own data folder: written to disk before the app ends.
  app.on("window-all-closed", () => { session.defaultSession.flushStorageData(); app.quit(); });
}
