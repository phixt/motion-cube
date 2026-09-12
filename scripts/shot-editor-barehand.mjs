// 编辑器裸手检查（开发用）：起 dev server 后运行
// SPIKE_URL=... node scripts/shot-editor-barehand.mjs
// 隐藏魔方后截图默认姿态手位（排查拇指朝向/形状问题）。
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const OUT = "spike-shots";
if (!existsSync(OUT)) mkdirSync(OUT);
const executablePath = existsSync(CHROME) ? CHROME : EDGE;
const userDataDir = mkdtempSync(join(tmpdir(), "barehand-"));
const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: [
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
    `--user-data-dir=${userDataDir}`,
    "--window-size=1500,940",
  ],
  defaultViewport: { width: 1500, height: 940 },
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const page = await browser.newPage();
const URL = process.env.SPIKE_URL ?? "http://localhost:5174/";

await page.goto(`${URL}#/library`, { waitUntil: "networkidle0" });
await sleep(1200);
// 合并示例库（复杂运动演示手法在示例里）
const samplesBtn = await page.$("#btn-samples");
if (samplesBtn) await samplesBtn.click();
await sleep(600);
await page.goto(`${URL}#/editor`, { waitUntil: "networkidle0" });
await sleep(1500);
// 侧栏默认全折叠：先展开「视口显隐」分组，再点隐藏魔方
await page.evaluate(() => {
  const head = [...document.querySelectorAll(".sb-group-head")].find((b) =>
    (b.textContent ?? "").includes("视口显隐"),
  );
  if (head && (head.textContent ?? "").includes("\u25B8")) head.click();
});
await sleep(400);
// 隐藏魔方（视口显隐 → 隐藏魔方按钮）
const toggle = await page.$("#editor-toggle-cube");
if (toggle) {
  const label = await toggle.evaluate((el) => el.textContent.trim());
  await toggle.click();
  console.log(`toggle cube: ${label} -> clicked`);
} else {
  console.log("WARN: #editor-toggle-cube not found");
}
await sleep(600);
// 可选：选中指定手法（SPIKE_TEC=名称子串），查看该手法姿态
const tecName = process.env.SPIKE_TEC;
if (tecName) {
  const picked = await page.evaluate((n) => {
    const btn = [...document.querySelectorAll(".tec-item")].find((b) =>
      (b.textContent ?? "").includes(n),
    );
    if (btn) {
      btn.click();
      return btn.textContent.trim();
    }
    return null;
  }, tecName);
  console.log(`technique: ${picked ?? `NOT FOUND (${tecName})`}`);
  await sleep(800);
}
await page.screenshot({ path: `${OUT}/editor-barehand.png` });
console.log("SHOT: spike-shots/editor-barehand.png");
await browser.close();
