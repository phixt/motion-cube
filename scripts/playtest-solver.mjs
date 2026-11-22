// 求解器 UI 验证：打乱 → 求解（CFOP/Roux）→ 阶段面板 → 演示。
// 运行：node scripts/playtest-solver.mjs（先起 dev server，SPIKE_URL 指向非 5173 端口）
//
// ============================================================================
// 阶段数断言的真相源（2026-10-27 修正：脚本不再写死「期望阶段数」）
// ----------------------------------------------------------------------------
// 旧版写死：runSolve("#btn-method-cfop", 7) / runSolve("#btn-method-roux", 6)。
// 这两个数字是拍脑袋抄来的，与应用自身真相源漂移：
//   应用按 src/cube/solver/methodOptions.ts 的 resolveSolverMethod() 把「Roux」解析成
//   **roux-merge**（roux.merge4b4c 默认开，methodOptions.ts:77-80），真实阶段数是 **5**
//   （roux.ts:257/262/273/280），于是脚本抛「阶段数异常：5 != 6」——脚本在说谎
//   （脚本自己的注释写「Roux（5 阶段）」，与硬编码的 6 自相矛盾：注释对、硬编码错）。
//
// 现在期望值全部来自「应用自己」，不再由脚本拍脑袋：
//   A) 方法解析（真相源 A）——页面内 import 应用自己的 src/cube/solver/methodOptions.ts
//      （Vite dev 会把 TS 现场转成浏览器可 import 的 ESM），用应用自己的
//      resolveSolverMethod(base, loadSolverOptions()) 求出「CFOP / Roux 此刻实际解析成哪个
//      方法键」。应用改选项默认值（合并 / EOLR / ZBLL 开关）时脚本自动跟随，不会说谎。
//   B) 阶段计划（真相源 B）——页面内 import 应用自己的 src/cube/solver/solve.ts，用
//      SOLVER_METHODS[key].run(solvedState()) 取该方法的阶段计划（阶段 short 序列），
//      与 UI 渲染出的 .solve-stage 序列逐项比对：
//        · 状态无关的方法（cfop / roux / roux-merge）计划唯一 → 严格相等断言；
//        · 分支型方法（cfop-adv / roux-adv）计划随状态变（见 P0-4）→ 走结构规则断言。
//   C) 结构不变量（真相源 C：静态契约表 STAGE_CONTRACT，逐条注明应用源码出处）——
//      无论动态探测是否可用都生效：阶段数下限、必含阶段、精确签名（状态无关方法）、
//      总步数 > 0、CFOP 与 Roux 的阶段签名必须不同、热表求解速度。
//      ⚠ 动态计划与契约表不一致 = 应用阶段计划变了 → 脚本**报错**并提示更新契约表，
//        绝不静默放宽断言（「任何数都过」是禁止的）。
//
//   已于 2026-11-23 Step 2 彻底解决：
//     - ZBLS 改特征降维键 + viewState 四槽统一（302/302 全收录，真实态命中 100%）；
//     - ZBLL 补 post-AUF + y 共轭展开（7776/7776 = 100% 一步覆盖）；
//     - Roux EOLR 补 3 伪位 <M,U> ItemSolver + 修复 cuberoot 命名表 um 配对（0 例变长）。
//     本脚本同时验证默认模式（CFOP / Roux）及勾选高级项（CFOP+ / Roux+）。
// ============================================================================
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

// ---------------------------------------------------------------------------
// 真相源 A + B：页面内 import 应用自己的求解器模块（应用自己的代码，不是脚本的猜测）
// ---------------------------------------------------------------------------
async function probeTruth() {
  try {
    return await page.evaluate(async () => {
      const res = { ok: false, err: "", resolved: {}, opts: null, shorts: {}, plans: {} };
      try {
        const mo = await import("/src/cube/solver/methodOptions.ts");
        const so = await import("/src/cube/solver/solve.ts");
        const eng = await import("/src/cube/solver/engine.ts");
        const opts = mo.loadSolverOptions();
        res.opts = opts;
        res.resolved.cfop = mo.resolveSolverMethod("cfop", opts);
        res.resolved.roux = mo.resolveSolverMethod("roux", opts);
        for (const key of Object.keys(so.SOLVER_METHODS)) {
          res.shorts[key] = so.SOLVER_METHODS[key].short;
          try {
            // 阶段计划：对「已解态」跑一次该方法，取阶段 short 序列（状态无关方法的计划唯一）
            res.plans[key] = so.SOLVER_METHODS[key].run(eng.solvedState()).stages.map((s) => s.short);
          } catch {
            res.plans[key] = null;
          }
        }
        res.ok = true;
      } catch (e) {
        res.err = String(e && e.message ? e.message : e);
      }
      return res;
    });
  } catch (e) {
    return { ok: false, err: String(e && e.message ? e.message : e), resolved: {}, shorts: {}, plans: {} };
  }
}

