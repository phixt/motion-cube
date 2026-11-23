// WinUI 预览页截图（开发用）：起 dev server 后运行 node scripts/shot-preview.mjs
// 环境变量：SPIKE_URL（默认 http://localhost:5174）
import { existsSync, mkdirSync } from "node:fs";
import { launchBrowser } from "./_browser.mjs";

const OUT = "spike-shots";
if (!existsSync(OUT)) mkdirSync(OUT);

const browser = await launchBrowser({ prefix: "preview-shot-", width: 1440, height: 900 });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const page = await browser.newPage();
page.setDefaultTimeout(20000);
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") console.log(`[console.error] ${m.text()}`);
});

const base = process.env.SPIKE_URL ?? "http://localhost:5174";
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
