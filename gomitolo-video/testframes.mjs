import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)('playwright');
import fs from 'fs';
const frames = process.argv.slice(2).map(Number);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.error('[page]', m.text()); });
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
await page.goto('http://127.0.0.1:8765/index.html');
await page.waitForFunction(() => window.sceneReady === true, null, { timeout: 300000 });
for (const f of frames) {
  const t = Date.now();
  const info = await page.evaluate((i) => window.renderFrame(i), f);
  await page.screenshot({ path: `test/f${f}.jpg`, type: 'jpeg', quality: 85 });
  console.log(f, JSON.stringify(info), (Date.now() - t) / 1000, 's');
}
await browser.close();