const truth = await probeTruth();
if (truth.ok) {
  console.log(
    `[truth] 方法解析(应用 methodOptions.resolveSolverMethod)：CFOP→${truth.resolved.cfop}，Roux→${truth.resolved.roux}` +
      `（localStorage 选项 ${JSON.stringify(truth.opts)}）`,
  );
  console.log(`[truth] 应用阶段计划(应用 solve.ts SOLVER_METHODS[].run) CFOP: ${(truth.plans[truth.resolved.cfop] ?? []).join(" → ")}`);
  console.log(`[truth] 应用阶段计划(应用 solve.ts SOLVER_METHODS[].run) Roux: ${(truth.plans[truth.resolved.roux] ?? []).join(" → ")}`);
} else {
  console.warn(`[truth] 真相源探测失败（${truth.err}）→ 退回静态契约表断言（需 SPIKE_URL 指向 Vite dev server 才能探测）`);
}

// ---------------------------------------------------------------------------
// 真相源 C：静态契约表（人工抄录应用源码 + 注明出处；状态无关方法给精确签名）
// ---------------------------------------------------------------------------
const STAGE_CONTRACT = {
  cfop: {
    src: "src/cube/solver/cfop.ts:116,130,97,104",
    minStages: 7,
    mustInclude: ["Cross", "OLL", "PLL"],
    exact: ["Cross", "F2L 1", "F2L 2", "F2L 3", "F2L 4", "OLL", "PLL"],
    f2lStages: 4,
    stateIndependent: true,
  },
  "cfop-adv": {
    src: "src/cube/solver/cfop.ts:138-190",
    minStages: 6,
    mustInclude: ["Cross", "F2L 1", "F2L 2", "F2L 3"],
    // 分支型：F2L 第 4 组可能走 ZBLS 或普通插入；LL 段可能走 ZBLL(EO+ZBLL) 或 OLL+PLL
    stateIndependent: false,
  },
  roux: {
    src: "src/cube/solver/roux.ts:208,212,221,229,232,235",
    minStages: 6,
    mustInclude: ["Block 1", "Block 2", "CMLL"],
    exact: ["Block 1", "Block 2", "CMLL", "4a EO", "4b ULUR", "4c L4E"],
    prefix: ["Block 1", "Block 2"],
    stateIndependent: true,
  },
  "roux-merge": {
    src: "src/cube/solver/roux.ts:257,262,273,280",
    minStages: 5,
    mustInclude: ["Block 1", "Block 2", "CMLL"],
    exact: ["Block 1", "Block 2", "CMLL", "4a EO", "4b+4c"],
    prefix: ["Block 1", "Block 2"],
    stateIndependent: true,
  },
  "roux-adv": {
    src: "src/cube/solver/roux.ts:147,153,161,172/182,188",
    minStages: 5,
    mustInclude: ["Block 1", "Block 2", "CMLL", "6E2C"],
    prefix: ["Block 1", "Block 2"],
    // 第 4 段是 EOLR 还是回退的 4a EO 取决于状态（P0-4：EOLR 目前从不命中）→ 分支型
    stateIndependent: false,
  },
};

/** 探测不可用时：用观察到的签名反查方法键（仍然只能命中契约表里已知签名，不放行未知形状） */
function identifyKey(base, sig) {
  const hit = Object.entries(STAGE_CONTRACT).filter(([, c]) => c.exact && c.exact.join("|") === sig.join("|"));
  if (hit.length === 1) return hit[0][0];
  throw new Error(
    `[truth] 无法确定 ${base} 实际解析出的方法键：阶段签名 ${sig.join(" → ")} 与契约表不匹配（可用签名：${Object.entries(STAGE_CONTRACT)
      .filter(([, c]) => c.exact)
      .map(([k, c]) => k + "=" + c.exact.join("/"))
      .join(" | ")}）`,
  );
}

