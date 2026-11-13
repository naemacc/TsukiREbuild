import Foundation
import CryptoKit

struct UpdateFile: Sendable {
    let path: String
    let size: Int64
    let hash: String   // 32 hex = MD5 (game assets), 64 hex = SHA-256 (app files)
    let from: String   // address under arcueid.date
}

enum UpdateError: LocalizedError {
    case badPath(String), http(Int), size(String), hash(String), stopped, missing(String), badID

    var errorDescription: String? {
        switch self {
        case .badPath(let p): return "bad path: \(p)"
        case .http(let c): return "server answered \(c)"
        case .size(let p): return "wrong size: \(p)"
        case .hash(let p): return "wrong hash: \(p)"
        case .stopped: return "stopped"
        case .missing(let p): return "missing after download: \(p)"
        case .badID: return "bad update id"
        }
    }
}

/// The iOS twin of Updates.java: downloads only the changed files, checks them,
/// and switches to them in one step. Served by SchemeHandler before the bundle.
final class Updates: @unchecked Sendable {
    static let shared = Updates()
    static let shell = 1   // must match SHELL in web/app/js/apphost.js (raise when this Swift code needs a newer app)
    static let site = URL(string: "https://arcueid.date/")!

    struct State: Codable {
        var currentID: String?
        var currentMeta: String?     // JSON text of what apphost.js `apply` recorded
        var previousID: String?
        var previousMeta: String?
        var attempts = 0             // page loads since the switch, until the page confirms
        var pending = false
        var rejected: [String] = []
    }

    private let lock = NSLock()
    private var state = State()
    private var cancelled = false
    private var task: URLSessionDownloadTask?
    private let base: URL

    private init() {
        let fm = FileManager.default
        let support = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        var b = support.appendingPathComponent("update", isDirectory: true)
        try? fm.createDirectory(at: b, withIntermediateDirectories: true)
        var rv = URLResourceValues()
        rv.isExcludedFromBackup = true            // keep updates out of iCloud backups
        try? b.setResourceValues(rv)
        base = b
        if let d = try? Data(contentsOf: b.appendingPathComponent("state.json")),
           let s = try? JSONDecoder().decode(State.self, from: d) {
            state = s
        }
        if let id = state.currentID, !fm.fileExists(atPath: filesDir(id).path) {
            state.currentID = nil; state.currentMeta = nil; state.pending = false
            saveLocked()
        }
    }

    // MARK: paths
    private func filesDir(_ id: String) -> URL {
        base.appendingPathComponent(id, isDirectory: true).appendingPathComponent("files", isDirectory: true)
    }
    private func saveLocked() {
        if let d = try? JSONEncoder().encode(state) {
            try? d.write(to: base.appendingPathComponent("state.json"), options: .atomic)
        }
    }

