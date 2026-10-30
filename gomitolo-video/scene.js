import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Path, simulate, W, H, FPS, MERC_TILE, THREAD_RATIO, smooth } from './timeline.js';
import { buildCity } from './city.js';

const ER = 6378137, HALF = Math.PI * ER;
const MAX_Z = 19, DEM_MAX_Z = 11, GRID = 24;
const SUN = new THREE.Vector3(0.369, 0.819, 0.440).normalize(); // from the south-east, 55 deg high
const HAZE = new THREE.Color(0xb7c3cc);
const WOOL = new THREE.Color(0xa3122a);
const WORLD_UP = new THREE.Vector3(0, 1, 0);

// ---------- renderer / scene ----------
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const maxAniso = renderer.capabilities.getMaxAnisotropy();

const scene = new THREE.Scene();
scene.background = HAZE.clone();
scene.fog = new THREE.Fog(HAZE, 1, 2);
const camera = new THREE.PerspectiveCamera(30, W / H, 1, 10);

const hemi = new THREE.HemisphereLight(0xe6edf5, 0x5a5040, 0.62 * Math.PI);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1dc, 0.50 * Math.PI);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.radius = 4;
scene.add(sun, sun.target);

// ---------- procedural textures ----------
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// Height field of a 3-ply twisted yarn: helical grooves plus fibre noise.
function yarnHeight(w, h) {
  const a = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = ((x / w) * 3 + (y / h) * 3) % 1;
    a[y * w + x] = Math.pow(Math.sin(Math.PI * p), 0.6);
  }
  for (let k = 0; k < 2200; k++) { // stray fibres following the twist
    let x = rnd() * w, y = rnd() * h; const len = 6 + rnd() * 22, amp = 0.25 + rnd() * 0.35;
    for (let i = 0; i < len; i++) { x += 0.7 + rnd() * 0.3; y += 0.7 + rnd() * 0.3; const xi = Math.floor(x) % w, yi = Math.floor(y) % h; a[yi * w + xi] = Math.min(1.2, a[yi * w + xi] + amp * 0.5); }
  }
  return a;
}
function normalFrom(hf, w, h, strength) {
  return canvasTex(w, h, (g) => {
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const hx = hf[y * w + ((x + 1) % w)] - hf[y * w + ((x - 1 + w) % w)];
      const hy = hf[((y + 1) % h) * w + x] - hf[((y - 1 + h) % h) * w + x];
      const n = new THREE.Vector3(-hx * strength, -hy * strength, 1).normalize();
      const i = (y * w + x) * 4;
      img.data[i] = (n.x * 0.5 + 0.5) * 255; img.data[i + 1] = (n.y * 0.5 + 0.5) * 255; img.data[i + 2] = (n.z * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, false);
}
function shadeFrom(hf, w, h) {
  return canvasTex(w, h, (g) => {
    const img = g.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const v = 0.55 + 0.45 * Math.min(1, hf[i]);
      img.data[i * 4] = 255 * v; img.data[i * 4 + 1] = 255 * v; img.data[i * 4 + 2] = 255 * v; img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  });
}
const YW = 128, YH = 128;
const yarnHF = yarnHeight(YW, YH);
const yarnNormal = normalFrom(yarnHF, YW, YH, 2.2);
const yarnShade = shadeFrom(yarnHF, YW, YH);

const woolMat = new THREE.MeshPhysicalMaterial({
  color: WOOL, map: yarnShade, normalMap: yarnNormal, normalScale: new THREE.Vector2(1.1, 1.1),
  roughness: 0.92, metalness: 0, sheen: 1, sheenColor: new THREE.Color(0xff8a8a), sheenRoughness: 0.55,
});

// ---------- the ball of yarn (unit radius) ----------
function tubeAlong(points, radius, radial, uScale, fixedUp = null) {
  const n = points.length, pos = [], nor = [], uv = [], idx = [];
  const T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3(), up = new THREE.Vector3();
  let arc = 0;
  for (let i = 0; i < n; i++) {
    const p = points[i], a = points[Math.max(0, i - 1)], b = points[Math.min(n - 1, i + 1)];
    T.subVectors(b, a).normalize();
    if (i > 0) arc += p.distanceTo(points[i - 1]);
    if (fixedUp) up.copy(fixedUp); else up.copy(p.lengthSq() > 0 ? p : new THREE.Vector3(0, 1, 0)).normalize();
    N.crossVectors(T, up); if (N.lengthSq() < 1e-8) N.set(1, 0, 0); N.normalize();
    B.crossVectors(N, T).normalize();
    for (let j = 0; j <= radial; j++) {
      const th = (j / radial) * Math.PI * 2, c = Math.cos(th), s = Math.sin(th);
      const nx = N.x * c + B.x * s, ny = N.y * c + B.y * s, nz = N.z * c + B.z * s;
      pos.push(p.x + nx * radius, p.y + ny * radius, p.z + nz * radius);
      nor.push(nx, ny, nz);
      uv.push(arc * uScale, j / radial);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function buildBall() {
  const group = new THREE.Group();
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.955, 96, 64), woolMat.clone());
  core.material.color = WOOL.clone().multiplyScalar(0.72);
  core.material.map = yarnShade.clone(); core.material.map.repeat.set(10, 5); core.material.map.needsUpdate = true;
  core.material.normalMap = yarnNormal.clone(); core.material.normalMap.repeat.set(10, 5); core.material.normalMap.needsUpdate = true;
  group.add(core);

  const strandR = THREAD_RATIO, bands = 24, perBand = 7, geos = [];
  const rand3 = () => new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize();
  for (let b = 0; b < bands; b++) {
    const nBand = rand3();
    const m = new THREE.Vector3().crossVectors(nBand, rand3()).normalize(); // strands pivot about m
    for (let k = 0; k < perBand; k++) {
      const ang = (k - (perBand - 1) / 2) * strandR * 2.15;
      const nrm = nBand.clone().applyAxisAngle(m, ang);
      const e1 = m.clone(), e2 = new THREE.Vector3().crossVectors(nrm, e1).normalize();
      const pts = [], segs = 220, ph = rnd() * 6.28;
      const span = b === bands - 1 && k === perBand - 1 ? 0.8 : 1; // the outermost strand is the loose end
      for (let i = 0; i <= segs; i++) {
        const th = (i / segs) * Math.PI * 2 * span;
        const r = 0.972 + 0.022 * (b / bands) + 0.006 * Math.sin(3 * th + ph) + 0.004 * Math.sin(7 * th + ph * 2);
        pts.push(e1.clone().multiplyScalar(Math.cos(th)).addScaledVector(e2, Math.sin(th)).multiplyScalar(r));
      }
      geos.push(tubeAlong(pts, strandR, 8, 1 / (Math.PI * 2 * strandR)));
    }
  }
  const strands = new THREE.Mesh(mergeGeometries(geos), woolMat);
  group.add(strands);
  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return group;
}

const ball = buildBall();
scene.add(ball);

// Soft contact occlusion under the ball.
const contactTex = canvasTex(256, 256, (g, w, h) => {
  const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  gr.addColorStop(0, 'rgba(0,0,0,0.75)'); gr.addColorStop(0.35, 'rgba(0,0,0,0.42)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
});
const contact = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: contactTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
contact.rotation.x = -Math.PI / 2;
contact.renderOrder = 2;
scene.add(contact);

// ---------- yarn laid on the ground ----------
const threadMat = woolMat.clone();
threadMat.normalMap = yarnNormal; threadMat.map = yarnShade;
threadMat.onBeforeCompile = (sh) => {
  sh.uniforms.depthBias = threadBias;
  sh.vertexShader = 'uniform float depthBias;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
    vec4 mvB = mvPosition; mvB.xyz -= normalize(mvB.xyz) * depthBias; gl_Position = projectionMatrix * mvB;`);
};
const threadBias = { value: 0 };
const thread = new THREE.Mesh(new THREE.BufferGeometry(), threadMat);
thread.castShadow = true; thread.receiveShadow = true; thread.frustumCulled = false;
scene.add(thread);

// ---------- tiles: imagery + elevation ----------
const texCache = new Map(), demCache = new Map(), meshCache = new Map();
const texLoader = new THREE.TextureLoader();
const tileSize = (z) => (2 * HALF) / 2 ** z;
const key = (z, x, y) => `${z}/${x}/${y}`;

function loadTex(z, x, y) {
  const k = key(z, x, y);
  if (!texCache.has(k)) {
    texCache.set(k, new Promise((res) => {
      texLoader.load(`tiles/sat/${k}`, (t) => {
        t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso;
        t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.minFilter = THREE.LinearMipmapLinearFilter;
        res(t);
      }, undefined, () => res(null));
    }));
  }
  return texCache.get(k);
}

function loadDem(z, x, y) {
  const k = key(z, x, y);
  if (!demCache.has(k)) {
    const p = fetch(`tiles/dem/${k}`).then((r) => (r.ok ? r.blob() : null)).then(async (b) => {
      if (!b) return null;
      const bmp = await createImageBitmap(b);
      const c = new OffscreenCanvas(256, 256), g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(bmp, 0, 0);
      const d = g.getImageData(0, 0, 256, 256).data, e = new Float32Array(65536);
      for (let i = 0; i < 65536; i++) e[i] = Math.max(0, d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768);
      p.data = e;
      return e;
    }).catch(() => null);
    demCache.set(k, p);
  }
  return demCache.get(k);
}

// Elevation (m) at a mercator point from the finest loaded DEM at or below z.
function elevation(mx, my, z) {
  for (let zz = Math.min(z, DEM_MAX_Z); zz >= 0; zz--) {
    const s = tileSize(zz), fx = (mx + HALF) / s, fy = (HALF - my) / s;
    const tx = Math.floor(fx), ty = Math.floor(fy);
    const p = demCache.get(key(zz, tx, ty));
    if (!p || !p.data) continue;
    const d = p.data;
    const px = Math.min(255, Math.max(0, (fx - tx) * 256 - 0.5)), py = Math.min(255, Math.max(0, (fy - ty) * 256 - 0.5));
    const x0 = Math.floor(px), y0 = Math.floor(py), x1 = Math.min(255, x0 + 1), y1 = Math.min(255, y0 + 1), u = px - x0, v = py - y0;
    return (d[y0 * 256 + x0] * (1 - u) + d[y0 * 256 + x1] * u) * (1 - v) + (d[y1 * 256 + x0] * (1 - u) + d[y1 * 256 + x1] * u) * v;
  }
  return 0;
}
const secLat = (my) => Math.cosh(my / ER); // mercator scale factor
const demZoomFor = (z) => Math.min(z, DEM_MAX_Z);
const demTileFor = (z, x, y) => { const dz = demZoomFor(z), sh = z - dz; return [dz, x >> sh, y >> sh]; };

function tileGeometry(z, x, y, ex) {
  const s = tileSize(z), x0 = -HALF + x * s, y0 = HALF - y * s, dz = demZoomFor(z);
  const n = GRID, pos = [], uv = [], idx = [];
  const hAt = (i, j) => elevation(x0 + (i / n) * s, y0 - (j / n) * s, dz) * secLat(y0 - (j / n) * s) * ex;
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) { pos.push((i / n) * s, hAt(i, j), (j / n) * s); uv.push(i / n, 1 - j / n); }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i; idx.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2); }
  const tmpG = new THREE.BufferGeometry();
  tmpG.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); tmpG.setIndex(idx.slice()); tmpG.computeVertexNormals();
  const nor = Array.from(tmpG.getAttribute('normal').array); tmpG.dispose();
  // skirts hide cracks between neighbouring tiles of different detail
  const skirt = s * 0.03 + 50 * ex;
  const ring = [];
  for (let i = 0; i <= n; i++) ring.push(i);
  for (let j = 1; j <= n; j++) ring.push(j * (n + 1) + n);
  for (let i = n - 1; i >= 0; i--) ring.push(n * (n + 1) + i);
  for (let j = n - 1; j >= 0; j--) ring.push(j * (n + 1));
  const base = pos.length / 3;
  ring.forEach((v) => { pos.push(pos[v * 3], pos[v * 3 + 1] - skirt, pos[v * 3 + 2]); uv.push(uv[v * 2], uv[v * 2 + 1]); nor.push(nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]); });
  for (let k = 0; k < ring.length - 1; k++) { const a = ring[k], b = ring[k + 1], c = base + k, d = base + k + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

const tileGroup = new THREE.Group();
scene.add(tileGroup);
const frustum = new THREE.Frustum(), projScreen = new THREE.Matrix4(), box = new THREE.Box3(), tmpV = new THREE.Vector3();

function selectTiles(O, ex) {
  projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(projScreen);
  const k = (2 * Math.tan((camera.fov * Math.PI) / 360)) / H;
  const out = [];
  const maxH = 4900 * 1.6 * ex + 10;
  const visit = (z, x, y) => {
    const s = tileSize(z), x0 = -HALF + x * s - O.x, z0 = -(HALF - y * s - O.y);
    box.min.set(x0, -10, z0); box.max.set(x0 + s, maxH, z0 + s);
    if (!frustum.intersectsBox(box)) return;
    box.clampPoint(camera.position, tmpV);
    const d = Math.max(tmpV.distanceTo(camera.position), camera.near);
    const want = Math.log2(MERC_TILE / (d * k)) + 0.35;
    if (z < MAX_Z && z < want && out.length < 900) {
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) visit(z + 1, x * 2 + dx, y * 2 + dy);
    } else out.push([z, x, y]);
  };
  visit(0, 0, 0);
  return out;
}

async function textureFor(z, x, y) {
  // fall back to an ancestor tile (with a sub-rectangle) when a tile is missing
  let zz = z, xx = x, yy = y;
  while (zz >= 0) {
    const t = await loadTex(zz, xx, yy);
    if (t) {
      const sh = z - zz, n = 2 ** sh;
      return { t, ox: (x - xx * n) / n, oy: (y - yy * n) / n, sc: 1 / n };
    }
    zz--; xx >>= 1; yy >>= 1;
  }
  return null;
}

async function buildTiles(O, ex) {
  const list = selectTiles(O, ex);
  await Promise.all(list.map(([z, x, y]) => { const [dz, dx, dy] = demTileFor(z, x, y); return loadDem(dz, dx, dy); }));
  const texs = await Promise.all(list.map(([z, x, y]) => textureFor(z, x, y)));
  tileGroup.clear();
  const exq = Math.round(ex * 100) / 100;
  list.forEach(([z, x, y], i) => {
    const tx = texs[i]; if (!tx) return;
    const mk = `${key(z, x, y)}@${exq}`;
    let m = meshCache.get(mk);
    if (!m) {
      const mat = new THREE.MeshLambertMaterial({ map: tx.t });
      if (tx.sc !== 1) { mat.map = tx.t.clone(); mat.map.needsUpdate = true; mat.map.repeat.set(tx.sc, tx.sc); mat.map.offset.set(tx.ox, 1 - tx.oy - tx.sc); }
      m = new THREE.Mesh(tileGeometry(z, x, y, exq), mat);
      m.receiveShadow = true;
      m.userData = { z, x, y };
      meshCache.set(mk, m);
      if (meshCache.size > 2500) { // simple eviction of the oldest meshes
        const [ok, om] = meshCache.entries().next().value; meshCache.delete(ok); om.geometry.dispose(); if (om.material.map !== tx.t) om.material.dispose();
      }
    }
    const s = tileSize(z);
    m.position.set(-HALF + x * s - O.x, 0, -(HALF - y * s - O.y));
    tileGroup.add(m);
  });
  return list.length;
}

// ---------- thread geometry rebuilt each frame ----------
function noise1(x) { const i = Math.floor(x), f = x - i, h = (n) => { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); }; const u = f * f * (3 - 2 * f); return (h(i) * (1 - u) + h(i + 1) * u) * 2 - 1; }

function buildThread(P, fr, O, ex, dz, ballC, R) {
  const rt = R * THREAD_RATIO;
  const sEnd = Math.max(0, fr.s - 0.5 * R);
  const k = (2 * Math.tan((camera.fov * Math.PI) / 360)) / H;
  const camP = camera.position;
  const pts = [];
  const iEnd = P.index(sEnd);
  const push = (mx, my, s) => {
    // gentle lateral meander of the laid yarn (fixed in metres, so it never "breathes")
    const d = P.dir(s, 1.5);
    const off = 0.35 * noise1(s / 3.1) + 0.12 * noise1(s / 0.9 + 17);
    const X = mx - d.y * off, Y = my + d.x * off;
    const hgt = elevation(X, Y, dz) * secLat(Y) * ex + rt * 0.92;
    pts.push(new THREE.Vector3(X - O.x, hgt, -(Y - O.y)));
  };
  // adaptive decimation: keep a vertex every ~1.2 px as seen from the camera
  let last = null;
  for (let i = 0; i <= iEnd; i++) {
    const x = P.x[i], y = P.y[i];
    if (last) {
      tmpV.set(x - O.x, 0, -(y - O.y));
      const d = tmpV.distanceTo(camP);
      const tol = Math.max(rt * 0.6, 1.2 * d * k);
      if (Math.hypot(x - last[0], y - last[1]) < tol && i !== iEnd) continue;
    }
    // densify long straight segments so the yarn follows the terrain
    if (last) {
      const seg = Math.hypot(x - last[0], y - last[1]), d = Math.max(camera.near, tmpV.distanceTo(camP));
      const step = Math.max(rt, 6 * d * k);
      const n = Math.min(200, Math.floor(seg / step));
      for (let j = 1; j < n; j++) { const u = j / n; push(last[0] + (x - last[0]) * u, last[1] + (y - last[1]) * u, last[2] + (P.s[i] - last[2]) * u); }
    }
    push(x, y, P.s[i]);
    last = [x, y, P.s[i]];
  }
  const tail = P.at(sEnd);
  push(tail.x, tail.y, sEnd);
  // the free strand rises from the ground into the back of the ball
  const dir = new THREE.Vector3(fr.dx, 0, -fr.dy).normalize();
  const g0 = pts[pts.length - 1];
  const exitP = ballC.clone().addScaledVector(dir, -0.55 * R).add(new THREE.Vector3(0, -0.8 * R, 0));
  const mid = g0.clone().lerp(exitP, 0.5); mid.y = g0.y + (exitP.y - g0.y) * 0.25;
  if (fr.s > 0.3 * R) { pts.push(mid, exitP); }
  if (pts.length < 2) { thread.visible = false; return; }
  thread.visible = true;
  thread.geometry.dispose();
  thread.geometry = tubeAlong(pts, rt, 8, 1 / (Math.PI * 2 * rt), WORLD_UP);
  threadBias.value = rt * 2.5;
}

// ---------- overlays ----------
const $ = (id) => document.getElementById(id);
const grain = $('grain').getContext('2d');
const grainImg = grain.createImageData(960, 540);
const PLACES = [
  [0, 12, 'Lombardia', 'Milano, Brera'], [12, 140, 'Italia', 'Pianura Padana'], [140, 215, 'Italia', "Valle d'Aosta"],
  [215, 248, 'Alpi', 'Traforo del Monte Bianco'], [248, 330, 'Francia', 'Alta Savoia'], [330, 470, 'Francia', 'Giura'],
  [470, 690, 'Francia', 'Borgogna'], [690, 900, 'Francia', 'Champagne'], [900, 1110, 'Francia', 'Hauts-de-France'],
  [1110, 1137, 'Francia', 'Calais'], [1137, 1192, 'Sotto la Manica', 'Eurotunnel'], [1192, 1272, 'Inghilterra', 'Kent'],
  [1272, 1310, 'Inghilterra', 'Londra'],
];
const fade = (t, a, b, f = 0.5) => smooth((t - a) / f) * (1 - smooth((t - b + f) / f));
let lastPlace = '';
function updateOverlay(fr, fi) {
  const t = fr.t;
  $('titleStart').style.opacity = fade(t, 0.25, 3.45, 0.6);
  $('titleStart').style.transform = `translateY(${(1 - smooth((t - 0.25) / 1.2)) * 24}px)`;
  $('titleEnd').style.opacity = smooth((t - 28.0) / 0.8);
  $('titleEnd').style.transform = `translateY(${(1 - smooth((t - 28.0) / 1.4)) * 24}px)`;
  $('counter').style.opacity = fade(t, 3.6, 28.4, 0.6);
  $('km').textContent = Math.round(fr.km).toLocaleString('it-IT');
  const pl = PLACES.find((p) => fr.km >= p[0] && fr.km < p[1]) || PLACES[PLACES.length - 1];
  $('placeK').textContent = pl[2]; $('placeN').textContent = pl[3];
  // fade in/out around each change of region
  const a = (fr.km - pl[0]) / Math.max(1e-6, fr.speedKm), b = (pl[1] - fr.km) / Math.max(1e-6, fr.speedKm);
  $('place').style.opacity = t < 3.8 || t > 27.8 ? 0 : Math.min(1, a / 0.35, b / 0.35, (t - 3.8) / 0.5, (27.8 - t) / 0.5);
  lastPlace = pl[3];
  // film grain, deterministic per frame
  let s = fi * 9301 + 49297;
  for (let i = 0; i < grainImg.data.length; i += 4) { s = (s * 1103515245 + 12345) & 0x7fffffff; const v = 128 + ((s >> 16) % 110) - 55; grainImg.data[i] = grainImg.data[i + 1] = grainImg.data[i + 2] = v; grainImg.data[i + 3] = 255; }
  grain.putImageData(grainImg, 0, 0);
}

// ---------- per-frame ----------
const routeData = await (await fetch('data/route.json')).json();
const P = new Path(routeData);
const { frames } = simulate(P);
frames.forEach((f, i) => { const p = frames[Math.max(0, i - 1)]; f.speedKm = Math.max(1e-4, (f.km - p.km) * FPS); });
// coarse elevation everywhere along the route, so any point has a fallback
{
  const z = 6, s = tileSize(z), xs = P.x, ys = P.y; const need = new Set();
  for (let i = 0; i < P.n; i += 50) need.add(key(z, Math.floor((xs[i] + HALF) / s), Math.floor((HALF - ys[i]) / s)));
  await Promise.all([...need].map((k) => loadDem(...k.split('/').map(Number))));
}
await document.fonts.ready;
await Promise.all(['150px Cormorant', 'italic 54px Cormorant', '20px InterL', '500 16px InterL'].map((f) => document.fonts.load(f)));

// 3D buildings around the start (Brera) and the finish (Harrods)
const cities = await Promise.all([
  buildCity('milano', [P.x[0], P.y[0]], maxAniso),
  buildCity('london', [P.x[P.n - 1], P.y[P.n - 1]], maxAniso),
]);
cities.forEach((c) => scene.add(c.group));
const CITY_MAX_MPP = 14;

const exagFor = (mpp) => 1.9 * smooth((Math.log10(mpp) - Math.log10(4)) / (Math.log10(120) - Math.log10(4)));

window.renderFrame = async function renderFrame(fi) {
  const fr = frames[fi];
  const O = { x: fr.tx, y: fr.ty };
  const ex = exagFor(fr.mpp);
  const dz = Math.max(3, Math.min(DEM_MAX_Z, Math.round(Math.log2(MERC_TILE / fr.mpp)) - 1));
  // DEM under the ball and target
  const st = tileSize(dz);
  const around = [];
  for (const [mx, my] of [[fr.bx, fr.by], [fr.tx, fr.ty]]) for (const ox of [-1, 0, 1]) for (const oy of [-1, 0, 1]) around.push([dz, Math.floor((mx + HALF) / st) + ox, Math.floor((HALF - my) / st) + oy]);
  await Promise.all(around.map((a) => loadDem(...a)));

  // ball rests on the highest ground under its footprint (rigid sphere contact)
  const R = fr.R;
  let cy = -Infinity;
  for (let a = 0; a < 3; a++) for (let k = 0; k < (a === 0 ? 1 : 8); k++) {
    const rr = a * 0.33 * R, th = (k / 8) * Math.PI * 2;
    const mx = fr.bx + Math.cos(th) * rr, my = fr.by + Math.sin(th) * rr;
    const g = elevation(mx, my, dz) * secLat(my) * ex;
    cy = Math.max(cy, g + Math.sqrt(R * R - rr * rr));
  }
  const ground = elevation(fr.bx, fr.by, dz) * secLat(fr.by) * ex;
  const ballC = new THREE.Vector3(fr.bx - O.x, cy, -(fr.by - O.y));
  ball.position.copy(ballC);
  ball.quaternion.set(fr.q[0], fr.q[1], fr.q[2], fr.q[3]);
  ball.scale.setScalar(R);
  contact.position.set(ballC.x, ground + R * 0.01, ballC.z);
  contact.scale.setScalar(R * 2.3);

  // camera
  const hr = (fr.heading * Math.PI) / 180, tr = (fr.tilt * Math.PI) / 180;
  const fwd = new THREE.Vector3(Math.sin(hr), 0, -Math.cos(hr));
  const tgtY = elevation(fr.tx, fr.ty, dz) * secLat(fr.ty) * ex + R * 0.6;
  const target = new THREE.Vector3(0, tgtY, 0);
  camera.fov = fr.fov;
  camera.position.copy(target).addScaledVector(fwd, -fr.dist * Math.sin(tr)).add(new THREE.Vector3(0, fr.dist * Math.cos(tr), 0));
  camera.up.copy(fwd).multiplyScalar(Math.cos(tr)).add(new THREE.Vector3(0, Math.sin(tr), 0)).normalize();
  camera.near = Math.max(0.05, fr.dist * 0.03);
  camera.far = fr.dist * 40;
  camera.lookAt(target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  scene.fog.near = fr.dist * (1.3 + 2 * (1 - Math.sin(tr)));
  scene.fog.far = fr.dist * (6 + 10 * (1 - Math.sin(tr)));

  // city blocks: placed relative to the floating origin, hidden when too far up
  let cityOn = false;
  for (const c of cities) {
    const near = fr.mpp < CITY_MAX_MPP && Math.hypot(c.ox - O.x, c.oy - O.y) < 30000;
    c.group.visible = near;
    if (near) { cityOn = true; c.group.position.set(c.ox - O.x, elevation(c.ox, c.oy, dz) * secLat(c.oy) * ex, -(c.oy - O.y)); }
  }

  // sun + shadow volume: around the ball, or the whole view when buildings are up
  const E = cityOn ? Math.max(R * 4, Math.min(fr.mpp * W * 0.75 * (1 + 1.5 * Math.sin(tr)), 1400)) : R * 4;
  const shC = cityOn ? new THREE.Vector3(0, ballC.y, 0).lerp(ballC, 0.5) : ballC;
  const lightD = Math.max(R * 20, E * 2 + 300);
  sun.position.copy(shC).addScaledVector(SUN, lightD);
  sun.target.position.copy(shC);
  const sc = sun.shadow.camera;
  sc.left = -E; sc.right = E; sc.top = E; sc.bottom = -E; sc.near = lightD * 0.2; sc.far = lightD * 2;
  sc.updateProjectionMatrix();
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = Math.max(R * 0.01, E / 4096);

  const t0 = performance.now();
  const nt = await buildTiles(O, ex);
  const t1 = performance.now();
  buildThread(P, fr, O, ex, dz, ballC, R);
  updateOverlay(fr, fi);
  const t2 = performance.now();
  renderer.render(scene, camera);
  renderer.getContext().finish();
  const t3 = performance.now();
  return { tiles: nt, shot: fr.shot, t: fr.t, ms: [t1 - t0, t2 - t1, t3 - t2].map(Math.round) };
};
window.NFRAMES = frames.length;
window.sceneReady = true;
