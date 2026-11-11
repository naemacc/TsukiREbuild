package date.arcueid.tsukirebuild;

import android.app.Activity;
import android.content.pm.ApplicationInfo;
import android.content.res.AssetFileDescriptor;
import android.content.res.AssetManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.window.OnBackInvokedDispatcher;

import java.io.ByteArrayInputStream;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The web port in a WebView, served from the APK. The page lives at https://appassets.androidplatform.net/ (a name
 * that never reaches the network: every request to it is answered here from assets/www, which holds web/app with
 * web/assets under it). Any other address is refused, and the app has no internet permission.
 */
public class MainActivity extends Activity {
    static final String TAG = "Tsukihime";
    static final String HOST = "appassets.androidplatform.net";
    static final String HOME = "https://" + HOST + "/";

    private WebView web;

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
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) WebView.setWebContentsDebuggingEnabled(true);

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
        web.setWebViewClient(new Assets(getAssets()));
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.d(TAG, m.messageLevel() + " " + m.message() + " (" + m.sourceId() + ":" + m.lineNumber() + ")");
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
        web.destroy();
        super.onDestroy();
    }

    /** Answers the page's requests from assets/www, with byte ranges (the movies seek). */
    static final class Assets extends WebViewClient {
        private static final Pattern RANGE = Pattern.compile("bytes=(\\d*)-(\\d*)");
        private static final Map<String, String> TYPES = new HashMap<>();
        static {
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
            return !HOST.equals(req.getUrl().getHost());   // no leaving the game for another site
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
                AssetFileDescriptor fd = assets.openFd(name);   // a stored (uncompressed) entry: seekable
                long size = fd.getLength(), a = 0, b = size - 1;
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
                FileInputStream in = new FileInputStream(fd.getFileDescriptor());
                in.getChannel().position(fd.getStartOffset());
                Map<String, String> h = headers();
                h.put("Accept-Ranges", "bytes");
                if (code == 206) h.put("Content-Range", "bytes " + a + "-" + b + "/" + size);
                InputStream body = "HEAD".equals(req.getMethod()) ? empty(fd) : new Slice(in, b + 1, fd);
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

        private static InputStream empty(AssetFileDescriptor fd) {
            try { fd.close(); } catch (IOException ignored) { }
            return new ByteArrayInputStream(new byte[0]);
        }

        private static String header(WebResourceRequest req, String name) {
            for (Map.Entry<String, String> e : req.getRequestHeaders().entrySet()) {
                if (e.getKey().equalsIgnoreCase(name)) return e.getValue();
            }
            return null;
        }

        private static Map<String, String> headers() {
            Map<String, String> h = new HashMap<>();
            h.put("Cache-Control", "no-cache");
            return h;
        }

        private static String type(String path) {
            int dot = path.lastIndexOf('.');
            String t = dot < 0 ? null : TYPES.get(path.substring(dot + 1).toLowerCase(Locale.ROOT));
            return t != null ? t : "application/octet-stream";
        }

        private static String encoding(String type) {
            return type.startsWith("text/") || type.equals("application/json") || type.equals("image/svg+xml") ? "utf-8" : null;
        }

        private static WebResourceResponse status(int code, String reason) {
            return new WebResourceResponse("text/plain", "utf-8", code, reason, headers(), new ByteArrayInputStream(new byte[0]));
        }
    }

    /** n bytes from where the stream stands, then the end; closing it closes the asset. */
    static final class Slice extends InputStream {
        private final FileInputStream in;
        private final AssetFileDescriptor fd;
        private long left;

        Slice(FileInputStream in, long n, AssetFileDescriptor fd) { this.in = in; this.left = n; this.fd = fd; }

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
