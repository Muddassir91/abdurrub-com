// Renders the CFoh! app icons (PNG) from an inline SVG using the bundled Chromium.
import { createRequire } from "node:module";
import { writeFileSync, mkdirSync } from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const svg = (pad) => `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="${pad ? 0 : 112}" fill="#4f46e5"/><text x="256" y="${pad ? 306 : 312}" text-anchor="middle" font-family="Inter, Helvetica, Arial, sans-serif" font-size="${pad ? 128 : 168}" font-weight="800" fill="#fff" letter-spacing="-6">CF<tspan font-style="italic">oh!</tspan></text></svg>`;
mkdirSync("public/icons", { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
for (const [name, size, pad] of [["icon-512.png", 512, false], ["icon-192.png", 192, false], ["apple-touch-icon.png", 180, false], ["maskable-512.png", 512, true]]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:${pad ? "#4f46e5" : "transparent"}">${svg(pad).replace('width="512" height="512"', `width="${size}" height="${size}"`)}</body></html>`);
  const buf = await page.screenshot({ omitBackground: !pad, type: "png" });
  writeFileSync(`public/icons/${name}`, buf);
  console.log("wrote", name);
}
writeFileSync("public/icons/icon.svg", svg(false));
await browser.close();
