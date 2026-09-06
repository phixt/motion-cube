// 图标实验室截图工具：无头渲染指定参数并保存 PNG（便于快速对比方案）。
// 用法：node tools/icon-lab/shot.mjs "palette=lightDeep&f=24&b=10&elev=27&azim=33" [输出文件名]
// 需先起服务：npx vite --port 5199 --strictPort
import { existsSync, mkdirSync } from "node:fs";
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://localhost:5199/tools/icon-lab/index.html";
const OUT = "spike-shots/icon-lab";

const params = process.argv[2] || "";
const name = (process.argv[3] || `preview-${Date.now()}`).replace(/\.png$/i, "");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: existsSync(CHROME) ? CHROME : EDGE,
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--window-size=1000,1000"],
  defaultViewport: { width: 1000, height: 1000 },
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`[console] ${m.text()}`); });

await page.goto(`${BASE}?${params}${params ? "&" : ""}bare=1`, { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 1500));
const file = `${OUT}/${name}.png`;
await page.screenshot({ path: file });
console.log(errors.length ? errors.join("\n") : "no page errors");
console.log(`saved: ${file}`);
await browser.close();
