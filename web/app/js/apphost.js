// apphost.js - the page inside the Android or the desktop app (web-dev/android, web-dev/desktop).
//
// The apps show the same page as the site, from their own files, at an address of their own (APP_HOSTS), with no browser around it. What a browser
// does for a page the app has to do itself, and the page asks for it here: saving a file where the player chooses (SAVE DATA's Export), opening a
// link in the system's browser, and fetching and installing an update (update.js). connect() is the app's side of that, or null in a browser,
// where none of it is needed. (The Android app is in landscape throughout, so its opening page is never the upright one.)
//
// Both apps answer the same commands (MainActivity.java `invoke`, desktop/main.js `host`), each with one object of arguments:
//   info         {}                              -> { kind, shell, version, update: { current: { id, time, version, assets, files } | null, rejected: [id] } }
//   open         { url }                         a web page, in the system's browser
//   saveFile     { name, data }                  data in base64; -> { saved, name } once the player has chosen a place, or closed the question
//   fetchText    { path, hash }                  a text file of the site's, checked against `hash` when one is given
//   stage        { id, files }                   downloads what update `id` needs and has not got; progress comes as events { done, total }
//   cancel       {}                              stops that
//   apply        { id, meta }                    switches to update `id`: the page then loads itself again, and is served the new files
//   confirm      {}                              the page has come up: the update it runs is kept
export const APP_HOSTS = { "appassets.androidplatform.net": "android", "tsukihime.desktop": "desktop" };
export const appKind = (host = globalThis.location?.hostname || "") => APP_HOSTS[host] || null;
export const APP = appKind();
// The app this page was written for: a number the Android and the desktop app each carry (SHELL in MainActivity.java and desktop/main.js), raised
// whenever the page comes to need something of the app that an older one does not do. An update is offered only to an app that has at least the
// number it was published with (web-dev/tools/app_manifest.py reads it from here).
export const SHELL = 1;

// The app's side: { kind, call(name, args, onEvent) -> a promise of the answer }, or null outside the apps.
export function connect(g = globalThis) {
  if (g.desktopHost?.invoke) {
    // the desktop app (preload.js): a promise for each command, and one listener for a running command's events
    let listener = null;
    g.desktopHost.onEvent?.((v) => listener?.(v));
    return { kind: "desktop", call: (name, args = {}, onEvent = null) => { if (onEvent) listener = onEvent; return g.desktopHost.invoke(name, args); } };
  }
  if (g.AndroidHost?.invoke) {
    // the Android app: a command goes out with a number, and its answer and events come back to the two functions below under that number
    const waiting = new Map();
    let n = 0;
    g.appHostReply = (call, ok, value) => {
      const w = waiting.get(call);
      if (!w) return;
      waiting.delete(call);
      if (ok) w.done(value); else w.fail(Error(String(value)));
    };
    g.appHostEvent = (call, value) => waiting.get(call)?.onEvent?.(value);
    return { kind: "android", call: (name, args = {}, onEvent = null) => new Promise((done, fail) => {
      const call = ++n;
      waiting.set(call, { done, fail, onEvent });
      try { g.AndroidHost.invoke(call, name, JSON.stringify(args)); } catch (e) { waiting.delete(call); fail(e); }
    }) };
  }
  return null;
}

// (made once, as the page loads: the app's objects are there before any of the page's scripts run)
export const HOST = connect();

// Bytes as base64, the form a file takes on its way to the app.
export function toBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
