/** 说明页盲拧编码立方体真机验证（稳定版：显式打点 + 各步超时）。 */
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL = "http://127.0.0.1:5174/#/help";
const log = (m) => console.log(`[probe] ${m}`);

log("launch chrome...");
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu"],
  defaultViewport: { width: 1280, height: 800 },
  timeout: 30000,
});
const page = await browser.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && errs.push(`console.error: ${m.text()}`));

log("goto #/help...");
await page.goto(URL, { waitUntil: "load", timeout: 20000 });
log("wait .blind-cube-wrap canvas...");
await page.waitForSelector(".blind-cube-wrap canvas", { timeout: 8000 });
await new Promise((r) => setTimeout(r, 400));

let pass = 0, fail = 0;
const check = (cond, msg) => (cond ? pass++ : (fail++, console.error(`FAIL ${msg}`)));

const canvasCount = await page.evaluate(
  () => document.querySelectorAll(".blind-cube-wrap canvas").length
);
check(canvasCount === 1, `.blind-cube-wrap canvas==1（实际 ${canvasCount}）`);

const bodyText = await page.evaluate(() => document.body.innerText);
check(bodyText.includes("黄顶红前"), "文案含 黄顶红前");
check(bodyText.includes("缓冲"), "文案含 缓冲");
check(bodyText.includes("三循环"), "文案含 三循环");

log("shot 1...");
await page.screenshot({ path: "spike-shots/help-blind-1.png" });

log("drag rotate...");
const canvas = await page.$(".blind-cube-wrap canvas");
const box = await canvas.boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
await page.mouse.move(cx, cy);
await page.mouse.down();
for (let i = 0; i < 8; i++) {
  await page.mouse.move(cx + i * 8, cy + i * 2, { steps: 2 });
  await new Promise((r) => setTimeout(r, 20));
}
await page.mouse.up();
await new Promise((r) => setTimeout(r, 300));
log("shot 2...");
await page.screenshot({ path: "spike-shots/help-blind-2-rotated.png" });

const bodyCanvas = await page.evaluate(
  () => [...document.body.children].filter((el) => el.tagName === "CANVAS").length
);
check(bodyCanvas === 0, `body 无直接子 canvas（实际 ${bodyCanvas}）`);

for (const e of errs) console.error(e);
log(`RESULT: ${pass} PASS / ${fail} FAIL (errs=${errs.length})`);
await browser.close();
if (fail > 0 || errs.length) process.exit(1);