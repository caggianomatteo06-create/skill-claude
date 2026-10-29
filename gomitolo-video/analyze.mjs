import fs from 'fs';
import { Path, simulate, FPS } from './timeline.js';
const path = new Path(JSON.parse(fs.readFileSync('data/route.json')));
const { frames } = simulate(path);
let prev = frames[0];
const rows = [];
for (const f of frames) {
  const ds = f.s - prev.s;
  rows.push({ t: f.t.toFixed(2), shot: f.shot, km: f.km.toFixed(3), mpp: f.mpp.toPrecision(3), Rm: f.R.toPrecision(3), Rpx: (f.R / f.mpp).toFixed(0), pxf: (ds / f.mpp).toFixed(1), radf: (ds / f.R).toFixed(2), tilt: f.tilt.toFixed(0), hdg: f.heading.toFixed(0) });
  prev = f;
}
for (let i = 0; i < rows.length; i += 10) console.log(Object.values(rows[i]).join('\t'));
const maxRad = Math.max(...rows.map(r => +r.radf)), maxPx = Math.max(...rows.map(r => +r.pxf));
console.log('max rad/frame', maxRad, 'max px/frame', maxPx);
