// 游戏页 cubing 后端恢复验证（2214498 render 切换回退后）：
//  1) twisty-player 元素已回归（cubing TwistyPlayer 挂载）；
//  2) window.__motionCube.player 就绪；截图供 vision 确认白块外观。
// 运行：node scripts/shot-game-cubing.mjs（dev 5174 需已起）
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

await page.goto(BASE + "#/game", { waitUntil: "networkidle0", timeout: 30000 });
await page.waitForSelector("#btn-apply", { timeout: 20000 });
await sleep(1800);

const twisted = await page.evaluate(() => !!document.querySelector("twisty-player"));
check("cubing TwistyPlayer 已回归（twisty-player 元素在）", twisted);

const hasPlayer = await page.evaluate(() => window.__motionCube?.player != null);
check("window.__motionCube.player 就绪", hasPlayer);

// 打乱滑条与选项面板仍在（回退不破坏 HUD 改动）
const hasScrambleSlider = await page.evaluate(() => !!document.querySelector("#scramble-speed"));
check("打乱速度滑条仍在", hasScrambleSlider);

await page.screenshot({ path: `${OUT}/game-cubing-1-initial.png` });
console.log("shot: game-cubing-1-initial.png");

if (failures.length) {
  console.error(`FAILED: ${failures.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log("ALL PASS — 游戏页 cubing 后端恢复验证通过");
}
await browser.close();