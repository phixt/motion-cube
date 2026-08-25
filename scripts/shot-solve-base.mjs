// 解法底多选 UI + 统一 s/步 速度视觉验证（dev 5174 /game）：
//  0) HUD 两个滑条显示 s/步（#speed / #scramble-speed），同一 s/步 基准；
//     播放滑条范围 0.05–2.00 s/步、打乱滑条范围 0.05–0.50 s/步（默认 1.00 / 0.33）
//  1) 开 CFOP 面板：.base-section 在、.base-chip 恰 6 个（无「跟随原始底」chip）、
//     含复位 .base-reset；默认放全局底上（.on 恰 1 个且为 D —— 当前全局底）
//  2) 点 L(红) chip → .on=2（D+L，多选）；localStorage motion-cube.solveBase 数组含 D、L
//  3) 取消唯一底被拒绝（最少保留一个）
//  4) 点 .base-reset → 回归全局底（.on=1 且 D，存储 [D]）
//  5) 点 #btn-solve → .solve-panel 出现且含步数文本（多底逐解取最短可用）
// 运行：node scripts/shot-solve-base.mjs（dev server 127.0.0.1:5174；Windows 侧跑）
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
// 干净会话：清除解法底存储，验证默认放全局底上
await page.evaluate(() => localStorage.removeItem("motion-cube.solveBase"));
await sleep(1800);

// 0. 速度滑条：WinSlider 是自定义 div 滑条（min/max 为 props，不落 DOM 属性）——
//    断言滑条元素存在 + HUD label 为「s/步」单位，播放值 ∈ [0.05,2]、打乱值 ∈ [0.05,0.5]
const sliders = await page.evaluate(() => ({
  speed: !!document.getElementById("speed"),
  scramble: !!document.getElementById("scramble-speed"),
}));
check("播放滑条 #speed 存在", sliders.speed);
check("打乱滑条 #scramble-speed 存在", sliders.scramble);
const labelTxt = await page.evaluate(() => document.body.innerText);
const sPerStep = [...labelTxt.matchAll(/(\d+\.\d{2})\s*s\/步/g)].map((m) => Number(m[1]));
check("HUD 两处显示 s/步 数值", sPerStep.length >= 2, `values=${JSON.stringify(sPerStep)}`);
check("播放滑条范围 0.05–2.0 s/步", sPerStep.length >= 1 && sPerStep[0] >= 0.05 && sPerStep[0] <= 2, `播放=${sPerStep[0]}`);
check("打乱滑条范围 0.05–0.5 s/步", sPerStep.length >= 2 && sPerStep[1] >= 0.05 && sPerStep[1] <= 0.5, `打乱=${sPerStep[1]}`);
// 打乱最快 5x 等效 = 0.20 s/步：默认打乱 0.33 s/步 ∈ [0.2,3]，其 label 数值已在上断言覆盖

// 1. 开面板
await page.click("#btn-method-cfop");
await page.waitForSelector("#solver-options", { timeout: 8000 });
const panelInfo = await page.evaluate(() => {
  const panel = document.querySelector("#solver-options");
  const chips = [...panel.querySelectorAll(".base-chip")];
  return {
    hasBase: !!panel.querySelector(".base-section"),
    hasReset: !!panel.querySelector(".base-reset"),
    nChips: chips.length,
    chipTexts: chips.map((c) => c.textContent.trim()),
    on: chips.filter((c) => c.classList.contains("on")).map((c) => c.textContent.trim()),
  };
});
check("面板含 .base-section（解法底区）", panelInfo.hasBase);
check("无「跟随原始底」chip（6 个色底）", panelInfo.nChips === 6, `n=${panelInfo.nChips} chips=${JSON.stringify(panelInfo.chipTexts)}`);
check("含复位按钮 .base-reset", panelInfo.hasReset);
check("默认放全局底上（.on=1 且 D）", panelInfo.on.length === 1 && panelInfo.on[0] === "D", `on=${JSON.stringify(panelInfo.on)}`);
await shot("solve-base-1-default.png");

