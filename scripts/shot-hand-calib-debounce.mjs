/**
 * 标定页防抖重建验证（Windows 跑，需 full-access）：
 * 1. 打开 #/hand，确认两视图 canvas 已挂载；
 * 2. monkey-patch HandCalibView.setConfig 计数重建次数；
 * 3. 对 len-index-0 连续触发 10 次 input（间隔 20ms，共 ~200ms）；
 * 4. 等 600ms 后断言：重建次数 ≤2（防抖 150ms 合并生效）且最终 setConfig 收到 lastLen=before+0.10；
 * 5. 截图 spike-shots/hand-calib.png（防抖后页面仍然渲染完整）。
 */
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL = "http://127.0.0.1:5174/#/hand";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--force-color-profile=srgb"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 860 });
  await page.goto(URL, { waitUntil: "networkidle0", timeout: 30000 });
  await page.waitForSelector("#hand-calib-view canvas", { timeout: 15000 });
  await page.waitForSelector("#hand-calib-side-view canvas", { timeout: 15000 });

  const kick = await page.evaluate(async () => {
    const g = globalThis.__motionCubeHandCalib;
    if (!g?.calib) return { err: "no __motionCubeHandCalib" };
    const counter = { n: 0, lastLen: NaN, lastSide: 0 };
    globalThis.__hb_count = counter;
    const orig = g.calib.setConfig.bind(g.calib);
    g.calib.setConfig = (cfg) => {
      counter.n++;
      counter.lastLen = cfg?.fingers?.index?.[0]?.length;
      return orig(cfg);
    };
    const inp = document.getElementById("len-index-0");
    if (!inp) return { err: "no len-index-0" };
    const before = Number(inp.value);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 1; i <= 10; i++) {
      setter.call(inp, String((before + i * 0.01).toFixed(2)));
      inp.dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(20);
    }
    return { before };
  });

  // 等防抖 150ms + rAF 完成
  await new Promise((r) => setTimeout(r, 600));

  const out = await page.evaluate(() => {
    const c = globalThis.__hb_count;
    const inp = document.getElementById("len-index-0");
    const vRaw = globalThis.__motionCubeHandCalib;
    const cards = document.querySelectorAll("#hand-calib-view canvas, #hand-calib-side-view canvas");
    return {
      rebuilds: c?.n ?? -1,
      lastLen: c?.lastLen ?? NaN,
      finalInput: inp?.value,
      canvases: cards.length,
      globalOk: !!vRaw,
    };
  });

  await page.screenshot({ path: "spike-shots/hand-calib.png" });
  const merged = { ...kick, ...out };
  const ok =
    !merged.err &&
    merged.rebuilds >= 1 && merged.rebuilds <= 2 &&
    Math.abs(merged.lastLen - (merged.before + 0.1)) < 1e-9 &&
    merged.canvases >= 2 && merged.globalOk;
  console.log(JSON.stringify({ ...merged, PASS: ok }));
  if (!ok) process.exitCode = 1;
} finally {
  await browser.close();
}