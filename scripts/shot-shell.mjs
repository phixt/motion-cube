// WinUI 壳回归截图（开发用）：起 dev server 后运行 node scripts/shot-shell.mjs
// 遍历 7 个路由，验证关键元素存在，并测试主题/材质切换。
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
const userDataDir = mkdtempSync(join(tmpdir(), "shell-shot-"));
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
page.setDefaultTimeout(25000);
const errors = [];
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`[console.error] ${m.text()}`);
});
page.on("response", (r) => {
  if (r.status() >= 400) errors.push(`[http ${r.status()}] ${r.url()}`);
});

const base = process.env.SPIKE_URL ?? "http://localhost:5173";

const ROUTES = [
  { route: "start", expect: ".start-actions" },
  { route: "game", expect: "twisty-player, #hud", waitMs: 2500 },
  { route: "library", expect: ".lib-form, #lib-status", waitMs: 800 },
  { route: "editor", expect: "#editor-view", waitMs: 800 },
  { route: "hand", expect: "#hand-calib-view", waitMs: 2500 },
  { route: "keymap", expect: "h1", waitMs: 800 },
  { route: "help", expect: "h1", waitMs: 800 },
];

const results = [];
for (const { route, expect, waitMs = 700 } of ROUTES) {
  await page.goto(`${base}/#/${route}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await sleep(waitMs);
  const selectors = expect.split(",").map((s) => s.trim());
  const found = [];
  for (const sel of selectors) {
    const ok = await page.evaluate((s) => !!document.querySelector(s), sel);
    found.push(`${sel}:${ok ? "ok" : "MISSING"}`);
  }
  await page.screenshot({ path: `${OUT}/shell-${route}.png` });
  results.push(`#/${route} ${found.join(" ")}`);
  console.log(`#/${route} ${found.join(" ")}`);
}

// 主题切换：点标题栏第一个按钮（主题），再截图
await page.goto(`${base}/#/start`, { waitUntil: "domcontentloaded", timeout: 30000 });
await sleep(900);
await page.evaluate(() => {
  const btns = [...document.querySelectorAll(".titlebar-actions .win-btn")];
  btns[0]?.click();
});
await sleep(900);
const themeClass = await page.evaluate(() => document.documentElement.className);
await page.screenshot({ path: `${OUT}/shell-theme-light.png` });
console.log(`theme after 1 click: ${themeClass}`);

// 材质切换：点第二个按钮
await page.evaluate(() => {
  const btns = [...document.querySelectorAll(".titlebar-actions .win-btn")];
  btns[1]?.click();
});
await sleep(900);
const materialClass = await page.evaluate(() => document.documentElement.className);
await page.screenshot({ path: `${OUT}/shell-material-acrylic.png` });
console.log(`material after 1 click: ${materialClass}`);

console.log(`\nerrors: ${errors.length}`);
for (const e of errors) console.log(e);
console.log(`\nsummary:\n${results.join("\n")}`);
await browser.close();
