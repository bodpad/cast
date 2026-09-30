// Renders docs/demo/scene.html frame by frame into docs/demo.gif.
// Usage: npm run demo (needs Google Chrome and gifski: https://gif.ski)
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const FPS = 10;
const WIDTH = 1200;
const dir = dirname(fileURLToPath(import.meta.url));
const frames = join(dir, '.frames');
const out = join(dir, '..', 'demo.gif');

try {
  execFileSync('gifski', ['--version'], { stdio: 'ignore' });
} catch {
  console.error('gifski is not installed: get it from https://gif.ski (snap install gifski, or the release binary)');
  process.exit(1);
}

rmSync(frames, { recursive: true, force: true });
mkdirSync(frames);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 675 } });
page.on('pageerror', e => { console.error(e); process.exit(1); });
await page.goto(pathToFileURL(join(dir, 'scene.html')).href + '?render=1');
const duration = await page.evaluate(() => window.DURATION);
const count = Math.ceil(duration / 1000 * FPS);
for (let i = 0; i < count; i++) {
  await page.evaluate(ms => window.renderAt(ms), i * 1000 / FPS);
  await page.screenshot({ path: join(frames, `${String(i).padStart(4, '0')}.png`) });
  if (i % FPS === 0) process.stdout.write(`\rframes ${i}/${count}`);
}
await browser.close();
console.log(`\rframes ${count}/${count}`);

const files = readdirSync(frames).sort().map(f => join(frames, f));
execFileSync('gifski', ['--fps', String(FPS), '--width', String(WIDTH), '--quality', '75', '--lossy-quality', '60', '--motion-quality', '60', '-o', out, ...files], { stdio: 'inherit' });
rmSync(frames, { recursive: true, force: true });
console.log(`${out}: ${(statSync(out).size / 1e6).toFixed(1)} MB`);
