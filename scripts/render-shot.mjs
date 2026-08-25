// R1 阶段1 渲染宿主视觉验证：/render-demo 初始视角 → 模拟拖转 → 打乱连播 → 撤销，
// 最后对照 cubing 默认（/editor）视角。输出 spike-shots/render-*.png + 拖转 info 文本。
// 运行：node scripts/render-shot.mjs（dev server 需已起，默认 http://127.0.0.1:5174）
import { existsSync, mkdirSync } from "node:fs";
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = process.env.SPIKE_URL ?? "http://localhost:5174/";
const OUT = "spike-shots";
if (!existsSync(OUT)) mkdirSync(OUT);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const executablePath = existsSync(CHROME) ? CHROME : EDGE;
const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--window-size=1280,800"],
  defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
page.setDefaultTimeout(25000);
const shot = async (p) => {
  await page.screenshot({ path: `${OUT}/${p}` });
  console.log(`shot: ${p}`);
};

// ---- /render-demo：初始 ----
await page.goto(BASE + "#/render-demo", { waitUntil: "networkidle0", timeout: 30000 });
await page.waitForSelector(".rstage canvas", { timeout: 20000 });
await sleep(1500); // 等首帧渲染
await shot("render-initial.png");
console.log("initial info:", await page.$eval(".rinfo", (el) => el.textContent));

// ---- 模拟拖转：拾面中心偏上、向右拖 130px ----
const box = await page.$eval(".rstage", (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
const cx = box.x + box.w / 2;
const cy = box.y + box.h * 0.42;
await page.mouse.move(cx, cy);
await page.mouse.down();
await sleep(60);
await page.mouse.move(cx + 130, cy, { steps: 14 });
await sleep(60);
await page.mouse.up();
await sleep(1500); // 吸附动画完成
await shot("render-after-drag.png");
console.log("after drag info:", await page.$eval(".rinfo", (el) => el.textContent));
console.log("last manual:", await page.evaluate(() => JSON.stringify(window.__lastManual ?? null)));

// ---- 打乱 ×20（连播） ----
const btns = await page.$$(".rbar button");
for (const h of btns) {
  const t = await h.evaluate((e) => e.textContent);
  if (t.includes("打乱")) {
    await h.click();
    break;
  }
}
await sleep(4000); // 20 步连播（每步 ~300ms）
await shot("render-scrambled.png");
console.log("scrambled info:", await page.$eval(".rinfo", (el) => el.textContent));

// ---- 撤销一步 ----
for (const h of await page.$$(".rbar button")) {
  const t = await h.evaluate((e) => e.textContent);
  if (t.includes("撤销")) {
    await h.click();
    break;
  }
}
await sleep(400);
await shot("render-after-undo.png");

// ---- 对照：cubing 默认 /editor ----
await page.goto(BASE + "#/editor", { waitUntil: "networkidle0", timeout: 30000 });
await page.waitForSelector("twisty-player", { timeout: 20000 });
await sleep(2000);
await shot("editor-cubing.png");

await browser.close();
console.log("DONE");