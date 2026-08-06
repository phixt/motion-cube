// Spike 补充验证：鼠标拖拽是否真的改变视角（camera）。
// 拖拽前后截图做 SHA-256 对比 + 视角目检（由视觉模型/用户确认）。
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const URL = process.env.SPIKE_URL ?? "http://localhost:5173/";
const OUT_DIR = "spike-shots";

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR);
const executablePath = existsSync(CHROME) ? CHROME : EDGE;
const userDataDir = mkdtempSync(join(tmpdir(), "motion-cube-drag-"));

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hash = (p) => createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 16);

const page = await browser.newPage();
await page.goto(URL, { waitUntil: "networkidle0", timeout: 30000 });
await page.waitForFunction(() => !!document.querySelector("twisty-player"), { timeout: 15000 });
await sleep(2000);

const before = `${OUT_DIR}/drag-before.png`;
const after = `${OUT_DIR}/drag-after.png`;
await page.screenshot({ path: before });

// 在魔方区域（画面中央略下，避开顶部 HUD）做两次拖拽：斜向 + 横向
const cx = 640;
const cy = 470;
await page.mouse.move(cx, cy);
await page.mouse.down();
for (let i = 1; i <= 12; i++) {
  await page.mouse.move(cx + i * 10, cy + i * 6, { steps: 2 });
  await sleep(15);
}
await page.mouse.up();
await sleep(400);
await page.mouse.move(cx + 60, cy + 40);
await page.mouse.down();
for (let i = 1; i <= 10; i++) {
  await page.mouse.move(cx + 60 - i * 15, cy + 40, { steps: 2 });
  await sleep(15);
}
await page.mouse.up();
await sleep(400);

await page.screenshot({ path: after });

const h1 = hash(before);
const h2 = hash(after);
console.log(`before hash: ${h1}`);
console.log(`after  hash: ${h2}`);
if (h1 === h2) {
  console.log("DRAG TEST: FAIL — 拖拽前后画面完全一致，视角未变化");
  process.exit(1);
}
console.log("DRAG TEST: PASS — 拖拽改变了画面（视角旋转生效）");
await browser.close();
