// 手部 low-poly 重构截图（开发用）：起 5174 后运行 node scripts/shot-hand-lab.mjs
// 输出：#hand-lab A/B 对照 + 标定页俯视/左视 + 编辑器手位
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const OUT = "spike-shots";
if (!existsSync(OUT)) mkdirSync(OUT);
const executablePath = existsSync(CHROME) ? CHROME : EDGE;
const userDataDir = mkdtempSync(join(tmpdir(), "hand-lab-"));
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

// 1) hand-lab A/B（等自转一段再拍第二张，验证旋转后渲染正常）
await page.goto(`${URL}#/hand-lab`, { waitUntil: "networkidle0" });
await sleep(2500);
await page.screenshot({ path: `${OUT}/hand-lab-1.png` });
await sleep(2500);
await page.screenshot({ path: `${OUT}/hand-lab-2-rotated.png` });

// 2) 标定页（俯视 + 左视 + 造型面板）
await page.goto(`${URL}#/hand`, { waitUntil: "networkidle0" });
await sleep(2000);
await page.screenshot({ path: `${OUT}/hand-calib-lowpoly.png` });

console.log("SHOTS: spike-shots/hand-lab-1.png, hand-lab-2-rotated.png, hand-calib-lowpoly.png");
await browser.close();
