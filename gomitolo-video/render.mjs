// Usage: node render.mjs <out.mp4|dir> <from> <to> [step]
// Renders frames [from, to) by driving scene.js in headless Chromium and pipes
// them into ffmpeg (or writes PNGs when the output is a directory).
import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { spawn } from 'child_process';
import fs from 'fs';
const [out, from = '0', to = '900', step = '1'] = process.argv.slice(2);
const port = process.env.PORT || 8765;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.error('[page]', m.text()); });
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${port}/index.html`);
await page.waitForFunction(() => window.sceneReady === true, null, { timeout: 300000 });
const toDir = !out.endsWith('.mp4');
let ff;
if (toDir) fs.mkdirSync(out, { recursive: true });
else {
  ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '30', '-c:v', 'png', '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', '15', '-pix_fmt', 'yuv420p', '-r', '30', out], { stdio: ['pipe', 'inherit', 'inherit'] });
}
const t0 = Date.now();
for (let f = +from; f < +to; f += +step) {
  const info = await page.evaluate((i) => window.renderFrame(i), f);
  const buf = await page.screenshot({ type: 'png' });
  if (toDir) fs.writeFileSync(`${out}/f${String(f).padStart(4, '0')}.png`, buf);
  else if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
  const el = (Date.now() - t0) / 1000, done = (f - +from) / +step + 1, total = Math.ceil((+to - +from) / +step);
  console.log(`frame ${f} shot ${info.shot} tiles ${info.tiles}  ${(el / done).toFixed(2)}s/f  eta ${((total - done) * el / done / 60).toFixed(1)} min`);
}
if (ff) { ff.stdin.end(); await new Promise((r) => ff.on('close', r)); }
await browser.close();