/** 阶段断言：静态契约（必查）+ 动态计划（真相源 B，交叉校验） */
function checkStages(base, key, sig, moves, titleTotal) {
  const c = STAGE_CONTRACT[key];
  if (!c) throw new Error(`[base=${base}] 未知求解方法键 ${key}`);
  if (sig.length < c.minStages) {
    throw new Error(`[base=${base}] 阶段数 ${sig.length} < 下限 ${c.minStages}：${sig.join(" → ")}`);
  }
  for (const need of c.mustInclude) {
    if (!sig.includes(need)) throw new Error(`[base=${base}] 缺少阶段「${need}」：${sig.join(" → ")}`);
  }
  if (c.f2lStages !== undefined) {
    const n = sig.filter((s) => /^F2L \d+$/.test(s)).length;
    if (n !== c.f2lStages) throw new Error(`[base=${base}] F2L 阶段数 ${n} != ${c.f2lStages}：${sig.join(" → ")}`);
  }
  if (c.prefix) {
    for (let i = 0; i < c.prefix.length; i++) {
      if (sig[i] !== c.prefix[i]) {
        throw new Error(`[base=${base}] 阶段前缀不符：${sig.join(" → ")}（期望前缀 ${c.prefix.join(" → ")}）`);
      }
    }
  }
  const dyn = truth.plans ? truth.plans[key] : null;
  if (dyn && c.stateIndependent) {
    // ① UI 渲染的阶段序列必须与应用自己的阶段计划逐项相同（真相源 B）
    if (sig.join("|") !== dyn.join("|")) {
      throw new Error(
        `[base=${base}] 阶段签名与「应用阶段计划」不符：\n  UI  ${sig.join(" → ")}\n  应用 ${dyn.join(" → ")}`,
      );
    }
    // ② 应用阶段计划变了（漂移）→ 报错要求更新契约表（不静默放宽、不静默跟随）
    if (c.exact && dyn.join("|") !== c.exact.join("|")) {
      throw new Error(
        `应用阶段计划与脚本契约表漂移（以应用真相为准，请更新 STAGE_CONTRACT）：\n  应用 ${dyn.join(" → ")}\n  契约 ${c.exact.join(" → ")}`,
      );
    }
  } else if (dyn) {
    // 分支型方法（cfop-adv / roux-adv）：静态计划可能走另一分支 → 只按结构规则断言
    console.log(`[truth] ${key} 为分支型方法：静态计划 ${dyn.join(" → ")}（本例可能走另一分支，按结构规则断言）`);
  }
  if (c.exact && sig.join("|") !== c.exact.join("|")) {
    throw new Error(
      `[base=${base}] 阶段签名与契约不符（${c.src}）：\n  实际 ${sig.join(" → ")}\n  契约 ${c.exact.join(" → ")}`,
    );
  }
  if (moves <= 0) throw new Error(`[base=${base}] 总步数为 0`);
  if (titleTotal >= 0 && titleTotal !== moves) {
    throw new Error(`[base=${base}] 阶段步数合计 ${moves} != 标题步数 ${titleTotal}`);
  }
}

// 用输入框打乱（先清空再逐键输入，保证 Vue v-model 同步）
await page.$eval(".hud-alg input", (el) => {
  el.value = "";
});
await page.type(".hud-alg input", SCRA);
await page.click("#btn-apply");
await sleep(800);
const curAlg = await page.evaluate(() => globalThis.__motionCube?.player?.currentAlg ?? "");
if (!curAlg || !curAlg.includes("R")) throw new Error(`打乱未生效：${curAlg}`);
console.log(`scrambled via box (${curAlg.split(/\s+/).filter(Boolean).length} moves)`);

/**
 * 跑一次求解并断言阶段面板。
 * @param base "cfop" | "roux" —— 方法基（按钮）
 * @returns { stages, sig, moves, totalApplied, titleTotal, key }
 */
