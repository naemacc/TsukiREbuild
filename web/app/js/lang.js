// lang.js - the language the game is played in: English (the translation, what the port's files are made from) or Japanese (the original game).
//
// Japanese is not a second copy of the game. web/assets/ja holds only what the original has that the translation changed (web-dev/tools/build_ja.py): the
// dialogue lines, the scripts the translation rewrote, the system's words, and the interface art, pictures and movies that carry text. ja/index.json lists
// those files, and asset() gives the Japanese file's address where there is one and the shared file's everywhere else.
//
// The language is chosen on the opening page (home.js, PLAY ONLINE) and kept in this browser. It is read once, as the page loads: every table is fetched in
// that language from the start, so changing it loads the page again. `?lang=ja` (or en) in the address chooses it for that visit, and is how the Android and
// desktop apps, which have no opening page, can be opened in Japanese.
export const LANGS = ["en", "ja"];
const KEY = "tsuki.lang";

export function storedLang(storage = globalThis.localStorage) {
  try { const v = storage?.getItem(KEY); return LANGS.includes(v) ? v : "en"; } catch { return "en"; }
}
export function langOf(search = "", storage = globalThis.localStorage) {
  const asked = new URLSearchParams(search).get("lang");
  return LANGS.includes(asked) ? asked : storedLang(storage);
}
export const LANG = langOf(globalThis.location?.search || "");
export const JA = LANG === "ja";

// Keeps the choice for the next load. Returns whether it is another language than the one this page was loaded in.
export function chooseLang(lang, storage = globalThis.localStorage) {
  if (!LANGS.includes(lang)) return false;
  try { storage?.setItem(KEY, lang); } catch { /* kept for this visit only */ }
  return lang !== LANG;
}

// What Japanese has of its own: paths under /assets/ja/.
let own = new Set();
export function setOwn(files) { own = new Set(files || []); }
export const has = (rel) => own.has(rel);
// The address to ask for: a file under /assets/ is the one of the same path under /assets/ja/ when Japanese has it.
export function asset(url) {
  if (!own.size || !url.startsWith("/assets/")) return url;
  const rel = url.slice(8);
  return own.has(rel) ? `/assets/ja/${rel}` : url;
}

// Resolved once the list is in (at once in English). A list that does not come leaves the game in the translation's files.
export const langReady = (async () => {
  if (!JA || typeof fetch !== "function") return;
  try {
    const r = await fetch("/assets/ja/index.json");
    if (r.ok) setOwn((await r.json()).files);
  } catch { /* the shared files */ }
  if (typeof document !== "undefined") {
    document.documentElement.lang = "ja";
    document.documentElement.classList.add("ja");
    localizeStyles();
  }
})();

// The style sheets name interface art by its shared address (the text window, the wait marks, the save rows ...). Each such picture Japanese has of its own is
// named again here, rule by rule.
const ART = /url\((["']?)(?:https?:\/\/[^\/"')]+)?(\/assets\/[^"')]+)\1\)/g;   // (a browser may give the address back whole)
export function localizeStyles(doc = document) {
  const walk = (rules) => {
    for (const rule of rules) {
      if (rule.cssRules && !rule.style) { walk(rule.cssRules); continue; }
      if (!rule.style) continue;
      for (const prop of ["background-image", "border-image-source"]) {
        const v = rule.style.getPropertyValue(prop);
        if (!v || !v.includes("/assets/")) continue;
        const next = v.replace(ART, (m, q, url) => `url("${asset(url)}")`);
        if (next !== v) rule.style.setProperty(prop, next, rule.style.getPropertyPriority(prop));
      }
      if (rule.cssRules) walk(rule.cssRules);
    }
  };
  for (const sheet of doc.styleSheets) {
    try { walk(sheet.cssRules); } catch { /* a sheet from elsewhere */ }
  }
}
