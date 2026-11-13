package date.arcueid.tsukirebuild;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * The app's side of an update (web/app/js/update.js decides what is wanted; apphost.js lists the commands). The same
 * as the desktop app's updater.js, which says more.
 *
 * Updates are kept in the app's own storage, one folder a version:
 *   update/state.json        which one is in use, which was before it, whether it has come up, which were given up
 *   update/[id]/files/...    the files of update [id], under the paths the page asks for them by
 *   update/[id]/meta.json    what [id] is: written when it is switched to, with every file's size and hash
 * A request is answered from the update in use where it has the file (fileFor), from the APK otherwise. A folder is
 * filled file by file, each downloaded beside its place, checked against its size and hash and only then given its
 * name; nothing looks into it until state.json names it, and state.json is replaced in one step. So the app is always
 * wholly on one version, and an update cut off halfway has changed nothing. Downloads come from one address, origin.
 *
 * A version that does not come up (the page never confirms it) twice running is taken out again, the one before it is
 * back, and its name is kept in "rejected". Everything is dropped when the APK is another one than the updates were
 * made for (bundle).
 */
final class Updates {
    interface Progress { void at(long done, long total); }

    private static final Pattern SAFE_PATH = Pattern.compile("[A-Za-z0-9_][A-Za-z0-9_.-]*(/[A-Za-z0-9_][A-Za-z0-9_.-]*)*");
    private static final Pattern QUERY = Pattern.compile("h=[0-9a-f]{1,64}");
    private static final Pattern ID = Pattern.compile("[0-9a-f]{12}-[0-9a-f]{8}");
    private static final Pattern HASH = Pattern.compile("[0-9a-f]{32}|[0-9a-f]{64}");   // MD5 for the game's files, SHA-256 for the page's
    private static final Pattern VERSION = Pattern.compile("[0-9a-f]{12}");
    private static final Pattern MD5 = Pattern.compile("[0-9a-f]{32}");
    private static final int TEXT_MOST = 4 << 20, TRIES = 2, CONNECT = 15000, STALL = 30000;
    private static final long FILE_MOST = 1L << 31;

    private final File dir;
    private final String origin, bundle;
    private JSONObject state;
    private JSONObject meta;                                      // the update in use, or null
    private volatile Map<String, File> served = Collections.emptyMap();   // its files, for the threads that answer requests
    private volatile boolean stopped;
    private volatile HttpURLConnection live;
    private boolean busy;

    Updates(File dir, String origin, String bundle) {
        this.dir = dir;
        this.origin = origin.endsWith("/") ? origin.substring(0, origin.length() - 1) : origin;
        this.bundle = bundle;
        this.state = fresh();
    }

    // ---- small things -------------------------------------------------------------------------------------------
    private JSONObject fresh() {
        try {
            return new JSONObject().put("bundle", bundle).put("current", JSONObject.NULL).put("previous", JSONObject.NULL)
                    .put("confirmed", true).put("tries", 0).put("rejected", new JSONArray());
        } catch (JSONException e) { throw new IllegalStateException(e); }
    }

    private static boolean is(Pattern p, String s) { return s != null && p.matcher(s).matches(); }
    private String current() { return state.isNull("current") ? null : state.optString("current", null); }
    private String previous() { return state.isNull("previous") ? null : state.optString("previous", null); }
    private File folder(String id) { return new File(dir, id); }
    private File place(String id, String rel) { return new File(new File(folder(id), "files"), rel); }

    private static String hex(byte[] b) {
        StringBuilder s = new StringBuilder(b.length * 2);
        for (byte x : b) s.append(Character.forDigit((x >> 4) & 15, 16)).append(Character.forDigit(x & 15, 16));
        return s.toString();
    }