// 2. 点 L(红) chip → 多选（D+L）；chips 顺序 U/R/F/D/L/B，L=index 4
await page.evaluate(() => {
  const panel = document.querySelector("#solver-options");
  [...panel.querySelectorAll(".base-chip")][4].click(); // L
});
await sleep(300);
const afterL = await page.evaluate(() => {
  const panel = document.querySelector("#solver-options");
  const on = [...panel.querySelectorAll(".base-chip")].filter((c) => c.classList.contains("on")).map((c) => c.textContent.trim());
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem("motion-cube.solveBase") || "null"); } catch { /* noop */ }
  return { on, stored };
});
check("点 L 后 .on=2（D+L 多选）", afterL.on.length === 2 && afterL.on.includes("D") && afterL.on.includes("L"), `on=${JSON.stringify(afterL.on)}`);
check("localStorage 数组含 D、L", Array.isArray(afterL.stored) && afterL.stored.includes("D") && afterL.stored.includes("L"), `stored=${JSON.stringify(afterL.stored)}`);
await shot("solve-base-2-multi.png");

// 3. 取消唯一底被拒绝（最少保留一个）
await page.evaluate(() => {
  const panel = document.querySelector("#solver-options");
  [...panel.querySelectorAll(".base-chip")][3].click(); // D 取消（D+L → L）
});
await sleep(350);
const afterCancelD = await page.evaluate(() => {
  const panel = document.querySelector("#solver-options");
  return [...panel.querySelectorAll(".base-chip")]
    .filter((c) => c.classList.contains("on"))
    .map((c) => c.textContent.trim());
});
check("取消 D 后 .on=1（只剩 L）", afterCancelD.length === 1 && afterCancelD[0] === "L", `on=${JSON.stringify(afterCancelD)}`);
await page.evaluate(() => {
  const panel = document.querySelector("#solver-options");
  [...panel.querySelectorAll(".base-chip")][4].click(); // L 取消（此时唯一，应被拒）
});
await sleep(350);
const guardState = await page.evaluate(() => {
  const panel = document.querySelector("#solver-options");
  const on = [...panel.querySelectorAll(".base-chip")].filter((c) => c.classList.contains("on")).map((c) => c.textContent.trim());
  return { on };
});
check("取消唯一底被拒绝（最少保留一个）", guardState.on.length === 1 && guardState.on[0] === "L", `on=${JSON.stringify(guardState.on)}`);

// 4. 重置回归全局底
await page.evaluate(() => {
  document.querySelector("#solver-options .base-reset").click();
});
await sleep(200);
const afterReset = await page.evaluate(() => {
  const panel = document.querySelector("#solver-options");
  const on = [...panel.querySelectorAll(".base-chip")].filter((c) => c.classList.contains("on")).map((c) => c.textContent.trim());
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem("motion-cube.solveBase") || "null"); } catch { /* noop */ }
  return { on, stored };
});
check("重置回归全局底（.on=1 且 D）", afterReset.on.length === 1 && afterReset.on[0] === "D", `on=${JSON.stringify(afterReset.on)}`);
check("重置后存储=[D]", JSON.stringify(afterReset.stored) === JSON.stringify(["D"]), `stored=${JSON.stringify(afterReset.stored)}`);

// 5. 求解可用
await page.click("#btn-solve");
await page.waitForSelector(".solve-panel", { timeout: 8000 });
await page.waitForFunction(
  () => /(步|moves|total)/i.test((document.querySelector(".solve-panel") || {}).textContent || ""),
  { timeout: 20000 },
);
const solveTxt = await page.evaluate(() => document.querySelector(".solve-panel").textContent.trim());
check("求解面板出现且含步数文本", /\d+\s*步/.test(solveTxt), solveTxt.slice(0, 60));
await shot("solve-base-3-solve.png");

if (failures.length) {
  console.error(`FAILED: ${failures.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log("ALL PASS — 解法底多选 UI + s/步 速度统一视觉验证");
}
await browser.close();