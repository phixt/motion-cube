// probe-render-dispose.mjs — 渲染后端 dispose 残留 DOM 探针（针对 947e9fd 之前真机崩溃
// root cause：RenderCubeHost.dispose 未移除自己 canvas → HMR/卸载残留 → 全屏黑底叠加 + 双实例）。
// 验证路径（DOM 计数是可 headless 测的残留信号）：
//   1) 进 #/render-demo：.rstage canvas 恰好 1 个、无 document.body 直接子 canvas；
//   2) 切到 #/editor 再回 #/render-demo（往返 3 次）：每轮返回后 .rstage canvas 仍 1、
//      无额外叠加 canvas——dispose 完整（host canvas.remove + forceContextLoss）。
// 运行：node scripts/probe-render-dispose.mjs（dev server 5174 需已起；Windows pwsh 跑）
import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = process.env.SPIKE_URL ?? "http://localhost:5174/";

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

const rstageCanvasCount = () =>
  page.evaluate(() => {
    const inStage = document.querySelectorAll(".rstage canvas").length;
    const bodyDirectCanvas = [...document.body.children].filter((c) => c.tagName === "CANVAS").length;
    return { inStage, bodyDirectCanvas };
  });

let fail = 0;
const check = (label, cond, extra = "") => {
  if (!cond) { fail++; console.log(`FAIL ${label}${extra ? " :: " + extra : ""}`); }
  else console.log(`PASS ${label}`);
};

// 初始进 render-demo
await page.goto(BASE + "#/render-demo", { waitUntil: "networkidle0", timeout: 30000 });
await page.waitForSelector(".rstage canvas", { timeout: 20000 });
await sleep(1200);
check("初始 .rstage canvas == 1", (await rstageCanvasCount()).inStage === 1,
  JSON.stringify(await rstageCanvasCount()));
check("初始无 body 直接子 canvas（无残留叠加）", (await rstageCanvasCount()).bodyDirectCanvas === 0,
  JSON.stringify(await rstageCanvasCount()));

// 往返 3 次：render-demo → editor → render-demo
for (let k = 1; k <= 3; k++) {
  await page.goto(BASE + "#/editor", { waitUntil: "networkidle0", timeout: 30000 });
  await sleep(600);
  await page.goto(BASE + "#/render-demo", { waitUntil: "networkidle0", timeout: 30000 });
  await page.waitForSelector(".rstage canvas", { timeout: 20000 });
  await sleep(800);
  const c = await rstageCanvasCount();
  check(`往返${k} 返回后 .rstage canvas == 1（dispose 完整）`, c.inStage === 1, JSON.stringify(c));
  check(`往返${k} 无 body 叠加 canvas`, c.bodyDirectCanvas === 0, JSON.stringify(c));
}

await browser.close();
console.log(`probe-render-dispose: ${fail === 0 ? "ALL PASS" : fail + " FAIL"}`);
process.exit(fail === 0 ? 0 : 1);