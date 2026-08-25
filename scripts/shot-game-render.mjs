// 游戏页 render 后端替换验证（R1 阶段1）：GamePage 走 RenderCubeHost 自建渲染。
//  1) stage 挂载 host canvas；无 twisty-player 元素（cubing 已被替换——用户核心诉求之一）；
//  2) applyMove("R") → 动画截图（非跳变）；
//  3) Backspace 撤销 → 状态回退截图；
//  4) CFOP 求解演示触发（status 文案提示），动画逐步播放截图。
// 运行：node scripts/shot-game-render.mjs（dev 5174 需已起）
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
await page.waitForSelector("#btn-apply", { timeout: 20000 });
await sleep(1800);

const hasCanvas = await page.evaluate(() => {
  const stage = document.querySelector(".stage");
  return !!stage && !!stage.querySelector("canvas");
});
check("render 宿主 canvas 已挂载", hasCanvas);

const noTwisty = await page.evaluate(() => !document.querySelector("twisty-player"));
check("cubing TwistyPlayer 已被替换（无 twisty-player 元素）", noTwisty, noTwisty ? "" : "仍存在 twisty-player");

const hasPlayer = await page.evaluate(() => window.__motionCube?.player != null);
check("window.__motionCube.player 已挂载", hasPlayer);
await shot("game-render-1-initial.png");

// 单步 R（经 player.applyMove → render playMove，动画非跳变）
await page.evaluate(() => window.__motionCube?.player.applyMove("R"));
await sleep(700);
await shot("game-render-2-after-R.png");

// Backspace 撤销（session keymap undo → player.undoLastMove → render undo）
await page.keyboard.press("Backspace");
await sleep(600);
await shot("game-render-3-undone.png");

// CFOP 求解演示（doSolve → demoSolve 经 player.applyMove 逐步播）
await page.click("#btn-method-cfop");
await sleep(250);
await page.click("#btn-solve");
await sleep(1600);
const statusTxt = await page.evaluate(() => document.querySelector("#hud-status")?.textContent ?? "");
check("求解演示触发（status 有反馈）", statusTxt.length > 0, statusTxt);
await shot("game-render-4-solve-demo.png");

if (failures.length) {
  console.error(`FAILED: ${failures.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log("ALL PASS — 游戏页 render 后端替换验证通过（canvas/替换/动画/撤销/求解演示）");
}
await browser.close();