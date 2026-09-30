// Generates the desktop shell's icons from the web app's own icon so the two
// never drift apart.
//
// Usage: npm run desktop:icons
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, "public", "icons", "icon-512.png");
const assetsDir = join(root, "desktop", "assets");

mkdirSync(assetsDir, { recursive: true });
copyFileSync(source, join(assetsDir, "icon.png"));
console.log("wrote desktop/assets/icon.png (512x512, from public/icons/icon-512.png)");

const sourceUrl = pathToFileURL(source).href;
const browser = await chromium.launch();
try {
  for (const { name, size } of [
    { name: "tray.png", size: 32 },
    { name: "tray@2x.png", size: 64 },
  ]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}img{width:${size}px;height:${size}px;display:block}</style><img src="${sourceUrl}">`,
    );
    await page.waitForFunction(() => document.querySelector("img")?.complete === true);
    writeFileSync(join(assetsDir, name), await page.screenshot({ omitBackground: true }));
    await page.close();
    console.log(`wrote desktop/assets/${name} (${size}x${size})`);
  }
} finally {
  await browser.close();
}
