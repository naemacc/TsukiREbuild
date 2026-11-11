function getRange(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || size === 0) return null;

  const offset = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset >= size || end < offset) return null;
  return { offset, length: end - offset + 1 };
}

// The game's converted media (voices, pictures, sounds, music, movies, the game's font) are made once from the dump and
// do not change with the code, and they are nearly every request a player makes: a browser keeps them for 30 days without
// asking again, so a returning player costs no Worker requests or R2 reads for what they already have. The scripts, the
// tables and the interface art, which do change with the code, keep the short lifetime and so update by themselves.
// A media file that is ever converted again reaches players who have it within those 30 days, or at once under a new name.
// The sound packs and their index are named by their content (assets/pack/<kind>-<hash>.pack, index-<hash>.json): kept as long. The one
// file that names the index in use, assets/pack/index.json, is not.
const MEDIA = /^assets\/((voice|img|se|bgm|movie|sys|fonts)\/|pack\/[a-z]+-[0-9a-f]{10}\.)/;
const MEDIA_CACHE = "public, max-age=2592000, immutable";

export default {
  async fetch(request, { GAME, ASSETS }) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
    }

    let path;
    try {
      path = decodeURIComponent(new URL(request.url).pathname);
    } catch {
      return new Response(null, { status: 400 });
    }

    if (!path.startsWith("/assets/")) return ASSETS.fetch(request);
    const key = path.slice(1);
    const rangeHeader = request.method === "GET" ? request.headers.get("Range") : null;
    let range;
    if (rangeHeader) {
      const meta = await GAME.head(key);
      if (!meta) return new Response(null, { status: 404 });

      const ifRange = request.headers.get("If-Range");
      if (!ifRange || ifRange === meta.httpEtag || Date.parse(ifRange) >= Math.floor(meta.uploaded.getTime() / 1000) * 1000) {
        range = getRange(rangeHeader, meta.size);
        if (!range) {
          return new Response(null, { status: 416, headers: { "Content-Range": "bytes */" + meta.size } });
        }
      }
    }

    const object = request.method === "HEAD"
      ? await GAME.head(key)
      : await GAME.get(key, range ? { range } : undefined);
    if (!object) return new Response(null, { status: 404 });

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("Cache-Control", MEDIA.test(key) ? MEDIA_CACHE : "public, max-age=300");
    headers.set("ETag", object.httpEtag);
    headers.set("Last-Modified", object.uploaded.toUTCString());
    headers.set("Accept-Ranges", "bytes");
    headers.set("X-Content-Type-Options", "nosniff");

    const etags = request.headers.get("If-None-Match")?.split(",") ?? [];
    if (etags.some(value => value.trim() === "*" || value.trim().replace(/^W\//, "") === object.httpEtag)) {
      await object.body?.cancel();
      return new Response(null, { status: 304, headers });
    }

    headers.set("Content-Length", String(range ? range.length : object.size));
    if (range) {
      const end = range.offset + range.length - 1;
      headers.set("Content-Range", `bytes ${range.offset}-${end}/${object.size}`);
    }
    return new Response(object.body ?? null, { status: range ? 206 : 200, headers });
  }
};
