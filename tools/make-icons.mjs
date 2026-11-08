// Renders icons/icon.svg to the PNG app icons. Run after changing the SVG:
//   node tools/make-icons.mjs
// Needs Playwright with Chromium (not a dependency of the app).
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const svg = readFileSync('icons/icon.svg', 'utf8');
// [file, size, scale]: "any" icons fill more of the square; the maskable one keeps the
// artwork inside the 80% safe circle that Android crops to.
const outputs = [
  ['icons/icon-192.png', 192, 1.12],
  ['icons/icon-512.png', 512, 1.12],
  ['icons/icon-maskable-512.png', 512, 1],
  ['icons/apple-touch-icon.png', 180, 1.12],
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [file, size, scale] of outputs) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:#0d1117;overflow:hidden}svg{width:${size}px;height:${size}px;display:block;transform:scale(${scale})}</style>${svg}`,
  );
  await page.screenshot({ path: file, omitBackground: false });
}
await browser.close();
