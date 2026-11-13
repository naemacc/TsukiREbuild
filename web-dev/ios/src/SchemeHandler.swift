import WebKit
import UniformTypeIdentifiers

final class SchemeHandler: NSObject, WKURLSchemeHandler {
    private let queue = DispatchQueue(label: "tsuki.scheme", qos: .userInitiated, attributes: .concurrent)
    private let lock = NSLock()
    private var active: [ObjectIdentifier: WKURLSchemeTask] = [:]

    private let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    private let www = Bundle.main.resourceURL!.appendingPathComponent("www", isDirectory: true)

    private static let mime: [String: String] = [
        "html": "text/html; charset=utf-8", "js": "text/javascript; charset=utf-8",
        "mjs": "text/javascript; charset=utf-8", "css": "text/css; charset=utf-8",
        "json": "application/json; charset=utf-8", "txt": "text/plain; charset=utf-8",
        "avif": "image/avif", "webp": "image/webp", "png": "image/png", "svg": "image/svg+xml",
        "mp4": "video/mp4", "opus": "audio/ogg", "ogg": "audio/ogg",
        "woff2": "font/woff2", "woff": "font/woff", "ttf": "font/ttf", "otf": "font/otf",
        "wasm": "application/wasm",
    ]

    // MARK: WKURLSchemeHandler
    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        let id = ObjectIdentifier(task)
        lock.lock(); active[id] = task; lock.unlock()
        let request = task.request
        queue.async { self.serve(task, id: id, request: request) }
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        remove(ObjectIdentifier(task))
    }

    // MARK: helpers
    private func isActive(_ id: ObjectIdentifier) -> Bool {
        lock.lock(); defer { lock.unlock() }; return active[id] != nil
    }
    private func remove(_ id: ObjectIdentifier) {
        lock.lock(); active[id] = nil; lock.unlock()
    }

    private func resolve(_ rel: String) -> URL? {
        if rel.split(separator: "/").contains("..") { return nil }
        var candidates: [URL] = []
        // 1. the active update (downloaded by Updates.swift) wins over everything
        if let root = Updates.shared.activeRoot { candidates.append(root.appendingPathComponent(rel)) }
        // 2. assets copied into Documents through Files
        if rel.hasPrefix("assets/") { candidates.append(docs.appendingPathComponent(rel)) }
        // 3. what the app was built with
        candidates.append(www.appendingPathComponent(rel))
        // 4. what was fetched from the site earlier (lite IPA)
        if rel.hasPrefix("assets/") { candidates.append(cacheRoot.appendingPathComponent(rel)) }
        var isDir: ObjCBool = false
        return candidates.first { FileManager.default.fileExists(atPath: $0.path, isDirectory: &isDir) && !isDir.boolValue }
    }

    private static func mimeType(for url: URL) -> String {
        let ext = url.pathExtension.lowercased()
        return mime[ext] ?? UTType(filenameExtension: ext)?.preferredMIMEType ?? "application/octet-stream"
    }

    private static func parseRange(_ header: String, size: UInt64) -> (UInt64, UInt64)? {
        guard size > 0, header.hasPrefix("bytes=") else { return nil }
        let spec = header.dropFirst(6).split(separator: ",").first ?? ""
        let parts = spec.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 2 else { return nil }
        if parts[0].isEmpty {                       // bytes=-N (last N bytes)
            guard let n = UInt64(parts[1]), n > 0 else { return nil }
            return (size > n ? size - n : 0, size - 1)
        }
        guard let s = UInt64(parts[0]), s < size else { return nil }
        let e = parts[1].isEmpty ? size - 1 : min(UInt64(parts[1]) ?? size - 1, size - 1)
        return s <= e ? (s, e) : nil
    }

    // MARK: online game files (lite IPA)
    // A file under assets/ that is neither in an update, nor in Documents, nor in the app is asked of the site, as the web
    // version does. The media the site keeps for 30 days are also kept here (in Caches, which iOS may clear: they are
    // fetched again then), so each is downloaded once. Ranged requests (movies) are passed through and not kept.
    private static let site = URL(string: "https://arcueid.date/")!
    private static let keepable = ["assets/voice/", "assets/img/", "assets/se/", "assets/bgm/", "assets/movie/",
                                   "assets/sys/", "assets/fonts/", "assets/pack/"]
    private static func isKeepable(_ rel: String) -> Bool {
        rel != "assets/pack/index.json" && keepable.contains { rel.hasPrefix($0) }
    }
    private let cacheRoot = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("www", isDirectory: true)
    private lazy var remote = Remote(owner: self)

    private func proxy(_ task: WKURLSchemeTask, id: ObjectIdentifier, request: URLRequest, rel: String) {
        guard !rel.split(separator: "/").contains(".."), let src = request.url,
              var comps = URLComponents(url: Self.site.appendingPathComponent(rel), resolvingAgainstBaseURL: false)
        else { return send(task, id, 400, [:], nil) }
        comps.percentEncodedQuery = URLComponents(url: src, resolvingAgainstBaseURL: false)?.percentEncodedQuery
        guard let url = comps.url, url.host == Self.site.host else { return send(task, id, 400, [:], nil) }
        var req = URLRequest(url: url)
        req.httpMethod = request.httpMethod == "HEAD" ? "HEAD" : "GET"
        let range = request.value(forHTTPHeaderField: "Range")
        if let range { req.setValue(range, forHTTPHeaderField: "Range") }
        let keepAs = (range == nil && req.httpMethod == "GET" && src.query == nil && Self.isKeepable(rel))
            ? cacheRoot.appendingPathComponent(rel) : nil
        remote.start(req, task: task, id: id, keepAs: keepAs)
    }

    private final class Remote: NSObject, URLSessionDataDelegate {
        private struct Job {
            let task: WKURLSchemeTask
            let id: ObjectIdentifier
            let keepAs: URL?
            var part: URL?
            var handle: FileHandle?
            var length: Int64 = -1
            var written: Int64 = 0
            var broken = false
        }
        private unowned let owner: SchemeHandler
        private let lock = NSLock()
        private var jobs: [Int: Job] = [:]
        private lazy var session: URLSession = {
            let cfg = URLSessionConfiguration.default
            cfg.urlCache = URLCache(memoryCapacity: 16 << 20, diskCapacity: 256 << 20, directory: nil)   // short-lived files follow their headers
            let q = OperationQueue(); q.maxConcurrentOperationCount = 1
            return URLSession(configuration: cfg, delegate: self, delegateQueue: q)
        }()

        init(owner: SchemeHandler) { self.owner = owner }

        func start(_ req: URLRequest, task: WKURLSchemeTask, id: ObjectIdentifier, keepAs: URL?) {
            let t = session.dataTask(with: req)
            lock.lock(); jobs[t.taskIdentifier] = Job(task: task, id: id, keepAs: keepAs); lock.unlock()
            t.resume()
        }

        private func find(_ t: URLSessionTask) -> Job? { lock.lock(); defer { lock.unlock() }; return jobs[t.taskIdentifier] }
        private func take(_ t: URLSessionTask) -> Job? { lock.lock(); defer { lock.unlock() }; return jobs.removeValue(forKey: t.taskIdentifier) }
        private func update(_ t: URLSessionTask, _ f: (inout Job) -> Void) {
            lock.lock(); defer { lock.unlock() }
            if var j = jobs[t.taskIdentifier] { f(&j); jobs[t.taskIdentifier] = j }
        }

        func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
            guard let job = find(dataTask), let http = response as? HTTPURLResponse else { completionHandler(.cancel); return }
            var headers = ["Access-Control-Allow-Origin": "*", "Accept-Ranges": "bytes"]
            for k in ["Content-Type", "Content-Range", "Cache-Control", "ETag", "Last-Modified"] {
                if let v = http.value(forHTTPHeaderField: k) { headers[k] = v }
            }
            if http.value(forHTTPHeaderField: "Content-Encoding") == nil,
               let v = http.value(forHTTPHeaderField: "Content-Length") { headers["Content-Length"] = v }
            guard owner.respond(job.task, job.id, http.statusCode, headers) else { completionHandler(.cancel); return }
            if http.statusCode == 200, let dest = job.keepAs {
                let dir = dest.deletingLastPathComponent()
                try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                let part = dir.appendingPathComponent(".part-" + UUID().uuidString)
                if FileManager.default.createFile(atPath: part.path, contents: nil),
                   let h = try? FileHandle(forWritingTo: part) {
                    update(dataTask) { $0.part = part; $0.handle = h; $0.length = http.expectedContentLength }
                }
            }
            completionHandler(.allow)
        }

        func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
            guard let job = find(dataTask) else { dataTask.cancel(); return }
            var alive = true
            DispatchQueue.main.sync {                       // sync = backpressure, as in serve()
                if self.owner.isActive(job.id) { job.task.didReceive(data) } else { alive = false }
            }
            guard alive else { dataTask.cancel(); return }  // the page stopped asking: didComplete cleans up
            if let h = job.handle, !job.broken {
                do { try h.write(contentsOf: data); update(dataTask) { $0.written += Int64(data.count) } }
                catch { update(dataTask) { $0.broken = true } }
            }
        }

        func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
            guard let job = take(task) else { return }
            try? job.handle?.close()
            if let part = job.part {
                if error == nil, !job.broken, let dest = job.keepAs, job.length < 0 || job.written == job.length {
                    try? FileManager.default.removeItem(at: dest)
                    do { try FileManager.default.moveItem(at: part, to: dest) }
                    catch { try? FileManager.default.removeItem(at: part) }
                } else {
                    try? FileManager.default.removeItem(at: part)   // cut off: nothing half done is kept
                }
            }
            DispatchQueue.main.sync {
                guard self.owner.isActive(job.id) else { return }
                if let error { job.task.didFailWithError(error) } else { job.task.didFinish() }
                self.owner.remove(job.id)
            }
        }
    }

    // MARK: serving (background queue)
    private func serve(_ task: WKURLSchemeTask, id: ObjectIdentifier, request: URLRequest) {
        guard let url = request.url else { return send(task, id, 400, [:], nil) }
        var rel = String(url.path.dropFirst())
        if rel.isEmpty { rel = "index.html" }

        // an update that never comes up is taken out again here, before the page is served
        if rel == "index.html" { Updates.shared.willServeIndex() }

        guard let file = resolve(rel),
              let size = (try? file.resourceValues(forKeys: [.fileSizeKey]))?.fileSize.map({ UInt64($0) }) else {
            // a game file the IPA does not carry (a lite IPA): fetched from the site, as the web version does
            if rel.hasPrefix("assets/") { return proxy(task, id: id, request: request, rel: rel) }
            return send(task, id, 404, ["Content-Type": "text/plain"], Data("Not found: \(rel)".utf8))
        }

        // iOS only: `?play` skips the opening page (home.js homeDue). Done here, on the way out, so it holds for the
        // bundled copy and for a copy that an update downloaded; the files themselves stay as the site has them.
        if rel == "js/home.js", let raw = try? Data(contentsOf: file), var text = String(data: raw, encoding: .utf8) {
            let needle = "return !query.has(\"script\");"
            if text.contains(needle) {
                text = text.replacingOccurrences(of: needle, with: "return !query.has(\"script\") && !query.has(\"play\");")
                return send(task, id, 200, ["Content-Type": "text/javascript; charset=utf-8",
                                            "Access-Control-Allow-Origin": "*"], Data(text.utf8))
            }
        }

        var headers = ["Content-Type": Self.mimeType(for: file), "Accept-Ranges": "bytes",
                       "Access-Control-Allow-Origin": "*"]
        var status = 200
        var start: UInt64 = 0
        var length = size
        if let h = request.value(forHTTPHeaderField: "Range") {
            guard let (s, e) = Self.parseRange(h, size: size) else {
                return send(task, id, 416, ["Content-Range": "bytes */\(size)"], nil)
            }
            status = 206; start = s; length = e - s + 1
            headers["Content-Range"] = "bytes \(s)-\(e)/\(size)"
        }
        headers["Content-Length"] = String(length)
        guard respond(task, id, status, headers) else { return }
        if request.httpMethod == "HEAD" || length == 0 { return finish(task, id) }

        guard let fh = try? FileHandle(forReadingFrom: file) else { return fail(task, id) }
        defer { try? fh.close() }
        do { try fh.seek(toOffset: start) } catch { return fail(task, id) }

        var remaining = length
        while remaining > 0 {
            guard isActive(id),
                  let chunk = try? fh.read(upToCount: Int(min(remaining, 1 << 20))),
                  !chunk.isEmpty else { break }
            remaining -= UInt64(chunk.count)
            var alive = true
            DispatchQueue.main.sync {                       // sync = backpressure, no memory ballooning
                if self.isActive(id) { task.didReceive(chunk) } else { alive = false }
            }
            if !alive { return }
        }
        finish(task, id)
    }

    private func respond(_ task: WKURLSchemeTask, _ id: ObjectIdentifier, _ status: Int, _ headers: [String: String]) -> Bool {
        var ok = false
        DispatchQueue.main.sync {
            guard self.isActive(id), let url = task.request.url,
                  let r = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)
            else { return }
            task.didReceive(r); ok = true
        }
        return ok
    }

    private func finish(_ task: WKURLSchemeTask, _ id: ObjectIdentifier) {
        DispatchQueue.main.sync {
            if self.isActive(id) { task.didFinish(); self.remove(id) }
        }
    }

    private func fail(_ task: WKURLSchemeTask, _ id: ObjectIdentifier) {
        DispatchQueue.main.sync {
            if self.isActive(id) { task.didFailWithError(URLError(.cannotOpenFile)); self.remove(id) }
        }
    }

    private func send(_ task: WKURLSchemeTask, _ id: ObjectIdentifier, _ status: Int,
                      _ headers: [String: String], _ body: Data?) {
        var h = headers
        if let body { h["Content-Length"] = String(body.count) }
        guard respond(task, id, status, h) else { return }
        if let body { DispatchQueue.main.sync { if self.isActive(id) { task.didReceive(body) } } }
        finish(task, id)
    }
}
