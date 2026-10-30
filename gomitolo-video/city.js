// Extruded 3D city from OSM footprints (OpenFreeMap / OpenMapTiles building
// layer). Roofs are textured with the real satellite photo (planar projection
// of an imagery mosaic), facades with a procedural window pattern tinted per
// building. Geometry is in mercator meters relative to the city origin.
import * as THREE from 'three';

const ER = 6378137, HALF = Math.PI * ER;
const HARRODS = [ER * (-0.16295 * Math.PI / 180), ER * Math.log(Math.tan(Math.PI / 4 + (51.49905 * Math.PI / 180) / 2))];

const PALETTES = {
  // ochre, cream, terracotta plaster typical of central Milan
  milano: ['#d9c4a0', '#cfae84', '#e4d6bb', '#c08f68', '#d2c7b3', '#b98262', '#e0c79b', '#cbb8a0'],
  // Portland stone, red brick, white stucco of Knightsbridge
  london: ['#d8cdb7', '#a35d45', '#e9e3d4', '#b06f55', '#cfc5b0', '#8f4f3c', '#e2dccb', '#c9bba0'],
};

function hash(n) { const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); }

function facadeTexture(maxAniso, city) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#f0f0f0'; g.fillRect(0, 0, 256, 256);
  // plaster / stone grain
  for (let i = 0; i < 4000; i++) { const v = 220 + Math.floor(hash(i) * 35); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(hash(i + 1) * 256, hash(i + 2) * 256, 2, 2); }
  if (city === 'london') { // faint brick coursing
    g.fillStyle = 'rgba(0,0,0,0.06)';
    for (let y = 0; y < 256; y += 8) { g.fillRect(0, y, 256, 1); for (let x = (y / 8) % 2 ? 0 : 12; x < 256; x += 24) g.fillRect(x, y, 1, 8); }
  }
  // string course between floors + soffit shadow
  g.fillStyle = '#d6d6d6'; g.fillRect(0, 244, 256, 12);
  g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, 240, 256, 4);
  const wx = 92, wy = 50, ww = 72, wh = 140; // window opening (~1.1 x 1.8 m)
  // reveal shadow
  g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(wx - 4, wy - 4, ww + 8, wh + 8);
  // glass with sky reflection
  const gr = g.createLinearGradient(wx, wy, wx + ww, wy + wh);
  gr.addColorStop(0, '#8fa3b5'); gr.addColorStop(0.45, '#4d5d6c'); gr.addColorStop(1, '#27313b');
  g.fillStyle = gr; g.fillRect(wx, wy, ww, wh);
  // frames / glazing bars
  g.fillStyle = city === 'london' ? '#f4f4f0' : '#e6e1d6';
  g.fillRect(wx, wy, ww, 5); g.fillRect(wx, wy + wh - 5, ww, 5); g.fillRect(wx, wy, 5, wh); g.fillRect(wx + ww - 5, wy, 5, wh);
  if (city === 'london') { g.fillRect(wx, wy + wh / 2 - 3, ww, 6); g.fillRect(wx + ww / 3, wy, 3, wh); g.fillRect(wx + (2 * ww) / 3, wy, 3, wh); g.fillRect(wx, wy + wh / 4, ww, 2); g.fillRect(wx, wy + (3 * wh) / 4, ww, 2); }
  else { g.fillRect(wx + ww / 2 - 2, wy, 4, wh); g.fillRect(wx, wy + wh * 0.3, ww, 4); }
  if (city === 'milano') { // open green persiane on both sides
    for (const sx of [wx - 40, wx + ww + 4]) {
      g.fillStyle = '#3f5b3d'; g.fillRect(sx, wy - 2, 36, wh + 4);
      g.fillStyle = 'rgba(0,0,0,0.25)'; for (let y = wy; y < wy + wh; y += 6) g.fillRect(sx + 3, y, 30, 2);
    }
  }
  // sill and lintel
  g.fillStyle = '#c9c4ba'; g.fillRect(wx - 10, wy + wh + 4, ww + 20, 9); g.fillRect(wx - 8, wy - 14, ww + 16, 9);
  g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(wx - 10, wy + wh + 13, ww + 20, 4);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso;
  return t;
}

