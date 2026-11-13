package date.arcueid.tsukirebuild;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.res.AssetFileDescriptor;
import android.content.res.AssetManager;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.util.Log;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.window.OnBackInvokedDispatcher;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.Closeable;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The web port in a WebView, served from the APK. The page lives at https://appassets.androidplatform.net/ (a name
 * that never reaches the network: every request to it is answered here from assets/www, which holds web/app with
 * web/assets under it). Any other address is refused, and the WebView itself is kept off the network.
 *
 * What the page needs of the app it asks for by name (Bridge.invoke; the commands are listed in
 * web/app/js/apphost.js): a place for an exported save, a link opened in the phone's browser, and the update: files
 * newer than the APK's, fetched from the site into the app's storage and answered from there first (Updates). That
 * download is the one thing the app's internet permission is used for. The app is in landscape throughout, its
 * opening page included (the manifest's sensorLandscape).
 */
public class MainActivity extends Activity {
    static final String TAG = "Tsukihime";
    static final String HOST = "appassets.androidplatform.net";
    static final String HOME = "https://" + HOST + "/";
    static final int SHELL = 1;                          // what this app does for the page, as a number (apphost.js SHELL): an update made for a higher one is not taken
    static final String SITE = "https://arcueid.date";   // the one place updates come from
    private static final int ASK_OPEN = 1, ASK_SAVE = 2;
    // For testing, in a debuggable build only: updates from a copy of the site on the computer (adb reverse), given as
    // the extra update_origin when the app is started. No other address is accepted.
    private static final Pattern TEST_ORIGIN = Pattern.compile("http://(127\\.0\\.0\\.1|localhost):\\d+");

    private static Updates updates;                      // one for the app's process: its state is read once, as the app starts
    private final ExecutorService worker = Executors.newSingleThreadExecutor();   // downloads and file writes, off the page's thread
    private WebView web;
    private ValueCallback<Uri[]> chooser;                // the page's file question (Import), until the player has answered
    private byte[] saving;                               // an exported file, until the player has said where it goes
    private int savingCall;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        Window w = getWindow();
        w.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        w.getDecorView().setBackgroundColor(Color.BLACK);
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = w.getAttributes();
            lp.layoutInDisplayCutoutMode = Build.VERSION.SDK_INT >= 30
                    ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                    : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            w.setAttributes(lp);
        }
        boolean debuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        if (debuggable) WebView.setWebContentsDebuggingEnabled(true);
        if (updates == null) {
            String origin = SITE, asked = debuggable ? getIntent().getStringExtra("update_origin") : null;
            if (asked != null && TEST_ORIGIN.matcher(asked).matches()) origin = asked;
            updates = new Updates(new File(getNoBackupFilesDir(), "update"), origin, bundleName());
            updates.load();
        }

        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);                  // saves, settings and unlocks are in localStorage
        s.setMediaPlaybackRequiresUserGesture(false);  // music and movies start as the game says, as on a computer
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setTextZoom(100);                            // the phone's font size must not resize the game's text
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        s.setBlockNetworkLoads(true);                  // the page fetches nothing from the network: the app has the permission for its updates only
        if (Build.VERSION.SDK_INT >= 26) s.setSafeBrowsingEnabled(false);   // (nothing but the app's own page is ever shown)
        web.setWebViewClient(new Assets(getAssets()));
        web.addJavascriptInterface(new Bridge(), "AndroidHost");
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.d(TAG, m.messageLevel() + " " + m.message() + " (" + m.sourceId() + ":" + m.lineNumber() + ")");
                return true;
            }

            // SAVE DATA's Import: the page's file question is the system's own document picker.
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> answer, FileChooserParams params) {
                if (chooser != null) chooser.onReceiveValue(null);
                chooser = answer;
                Intent pick = new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");   // (the game's save has no extension)
                try { startActivityForResult(pick, ASK_OPEN); }
                catch (ActivityNotFoundException e) { chooser = null; answer.onReceiveValue(null); }
                return true;
            }
        });
        setContentView(web);
        hideBars();

        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::back);
        }
        if (saved != null) web.restoreState(saved);
        if (web.getUrl() == null) web.loadUrl(HOME);
    }

    /** What the APK was built with, as bundled.json names it: updates made for another build are dropped (Updates.load). */
    private String bundleName() {
        try (InputStream in = getAssets().open("www/bundled.json")) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
            JSONObject m = new JSONObject(new String(out.toByteArray(), StandardCharsets.UTF_8));
            return m.getString("version") + "-" + m.getJSONObject("assets").getString("md5");
        } catch (Exception e) { return "undescribed"; }   // (no description: the page offers no updates)
    }

    // ---- what the page asks of the app (web/app/js/apphost.js) ---------------------------------------------------
    final class Bridge {
        /** A command and its arguments (JSON). The answer comes back to the page's appHostReply(call, ok, value). */
        @JavascriptInterface
        public void invoke(final int call, final String name, final String args) {
            try {
                final JSONObject a = new JSONObject(args == null || args.isEmpty() ? "{}" : args);
                switch (name) {
                    case "info": {
                        String version = getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
                        reply(call, new JSONObject().put("kind", "android").put("shell", SHELL).put("version", version).put("update", updates.info()).toString());
                        break;
                    }
                    case "open":
                        runOnUiThread(() -> outside(Uri.parse(a.optString("url"))));
                        reply(call, "{}");
                        break;
                    case "saveFile": {
                        final String file = a.optString("name");
                        if (!file.matches("[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}")) throw new IOException("not a file to save");
                        final byte[] data = Base64.decode(a.getString("data"), Base64.DEFAULT);
                        runOnUiThread(() -> askWhere(call, file, data));
                        break;
                    }
                    case "fetchText":
                        worker.execute(() -> {
                            try { reply(call, JSONObject.quote(updates.fetchText(a.optString("path", null), a.isNull("hash") ? null : a.optString("hash", null)))); }
                            catch (Exception e) { fail(call, e); }
                        });
                        break;
                    case "stage":
                        worker.execute(() -> {
                            try {
                                updates.stage(a.optString("id", null), a.optJSONArray("files"), (done, total) -> event(call, "{\"done\":" + done + ",\"total\":" + total + "}"));
                                reply(call, "{\"ok\":true}");
                            } catch (Exception e) { fail(call, e); }
                        });
                        break;
                    case "cancel":
                        updates.cancel();
                        reply(call, "{}");
                        break;
                    case "apply":
                        worker.execute(() -> {
                            try { updates.apply(a.optString("id", null), a.optJSONObject("meta")); reply(call, "{\"ok\":true}"); }
                            catch (Exception e) { fail(call, e); }
                        });
                        break;
                    case "confirm":
                        worker.execute(() -> {
                            try { updates.confirm(); reply(call, "{}"); } catch (Exception e) { fail(call, e); }
                        });
                        break;
                    default:
                        throw new IOException("not available: " + name);
                }
            } catch (Exception e) { fail(call, e); }
        }
    }

    private void toPage(final String script) { runOnUiThread(() -> { if (web != null) web.evaluateJavascript(script, null); }); }
    private void reply(int call, String json) { toPage("globalThis.appHostReply&&appHostReply(" + call + ",true," + json + ")"); }
    private void event(int call, String json) { toPage("globalThis.appHostEvent&&appHostEvent(" + call + "," + json + ")"); }
    private void fail(int call, Exception e) {
        Log.w(TAG, "host: " + e);
        toPage("globalThis.appHostReply&&appHostReply(" + call + ",false," + JSONObject.quote(String.valueOf(e.getMessage())) + ")");
    }

    /** A web page, in the phone's own browser. */
    private void outside(Uri u) {
        if (u == null || !"https".equals(u.getScheme())) return;
        try { startActivity(new Intent(Intent.ACTION_VIEW, u).addCategory(Intent.CATEGORY_BROWSABLE)); }
        catch (ActivityNotFoundException e) { Log.w(TAG, "no browser for " + u); }
    }

    /** SAVE DATA's Export: the system asks where the file is to go; it is written there once that is answered. */
    private void askWhere(int call, String file, byte[] data) {
        if (saving != null) reply(savingCall, "{\"saved\":false}");
        saving = data;
        savingCall = call;
        Intent make = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                .setType("application/octet-stream").putExtra(Intent.EXTRA_TITLE, file);
        try { startActivityForResult(make, ASK_SAVE); }
        catch (ActivityNotFoundException e) { saving = null; fail(call, e); }
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        final Uri picked = result == RESULT_OK && data != null ? data.getData() : null;
        if (request == ASK_OPEN) {
            ValueCallback<Uri[]> answer = chooser;
            chooser = null;
            if (answer != null) answer.onReceiveValue(picked != null ? new Uri[] { picked } : null);
        } else if (request == ASK_SAVE) {
            final byte[] bytes = saving;
            final int call = savingCall;
            saving = null;
            if (bytes == null) return;
            if (picked == null) { reply(call, "{\"saved\":false}"); return; }
            worker.execute(() -> {
                try (OutputStream out = getContentResolver().openOutputStream(picked, "wt")) {
                    if (out == null) throw new IOException("could not open " + picked);
                    out.write(bytes);
                    reply(call, "{\"saved\":true,\"name\":" + JSONObject.quote(nameOf(picked)) + "}");
                } catch (Exception e) { fail(call, e); }
            });
        }
    }

    /** The name a saved file was given (the system numbers a second one of the same name), or "" where it cannot be told. */
    private String nameOf(Uri u) {
        try (Cursor c = getContentResolver().query(u, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            return c != null && c.moveToFirst() && c.getString(0) != null ? c.getString(0) : "";
        } catch (Exception e) { return ""; }
    }

    // The system Back gesture does what the game's own Back button does wherever that button is showing (a menu, the
    // log, the gallery...), and nothing elsewhere, so a stray swipe never leaves the story.
    private void back() {
        web.evaluateJavascript("(() => { const b = document.getElementById('touch-back');"
                + " if (b && b.style.visibility === 'visible' && b.style.pointerEvents !== 'none') b.click(); })()", null);
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() { back(); }

    @SuppressWarnings("deprecation")
    private void hideBars() {
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.systemBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean focus) {
        super.onWindowFocusChanged(focus);
        if (focus) hideBars();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        web.resumeTimers();
    }

    @Override
    protected void onPause() {
        web.onPause();
        super.onPause();
    }

    // Going to the background: Android may end the app from there without the page's pagehide, so the automatic save
    // is made now (main.js appSuspend), then the page's timers stop until the app comes back.
    @Override
    protected void onStop() {
        web.evaluateJavascript("globalThis.appSuspend && globalThis.appSuspend()", (r) -> web.pauseTimers());
        super.onStop();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onDestroy() {
        if (chooser != null) { chooser.onReceiveValue(null); chooser = null; }
        web.destroy();
        web = null;
        worker.shutdown();
        super.onDestroy();
    }

    /** Answers the page's requests from the update in use where it has the file, else from assets/www, with byte ranges (the movies seek). */
    final class Assets extends WebViewClient {
        private final Pattern RANGE = Pattern.compile("bytes=(\\d*)-(\\d*)");
        private final Map<String, String> TYPES = new HashMap<>();
        {
            String[] t = {
                "html", "text/html", "js", "text/javascript", "mjs", "text/javascript", "css", "text/css",
                "json", "application/json", "svg", "image/svg+xml", "avif", "image/avif", "webp", "image/webp",
                "png", "image/png", "jpg", "image/jpeg", "ico", "image/x-icon", "ogg", "audio/ogg", "mp4", "video/mp4",
                "otf", "font/otf", "ttf", "font/ttf", "woff", "font/woff", "woff2", "font/woff2", "txt", "text/plain",
            };
            for (int i = 0; i < t.length; i += 2) TYPES.put(t[i], t[i + 1]);
        }
        private final AssetManager assets;

        Assets(AssetManager assets) { this.assets = assets; }

        @Override
        public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
            if (HOST.equals(req.getUrl().getHost())) return false;
            if (req.hasGesture()) outside(req.getUrl());   // a link the player pressed: in the phone's browser
            return true;                                   // no leaving the game for another site
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (!"https".equals(u.getScheme()) || !HOST.equals(u.getHost())) return status(403, "Forbidden");
            String path = u.getPath();
            if (path == null || path.isEmpty() || path.equals("/")) path = "/index.html";
            if (path.contains("..") || path.contains("//")) return status(404, "Not Found");
            String name = "www" + path;
            String type = type(path);
            String head = header(req, "Range");
            try {
                // the update in use has the file: that one; else the APK's, a stored (uncompressed) entry: seekable
                File newer = updates.fileFor(path.substring(1));
                AssetFileDescriptor fd = newer != null ? null : assets.openFd(name);
                FileInputStream in = newer != null ? new FileInputStream(newer) : new FileInputStream(fd.getFileDescriptor());
                Closeable both = fd != null ? fd : in;
                long size = newer != null ? newer.length() : fd.getLength(), a = 0, b = size - 1;
                int code = 200;
                Matcher m = head == null ? null : RANGE.matcher(head.trim());
                if (m != null && m.matches() && (!m.group(1).isEmpty() || !m.group(2).isEmpty())) {
                    if (!m.group(1).isEmpty()) {
                        a = Long.parseLong(m.group(1));
                        if (!m.group(2).isEmpty()) b = Math.min(size - 1, Long.parseLong(m.group(2)));
                    } else {
                        a = Math.max(0, size - Long.parseLong(m.group(2)));
                    }
                    if (a < size && a <= b) code = 206;
                    else { a = 0; b = size - 1; }
                }
                // The WebView applies the Range itself (it skips into the stream and works out Content-Length from
                // available()), so the body starts at the file's first byte; it ends after the range's last one,
                // which the WebView would read past. The status and Content-Range say which part is sent.
                if (fd != null) in.getChannel().position(fd.getStartOffset());
                Map<String, String> h = headers();
                h.put("Accept-Ranges", "bytes");
                if (code == 206) h.put("Content-Range", "bytes " + a + "-" + b + "/" + size);
                InputStream body = "HEAD".equals(req.getMethod()) ? empty(in, both) : new Slice(in, b + 1, both);
                return new WebResourceResponse(type, encoding(type), code, code == 206 ? "Partial Content" : "OK", h, body);
            } catch (FileNotFoundException e) {
                // Not stored: a compressed entry can still be read whole (no ranges), else it is missing.
                try {
                    InputStream in = assets.open(name);
                    return new WebResourceResponse(type, encoding(type), 200, "OK", headers(), in);
                } catch (IOException missing) {
                    return status(404, "Not Found");
                }
            } catch (IOException e) {
                Log.w(TAG, name + ": " + e);
                return status(500, "Internal Server Error");
            }
        }

        private InputStream empty(FileInputStream in, Closeable both) {
            try { in.close(); both.close(); } catch (IOException ignored) { }
            return new ByteArrayInputStream(new byte[0]);
        }

        private String header(WebResourceRequest req, String name) {
            for (Map.Entry<String, String> e : req.getRequestHeaders().entrySet()) {
                if (e.getKey().equalsIgnoreCase(name)) return e.getValue();
            }
            return null;
        }

        private Map<String, String> headers() {
            Map<String, String> h = new HashMap<>();
            h.put("Cache-Control", "no-cache");
            return h;
        }

        private String type(String path) {
            int dot = path.lastIndexOf('.');
            String t = dot < 0 ? null : TYPES.get(path.substring(dot + 1).toLowerCase(Locale.ROOT));
            return t != null ? t : "application/octet-stream";
        }

        private String encoding(String type) {
            return type.startsWith("text/") || type.equals("application/json") || type.equals("image/svg+xml") ? "utf-8" : null;
        }

        private WebResourceResponse status(int code, String reason) {
            return new WebResourceResponse("text/plain", "utf-8", code, reason, headers(), new ByteArrayInputStream(new byte[0]));
        }
    }

    /** n bytes from where the stream stands, then the end; closing it closes the file it came from. */
    static final class Slice extends InputStream {
        private final FileInputStream in;
        private final Closeable fd;
        private long left;

        Slice(FileInputStream in, long n, Closeable fd) { this.in = in; this.left = n; this.fd = fd; }

        @Override
        public int read() throws IOException {
            if (left <= 0) return -1;
            int c = in.read();
            if (c >= 0) left--;
            return c;
        }

        @Override
        public int read(byte[] buf, int off, int len) throws IOException {
            if (left <= 0) return -1;
            int n = in.read(buf, off, (int) Math.min(len, left));
            if (n > 0) left -= n;
            return n;
        }

        @Override
        public int available() { return (int) Math.min(Integer.MAX_VALUE, left); }

        // A seek in the movie skips to its byte at once instead of reading up to it.
        @Override
        public long skip(long n) throws IOException {
            if (n <= 0) return 0;
            long k = Math.min(n, left);
            java.nio.channels.FileChannel c = in.getChannel();
            c.position(c.position() + k);
            left -= k;
            return k;
        }

        @Override
        public void close() throws IOException {
            try { in.close(); } finally { fd.close(); }
        }
    }
}
