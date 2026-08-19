// 求解器 UI 验证：打乱 → 求解（CFOP/Roux）→ 阶段面板 → 演示。
// 运行：node scripts/playtest-solver.mjs（先起 dev server，SPIKE_URL 指向非 5173 端口）
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const URL = process.env.SPIKE_URL ?? "http://localhost:5174/";
const OUT = "spike-shots";
if (!existsSync(OUT)) mkdirSync(OUT);
const executablePath = existsSync(CHROME) ? CHROME : EDGE;
const userDataDir = mkdtempSync(join(tmpdir(), "motion-cube-solver-"));
const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", `--user-data-dir=${userDataDir}`, "--window-size=1280,800"],
  defaultViewport: { width: 1280, height: 800 },
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const page = await browser.newPage();
page.setDefaultTimeout(20000);
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));

const SCRA = "R U' F2 B2 D' R2 U L F' B2 U2 L2 B U' L D2 R B' U2 R' F' U L2 D' R B2";

await page.goto(URL, { waitUntil: "networkidle0", timeout: 30000 });
await page.reload({ waitUntil: "networkidle0", timeout: 30000 });
await page.waitForSelector(".start-page");
await page.click(".start-play");
await page.waitForFunction(() => location.hash === "#/game", { timeout: 10000 });
await page.waitForFunction(() => !!document.querySelector("twisty-player"), { timeout: 15000 });
await sleep(1000);

// 用输入框打乱（先清空再逐键输入，保证 Vue v-model 同步）
await page.$eval(".hud-alg input", (el) => { el.value = ""; });
await page.type(".hud-alg input", SCRA);
await page.click("#btn-apply");
await sleep(800);
const curAlg = await page.evaluate(() => globalThis.__motionCube?.player?.currentAlg ?? "");
if (!curAlg || !curAlg.includes("R")) throw new Error(`打乱未生效：${curAlg}`);
console.log(`scrambled via box (${curAlg.split(/\s+/).filter(Boolean).length} moves)`);

async function runSolve(methodBtn, expectStages) {
  await page.click(methodBtn);
  await sleep(200);
  await page.click("#btn-solve");
  await sleep(1500); // 首解建表
  await page.waitForSelector(".solve-stage", { timeout: 30000 });
  const stages = await page.$$eval(".solve-stage", (els) =>
    els.map((e) => ({
      short: e.querySelector(".stage-short")?.textContent ?? "",
      count: parseInt(e.querySelector(".stage-count")?.textContent ?? "0", 10),
    })),
  );
  const totalText = await page.$eval(".solve-title", (el) => el.textContent ?? "");
  const moves = stages.reduce((a, s) => a + s.count, 0);
  if (stages.length !== expectStages) throw new Error(`阶段数异常：${stages.length} != ${expectStages}`);
  if (moves <= 0) throw new Error(`总步数为 0：${JSON.stringify(stages)}`);
  console.log(`solve ok [${methodBtn}]: ${stages.map((s) => s.short + ":" + s.count).join(" ")} | ${totalText.trim()}`);
  return { stages, totalText, moves };
}

// CFOP（4+ 阶段）与 Roux（5 阶段）
const r1 = await runSolve("#btn-method-cfop", 7);
await page.screenshot({ path: "spike-shots/solve-01-cfop.png" });

// 再解一次（热表）应更快，结果一致
const tHot0 = Date.now();
await page.click("#btn-solve");
await sleep(400);
await page.waitForSelector(".solve-stage");
const hotMs = Date.now() - tHot0;
if (hotMs > 800) throw new Error(`热表求解过慢：${hotMs}ms`);
console.log(`hot solve fast: ${hotMs}ms`);

const r2 = await runSolve("#btn-method-roux", 6);
await page.screenshot({ path: "spike-shots/solve-02-roux.png" });

// 演示：应把魔方驱动到还原（TwistyPlayer alg 结束为空/含逆序）
await page.click(".solve-actions button"); // 第一个按钮 = 演示
await sleep(3000);
const finalAlg = await page.evaluate(async () => {
  const el = document.querySelector("twisty-player");
  try { return (await el?.experimentalModel.alg.get())?.alg?.toString() ?? ""; }
  catch (e) { return `ERR:${e.message}`; }
});
if (typeof finalAlg === "string" && finalAlg.startsWith("ERR")) throw new Error(`演示读取失败：${finalAlg}`);
console.log(`demo finished, player alg len=${finalAlg.split(/\s+/).filter(Boolean).length}`);

// 已解状态：求解 → 提示已还原、0 步
await page.click(".solve-actions button:last-child"); // 关闭
await sleep(200);
await page.click("#btn-reset");
await sleep(600);
await page.click("#btn-solve");
await sleep(1200);
await page.waitForSelector(".solve-panel");
const solvedText = await page.$eval("#hud-status", (el) => el.textContent ?? "");
if (!/已还原|solved/i.test(solvedText)) throw new Error(`已解状态提示异常：${solvedText}`);
console.log(`solved-state solve ok: ${solvedText}`);

await browser.close();
console.log("solver UI playtest OK");