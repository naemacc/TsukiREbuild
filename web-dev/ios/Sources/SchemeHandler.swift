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
        if rel.hasPrefix("assets/") { candidates.append(docs.appendingPathComponent(rel)) } // downloaded or copied-in assets win
        candidates.append(www.appendingPathComponent(rel))
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

    // MARK: serving (background queue)
    private func serve(_ task: WKURLSchemeTask, id: ObjectIdentifier, request: URLRequest) {
        guard let url = request.url else { return send(task, id, 400, [:], nil) }
        var rel = String(url.path.dropFirst())
        if rel.isEmpty { rel = "index.html" }

        guard let file = resolve(rel),
              let size = (try? file.resourceValues(forKeys: [.fileSizeKey]))?.fileSize.map({ UInt64($0) }) else {
            return send(task, id, 404, ["Content-Type": "text/plain"], Data("Not found: \(rel)".utf8))
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