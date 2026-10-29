"""Static file server + caching proxy for satellite imagery and elevation tiles.

  /tiles/sat/{z}/{x}/{y}  -> Esri World Imagery (jpg)
  /tiles/dem/{z}/{x}/{y}  -> AWS Terrain Tiles, terrarium encoding (png)

Tiles are cached under ./cache so re-renders never hit the network again.
"""
import http.server
import os
import re
import sys
import threading
import time
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(ROOT, "cache")
SOURCES = {
    "sat": ("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", "jpg", "image/jpeg"),
    "dem": ("https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png", "png", "image/png"),
}
TILE_RE = re.compile(r"^/tiles/(sat|dem)/(\d+)/(\d+)/(\d+)$")
locks = {}
locks_guard = threading.Lock()


def fetch(kind, z, x, y):
    url_tpl, ext, _ = SOURCES[kind]
    path = os.path.join(CACHE, kind, z, x, f"{y}.{ext}")
    if os.path.exists(path):
        return path
    with locks_guard:
        lock = locks.setdefault(path, threading.Lock())
    with lock:
        if os.path.exists(path):
            return path
        os.makedirs(os.path.dirname(path), exist_ok=True)
        url = url_tpl.format(z=z, x=x, y=y)
        for attempt in range(5):
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "gomitolo-video/1.0"})
                with urllib.request.urlopen(req, timeout=30) as r:
                    data = r.read()
                tmp = path + ".tmp"
                with open(tmp, "wb") as f:
                    f.write(data)
                os.replace(tmp, path)
                return path
            except Exception as e:  # noqa: BLE001
                if attempt == 4:
                    print("tile failed", url, e, file=sys.stderr)
                    return None
                time.sleep(1.5 * (attempt + 1))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, *a):
        pass

    def do_GET(self):
        m = TILE_RE.match(self.path.split("?")[0])
        if not m:
            return super().do_GET()
        kind, z, x, y = m.groups()
        path = fetch(kind, z, x, y)
        if not path:
            self.send_response(404)
            self.end_headers()
            return
        with open(path, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", SOURCES[kind][2])
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "max-age=86400")
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