async function runSolve(base, methodBtn) {
  await page.click(methodBtn);
  await sleep(200);
  await page.click("#btn-solve");
  await sleep(1500); // 首解建表
  await page.waitForSelector(".solve-stage", { timeout: 30000 });
  const rows = await page.$$eval(".solve-stage", (els) =>
    els.map((e) => ({
      rotate: e.classList.contains("solve-stage-rotate"),
      short: (e.querySelector(".stage-short")?.textContent ?? "").trim(),
      count: parseInt(e.querySelector(".stage-count")?.textContent ?? "0", 10) || 0,
    })),
  );
  const title = await page.evaluate(() => {
    const t = document.querySelector(".solve-title");
    const muted = t?.querySelector(".panel-muted")?.textContent ?? "";
    const m = muted.match(/(\d+)/);
    return {
      first: (t?.firstChild?.textContent ?? "").trim(),
      muted: muted.trim(),
      total: m ? parseInt(m[1], 10) : -1,
    };
  });
  // 旋转行（解法底 setupAlg / 收尾 endAlg）不是方法阶段，单独剔除
  const stages = rows.filter((r) => !r.rotate);
  const sig = stages.map((r) => r.short);
  const moves = stages.reduce((a, s) => a + s.count, 0);
  const totalApplied = rows.reduce((a, s) => a + s.count, 0); // 演示实际施加的步数（含 setup/end）

  const key = truth.ok ? truth.resolved[base] : identifyKey(base, sig);
  checkStages(base, key, sig, moves, title.total);
  if (truth.ok) {
    const expectShort = truth.shorts[key];
    if (expectShort && title.first !== expectShort) {
      throw new Error(`[base=${base}] UI 展示的方法「${title.first}」与应用解析出的 ${key}「${expectShort}」不一致`);
    }
  }
  console.log(
    `solve ok [${base} → ${key}]: ${sig.length} 阶段 ${sig.map((s, i) => s + ":" + stages[i].count).join(" ")} | ${title.first} ${title.muted}`,
  );
  return { stages, sig, moves, totalApplied, titleText: `${title.first} ${title.muted}`, key };
}

// CFOP（普通）与 Roux（按应用当前选项解析出的方法，可能是 roux / roux-merge / roux-adv）
const r1 = await runSolve("cfop", "#btn-method-cfop");
await page.waitForSelector("#btn-copy-solve", { timeout: 5000 });
console.log("solve copy button ok");
await page.screenshot({ path: "spike-shots/solve-01-cfop.png" });

// 再解一次（热表）应更快，结果一致
const tHot0 = Date.now();
await page.click("#btn-solve");
await sleep(400);
await page.waitForSelector(".solve-stage");
const hotMs = Date.now() - tHot0;
if (hotMs > 800) throw new Error(`热表求解过慢：${hotMs}ms`);
console.log(`hot solve fast: ${hotMs}ms`);

const r2 = await runSolve("roux", "#btn-method-roux");
await page.screenshot({ path: "spike-shots/solve-02-roux.png" });

// CFOP 与 Roux 必须给出不同的阶段签名（守住「两个方法不能退化成同一个」）
if (r1.sig.join("|") === r2.sig.join("|")) {
  throw new Error(`CFOP 与 Roux 阶段签名相同（${r1.sig.join(" → ")}）—— 两个方法退化成同一个了`);
}
console.log(`stage signature differs ok: CFOP[${r1.key}] ${r1.sig.join(" → ")} | Roux[${r2.key}] ${r2.sig.join(" → ")}`);

