import UIKit
import WebKit

final class ViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate,
                            WKScriptMessageHandlerWithReply {
    private var webView: WKWebView!
    private var downloadDestination: URL?

    // Crash-loop protection: if iOS keeps killing the web process, stop reloading.
    private var terminations: [Date] = []
    private let maxTerminations = 3
    private let terminationWindow: TimeInterval = 60
    private var failureLabel: UILabel!

    private static let appURL = URL(string: "tsuki://tsukihime.desktop/index.html?play")!

    // The page treats tsukihime.desktop as an app and looks for window.desktopHost
    // (web/app/js/apphost.js). This is that object, backed by the "host" message handler below.
    private static let bootScript = """
    window.__TSUKI_IOS__ = true;
    (function () {
      let listener = null;
      window.desktopHost = {
        invoke: (name, args) => window.webkit.messageHandlers.host.postMessage({ name: name, args: args || {} }),
        onEvent: (f) => { listener = f; },
      };
      window.__hostEvent = (v) => { if (listener) listener(v); };
    })();
    """

    // iOS skips the opening page, which is where the apps check for updates (home.js). So it is done here, at every
    // launch: once the game's page is up it is confirmed (apphost.js `confirm`), then the site is asked (update.js),
    // and an update is downloaded after asking. Shown over the game by the native alert below.
    private static let updateScript = """
    (async () => {
      if (!window.__TSUKI_IOS__ || !location.search.includes("play")) return;
      try {
        const { HOST } = await import("/js/apphost.js");
        if (!HOST) return;
        for (let i = 0; i < 300 && !window.preload; i++) await new Promise((r) => setTimeout(r, 100));
        if (!window.preload) return;   // the page never came up: not confirmed, so the app takes a bad update out again
        await HOST.call("confirm").catch(() => {});
        const U = await import("/js/update.js");
        // a lite IPA has no list of the game's files: it fetches them from the site as it plays, so it has them all
        const local = async (p) => {
          const r = await fetch(p, { cache: "no-store" });
          if (r.ok) return r.text();
          if (p === "/bundled-assets.txt") {
            const m = JSON.parse(await HOST.call("fetchText", { path: "update/app.json" }));
            return HOST.call("fetchText", { path: m.assets.path + "?h=" + m.assets.md5.slice(0, 12), hash: m.assets.md5 });
          }
          throw Error(p + ": " + r.status);
        };
        const plan = await U.checkUpdate(HOST, { local });
        if (plan.state !== "update") return;
        if (!confirm("An update is available (" + U.sizeText(plan.bytes) + ").\\nDownload it now?")) return;
        const box = document.createElement("div");
        box.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:#000;color:#fff;display:flex;align-items:center;justify-content:center;font:20px -apple-system,sans-serif;text-align:center";
        box.textContent = "Downloading the update  0%";
        document.body.appendChild(box);
        try {
          await U.runUpdate(HOST, plan, (p) => { box.textContent = "Downloading the update  " + (p.total ? Math.floor((p.done / p.total) * 100) : 0) + "%"; });
          location.reload();
        } catch (e) {
          box.textContent = "The update could not be downloaded. Nothing was changed.";
          setTimeout(() => box.remove(), 3000);
        }
      } catch (e) { /* no update check this time */ }
    })();
    """

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { .all }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .landscape }
    override var shouldAutorotate: Bool { true }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black

        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(SchemeHandler(), forURLScheme: "tsuki")
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.addUserScript(
            WKUserScript(source: Self.bootScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        config.userContentController.addUserScript(
            WKUserScript(source: Self.updateScript, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        config.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "host")

        webView = WKWebView(frame: .zero, configuration: config)
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.navigationDelegate = self
        webView.uiDelegate = self
        view.addSubview(webView)
        NSLayoutConstraint.activate([   // edge to edge, under notch and home bar
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])

        // Message shown only when the web process keeps getting killed
        failureLabel = UILabel()
        failureLabel.translatesAutoresizingMaskIntoConstraints = false
        failureLabel.textColor = .white
        failureLabel.textAlignment = .center
        failureLabel.numberOfLines = 0
        failureLabel.font = .systemFont(ofSize: 18)
        failureLabel.text = "iOS keeps closing the game (probably out of memory).\n\nTap to try again."
        failureLabel.isHidden = true
        view.addSubview(failureLabel)
        NSLayoutConstraint.activate([
            failureLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            failureLabel.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            failureLabel.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 40),
            failureLabel.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -40),
        ])
        view.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(retryTapped)))

        loadApp()
        NotificationCenter.default.addObserver(self, selector: #selector(appSuspend),
            name: UIApplication.willResignActiveNotification, object: nil)
    }

    private func loadApp() {
        failureLabel.isHidden = true
        webView.load(URLRequest(url: Self.appURL))
    }

    @objc private func retryTapped() {
        guard !failureLabel.isHidden else { return }
        terminations.removeAll()
        loadApp()
    }

    @objc private func appSuspend() {
        webView.evaluateJavaScript("globalThis.appSuspend && globalThis.appSuspend()", completionHandler: nil)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        setNeedsUpdateOfHomeIndicatorAutoHidden()
        setNeedsUpdateOfScreenEdgesDeferringSystemGestures()
    }

    // iOS kills the web process under memory pressure. Reload, but back off and give up
    // after repeated kills so it never turns into an endless black/flicker loop.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        let now = Date()
        terminations = terminations.filter { now.timeIntervalSince($0) < terminationWindow }
        terminations.append(now)

        if terminations.count > maxTerminations {
            failureLabel.isHidden = false
            return
        }
        let delay = 1.5 * Double(terminations.count)
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            self?.loadApp()
        }
    }

    // MARK: host bridge (the commands apphost.js lists)
    private final class Throttle: @unchecked Sendable {
        private let lock = NSLock()
        private var last = Date.distantPast
        func allow(force: Bool) -> Bool {
            lock.lock(); defer { lock.unlock() }
            let now = Date()
            if force || now.timeIntervalSince(last) > 0.1 { last = now; return true }
            return false
        }
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) async -> (Any?, String?) {
        guard let body = message.body as? [String: Any], let name = body["name"] as? String else {
            return (nil, "bad call")
        }
        let args = body["args"] as? [String: Any] ?? [:]
        do { return (try await host(name, args), nil) }
        catch { return (nil, error.localizedDescription) }
    }

    private func host(_ name: String, _ args: [String: Any]) async throws -> Any? {
        switch name {
        case "info":
            return Updates.shared.info()

        case "open":
            if let s = args["url"] as? String, let url = URL(string: s),
               ["http", "https"].contains(url.scheme ?? "") {
                UIApplication.shared.open(url, options: [:], completionHandler: nil)
            }
            return nil

        case "saveFile":
            guard let rawName = args["name"] as? String, let b64 = args["data"] as? String,
                  let data = Data(base64Encoded: b64) else { throw UpdateError.badPath("saveFile") }
            let safe = (rawName as NSString).lastPathComponent
            let dir = FileManager.default.temporaryDirectory.appendingPathComponent("exports", isDirectory: true)
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let dest = dir.appendingPathComponent(safe)
            try? FileManager.default.removeItem(at: dest)
            try data.write(to: dest)
            return await withCheckedContinuation { (cont: CheckedContinuation<[String: Any], Never>) in
                let sheet = UIActivityViewController(activityItems: [dest], applicationActivities: nil)
                sheet.popoverPresentationController?.sourceView = view
                sheet.popoverPresentationController?.sourceRect =
                    CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
                sheet.completionWithItemsHandler = { _, completed, _, _ in
                    cont.resume(returning: ["saved": completed, "name": safe])
                }
                present(sheet, animated: true)
            }

        case "fetchText":
            guard let path = args["path"] as? String else { throw UpdateError.badPath("fetchText") }
            return try await Updates.shared.fetchText(path: path, hash: args["hash"] as? String)

        case "stage":
            guard let id = args["id"] as? String, let list = args["files"] as? [[String: Any]] else {
                throw UpdateError.badID
            }
            let files: [UpdateFile] = try list.map { f in
                guard let p = f["path"] as? String, let h = f["hash"] as? String, let from = f["from"] as? String,
                      let size = (f["size"] as? NSNumber)?.int64Value else { throw UpdateError.badPath("file entry") }
                return UpdateFile(path: p, size: size, hash: h, from: from)
            }
            let throttle = Throttle()
            try await Updates.shared.stage(id: id, files: files) { [weak self] done, total in
                guard throttle.allow(force: done == total) else { return }
                DispatchQueue.main.async {
                    self?.webView.evaluateJavaScript(
                        "window.__hostEvent && window.__hostEvent({done:\(done),total:\(total)})",
                        completionHandler: nil)
                }
            }
            return nil

        case "cancel":
            Updates.shared.cancel()
            return nil

        case "apply":
            guard let id = args["id"] as? String, let meta = args["meta"],
                  JSONSerialization.isValidJSONObject(meta),
                  let d = try? JSONSerialization.data(withJSONObject: meta),
                  let text = String(data: d, encoding: .utf8) else { throw UpdateError.badID }
            try Updates.shared.apply(id: id, meta: text)
            return nil

        case "confirm":
            Updates.shared.confirm()
            return nil

        default:
            throw UpdateError.badPath("unknown command \(name)")
        }
    }

    // External links go to Safari; downloads (Export Saves) go to the share sheet
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 preferences: WKWebpagePreferences,
                 decisionHandler: @escaping (WKNavigationActionPolicy, WKWebpagePreferences) -> Void) {
        if navigationAction.shouldPerformDownload { decisionHandler(.download, preferences); return }
        if let url = navigationAction.request.url, ["http", "https"].contains(url.scheme ?? "") {
            UIApplication.shared.open(url)
            decisionHandler(.cancel, preferences)
            return
        }
        decisionHandler(.allow, preferences)
    }

    // The update question (confirm() in the page)
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Not now", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "Download", style: .default) { _ in completionHandler(true) })
        present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url { UIApplication.shared.open(url) }
        return nil
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                  suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("exports", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let dest = dir.appendingPathComponent(suggestedFilename)
        try? FileManager.default.removeItem(at: dest)
        downloadDestination = dest
        completionHandler(dest)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let url = downloadDestination else { return }
        let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        sheet.popoverPresentationController?.sourceView = view
        sheet.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
        present(sheet, animated: true)
    }
}
