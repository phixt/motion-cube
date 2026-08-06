// Spike 浏览器实测：启动 dev server 后运行
//   node scripts/playtest-spike.mjs
// 覆盖：启动渲染、公式应用、播放、键盘映射（面/反转/中层/翻面/双层）、撤销、非法输入。
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL = process.env.SPIKE_URL ?? "http://localhost:5173/";
const SHOT_DIR = "spike-shots";

if (!existsSync(SHOT_DIR)) mkdirSync(SHOT_DIR);

const executablePath = existsSync(CHROME) ? CHROME : EDGE;
const userDataDir = mkdtempSync(join(tmpdir(), "motion-cube-spike-"));

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: [
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
    `--user-data-dir=${userDataDir}`,
    "--window-size=1280,800",
  ],
  defaultViewport: { width: 1280, height: 800 },
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const page = await browser.newPage();
page.setDefaultTimeout(20000);
page.on("console", (m) => console.log(`[console] ${m.type()}: ${m.text()}`));
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));

await page.goto(URL, { waitUntil: "networkidle0", timeout: 30000 });
await page.waitForFunction(() => !!document.querySelector("twisty-player"), { timeout: 15000 });
await sleep(1500);

const shots = [];
async function shot(name) {
  const p = `${SHOT_DIR}/${name}.png`;
  await page.screenshot({ path: p });
  shots.push(p);
  console.log(`screenshot: ${p}`);
}

const logText = () => page.$eval("#move-log", (el) => el.textContent ?? "");
const statusText = () => page.$eval("#hud-status", (el) => el.textContent ?? "").then((s) => s.trim());

await shot("01-boot");

// 1) 记法应用：V Perm（docs 示例，UD' 拆开为 U' D'）
await page.type("#alg-input", "(R' U R' U') (R D' R' D) R' U' D' (R2 U' R2' D R2)");
await page.click("#btn-apply");
await sleep(900);
const appliedValue = await page.$eval("#alg-input", (el) => el.value);
console.log(`applied alg normalized: ${appliedValue}`);
await shot("02-vperm-applied");

// 2) 播放 / 暂停
await page.click("#btn-play");
await sleep(1200);
await shot("03-playing-mid");
await page.click("#btn-play"); // 同一按钮，此时文本为「暂停」
await sleep(200);

// 3) 键盘映射
await page.keyboard.press("r");
await sleep(350);
await page.keyboard.down("Shift");
await page.keyboard.press("r");
await page.keyboard.up("Shift");
await sleep(350);
await page.keyboard.press("m");
await sleep(350);
await page.keyboard.press("x");
await sleep(350);
await page.keyboard.down("Space");
await page.keyboard.press("r");
await page.keyboard.up("Space");
await sleep(350);

const log1 = await logText();
console.log(`move log after keys: ${log1.replace(/\s+/g, " ")}`);
for (const expected of ["R", "R'", "M", "x", "r"]) {
  if (!log1.includes(expected)) throw new Error(`移动日志缺少 ${expected}：${log1}`);
}
await shot("04-after-keys");

// 4) 撤销一步（Backspace）：日志应移除最后一个 chip
const beforeUndo = await logText();
await page.keyboard.press("Backspace");
await sleep(250);
const afterUndo = await logText();
if (afterUndo.length >= beforeUndo.length) {
  throw new Error(`撤销未生效：${beforeUndo} -> ${afterUndo}`);
}
console.log(`undo ok: "${beforeUndo.trim()}" -> "${afterUndo.trim()}"`);

// 5) 重置（Escape）
await page.keyboard.press("Escape");
await sleep(250);
const logAfterReset = await logText();
if (logAfterReset.trim()) throw new Error(`重置后日志未清空：${logAfterReset}`);
console.log("reset ok: log cleared");

// 6) 非法输入
await page.type("#alg-input", "R U ???");
await page.click("#btn-apply");
await sleep(250);
const st = await statusText();
if (!/解析失败/.test(st)) throw new Error(`期望解析失败状态，实际：${st}`);
console.log(`invalid input rejected: ${st}`);
await shot("05-invalid-input");

// 7) 记法自检（浏览器内）
await page.click("#btn-verify");
await sleep(300);
const selfTest = await page.$eval("#self-test", (el) => el.textContent ?? "");
const failed = (selfTest.match(/FAIL/g) ?? []).length;
console.log(`self-test: ${failed} FAIL / ${(selfTest.match(/OK/g) ?? []).length} OK`);
if (failed > 0) console.log(selfTest.split("\n").filter((l) => l.startsWith("FAIL")).join("\n"));
await shot("06-self-test");

await browser.close();
console.log(`\nSHOTS: ${shots.join(", ")}`);
process.exit(failed > 0 ? 1 : 0);
