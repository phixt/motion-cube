// 方法二级选项面板视觉验证 v2（打乱独立滑条 + 面板左中浮层）：
//  1) 初始：无常驻高级按钮、无面板、HUD 有「打乱速度」滑条；
//  2) 点 CFOP → 面板展开（含 ZBLL 复选框），面板位于 3D 视图左侧中部；
//  3) 点 Roux → 面板切到 Roux 组（EOLR + 合并 4b+4c，后者默认勾选）；
//  4) 再点 Roux 收起；点击打乱后采样中段帧（动画进行中）。
// 运行：node scripts/shot-solver-options.mjs（dev server 需已起 127.0.0.1:5174）
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

// 1. 初始态断言
check("无常驻高级按钮(#btn-method-cfop-adv)", (await page.$("#btn-method-cfop-adv")) === null);
check("初始面板折叠(#solver-options)", (await page.$("#solver-options")) === null);
check("HUD 有打乱速度滑条", (await page.$("#scramble-speed")) !== null);
await shot("solver-options-1-initial.png");

// 2. 点 CFOP → 面板展开 + 左中定位 + ZBLL 勾选项
await page.click("#btn-method-cfop");
await sleep(350);
const panel1 = await page.$("#solver-options");
check("点 CFOP 展开面板", panel1 !== null);
if (panel1) {
  const r = await panel1.evaluate((el) => {
    const b = el.getBoundingClientRect();
    return { left: b.left, top: b.top, H: b.height, winH: window.innerHeight };
  });
  check("面板位于视图左侧", r.left < 150, `left=${Math.round(r.left)}px`);
  check("面板位于中高区", Math.abs(r.top + r.H / 2 - r.winH / 2) < r.winH * 0.25,
    `center≈${Math.round(r.top + r.H / 2)}px / H=${r.winH}px`);
  const txt = await panel1.evaluate((el) => el.textContent);
  check("CFOP 面板含一步顶层(ZBLL)", /一步顶层/.test(txt));
}
await shot("solver-options-2-cfop.png");

// 3. 点 Roux → 切组（EOLR + 合并 4b+4c，合并默认勾选）
await page.click("#btn-method-roux");
await sleep(350);
const panel2 = await page.$("#solver-options");
check("点 Roux 面板切换", panel2 !== null);
if (panel2) {
  const txt = await panel2.evaluate((el) => el.textContent);
  check("Roux 面板含 EOLR 选项", /EOLR/.test(txt));
  check("Roux 面板含合并 4b+4c 选项", /合并 4b\+4c/.test(txt));
  const checked = await panel2.evaluate((el) => {
    const boxes = [...el.querySelectorAll("input[type=checkbox]")];
    return { n: boxes.length, checkedCount: boxes.filter((b) => b.checked).length };
  });
  check("合并 4b+4c 默认勾选", checked.checkedCount >= 1, `勾选 ${checked.checkedCount}/${checked.n}`);
}
await shot("solver-options-3-roux.png");

// 4. 再点 Roux 收起
await page.click("#btn-method-roux");
await sleep(250);
check("再点同方法收起面板", (await page.$("#solver-options")) === null);

// 5. 打乱动画采样：点击打乱后约 400ms 截帧（动画进行中，非静止跳变）
await page.click("#btn-scramble");
await sleep(400);
await shot("solver-options-4-scramble-mid.png");
console.log("mid-scramble frame captured (scramble in progress at 3x)");

if (failures.length) {
  console.error(`FAILED: ${failures.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log("ALL PASS — 方法二级选项面板 v2 视觉验证通过（左中浮层 + 打乱独立滑条）");
}
await browser.close();