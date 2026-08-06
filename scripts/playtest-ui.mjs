// UI 流程验证：路由切换 / 游戏页 / 按键设置（改键+冷却）/ 改键后生效 / 快速连击冷却。
// 运行：node scripts/playtest-ui.mjs（先起 dev server）
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const URL = process.env.SPIKE_URL ?? "http://localhost:5173/";
const OUT = "spike-shots";

if (!existsSync(OUT)) mkdirSync(OUT);
const executablePath = existsSync(CHROME) ? CHROME : EDGE;
const userDataDir = mkdtempSync(join(tmpdir(), "motion-cube-ui-"));

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
const page = await browser.newPage();
page.setDefaultTimeout(20000);
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));

const shots = [];
async function shot(name) {
  const p = `${OUT}/${name}.png`;
  await page.screenshot({ path: p });
  shots.push(p);
  console.log(`screenshot: ${p}`);
}

async function clickNav(label) {
  console.log(`clickNav: ${label} (hash=${await page.evaluate(() => location.hash)})`);
  const handles = await page.$$(".nav-link");
  for (const h of handles) {
    const t = await h.evaluate((n) => n.textContent);
    if (t === label) {
      await h.click();
      await sleep(250);
      console.log(`  -> clicked, hash=${await page.evaluate(() => location.hash)}`);
      return;
    }
  }
  throw new Error("导航按钮未找到: " + label);
}

const moveLogText = () => page.$eval("#move-log", (el) => el.textContent ?? "").then((s) => s.trim());
const chipCount = () => page.$eval("#move-log", (el) => el.children.length).catch(() => 0);

// 1) 开始页
await page.goto(URL, { waitUntil: "networkidle0", timeout: 30000 });
await page.waitForSelector(".page h1");
const startTitle = await page.$eval(".page h1", (el) => el.textContent);
if (startTitle !== "Motion Cube") throw new Error(`开始页标题异常：${startTitle}`);
console.log("start page ok");
await shot("ui-01-start");

// 2) 进入游戏
await page.click('.start-actions [data-route="game"]');
await page.waitForFunction(() => !!document.querySelector("twisty-player"), { timeout: 15000 });
await sleep(1200);
console.log("game page ok");
await shot("ui-02-game");

// 3) 游戏页按键生效
await page.keyboard.press("r");
await sleep(300);
let log = await moveLogText();
if (!log.includes("R")) throw new Error(`按键 R 未生效：${log}`);
console.log(`game key ok: ${log}`);

// 4) 按键设置页：把 R 改绑到 T
await clickNav("按键设置");
await page.waitForSelector('[data-action="R"] .rebind');
await shot("ui-03-keymap");
await page.click('[data-action="R"] .rebind');
await sleep(150);
await page.keyboard.press("t");
await sleep(250);
const bindingT = await page.$eval('[data-action="R"] .binding', (el) => el.textContent);
if (bindingT !== "T") throw new Error(`R 应改绑为 T，实际：${bindingT}`);
console.log(`rebind ok: R → ${bindingT}`);
await shot("ui-04-keymap-rebound");

// 5) 改键生效：游戏页按 T 应执行 R
await clickNav("游戏");
await page.waitForFunction(() => !!document.querySelector("twisty-player"), { timeout: 15000 });
await sleep(600);
await page.keyboard.press("t");
await sleep(300);
log = await moveLogText();
if (!log.includes("R")) throw new Error(`改键后 T 未触发 R：${log}`);
console.log(`rebound key works: ${log}`);
await shot("ui-05-game-rebound");

// 6) 快速连击：重置后连按 d ×6（默认冷却 120ms），应明显少于 6 步
await page.keyboard.press("Escape");
await sleep(250);
for (let i = 0; i < 6; i++) {
  await page.keyboard.press("d");
  await sleep(25);
}
await sleep(400);
const count = await chipCount();
if (count >= 6) throw new Error(`连击冷却未生效：6 次连按触发 ${count} 步`);
if (count < 1) throw new Error(`连击冷却过强：${count} 步`);
console.log(`cooldown ok: 6 次连按 → ${count} 步`);
await shot("ui-06-rapid");

// 7) 动画编辑占位页 + 说明页
await clickNav("动画编辑");
await page.waitForSelector(".page h1");
console.log("editor page ok");
await shot("ui-07-editor");
await clickNav("说明");
await page.waitForSelector(".page h1");
const helpHas = await page.$eval(".page", (el) => el.textContent);
if (!helpHas.includes("游戏页操作")) throw new Error("说明页缺少操作说明");
if (helpHas.includes(" → ")) throw new Error("说明页不应再包含键位列表");
if (helpHas.includes("连击冷却")) throw new Error("说明页不应再包含冷却时间");
console.log("help page ok");
await shot("ui-08-help");

// 8) 公式库页：示例加载 / 添加 / 非法报错 / 删除
await clickNav("公式库");
await page.waitForSelector("#formula-rows");
await page.click("#btn-samples");
await sleep(300);
let formulaText = await page.$eval("#formula-rows", (el) => el.textContent ?? "");
if (!formulaText.includes("V Perm")) throw new Error("示例公式未加载");
const techniqueText = await page.$eval("#technique-rows", (el) => el.textContent ?? "");
if (!techniqueText.includes("单拨 U")) throw new Error("示例手法未加载");
console.log("library samples ok");
await shot("ui-09-library");

await page.type("#f-name", "测试 OLL");
await page.type("#f-moves", "R U R' U R U2' R'");
await page.click("#f-submit");
await sleep(250);
formulaText = await page.$eval("#formula-rows", (el) => el.textContent ?? "");
if (!formulaText.includes("测试 OLL")) throw new Error("添加公式失败");

await page.type("#f-name", "bad");
await page.type("#f-moves", "R U ???");
await page.click("#f-submit");
await sleep(250);
const libErr = await page.$eval("#lib-status", (el) => el.textContent ?? "");
if (!libErr.includes("添加失败")) throw new Error(`非法公式未报错：${libErr}`);
console.log("library invalid rejected");

await page.click('[data-name="测试 OLL"] .del');
await sleep(200);
formulaText = await page.$eval("#formula-rows", (el) => el.textContent ?? "");
if (formulaText.includes("测试 OLL")) throw new Error("删除公式失败");
console.log("library add/error/delete ok");
await shot("ui-10-library-edit");

await browser.close();
console.log(`\nSHOTS: ${shots.join(", ")}`);
