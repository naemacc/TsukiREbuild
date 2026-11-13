import UIKit
import WebKit

final class ViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    private var webView: WKWebView!
    private var downloadDestination: URL?

    // Crash-loop protection: if iOS keeps killing the web process, stop reloading.
    private var terminations: [Date] = []
    private let maxTerminations = 3
    private let terminationWindow: TimeInterval = 60
    private var failureLabel: UILabel!

    private static let appURL = URL(string: "tsuki://tsukihime.desktop/index.html")!

    // Set whatever flag your Android/desktop apps use to skip the opening page.
    // Check web-dev/android/README.md and grep web/app/js/home.js for it.
    private static let bootScript = """
    window.__TSUKI_IOS__ = true;
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