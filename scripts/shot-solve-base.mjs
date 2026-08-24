// 解法底选择 UI 视觉验证（dev 5174 /game）：
//  1) 点 CFOP 展开方法面板 → #solver-options 出现，含 .base-section，7 个 .base-chip
//     （global + U/R/F/D/L/B 六色），global chip 默认选中(.on)；
//  2) 点 L(红) chip → .on 前移到该 chip，localStorage[motion-cube.solveBase]==="L"；
//  3) 点求解 → .solve-panel 出现并含步数文本（真实求解可用）；
//  4) 截图 spike-shots/solve-base-*.png。
// 运行：node scripts/shot-solve-base.mjs（dev server 需已起 127.0.0.1:5174；Windows 侧跑）
import { existsSync, mkdirSync } from "node:fs";
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = process.env.SPIKE_URL ?? "http://127.0.0.1:5174/";
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
const failures = [];
const check = (name, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures.push(name);
};
const shot = async (p) => {
  await page.screenshot({ path: `${OUT}/${p}` });
  console.log(`shot: ${p}`);
};

await page.goto(BASE + "#/game", { waitUntil: "networkidle0", timeout: 30000 });
await page.waitForSelector("#btn-method-cfop", { timeout: 20000 });
await sleep(1800);

// 1. 开面板
await page.click("#btn-method-cfop");
await page.waitForSelector("#solver-options", { timeout: 8000 });
check("点 CFOP 展开方法面板", true);

const panelInfo = await page.evaluate(() => {
  const panel = document.querySelector("#solver-options");
  const chips = [...panel.querySelectorAll(".base-chip")];
  return {
    hasBase: !!panel.querySelector(".base-section"),
    nChips: chips.length,
    chipTexts: chips.map((c) => c.textContent.trim()),
    onIndex: chips.findIndex((c) => c.classList.contains("on")),
  };
});
check("面板含 .base-section（解法底区）", panelInfo.hasBase);
check("base-chip 共 7 个（global+6 色）", panelInfo.nChips === 7, `n=${panelInfo.nChips}`);
check("默认选中 global（跟随全局底）", panelInfo.onIndex === 0,
  `onIndex=${panelInfo.onIndex} chips=${JSON.stringify(panelInfo.chipTexts)}`);

// 2. 点 L(红) chip（索引 5：global,U,R,F,D,L,B）
await page.evaluate(() => {
  const panel = document.querySelector("#solver-options");
  const chips = [...panel.querySelectorAll(".base-chip")];
  chips[5].click();
});
await sleep(300);
const afterL = await page.evaluate(() => {
  const panel = document.querySelector("#solver-options");
  const chips = [...panel.querySelectorAll(".base-chip")];
  return {
    onIndex: chips.findIndex((c) => c.classList.contains("on")),
    onText: (chips.find((c) => c.classList.contains("on")) || {}).textContent?.trim(),
    stored: localStorage.getItem("motion-cube.solveBase"),
  };
});
check("点 L 后 .on 前移到 L chip", afterL.onIndex === 5 && /^L$/i.test(afterL.onText ?? ""),
  `onIndex=${afterL.onIndex} on=${afterL.onText}`);
check("localStorage[motion-cube.solveBase]==='L'", afterL.stored === "L", `stored=${afterL.stored}`);
await shot("solve-base-l-selected.png");

// 3. 点求解 → .solve-panel 出现且含步数
await page.click("#btn-solve");
await page.waitForSelector(".solve-panel", { timeout: 8000 });
await page.waitForFunction(
  () => /(步|moves|total)/i.test((document.querySelector(".solve-panel") || {}).textContent || ""),
  { timeout: 15000 }
);
const solveTxt = await page.evaluate(() => document.querySelector(".solve-panel").textContent.trim());
check("求解面板出现且含步数文本", /(\d+\s*步|\d+\s*moves|总\d)/.test(solveTxt),
  `panel=${solveTxt.slice(0, 60)}`);
await shot("solve-base-solve-result.png");

if (failures.length) {
  console.error(`FAILED: ${failures.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log("ALL PASS — 解法底选择 UI（7 chip / global 默认 / 点 L 持久化 / 求解可用）");
}
await browser.close();