/** Regenerate only app-owned icons from app-mark.svg. Leaves the historical Studio export intact.
 * node scripts/build-app-icons.ts; requires local Chromium (CHROMIUM override).
 * No network or running app needed. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const dir = join(import.meta.dirname, "../web/public/brand");
const mark = readFileSync(join(dir, "app-mark.svg"), "utf8");
const paths = mark.slice(mark.indexOf("  <g"), mark.lastIndexOf("</svg>"));
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <title>Struna</title>
  <metadata>App icon v1, derived from app-mark.svg; CC0-1.0. Foreground fits the maskable central safe circle.</metadata>
  <rect width="128" height="128" fill="#FFFAF0"/>
  <svg x="39" y="30" width="50" height="68" viewBox="0 0 28 34" fill="none" color="#315E4D">
${paths}  </svg>
</svg>
`;
writeFileSync(join(dir, "app-icon.svg"), svg);
writeFileSync(join(dir, "app-favicon.svg"), svg);
writeFileSync(join(dir, "app-favicon-16.svg"), svg);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : chromium.executablePath()), headless: true });
try {
  const page = await browser.newPage();
  for (const [name, size] of [["app-favicon.png", 48], ["app-apple-touch-icon.png", 180], ["app-icon-512.png", 512], ["app-icon-maskable-512.png", 512]] as const) {
    const data = await page.evaluate(async ({ svg, size }) => {
      const image = new Image();
      image.src = `data:image/svg+xml;base64,${btoa(svg)}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      canvas.getContext("2d")!.drawImage(image, 0, 0, size, size);
      return canvas.toDataURL("image/png").split(",")[1]!;
    }, { svg, size });
    writeFileSync(join(dir, name), Buffer.from(data, "base64"));
    console.log(`${name}: ${size}×${size}`);
  }
} finally {
  await browser.close();
}
