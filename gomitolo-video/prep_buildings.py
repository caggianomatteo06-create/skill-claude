"""Download OSM building footprints + heights (OpenFreeMap vector tiles, z14)
around Brera and Harrods and save them in Web-Mercator meters relative to a
per-city origin (keeps float32 precision in the browser)."""
import json
import math
import os
import urllib.request

import mapbox_vector_tile
from shapely.geometry import box, shape
from shapely.ops import unary_union

ROOT = os.path.dirname(os.path.abspath(__file__))
R = 6378137.0
HALF = math.pi * R
Z = 14
URL = json.load(urllib.request.urlopen(urllib.request.Request("https://tiles.openfreemap.org/planet", headers={"User-Agent": "gomitolo-video/1.0"})))["tiles"][0]

CITIES = {
    "milano": {"bbox": (9.160, 45.452, 9.215, 45.492)},
    "london": {"bbox": (-0.190, 51.486, -0.135, 51.514)},
}


def merc(lon, lat):
    return R * math.radians(lon), R * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


def tile_xy(lon, lat, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
    return int(x), int(y)


for name, c in CITIES.items():
    lon0, lat0, lon1, lat1 = c["bbox"]
    x0, y1 = tile_xy(lon0, lat0, Z)
    x1, y0 = tile_xy(lon1, lat1, Z)
    ox, oy = merc((lon0 + lon1) / 2, (lat0 + lat1) / 2)
    size = 2 * HALF / 2 ** Z
    out = []
    for tx in range(x0, x1 + 1):
        for ty in range(y0, y1 + 1):
            cache = os.path.join(ROOT, "cache", "vt", f"{Z}_{tx}_{ty}.pbf")
            if not os.path.exists(cache):
                os.makedirs(os.path.dirname(cache), exist_ok=True)
                req = urllib.request.Request(URL.format(z=Z, x=tx, y=ty), headers={"User-Agent": "gomitolo-video/1.0"})
                with urllib.request.urlopen(req, timeout=60) as r, open(cache, "wb") as f:
                    f.write(r.read())
            data = mapbox_vector_tile.decode(open(cache, "rb").read(), default_options={"y_coord_down": True})
            layer = data.get("building")
            if not layer:
                continue
            ext = layer["extent"]
            tx0, ty0 = -HALF + tx * size, HALF - ty * size
            clip = box(0, 0, ext, ext)
            for feat in layer["features"]:
                p = feat["properties"]
                if p.get("hide_3d"):
                    continue
                h = float(p.get("render_height", 10) or 10)
                mh = float(p.get("render_min_height", 0) or 0)
                g = shape(feat["geometry"]).buffer(0).intersection(clip)
                polys = [g] if g.geom_type == "Polygon" else [q for q in getattr(g, "geoms", []) if q.geom_type == "Polygon"]
                for poly in polys:
                    if poly.area < 4:  # tile units; drop slivers
                        continue
                    poly = poly.simplify(1.0)
                    rings = []
                    for ring in [poly.exterior, *poly.interiors]:
                        pts = []
                        for (u, v) in list(ring.coords)[:-1]:
                            mx = tx0 + u / ext * size - ox
                            my = ty0 - v / ext * size - oy
                            pts += [round(mx, 2), round(my, 2)]
                        if len(pts) >= 6:
                            rings.append(pts)
                    if rings:
                        out.append({"h": round(h, 1), "mh": round(mh, 1), "r": rings})
    json.dump({"origin": [ox, oy], "buildings": out}, open(os.path.join(ROOT, f"data/buildings_{name}.json"), "w"), separators=(",", ":"))
    hs = sorted(b["h"] for b in out)
    print(name, len(out), "parts, tiles", (x1 - x0 + 1) * (y1 - y0 + 1), "median h", hs[len(hs) // 2], "max", hs[-1])