    private static MessageDigest digest(String hash) {
        try { return MessageDigest.getInstance(hash.length() == 32 ? "MD5" : "SHA-256"); }
        catch (java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }

    private static String hashFile(File f, String like) throws IOException {
        MessageDigest d = digest(like);
        byte[] buf = new byte[1 << 16];
        try (FileInputStream in = new FileInputStream(f)) { for (int n; (n = in.read(buf)) > 0; ) d.update(buf, 0, n); }
        return hex(d.digest());
    }

    private static byte[] readAll(File f) throws IOException {
        try (FileInputStream in = new FileInputStream(f)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[1 << 16];
            for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
            return out.toByteArray();
        }
    }

    /** A file written whole or not at all: beside its place first, flushed, then renamed over it. */
    private static void writeWhole(File f, String text) throws IOException {
        File tmp = new File(f.getPath() + ".tmp");
        f.getParentFile().mkdirs();
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(text.getBytes(StandardCharsets.UTF_8));
            out.getFD().sync();
        }
        if (!tmp.renameTo(f)) throw new IOException("could not write " + f);
    }

    private static void remove(File f) {
        File[] inside = f.listFiles();
        if (inside != null) for (File c : inside) remove(c);
        f.delete();
    }

    private void drop(String id) { if (is(ID, id)) remove(folder(id)); }
    private void save() throws IOException { writeWhole(new File(dir, "state.json"), state.toString()); }

    /** An update as it was recorded, if every file of it is there at its size; else null. */
    private JSONObject read(String id) {
        try {
            if (!is(ID, id)) return null;
            JSONObject m = new JSONObject(new String(readAll(new File(folder(id), "meta.json")), StandardCharsets.UTF_8));
            if (!id.equals(m.optString("id"))) return null;
            JSONObject files = m.getJSONObject("files");
            for (Iterator<String> k = files.keys(); k.hasNext(); ) {
                String rel = k.next();
                File f = place(id, rel);
                if (!is(SAFE_PATH, rel) || !f.isFile() || f.length() != files.getJSONArray(rel).getLong(0)) return null;
            }
            return m;
        } catch (IOException | JSONException e) { return null; }
    }

    private void use(JSONObject m) throws JSONException {
        Map<String, File> map = new HashMap<>();
        if (m != null) {
            String id = m.getString("id");
            for (Iterator<String> k = m.getJSONObject("files").keys(); k.hasNext(); ) { String rel = k.next(); map.put(rel, place(id, rel)); }
        }
        meta = m;
        served = map;
    }

    /** The version tried twice without coming up, or broken on disk: out, the one before it back, and not offered again by itself. */
    private void giveUp() throws JSONException {
        String cur = current();
        if (cur != null) {
            JSONArray old = state.optJSONArray("rejected"), kept = new JSONArray();
            List<String> names = new ArrayList<>();
            if (old != null) for (int i = 0; i < old.length(); i++) if (is(ID, old.optString(i)) && !cur.equals(old.optString(i))) names.add(old.optString(i));
            names.add(cur);
            for (String n : names.subList(Math.max(0, names.size() - 8), names.size())) kept.put(n);
            state.put("rejected", kept);
            drop(cur);
        }
        String before = previous();
        state.put("current", read(before) != null ? before : JSONObject.NULL).put("previous", JSONObject.NULL).put("confirmed", true).put("tries", 0);
    }

    // ---- what the app asks ---------------------------------------------------------------------------------------
    /** Once, as the app starts. */
    synchronized void load() {
        try {
            JSONObject s = null;
            try { s = new JSONObject(new String(readAll(new File(dir, "state.json")), StandardCharsets.UTF_8)); } catch (IOException | JSONException none) { /* as built */ }
            if (s == null || !bundle.equals(s.optString("bundle"))) {
                // No update has been switched to yet (what a download left is kept: it is checked file by file when it
                // goes on). Or the APK is another one than the updates were made for: it is the newer, and they go.
                if (s != null) remove(dir);
                state = fresh();
                use(null);
                return;
            }
            state = s;
            if (state.optJSONArray("rejected") == null) state.put("rejected", new JSONArray());
            if (current() != null && !state.optBoolean("confirmed", true)) {
                if (state.optInt("tries", 0) >= TRIES) giveUp(); else state.put("tries", state.optInt("tries", 0) + 1);
            }
            if (current() != null && read(current()) == null) giveUp();
            use(current() != null ? read(current()) : null);
            save();
        } catch (IOException | JSONException e) {
            state = fresh();
            served = Collections.emptyMap();
            meta = null;
        }
    }

    /** The file to answer a request for rel ("js/main.js", "assets/img/X.avif") with, when the update in use has one. */
    File fileFor(String rel) { return served.get(rel); }