// Stitch satellite tiles into one canvas covering [x0,x1]x[y0,y1] at zoom z.
async function mosaic(x0, y0, x1, y1, z, maxAniso) {
  const size = (2 * HALF) / 2 ** z;
  const tx0 = Math.floor((x0 + HALF) / size), tx1 = Math.floor((x1 + HALF) / size);
  const ty0 = Math.floor((HALF - y1) / size), ty1 = Math.floor((HALF - y0) / size);
  const nx = tx1 - tx0 + 1, ny = ty1 - ty0 + 1;
  const c = document.createElement('canvas'); c.width = nx * 256; c.height = ny * 256;
  const g = c.getContext('2d');
  const jobs = [];
  for (let x = tx0; x <= tx1; x++) for (let y = ty0; y <= ty1; y++) {
    jobs.push(() => fetch(`tiles/sat/${z}/${x}/${y}`).then((r) => (r.ok ? r.blob() : null)).then((b) => (b ? createImageBitmap(b) : null))
      .then((bmp) => { if (bmp) g.drawImage(bmp, (x - tx0) * 256, (y - ty0) * 256); }).catch(() => {}));
  }
  for (let i = 0; i < jobs.length; i += 24) await Promise.all(jobs.slice(i, i + 24).map((j) => j()));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  // mercator bounds of the mosaic, for planar roof UVs
  return { tex: t, bx0: -HALF + tx0 * size, by1: HALF - ty0 * size, w: nx * size, h: ny * size };
}

