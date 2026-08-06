// 标定页像素级验证：高分屏（dpr=2）下手应居中且不被裁剪。
// 运行（先起 5174）：node scripts/verify-hand-calib.mjs
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
    `--user-data-dir=${mkdtempSync(join(tmpdir(), "verify-hand-"))}`,
    "--window-size=1440,900",
  ],
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const page = await browser.newPage();
page.setDefaultTimeout(20000);
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));

await page.goto(`${process.env.SPIKE_URL ?? "http://localhost:5174/"}#/hand`, {
  waitUntil: "domcontentloaded",
  timeout: 30000,
});
await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForSelector("#hand-calib-view", { timeout: 15000 });
await sleep(2500);

const info = await page.evaluate(() => {
  const cv = document.querySelector("#hand-calib-view canvas");
  const cw = cv.clientWidth;
  const ch = cv.clientHeight;
  const c2 = document.createElement("canvas");
  c2.width = cv.width;
  c2.height = cv.height;
  const ctx = c2.getContext("2d");
  ctx.drawImage(cv, 0, 0);
  const data = ctx.getImageData(0, 0, cv.width, cv.height).data;
  let minX = cv.width;
  let maxX = -1;
  let minY = cv.height;
  let maxY = -1;
  let count = 0;
  for (let y = 0; y < cv.height; y += 2) {
    for (let x = 0; x < cv.width; x += 2) {
      const i = (y * cv.width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      // 皮肤色 #cfc0a8 容差 28；alpha>64 排除标尺/网格细线
      if (a > 64 && Math.abs(r - 207) < 28 && Math.abs(g - 192) < 28 && Math.abs(b - 168) < 28) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        count++;
      }
    }
  }
  const cx = (minX + maxX) / 2 / cv.width;
  const cy = (minY + maxY) / 2 / cv.height;
  return {
    canvasCss: [cw, ch],
    canvasBuf: [cv.width, cv.height],
    bbox: [minX, minY, maxX, maxY],
    center: [cx.toFixed(3), cy.toFixed(3)],
    count,
  };
});

console.log("info:", JSON.stringify(info));
if (info.count < 200) throw new Error("皮肤像素过少，手可能未渲染");
const [cx, cy] = info.center.map(Number);
if (Math.abs(cx - 0.5) > 0.12 || Math.abs(cy - 0.5) > 0.15) {
  throw new Error(`手未居中：center=${info.center.join(",")}`);
}
console.log("hand centered ok");
await browser.close();
