#!/usr/bin/env python3
"""server.py [port]: the local web version. Listens on this machine only.

Serves web/app and web/assets, with byte ranges for the movies. It needs nothing but Python's standard library and this folder:
everything the game uses is in web/assets. Those files are not in the repository: web-dev/tools/fetch_assets.py brings them from the
site, once (or web-dev/tools/convert_all.py makes them from a dump of the game).
"""
import http.server
import mimetypes
import os
import re
import socketserver
import sys
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(HERE, "app")
ASSETS = os.path.join(HERE, "assets")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
for ext, kind in ((".avif", "image/avif"), (".webp", "image/webp"), (".ogg", "audio/ogg"), (".mp4", "video/mp4"), (".js", "text/javascript"),
                  (".ttf", "font/ttf"), (".otf", "font/otf"), (".woff2", "font/woff2")):
    mimetypes.add_type(kind, ext)


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        if len(args) > 1 and str(args[1])[0] in "45":
            sys.stderr.write("%s %s\n" % (self.path, args[1]))

    def fail(self, status, msg):
        data = msg.encode()
        self.send_response(status)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def parse_range(self, size):
        m = re.fullmatch(r"bytes=(\d*)-(\d*)", self.headers.get("Range") or "")
        if not m:
            return None
        if m[1]:
            a = int(m[1])
            b = int(m[2]) if m[2] else size - 1
        else:
            a = max(0, size - int(m[2]))
            b = size - 1
        return a, min(b, size - 1)

    def send_file(self, path):
        size = os.path.getsize(path)
        rg = self.parse_range(size)
        if rg and rg[0] < size:
            a, b = rg
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {a}-{b}/{size}")
        else:
            a, b = 0, size - 1
            self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(path)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(max(0, b - a + 1)))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        if self.command == "HEAD":
            return
        with open(path, "rb") as f:
            f.seek(a)
            left = b - a + 1
            while left > 0:
                chunk = f.read(min(1 << 20, left))
                if not chunk:
                    break
                self.wfile.write(chunk)
                left -= len(chunk)

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        path = urllib.parse.unquote(urllib.parse.urlparse(self.path).path)
        try:
            base, rel = (ASSETS, path[8:]) if path.startswith("/assets/") else (APP, "index.html" if path == "/" else path.lstrip("/"))
            full = os.path.normpath(os.path.join(base, rel))
            if not full.startswith(os.path.join(base, "")) or not os.path.isfile(full):
                return self.fail(404, "not found")
            self.send_file(full)
        except ConnectionError:
            pass
        except Exception as e:  # one bad request must not stop the game
            sys.stderr.write(f"{path}: {e!r}\n")
            try:
                self.fail(500, repr(e))
            except Exception:
                pass


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def handle_error(self, request, client_address):
        # A browser dropping a connection it kept open (a reload, a closed tab) is normal, not worth a traceback.
        if not isinstance(sys.exc_info()[1], ConnectionError):
            super().handle_error(request, client_address)


if __name__ == "__main__":
    if not os.path.isfile(os.path.join(ASSETS, "text.json")):
        sys.exit("The game's files are not in web/assets (they are not part of the repository).\n"
                 "Fetch them once from the site:  python3 web-dev/tools/fetch_assets.py")
    srv = Server(("127.0.0.1", PORT), Handler)
    print(f"http://localhost:{PORT}", flush=True)
    srv.serve_forever()