export async function buildCity(name, core, maxAniso) {
  const data = await (await fetch(`data/buildings_${name}.json`)).json();
  const [ox, oy] = data.origin;
  const sec = Math.cosh(oy / ER); // mercator scale: 1 true meter = sec mercator meters
  const pal = PALETTES[name].map((c) => new THREE.Color(c));

  // roof imagery: z19 around the hero spot, z15 for the rest of the district
  const coreHalf = 320 * sec;
  const [mCore, mWide] = await Promise.all([
    mosaic(core[0] - coreHalf, core[1] - coreHalf, core[0] + coreHalf, core[1] + coreHalf, 19, maxAniso),
    mosaic(ox - 4200 * sec, oy - 3000 * sec, ox + 4200 * sec, oy + 3000 * sec, 15, maxAniso),
  ]);

  const walls = { pos: [], nor: [], uv: [], col: [] };
  const roofs = [{ pos: [], uv: [] }, { pos: [], uv: [] }];
  const BAY = 3.8 * sec, FLOOR = 3.3 * sec;

  data.buildings.forEach((b, bi) => {
    const outer = b.r[0];
    let area = 0, cx = 0, cy = 0;
    for (let i = 0; i < outer.length; i += 2) {
      const j = (i + 2) % outer.length;
      area += outer[i] * outer[j + 1] - outer[j] * outer[i + 1];
      cx += outer[i]; cy += outer[i + 1];
    }
    area = Math.abs(area / 2) / (sec * sec); // true m²
    cx /= outer.length / 2; cy /= outer.length / 2;
    let h = b.h, mh = b.mh;
    // OSM often lacks heights: 5 m is the tile default, so estimate a plausible
    // height for real buildings from a per-building hash (5–8 floors downtown).
    if (h <= 5.01 && area > 70) {
      const r = hash(bi + (name === 'london' ? 999 : 0));
      h = name === 'milano' ? 15 + r * 11 : 13 + r * 9;
      if (area > 2500) h += 3;
    }
    h *= sec; mh *= sec;
    const col = pal[Math.floor(hash(bi * 7.1) * pal.length)].clone().multiplyScalar(0.92 + hash(bi * 3.3) * 0.12);
    // Harrods' terracotta facade
    if (name === 'london' && Math.hypot(cx - HARRODS[0] + ox, cy - HARRODS[1] + oy) < 95 * sec) col.set('#b3654a');

    b.r.forEach((ring, ri) => {
      const n = ring.length / 2;
      let sa = 0;
      for (let i = 0; i < n; i++) { const j = (i + 1) % n; sa += ring[i * 2] * ring[j * 2 + 1] - ring[j * 2] * ring[i * 2 + 1]; }
      const ccw = sa > 0, outward = ri === 0 ? ccw : !ccw;
      let along = hash(bi) * BAY;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ax = ring[i * 2], ay = ring[i * 2 + 1], bx = ring[j * 2], by = ring[j * 2 + 1];
        const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
        if (len < 1e-3) continue;
        // outward normal in the (east, north) plane, then to three.js (X, Z = -north)
        let nx = outward ? dy / len : -dy / len, ny = outward ? -dx / len : dx / len;
        const N = [nx, 0, -ny];
        const A0 = [ax, mh, -ay], B0 = [bx, mh, -by], A1 = [ax, h, -ay], B1 = [bx, h, -by];
        const u0 = along / BAY, u1 = (along + len) / BAY, v0 = mh / FLOOR, v1 = h / FLOOR;
        along += len;
        // pick the winding whose face normal matches N
        const e1 = [B0[0] - A0[0], 0, B0[2] - A0[2]], fn = [-e1[2], 0, e1[0]]; // (B0-A0) x up
        const flip = fn[0] * N[0] + fn[2] * N[2] < 0;
        const tri = flip ? [A0, A1, B0, B0, A1, B1] : [A0, B0, A1, B0, B1, A1];
        const uvs = flip ? [[u0, v0], [u0, v1], [u1, v0], [u1, v0], [u0, v1], [u1, v1]] : [[u0, v0], [u1, v0], [u0, v1], [u1, v0], [u1, v1], [u0, v1]];
        tri.forEach((p, k) => {
          // cheap ambient occlusion: walls darken towards the street
          const ao = 0.62 + 0.38 * Math.min(1, (p[1] - mh) / (10 * sec) + (mh > 0 ? 1 : 0));
          walls.pos.push(...p); walls.nor.push(...N); walls.uv.push(...uvs[k]); walls.col.push(col.r * ao, col.g * ao, col.b * ao);
        });
      }
    });

    // roof
    const toV = (ring) => { const a = []; for (let i = 0; i < ring.length; i += 2) a.push(new THREE.Vector2(ring[i], ring[i + 1])); return a; };
    const contour = toV(outer), holes = b.r.slice(1).map(toV);
    let tris;
    try { tris = THREE.ShapeUtils.triangulateShape(contour, holes); } catch (e) { return; }
    const all = contour.concat(...holes);
    const wx = ox + cx, wy = oy + cy;
    const inCore = Math.abs(wx - core[0]) < coreHalf * 0.98 && Math.abs(wy - core[1]) < coreHalf * 0.98;
    const m = inCore ? mCore : mWide, R = roofs[inCore ? 0 : 1];
    tris.forEach((t) => {
      // counter-clockwise when seen from above
      const [a, b2, c] = t.map((k) => all[k]);
      const cr = (b2.x - a.x) * (c.y - a.y) - (b2.y - a.y) * (c.x - a.x);
      const order = cr > 0 ? [a, b2, c] : [a, c, b2];
      order.forEach((p) => {
        R.pos.push(p.x, h, -p.y);
        R.uv.push((ox + p.x - m.bx0) / m.w, 1 - (m.by1 - (oy + p.y)) / m.h);
      });
    });
  });

  const group = new THREE.Group();
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(walls.pos, 3));
  wg.setAttribute('normal', new THREE.Float32BufferAttribute(walls.nor, 3));
  wg.setAttribute('uv', new THREE.Float32BufferAttribute(walls.uv, 2));
  wg.setAttribute('color', new THREE.Float32BufferAttribute(walls.col, 3));
  const wallMesh = new THREE.Mesh(wg, new THREE.MeshLambertMaterial({ map: facadeTexture(maxAniso, name), vertexColors: true }));
  group.add(wallMesh);
  roofs.forEach((R, i) => {
    if (!R.pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(R.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(R.uv, 2));
    const nor = new Float32Array(R.pos.length); for (let k = 1; k < nor.length; k += 3) nor[k] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    group.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: (i === 0 ? mCore : mWide).tex })));
  });
  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
  return { group, ox, oy, sec, count: data.buildings.length };
}