// 高级模式 UI 验证：勾选 CFOP+ (ZBLS+ZBLL) 与 Roux+ (EOLR)，确认步数不劣于普通且高级阶段生效
{
  // 1) 切回 CFOP 并勾选第一个选项（cfop.zbll）
  await page.click("#btn-method-cfop");
  await sleep(200);
  const cfopCb = await page.$(".solver-options-panel .opt-input");
  if (!cfopCb) throw new Error("CFOP 选项面板未展开");
  await cfopCb.click();
  await sleep(150);
  await page.click("#btn-solve");
  await page.waitForFunction(
    () => (document.querySelector(".solve-title")?.firstChild?.textContent ?? "").trim() === "CFOP+",
    { timeout: 15000 },
  );
  const advCfop = await page.$$eval(".solve-stage:not(.solve-stage-rotate)", (els) =>
    els.map((e) => ({
      short: (e.querySelector(".stage-short")?.textContent ?? "").trim(),
      count: parseInt(e.querySelector(".stage-count")?.textContent ?? "0", 10) || 0,
    })),
  );
  const advCfopSig = advCfop.map((x) => x.short);
  const advCfopMoves = advCfop.reduce((a, x) => a + x.count, 0);
  if (advCfopMoves > r1.moves) throw new Error(`CFOP+ (${advCfopMoves}) 比 CFOP (${r1.moves}) 更长`);
  if (!advCfopSig.includes("ZBLS") && !advCfopSig.includes("ZBLL")) {
    throw new Error(`CFOP+ 未出现 ZBLS/ZBLL 阶段: ${advCfopSig.join(" → ")}`);
  }
  console.log(`adv CFOP+ ok: ${advCfopMoves} moves (vs CFOP ${r1.moves}) | ${advCfopSig.join(" → ")}`);
  // 还原勾选
  await cfopCb.click();
  await sleep(150);

  // 2) 切到 Roux 并勾选第一个选项（roux.eolr）
  await page.click("#btn-method-roux");
  await sleep(200);
  const rouxCb = await page.$(".solver-options-panel .opt-input");
  if (!rouxCb) throw new Error("Roux 选项面板未展开");
  await rouxCb.click();
  await sleep(150);
  await page.click("#btn-solve");
  await page.waitForFunction(
    () => (document.querySelector(".solve-title")?.firstChild?.textContent ?? "").trim() === "Roux+",
    { timeout: 15000 },
  );
  const advRoux = await page.$$eval(".solve-stage:not(.solve-stage-rotate)", (els) =>
    els.map((e) => ({
      short: (e.querySelector(".stage-short")?.textContent ?? "").trim(),
      count: parseInt(e.querySelector(".stage-count")?.textContent ?? "0", 10) || 0,
    })),
  );
  const advRouxSig = advRoux.map((x) => x.short);
  const advRouxMoves = advRoux.reduce((a, x) => a + x.count, 0);
  if (advRouxMoves > r2.moves) throw new Error(`Roux+ (${advRouxMoves}) 比 Roux (${r2.moves}) 更长`);
  if (!advRouxSig.includes("6E2C")) throw new Error(`Roux+ 缺少 6E2C 阶段: ${advRouxSig.join(" → ")}`);
  console.log(`adv Roux+ ok: ${advRouxMoves} moves (vs Roux ${r2.moves}) | ${advRouxSig.join(" → ")}`);
  // 还原勾选并回到 r2 (Roux 默认) 供下方演示断言使用
  await rouxCb.click();
  await sleep(150);
  await page.click("#btn-solve");
  await page.waitForFunction(
    () => (document.querySelector(".solve-title")?.firstChild?.textContent ?? "").trim() !== "Roux+",
    { timeout: 15000 },
  );
}