    private static func safePath(_ p: String) -> Bool {
        p.range(of: #"^[A-Za-z0-9_][A-Za-z0-9_.-]*(/[A-Za-z0-9_][A-Za-z0-9_.-]*)*$"#,
                options: .regularExpression) != nil
    }
    private static func safeID(_ id: String) -> Bool {
        id.range(of: #"^[A-Za-z0-9_-]{1,64}$"#, options: .regularExpression) != nil
    }
    private static func safeFrom(_ p: String) -> Bool {
        !p.contains("://") && !p.hasPrefix("/") && !p.contains("..") && !p.isEmpty
    }

    // MARK: used by SchemeHandler
    /// Folder of the active update's files, or nil when the app runs what it was built with.
    var activeRoot: URL? {
        lock.lock(); defer { lock.unlock() }
        return state.currentID.map(filesDir)
    }

    /// Called at every load of index.html. An update that never confirms twice running is taken out.
    func willServeIndex() {
        lock.lock(); defer { lock.unlock() }
        guard state.pending else { return }
        if state.attempts >= 2 { rollbackLocked() } else { state.attempts += 1; saveLocked() }
    }

    private func rollbackLocked() {
        if let bad = state.currentID {
            state.rejected.append(bad)
            try? FileManager.default.removeItem(at: base.appendingPathComponent(bad))
        }
        state.currentID = state.previousID
        state.currentMeta = state.previousMeta
        state.previousID = nil; state.previousMeta = nil
        state.pending = false; state.attempts = 0
        saveLocked()
    }

    // MARK: commands
    func info() -> [String: Any] {
        lock.lock(); defer { lock.unlock() }
        var current: Any = NSNull()
        var version = ""
        if let m = state.currentMeta, let d = m.data(using: .utf8),
           let obj = try? JSONSerialization.jsonObject(with: d) as? [String: Any] {
            current = obj
            version = obj["version"] as? String ?? ""
        }
        return ["kind": "desktop", "shell": Self.shell, "version": version,
                "update": ["current": current, "rejected": state.rejected] as [String: Any]]
    }

    func confirm() {
        lock.lock(); defer { lock.unlock() }
        guard state.pending else { return }
        state.pending = false; state.attempts = 0
        if let old = state.previousID { try? FileManager.default.removeItem(at: base.appendingPathComponent(old)) }
        state.previousID = nil; state.previousMeta = nil
        saveLocked()
    }

    func cancel() {
        lock.lock(); cancelled = true; let t = task; lock.unlock()
        t?.cancel()
    }

    func apply(id: String, meta: String) throws {
        guard Self.safeID(id) else { throw UpdateError.badID }
        let dir = filesDir(id)
        if let d = meta.data(using: .utf8),
           let obj = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
           let files = obj["files"] as? [String: Any] {
            for p in files.keys {
                guard Self.safePath(p), FileManager.default.fileExists(atPath: dir.appendingPathComponent(p).path)
                else { throw UpdateError.missing(p) }
            }
        } else { throw UpdateError.badID }
        lock.lock(); defer { lock.unlock() }
        state.previousID = state.currentID
        state.previousMeta = state.currentMeta
        state.currentID = id
        state.currentMeta = meta
        state.pending = true
        state.attempts = 0
        state.rejected.removeAll { $0 == id }
        saveLocked()
    }

    func fetchText(path: String, hash: String?) async throws -> String {
        guard Self.safeFrom(path), let url = URL(string: path, relativeTo: Self.site)?.absoluteURL,
              url.host == Self.site.host else { throw UpdateError.badPath(path) }
        var req = URLRequest(url: url)
        req.cachePolicy = .reloadIgnoringLocalCacheData
        let (data, resp) = try await URLSession.shared.data(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard code == 200 else { throw UpdateError.http(code) }
        if let hash, !hash.isEmpty, Self.hex(Insecure.MD5.hash(data: data)) != hash { throw UpdateError.hash(path) }
        return String(decoding: data, as: UTF8.self)
    }

    func stage(id: String, files: [UpdateFile], progress: @escaping @Sendable (Int64, Int64) -> Void) async throws {
        guard Self.safeID(id) else { throw UpdateError.badID }
        lock.lock()
        cancelled = false
        let currentDir = state.currentID.map(filesDir)
        lock.unlock()

        let fm = FileManager.default
        let dest = filesDir(id)
        try fm.createDirectory(at: dest, withIntermediateDirectories: true)

        // what is already whole here, or in the update in use, is kept; the rest is downloaded
        var wanted: [UpdateFile] = []
        for f in files {
            guard Self.safePath(f.path), Self.safeFrom(f.from) else { throw UpdateError.badPath(f.path) }
            let target = dest.appendingPathComponent(f.path)
            if Self.valid(target, f) { continue }
            if let c = currentDir {
                let src = c.appendingPathComponent(f.path)
                if Self.valid(src, f) {
                    try fm.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
                    try? fm.removeItem(at: target)
                    try fm.copyItem(at: src, to: target)
                    continue
                }
            }
            wanted.append(f)
        }

        let total = wanted.reduce(Int64(0)) { $0 + $1.size }
        var done: Int64 = 0
        progress(0, total)
        for f in wanted {
            if isCancelled { throw UpdateError.stopped }
            let base = done
            let tmp: URL
            do {
                tmp = try await download(Self.site.appendingPathComponent(f.from, isDirectory: false), from: f.from) { n in
                    progress(base + n, total)
                }
            } catch {
                if isCancelled { throw UpdateError.stopped }
                throw error
            }
            defer { try? fm.removeItem(at: tmp) }
            let size = (try? tmp.resourceValues(forKeys: [.fileSizeKey]))?.fileSize.map { Int64($0) } ?? -1
            guard size == f.size else { throw UpdateError.size(f.path) }
            guard (try? Self.digest(tmp, md5: f.hash.count == 32)) == f.hash else { throw UpdateError.hash(f.path) }
            let target = dest.appendingPathComponent(f.path)
            try fm.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? fm.removeItem(at: target)
            try fm.moveItem(at: tmp, to: target)
            done += f.size
            progress(done, total)
        }
    }

    // MARK: helpers
    private var isCancelled: Bool { lock.lock(); defer { lock.unlock() }; return cancelled }

    private final class Box { var obs: NSKeyValueObservation? }

    private func download(_ ignored: URL, from: String, report: @escaping @Sendable (Int64) -> Void) async throws -> URL {
        // `from` may carry a query (?h=...), so build the address from the string, not appendingPathComponent
        guard let url = URL(string: from, relativeTo: Self.site)?.absoluteURL, url.host == Self.site.host
        else { throw UpdateError.badPath(from) }
        var req = URLRequest(url: url)
        req.cachePolicy = .reloadIgnoringLocalCacheData
        return try await withCheckedThrowingContinuation { cont in
            let box = Box()
            let t = URLSession.shared.downloadTask(with: req) { tmp, resp, err in
                box.obs?.invalidate()
                if let err { cont.resume(throwing: err); return }
                let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
                guard let tmp, code == 200 else { cont.resume(throwing: UpdateError.http(code)); return }
                let keep = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
                do { try FileManager.default.moveItem(at: tmp, to: keep); cont.resume(returning: keep) }
                catch { cont.resume(throwing: error) }
            }
            box.obs = t.progress.observe(\.completedUnitCount) { p, _ in report(p.completedUnitCount) }
            lock.lock(); task = t; lock.unlock()
            t.resume()
        }
    }

    private static func valid(_ url: URL, _ f: UpdateFile) -> Bool {
        guard let size = (try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize, Int64(size) == f.size else { return false }
        return (try? digest(url, md5: f.hash.count == 32)) == f.hash
    }

    private static func digest(_ url: URL, md5: Bool) throws -> String {
        let fh = try FileHandle(forReadingFrom: url)
        defer { try? fh.close() }
        if md5 {
            var h = Insecure.MD5()
            while let d = try fh.read(upToCount: 1 << 20), !d.isEmpty { h.update(data: d) }
            return hex(h.finalize())
        }
        var h = SHA256()
        while let d = try fh.read(upToCount: 1 << 20), !d.isEmpty { h.update(data: d) }
        return hex(h.finalize())
    }

    private static func hex<D: Sequence>(_ d: D) -> String where D.Element == UInt8 {
        d.map { String(format: "%02x", $0) }.joined()
    }
}