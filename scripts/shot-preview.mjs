// WinUI 预览页截图（开发用）：起 dev server 后运行 node scripts/shot-preview.mjs
// 环境变量：SPIKE_URL（默认 http://localhost:5173）
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const OUT = "spike-shots";
if (!existsSync(OUT)) mkdirSync(OUT);

const executablePath = existsSync(CHROME) ? CHROME : EDGE;
const userDataDir = mkdtempSync(join(tmpdir(), "preview-shot-"));
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
page.on("console", (m) => {
  if (m.type() === "error") console.log(`[console.error] ${m.text()}`);
});

const base = process.env.SPIKE_URL ?? "http://localhost:5173";
await page.goto(`${base}/preview.html`, { waitUntil: "domcontentloaded", timeout: 30000 });
await sleep(1500);
await page.screenshot({ path: `${OUT}/preview-start.png` });
console.log("shot: spike-shots/preview-start.png");

// 点击导航切换页面，验证 ItemInvoked 路由
await page.evaluate(() => {
  const items = [...document.querySelectorAll(".win-nav-item")];
  const game = items.find((el) => el.textContent?.includes("游戏"));
  game?.click();
});
await sleep(1200);
await page.screenshot({ path: `${OUT}/preview-game.png` });
console.log("shot: spike-shots/preview-game.png");

await browser.close();
