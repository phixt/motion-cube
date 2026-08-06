// 手部标定页截图（开发用）：起 5174 后运行 node scripts/shot-hand-calib.mjs
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const OUT = "spike-shots";
if (!existsSync(OUT)) mkdirSync(OUT);
const executablePath = existsSync(CHROME) ? CHROME : EDGE;
const userDataDir = mkdtempSync(join(tmpdir(), "hand-calib-"));
const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: [
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
    `--user-data-dir=${userDataDir}`,
    "--window-size=1440,900",
  ],
  defaultViewport: { width: 1440, height: 900 },
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

const view = await page.evaluate(() => {
  const v = document.querySelector("#hand-calib-view");
  v.scrollIntoView({ block: "center" });
  const r = v.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
});
await sleep(800);
await page.screenshot({ path: `${OUT}/hand-calib.png` });
console.log("view:", JSON.stringify(view));
console.log("shot:", `${OUT}/hand-calib.png`);
await browser.close();
