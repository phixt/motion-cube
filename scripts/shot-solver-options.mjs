// 求解方法二级选项面板视觉验证：/game（GamePage）。
//  1. 初始：无常驻高级按钮（#btn-method-cfop-adv 不存在）、无选项面板（#solver-options 不存在）；
//  2. 点 #btn-method-cfop → 面板展开，含 ZBLL 复选框；
//  3. 点 #btn-method-roux → 面板切到 Roux，含 EOLR 与「合并 4b+4c」复选框。
// 输出 spike-shots/solver-options-*.png + PASS/FAIL 断言。
// 运行：node scripts/shot-solver-options.mjs（dev server 需已起，默认 127.0.0.1:5174）
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
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
await page.waitForSelector("#btn-solve", { timeout: 20000 });
await sleep(1800); // 等 cubing 渲染 + Vue 布局稳定

// 1. 初始态断言
const hasAdvBtn = await page.$("#btn-method-cfop-adv");
check("初始无常驻高级按钮", hasAdvBtn === null, "cfop-adv 按钮应已移除");
const hasPanel0 = await page.$("#solver-options");
check("初始选项面板折叠", hasPanel0 === null, "未展开时面板不渲染");
await shot("solver-options-1-initial.png");

// 2. 点 CFOP → 面板展开（ZBLL）
await page.click("#btn-method-cfop");
await sleep(300);
const panel1 = await page.$("#solver-options");
check("点 CFOP 展开面板", panel1 !== null);
const txt1 = panel1 ? await panel1.evaluate((el) => el.textContent) : "";
check("CFOP 面板含 ZBLL 选项", /ZBLL|一步顶层/.test(txt1), txt1.trim().slice(0, 60));
await shot("solver-options-2-cfop.png");

// 3. 点 Roux → 面板切到 Roux 组（EOLR + 合并 4b+4c）
await page.click("#btn-method-roux");
await sleep(300);
const panel2 = await page.$("#solver-options");
check("点 Roux 展开面板", panel2 !== null);
const txt2 = panel2 ? await panel2.evaluate((el) => el.textContent) : "";
check("Roux 面板含 EOLR 选项", /EOLR/.test(txt2), txt2.trim().slice(0, 60));
check("Roux 面板含合并4b+4c 选项", /4b\+4c|合并/.test(txt2));
await shot("solver-options-3-roux.png");

// 4. 收起：再点 Roux 折叠
await page.click("#btn-method-roux");
await sleep(200);
const panel3 = await page.$("#solver-options");
check("再点同方法收起面板", panel3 === null);

if (failures.length) {
  console.error(`FAILED: ${failures.join(", ")}`);
  writeFileSync(`${OUT}/solver-options-failures.txt`, failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("ALL PASS — 求解方法二级选项面板框架视觉验证通过");
}
await browser.close();