    synchronized JSONObject info() throws JSONException {
        JSONObject out = new JSONObject();
        out.put("current", meta != null ? meta : JSONObject.NULL);
        out.put("rejected", state.optJSONArray("rejected") != null ? state.optJSONArray("rejected") : new JSONArray());
        return out;
    }

    /** The page has come up in the version in use: it stays, and the one before it is not needed any more. */
    synchronized void confirm() throws IOException, JSONException {
        if (state.optBoolean("confirmed", true)) return;
        String old = previous();
        state.put("confirmed", true).put("tries", 0).put("previous", JSONObject.NULL);
        save();
        if (old != null && !old.equals(current())) drop(old);
    }

    private String address(String from) throws IOException {
        String[] parts = from == null ? new String[0] : from.split("\\?", -1);
        if (parts.length < 1 || parts.length > 2 || !is(SAFE_PATH, parts[0]) || (parts.length == 2 && !is(QUERY, parts[1]))) throw new IOException("not a path of the site's: " + from);
        return origin + "/" + from;
    }

    /** One download, its bytes handed to each piece by piece. Stops when nothing has come for STALL ms, or on cancel(). */
    private interface Piece { void take(byte[] buf, int n) throws IOException; }

    private void get(String url, long most, Piece each) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        live = c;
        try {
            c.setConnectTimeout(CONNECT);
            c.setReadTimeout(STALL);
            c.setInstanceFollowRedirects(false);
            c.setUseCaches(false);
            if (stopped) throw new IOException("stopped");
            if (c.getResponseCode() != 200) throw new IOException(url + ": HTTP " + c.getResponseCode());
            long size = 0;
            byte[] buf = new byte[1 << 16];
            try (InputStream in = c.getInputStream()) {
                for (int n; (n = in.read(buf)) > 0; ) {
                    if (stopped) throw new IOException("stopped");
                    size += n;
                    if (size > most) throw new IOException(url + ": larger than expected");
                    each.take(buf, n);
                }
            }
        } finally {
            live = null;
            c.disconnect();
        }
    }

    /** A text file of the site's, checked against hash when one is given. */
    String fetchText(String from, String hash) throws IOException {
        if (hash != null && !is(HASH, hash)) throw new IOException("not a hash");
        stopped = false;
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        get(address(from), TEXT_MOST, (buf, n) -> out.write(buf, 0, n));
        byte[] all = out.toByteArray();
        if (hash != null && !hex(digest(hash).digest(all)).equals(hash)) throw new IOException(from + ": not the file the site lists");
        return new String(all, StandardCharsets.UTF_8);
    }

    /**
     * Fills update id's folder with files ([{ path, from, size, hash }]): a file already there, or held by the update
     * in use, is checked and kept; the others are downloaded. progress: the bytes downloaded, of those to download.
     */
    void stage(String id, JSONArray files, Progress progress) throws IOException, JSONException {
        synchronized (this) {
            if (busy) throw new IOException("an update is being downloaded already");
            if (!is(ID, id) || files == null) throw new IOException("not an update");
            if (id.equals(current())) throw new IOException("that update is in use");
            busy = true;
            stopped = false;
        }
        try {
            for (int i = 0; i < files.length(); i++) {
                JSONObject f = files.getJSONObject(i);
                long size = f.optLong("size", -1);
                if (!is(SAFE_PATH, f.optString("path", null)) || !is(HASH, f.optString("hash", null)) || size < 0 || size > FILE_MOST) throw new IOException("not an update's file: " + f.optString("path"));
                address(f.optString("from", null));
            }
            // room is kept for the version in use, the one before it while that may still be gone back to, and this one
            dir.mkdirs();
            String[] names = dir.list();
            if (names != null) for (String name : names) if (is(ID, name) && !name.equals(id) && !name.equals(current()) && !name.equals(previous())) drop(name);
            List<JSONObject> wanted = new ArrayList<>();
            long total = 0;
            JSONObject held = meta != null ? meta.getJSONObject("files") : null;
            for (int i = 0; i < files.length(); i++) {
                JSONObject f = files.getJSONObject(i);
                String rel = f.getString("path"), hash = f.getString("hash");
                File dest = place(id, rel);
                if (dest.isFile() && dest.length() == f.getLong("size") && hashFile(dest, hash).equals(hash)) continue;   // (from a download that was cut off)
                dest.getParentFile().mkdirs();
                if (held != null && held.has(rel) && hash.equals(held.getJSONArray(rel).getString(1))) {
                    File part = new File(dest.getPath() + ".part");
                    copy(place(meta.getString("id"), rel), part);
                    if (hashFile(part, hash).equals(hash) && part.renameTo(dest)) continue;
                    part.delete();
                }
                wanted.add(f);
                total += f.getLong("size");
            }
            final long all = total;
            final long[] done = { 0 }, told = { 0 };
            if (progress != null) progress.at(0, all);
            for (JSONObject f : wanted) {
                if (stopped) throw new IOException("stopped");
                String rel = f.getString("path"), hash = f.getString("hash");
                long want = f.getLong("size");
                File dest = place(id, rel), part = new File(dest.getPath() + ".part");
                MessageDigest d = digest(hash);
                long before = done[0];
                try (FileOutputStream out = new FileOutputStream(part)) {
                    get(address(f.getString("from")), want, (buf, n) -> {
                        out.write(buf, 0, n);
                        d.update(buf, 0, n);
                        done[0] += n;
                        long now = System.currentTimeMillis();
                        if (progress != null && now - told[0] > 100) { told[0] = now; progress.at(done[0], all); }
                    });
                    out.getFD().sync();
                } catch (IOException e) {
                    part.delete();
                    throw stopped ? new IOException("stopped") : e;
                }
                if (done[0] - before != want || !hex(d.digest()).equals(hash)) { part.delete(); throw new IOException(rel + ": not the file the site lists"); }
                if (!part.renameTo(dest)) throw new IOException("could not keep " + rel);
            }
            if (progress != null) progress.at(done[0], all);
        } finally {
            synchronized (this) { busy = false; }
        }
    }

    private static void copy(File from, File to) throws IOException {
        byte[] buf = new byte[1 << 16];
        try (FileInputStream in = new FileInputStream(from); FileOutputStream out = new FileOutputStream(to)) {
            for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
            out.getFD().sync();
        }
    }

    /** Stops the download under way. */
    void cancel() {
        stopped = true;
        HttpURLConnection c = live;
        if (c != null) c.disconnect();
    }

    /** Switches to update id, whose files stage() has brought: m = { id, time, version, assets, files: { path: [size, hash] } }. */
    synchronized void apply(String id, JSONObject m) throws IOException, JSONException {
        if (busy) throw new IOException("an update is being downloaded");
        if (!is(ID, id) || m == null || !id.equals(m.optString("id")) || m.optJSONObject("files") == null) throw new IOException("not an update");
        if (!m.has("time") || Double.isNaN(m.optDouble("time")) || !is(VERSION, m.optString("version", null)) || !is(MD5, m.optString("assets", null))) throw new IOException("not an update");
        JSONObject given = m.getJSONObject("files"), files = new JSONObject();
        for (Iterator<String> k = given.keys(); k.hasNext(); ) {
            String rel = k.next();
            JSONArray entry = given.optJSONArray(rel);
            if (!is(SAFE_PATH, rel) || entry == null || !is(HASH, entry.optString(1, null))) throw new IOException("not an update's file: " + rel);
            File f = place(id, rel);
            if (!f.isFile() || f.length() != entry.getLong(0)) throw new IOException(rel + " has not been downloaded");
            files.put(rel, new JSONArray().put(entry.getLong(0)).put(entry.getString(1)));
        }
        JSONObject kept = new JSONObject().put("id", id).put("time", m.getLong("time")).put("version", m.getString("version"))
                .put("assets", m.getString("assets")).put("files", files);
        writeWhole(new File(folder(id), "meta.json"), kept.toString());
        // (the one before stays until this one has come up; an unconfirmed one in between is not gone back to)
        String cur = current();
        if (!id.equals(cur)) {
            if (state.optBoolean("confirmed", true)) {
                String before = previous();
                if (before != null && !before.equals(id)) drop(before);
                state.put("previous", cur != null ? cur : JSONObject.NULL);
            } else if (cur != null) drop(cur);
        }
        state.put("current", id).put("confirmed", false).put("tries", 1);
        save();   // the switch
        use(kept);
    }
}