// 演示：从当前打乱态逐步施加解法（不重放打乱）。
// 把速度滑条调到「快」再点演示：以第 1 步后立刻采样 alg，应为 打乱+前几步，
// 而非瞬间整段 打乱+解法（后者=旧行为从零重放打乱）。
//
// ⚠ 滑条方向修正（2026-10-27，脚本内既有缺陷，此前被阶段数断言提前挡住未暴露）：
//   演示每步延时 = max(60, speed*1000) ms（GamePage.vue:303），speed 越小=越快；
//   滑条范围 0.05..2 s/步，**右端 = 2 s/步 = 最慢**。旧脚本点的是右端
//   （sliderBox.x + sliderBox.w - 8），50 步要 ~100s，远超下面 30s 的等待超时 → 必然超时。
//   现在点「左端附近」把速度调到 ≈0.10 s/步（10 步/秒 → 50 步约 5s），并**回读** HUD 速度
//   断言确实生效（点歪/事件丢失会立刻报错，而不是默默跑 100s）。
const SPEED_MIN = 0.05;
const SPEED_MAX = 2;
const SPEED_STEP = 0.05;
const TARGET_SPEED = 0.1; // s/步 → ≈10 步/秒
const sliderBox = await page.$eval(".game-hud .win-slider-track", (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
const thumbLen = 18; // WinSlider 滑块长度：值映射要扣掉两端（WinSlider.vue:86,249-256）
const ratio = (TARGET_SPEED - SPEED_MIN) / (SPEED_MAX - SPEED_MIN);
const clickX = sliderBox.x + thumbLen / 2 + ratio * (sliderBox.w - thumbLen);
await page.mouse.click(clickX, sliderBox.y + sliderBox.h / 2);
await sleep(300);
const speedText = await page.$eval(".game-hud .speed-group .speed-label", (el) => el.textContent ?? "");
const speedVal = parseFloat((speedText.match(/(\d+(?:\.\d+)?)/) ?? ["NaN"])[0]);
if (!(speedVal > 0 && speedVal <= 0.2)) {
  throw new Error(`演示速度未调到快档（读回 "${speedText.trim()}" → ${speedVal} s/步），演示会超时`);
}
console.log(`demo speed ok: ${speedText.trim()}（${speedVal} s/步）`);
await page.click(".solve-actions button"); // 演示（demoRunning=false 时是第一个按钮）
await sleep(900); // 0.1 s/步 → 此时应已执行若干步（但远未走完）
const midAlg = await page.evaluate(async () => {
  const el = document.querySelector("twisty-player");
  try {
    return (await el?.experimentalModel.alg.get())?.alg?.toString() ?? "";
  } catch (e) {
    return `ERR:${e.message}`;
  }
});
if (typeof midAlg !== "string" || midAlg.startsWith("ERR")) throw new Error(`演示读取失败：${midAlg}`);
const midTokens = midAlg.split(/\s+/).filter(Boolean);
// 打乱 26 步 + 解法若干：中途长度应远小于 打乱+解法总和，且不小于 打乱步数
const totalSoln = r2.totalApplied;
if (midTokens.length <= 26 || midTokens.length >= 26 + totalSoln) {
  throw new Error(`演示未从打乱态开始逐步施加：len=${midTokens.length} (期望 ${26} < len < ${26 + totalSoln})`);
}
// 应已开始打乱之后的部分（去掉打乱前缀后至少出现解法首步）
console.log(`demo step-by-step ok: mid len=${midTokens.length} (scramble 26 + solution ${totalSoln})`);

// 等演示走完 → 已还原
await page.waitForFunction(
  () => (document.querySelector("#hud-status")?.textContent ?? "").includes("演示完成"),
  { timeout: 30000 },
);
await sleep(400);
const doneAlg = await page.evaluate(() => globalThis.__motionCube?.player?.currentAlg ?? "");
const doneTokens = doneAlg.split(/\s+/).filter(Boolean);
if (doneTokens.length !== 26 + totalSoln) throw new Error(`演示结束步数异常：${doneTokens.length} != ${26 + totalSoln}`);
console.log(`demo finished: ${doneTokens.length} tokens (= scramble + solution)`);

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

// 打乱按钮：点击后魔方被随机打乱（currentAlg 非空且含合法步）
// ⚠ 打乱是**逐步播放**的（GamePage.scrambleCube：20 步 × scrambleSpeed 0.33 s/步 ≈ 6.6s），
//   旧脚本只等 600ms 就断言「20 步」→ 读到的是播放中的前几步（实测 2 步）→ 误报。
//   这里改成等播放真正走完（currentAlg 满 20 步）再断言。
await page.click("#btn-scramble");
await page.waitForFunction(
  () => (globalThis.__motionCube?.player?.currentAlg ?? "").split(/\s+/).filter(Boolean).length >= 20,
  { timeout: 30000 },
);
const scrAlg = await page.evaluate(() => globalThis.__motionCube?.player?.currentAlg ?? "");
const scrTokens = scrAlg.split(/\s+/).filter(Boolean);
if (scrTokens.length !== 20) throw new Error(`打乱按钮应产生 20 步：${scrTokens.length}`);
const scrStatus = await page.$eval("#hud-status", (el) => el.textContent ?? "");
if (!/打乱|Scramble/i.test(scrStatus)) throw new Error(`打乱状态提示异常：${scrStatus}`);
console.log(`scramble button ok: ${scrAlg}`);

// 打乱公式条：显示当前打乱且带复制按钮
const scrBarAlg = await page.$eval("#scramble-alg", (el) => el.textContent ?? "").catch(() => "");
if (scrBarAlg !== scrAlg) throw new Error(`打乱公式条未同步显示：${scrBarAlg}`);
await page.waitForSelector("#btn-copy-scramble", { timeout: 5000 });
console.log("scramble alg bar ok");

await browser.close();
console.log("solver UI playtest OK");
