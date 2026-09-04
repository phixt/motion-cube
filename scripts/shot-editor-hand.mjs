// 编辑器默认手位截图（开发用）：起 5174 后运行 node scripts/shot-editor-hand.mjs
// 可选参数：SPIKE_HAND=left 切左手；SPIKE_OUT 覆盖输出文件名
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const OUT = "spike-shots";
if (!existsSync(OUT)) mkdirSync(OUT);
const executablePath = existsSync(CHROME) ? CHROME : EDGE;
const userDataDir = mkdtempSync(join(tmpdir(), "editor-hand-"));
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

await page.goto(`${process.env.SPIKE_URL ?? "http://localhost:5174/"}#/editor`, {
  waitUntil: "domcontentloaded",
  timeout: 30000,
});
await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForSelector("#editor-view", { timeout: 15000 });
await sleep(2500);
// 可选：SPIKE_KF=1 先加载示例库并选中首个手法，展示关键帧编辑面板（含拇指 CMC 输入）
if (process.env.SPIKE_KF) {
  await page.evaluate(() => (location.hash = "#/library"));
  await sleep(800);
  await page.click("#btn-samples");
  await sleep(600);
  await page.evaluate(() => (location.hash = "#/editor"));
  await sleep(1500);
  await page.evaluate(() => {
    const item = document.querySelector(".tec-item");
    if (item) item.click();
  });
  await sleep(1200);
  const band = await page.$(".tl-step-band");
  if (band) {
    const b = await band.boundingBox();
    if (b) await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  }
  await sleep(800);
}

if (process.env.SPIKE_HAND) {
  await page.evaluate((hand) => {
    const sel = document.querySelector("#view-hand");
    if (sel) {
      sel.value = hand;
      sel.dispatchEvent(new Event("change"));
    }
  }, process.env.SPIKE_HAND);
  await sleep(1200);
}

await page.evaluate(() => {
  const v = document.querySelector("#editor-view");
  v.scrollIntoView({ block: "center" });
});
await sleep(800);
const shot = `${OUT}/editor-hand-${process.env.SPIKE_HAND ?? "right"}.png`;
await page.screenshot({ path: shot });
console.log("shot:", shot);
await browser.close();
