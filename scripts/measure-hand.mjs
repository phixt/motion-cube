// 测量编辑器 3D 视口里手/魔方的像素比例（当前渲染），用于校准缩放。
// 运行（先起 5174）：node scripts/measure-hand.mjs
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const URL = process.env.SPIKE_URL ?? "http://localhost:5174/";
const OUT = "spike-shots";
if (!existsSync(OUT)) mkdirSync(OUT);
const executablePath = existsSync(CHROME) ? CHROME : EDGE;
const userDataDir = mkdtempSync(join(tmpdir(), "measure-hand-"));
const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: [
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
    `--user-data-dir=${userDataDir}`,
    "--window-size=1280,800",
  ],
  defaultViewport: { width: 1280, height: 800 },
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const page = await browser.newPage();
page.setDefaultTimeout(20000);
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));

await page.goto(`${URL}#/library`, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForSelector("#btn-samples");
await page.click("#btn-samples");
await sleep(400);
await page.evaluate(() => (location.hash = "#/editor"));
await page.waitForSelector("#editor-view");
await sleep(2500);
// 选中 单拨 U
await page.evaluate(() => {
  const sel = document.querySelector("#tec-select");
  for (const o of sel.options) {
    if (o.textContent.includes("单拨 U")) {
      sel.value = o.value;
      sel.dispatchEvent(new Event("change"));
      break;
    }
  }
});
await sleep(1500);
// 视口居中
const rect = await page.evaluate(() => {
  const v = document.querySelector("#editor-view");
  v.scrollIntoView({ block: "center" });
  const r = v.getBoundingClientRect();
  return {
    x: Math.round(r.x),
    y: Math.round(r.y),
    w: Math.round(r.width),
    h: Math.round(r.height),
    raw: { x: r.x, y: r.y, w: r.width, h: r.height },
  };
});
await sleep(600);
const shot = `${OUT}/measure-hand.png`;
console.log("rect:", JSON.stringify(rect));
await page.screenshot({ path: shot });
console.log("screenshot:", shot);
await browser.close();
console.log("done");
