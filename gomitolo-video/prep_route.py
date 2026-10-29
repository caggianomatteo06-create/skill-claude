"""Turn the OSRM route into a smoothed Web-Mercator polyline for the scene."""
import json
import math
import os

ROOT = os.path.dirname(os.path.abspath(__file__))
R = 6378137.0

coords = json.load(open(os.path.join(ROOT, "data/osrm2.json")))["routes"][0]["geometry"]["coordinates"]

pts = []
for lon, lat in coords:
    if not pts or (lon, lat) != pts[-1]:
        pts.append((lon, lat))


def chaikin(p, it):
    for _ in range(it):
        q = [p[0]]
        for a, b in zip(p, p[1:]):
            q.append((0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]))
            q.append((0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]))
        q.append(p[-1])
        p = q
    return p


pts = chaikin(pts, 2)


def hav(a, b):
    la1, la2 = math.radians(a[1]), math.radians(b[1])
    dla, dlo = la2 - la1, math.radians(b[0] - a[0])
    h = math.sin(dla / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(dlo / 2) ** 2
    return 2 * 6371008.8 * math.asin(math.sqrt(h))


mx, my, km = [], [], []
acc = 0.0
for i, (lon, lat) in enumerate(pts):
    if i:
        acc += hav(pts[i - 1], pts[i])
    mx.append(round(R * math.radians(lon), 3))
    my.append(round(R * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)), 3))
    km.append(round(acc / 1000, 5))

places = {
    "Milano": (9.1879, 45.4720), "Aosta": (7.32, 45.737), "Monte Bianco": (6.87, 45.86),
    "Ginevra": (6.14, 46.20), "Digione": (5.04, 47.32), "Parigi": (2.35, 48.85),
    "Calais": (1.8126, 50.9246), "Folkestone": (1.15, 51.09), "Londra": (-0.13, 51.50),
}
marks = {}
for name, p in places.items():
    best = min(range(len(pts)), key=lambda i: (pts[i][0] - p[0]) ** 2 * math.cos(math.radians(p[1])) ** 2 + (pts[i][1] - p[1]) ** 2)
    marks[name] = {"km": km[best], "dist_km": round(hav(pts[best], p) / 1000, 1)}

json.dump({"mx": mx, "my": my, "km": km, "marks": marks}, open(os.path.join(ROOT, "data/route.json"), "w"))
print(len(mx), "points,", km[-1], "km")
for k, v in marks.items():
    print(f"{k:14s} km {v['km']:8.1f}  (off-route {v['dist_km']} km)")
