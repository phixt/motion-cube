// 第二批修复浏览器回归（独立验证者脚本）——只写本文件与 spike-shots/ 产物，不改产品代码。
//
// 用途：对 docs/audit/REVIEW-2026-10.md 第二批 8 项做 UI 级回归断言，输出矩阵表，
// FAIL / SKIP 语义明确；矩阵追加到 spike-shots/batch2-matrix.log。
//
// 运行：node scripts/verify-batch2-browser.mjs               # 全部
//       node scripts/verify-batch2-browser.mjs --only=A,B   # 只跑指定项（调试用）
//       SPIKE_URL=http://localhost:5174/ node scripts/...
//
// 前置：dev server 已常驻（默认 http://localhost:5174/，仅 localhost / IPv6 ::1 可连）。
// 断言纪律：不为了让断言变绿而放宽口径——发现疑似产品 bug 就原样报给 lead；
//   若断言本身写错（与 docs/ 规格或产品实际语义不符）则修正断言，并在脚本注释里写明理由。
import { existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = process.env.SPIKE_URL ?? "http://localhost:5174/";
const OUT = "spike-shots";
const LOG = join(OUT, "batch2-matrix.log");

const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--enable-unsafe-swiftshader",
  "--use-angle=swiftshader",
  "--disable-gpu-sandbox",
  "--window-size=1440,900",
];

const K = {
  library: "motion-cube.library",
  handRig: "motion-cube.handRig",
  settings: "motion-cube.settings",
  snapshot: "motion-cube.snapshot",
  solveBase: "motion-cube.solveBase",
  solveOptions: "motion-cube.solveOptions",
};

if (!existsSync(OUT)) mkdirSync(OUT);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 进程级工具 ----------
class TimeoutError extends Error {}
function raceTimeout(promise, ms, label) {
  const p = Promise.resolve(promise);
  p.catch(() => {});
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label)), ms);
  });
  return Promise.race([p, guard]).finally(() => clearTimeout(timer));
}
function assert(cond, message, evidence) {
  if (cond) return;
  const err = new Error(message);
  err.evidence = evidence;
  throw err;
}
const short = (v, n = 160) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  if (s === undefined) return String(v);
  return s.length > n ? s.slice(0, n) + "…" : s;
};

// ---------- 浏览器 / 页面 ----------
async function launchBrowser(label) {
  const executablePath = existsSync(CHROME) ? CHROME : EDGE;
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: LAUNCH_ARGS,
    defaultViewport: { width: 1440, height: 900 },
    protocolTimeout: 120000,
  });
  browser.__label = label;
  return browser;
}
async function newPage(browser) {
  const page = await browser.newPage();
  page.setDefaultTimeout(25000);
  page.__errors = [];
  page.__console = [];
  page.on("pageerror", (e) => page.__errors.push(String(e && e.message ? e.message : e)));
  page.on("console", (m) => {
    if (m.type() === "error") page.__console.push(m.text().slice(0, 300));
  });
  return page;
}

/** 等待应用外壳挂载（Vite dev 首次编译较慢，且必须等 router 就绪后再改 hash，
 *  否则 Vue router 的首次导航会把 hash 覆盖回 /start） */
async function waitShell(page) {
  await waitFn(
    page,
    () => {
      const app = document.querySelector("#app");
      return !!app && app.children.length > 0 && !!location.hash;
    },
    45000,
    "应用外壳未挂载",
  );
  await sleep(200);
}
/** 改 hash 导航（同文档，组件重新 setup → 重新读取 localStorage） */
async function navHash(page, route) {
  await page.evaluate((r) => {
    location.hash = "#" + r;
  }, route);
  await sleep(250);
}
/** 打开应用（可选先清理 + 注入 localStorage），返回后停在 route 页 */
async function openApp(page, route, storage) {
  await page.goto(BASE + "#/start", { waitUntil: "load", timeout: 60000 });
  await waitShell(page);
  if (storage !== undefined) {
    await page.evaluate((kv) => {
      localStorage.clear();
      for (const [k, v] of Object.entries(kv)) {
        if (v !== null && v !== undefined) localStorage.setItem(k, String(v));
      }
    }, storage);
  }
  const cur = await page.evaluate(() => location.hash);
  if (cur !== "#" + route) await navHash(page, route);
  await sleep(150);
}
async function waitSel(page, sel, timeout = 30000) {
  await page.waitForSelector(sel, { timeout });
}
async function waitFn(page, fn, timeout = 30000, msg = "等待条件超时") {
  try {
    await page.waitForFunction(fn, { timeout });
  } catch (e) {
    throw new Error(msg + "（" + (e && e.message ? e.message.slice(0, 120) : String(e)) + "）");
  }
}
async function waitEditor(page) {
  await waitSel(page, "#editor-view");
  await waitFn(page, () => !!(window.__motionCubeEditor && window.motionCubeHand), 30000, "编辑器调试钩子未就绪");
  await waitFn(
    page,
    () => {
      try {
        return !!window.motionCubeHand.getState().pose;
      } catch {
        return false;
      }
    },
    20000,
    "编辑器未注入手部姿态",
  );
}
async function waitHandPage(page) {
  await waitSel(page, "#hand-reset");
  await waitFn(
    page,
    () => {
      const el = document.getElementById("palm-width");
      return !!(el && el.value !== "");
    },
    30000,
    "标定页未就绪",
  );
}
async function waitGame(page) {
  await waitSel(page, "#btn-apply");
  await waitFn(page, () => !!window.__motionCube, 30000, "游戏页调试后门未就绪");
}

// ---------- 交互工具 ----------
const clickSel = (page, sel) =>
  page.$eval(sel, (el) => {
    el.click();
  });
const textOf = (page, sel) =>
  page.$eval(sel, (el) => (el.textContent ?? "").trim()).catch(() => "");
const valOf = (page, sel) => page.$eval(sel, (el) => el.value).catch(() => null);
const bodyText = (page) =>
  page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ")).catch(() => "");
async function setInput(page, sel, value, events = ["input", "change"]) {
  await page.$eval(
    sel,
    (el, v, evs) => {
      el.focus?.();
      el.value = String(v);
      for (const ev of evs) el.dispatchEvent(new Event(ev, { bubbles: true }));
    },
    String(value),
    events,
  );
}
async function selectOption(page, sel, value) {
  await page.$eval(
    sel,
    (el, v) => {
      el.value = String(v);
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    String(value),
  );
}
/** 展开左侧栏分组（.sb-group-head 文本匹配，默认全折叠） */
async function openSbGroup(page, title) {
  const opened = await page.evaluate((ti) => {
    const heads = [...document.querySelectorAll(".sb-group-head")];
    const norm = (s) => (s || "").replace(/[\u25B8\u25BE]/g, "").trim();
    const head = heads.find((b) => norm(b.textContent) === ti);
    if (!head) return "no-head";
    if ((head.textContent || "").includes("\u25B8")) {
      head.click();
      return "clicked";
    }
    return "already";
  }, title);
  await sleep(150);
  assert(opened !== "no-head", "侧边栏分组未找到：" + title);
}
/** 选手法（依赖已展开「手法」分组） */
async function clickTechnique(page, name) {
  await openSbGroup(page, "手法");
  const r = await page.evaluate((n) => {
    const btns = [...document.querySelectorAll(".tec-item")];
    const btn = btns.find((b) => (b.textContent ?? "").trim() === n);
    if (!btn) return { ok: false, names: btns.map((b) => (b.textContent ?? "").trim()) };
    btn.click();
    return { ok: true };
  }, name);
  assert(r.ok, "未找到手法：" + name + "（列表：" + short(r.names) + "）");
  await sleep(250);
}
const kfFrames = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("#tl-ruler .tl-kf")].map((el) => Number(el.getAttribute("data-frame"))),
  );
const stepBandCount = (page) => page.evaluate(() => document.querySelectorAll("#tl-track .tl-step-band").length);
/** 读 API 当前姿态的 x（形状不可用时重试几次，避免测试侧瞬时读抖动误报 FAIL） */
async function readApiPoseX(page, tries = 5) {
  let last = { type: "none", keys: null, x: null, raw: null };
  for (let i = 0; i < tries; i++) {
    last = await page.evaluate(() => {
      try {
        const st = window.motionCubeHand.getState();
        const q = st && st.pose;
        return {
          type: q === null ? "null" : typeof q,
          keys: q && typeof q === "object" ? Object.keys(q) : null,
          x: q && q.palm && q.palm.transform ? q.palm.transform.position.x : null,
          raw: typeof q === "string" ? q.slice(0, 120) : null,
        };
      } catch (e) {
        return { type: "throw", keys: null, x: null, raw: String(e).slice(0, 120) };
      }
    });
    if (last.x !== null && last.x !== undefined) return last;
    await sleep(200);
  }
  return last;
}
/** 读时间线总帧数（#tl-meta 里「总长 N 帧」） */
const totalFramesOf = async (page) => {
  const meta = await textOf(page, "#tl-meta");
  const m = /总长\s*(\d+)\s*帧/.exec(meta);
  return m ? Number(m[1]) : 0;
};

/* ---------- 标尺标定 / 真实鼠标点击（视口 px = getBoundingClientRect 坐标系） ----------
 * 【坐标系坑】应用在 <html> 上有全局 CSS 缩放（motion-cube.uiScale，默认 1.5）：
 *   el.offsetLeft 是【布局 px】，PointerEvent.clientX 是【视口 px】，两者差一个缩放系数。
 *   产品 seekFromEvent 用 track.getBoundingClientRect() 换算 → 本脚本一律用视口 px。
 *   关键帧标记中心恰好落在 rulerLeft + frame×pxPerFrame（视口 px）→ 可用标记做两点标定。 */
const rulerGeom = (page) =>
  page.evaluate(() => {
    const ruler = document.getElementById("tl-ruler");
    if (!ruler) return null;
    const wrap = ruler.closest(".tl-wrap");
    const rr = ruler.getBoundingClientRect();
    const wr = wrap ? wrap.getBoundingClientRect() : null;
    const marks = [...document.querySelectorAll("#tl-ruler .tl-kf")]
      .map((el) => {
        const b = el.getBoundingClientRect();
        return { frame: Number(el.dataset.frame), x: b.left + b.width / 2 };
      })
      .filter((m) => Number.isFinite(m.frame))
      .sort((a, b) => a.frame - b.frame);
    return {
      marks,
      left: rr.left,
      top: rr.top,
      width: rr.width,
      height: rr.height,
      wrapLeft: wr ? wr.left : rr.left,
      wrapRight: wr ? wr.right : rr.right,
    };
  });

/** 两点标定：目标帧 → 标尺上的视口像素 x（关键帧标记中心 = rulerLeft + frame×pxPerFrame） */
function calibrateX(marks, frame) {
  const lo = marks.filter((m) => m.frame < frame).pop();
  const hi = marks.find((m) => m.frame > frame);
  if (!lo || !hi) return null;
  return lo.x + ((frame - lo.frame) * (hi.x - lo.x)) / (hi.frame - lo.frame);
}

/**
 * 【真实鼠标点击】标尺 seek：必要时先把 .tl-wrap 横向滚到目标点可见，再用 page.mouse.click 真点。
 * **不派发合成 pointerdown** —— 真实点击才是这一轮要守住的东西（合成事件绕过命中测试，
 * 面板压住标尺时照样「成功」，正是之前误判的根源）。
 */
async function clickRulerAtFrame(page, frame) {
  let geom = null;
  let x = null;
  for (let i = 0; i < 10; i++) {
    geom = await rulerGeom(page);
    if (!geom) throw new Error("找不到 #tl-ruler");
    x = calibrateX(geom.marks, frame);
    if (x === null) {
      throw new Error("无法标定目标帧 " + frame + " 的像素位置（标尺关键帧标记=" + JSON.stringify(geom.marks) + "）");
    }
    if (x >= geom.wrapLeft + 2 && x <= geom.wrapRight - 2) break;
    // 目标点落在 .tl-wrap 可视区外 → 先横向滚动标尺容器（真实用户也会这么做）
    const zoom = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).zoom) || 1);
    const needViewport = x < geom.wrapLeft + 2 ? x - (geom.wrapLeft + 2) : x - (geom.wrapRight - 2);
    await page.evaluate((d) => {
      const w = document.getElementById("tl-ruler").closest(".tl-wrap");
      w.scrollLeft += d;
    }, needViewport / zoom);
    await sleep(200);
  }
  const y = geom.top + Math.min(6, geom.height / 2);
  const hit = await page.evaluate(
    (px, py) => {
      const el = document.elementFromPoint(px, py);
      return el
        ? { tag: el.tagName, id: el.id || "", cls: String(el.className || ""), inRuler: !!(el.closest && el.closest("#tl-ruler")) }
        : null;
    },
    x,
    y,
  );
  await page.mouse.click(x, y);
  await sleep(320);
  return { x, y, hit, geom };
}

/** 读播放头帧（#tl-playhead 的 left = previewFrame × pxPerFrame；pxPerFrame 是布局 px） */
const readPlayheadFrame = (page, pxPerFrame) =>
  page.evaluate((ppf) => {
    const ph = document.getElementById("tl-playhead");
    if (!ph || !(ppf > 0)) return null;
    return Math.round(parseFloat(ph.style.left || "0") / ppf);
  }, pxPerFrame);

// ---------- 种子数据构造 ----------
const clone = (o) => JSON.parse(JSON.stringify(o));
function makeFormula(id, name, moves) {
  return { id, name, moves, tags: [], categoryId: null };
}
/** pose 变体：可改手掌位置 x / 拇指 CMC（保持其余结构合法） */
function poseVariant(base, patch = {}) {
  const p = clone(base);
  if (patch.x !== undefined) p.palm.transform.position.x = patch.x;
  if (patch.y !== undefined) p.palm.transform.position.y = patch.y;
  if (patch.z !== undefined) p.palm.transform.position.z = patch.z;
  if (patch.abduction !== undefined) p.thumbCMC.abduction = patch.abduction;
  if (patch.rotation !== undefined) p.thumbCMC.rotation = patch.rotation;
  if (patch.elevation !== undefined) p.thumbCMC.elevation = patch.elevation;
  return p;
}
const libJson = (formulas, techniques) =>
  JSON.stringify({ version: 1, categories: [], formulas, techniques });
const settingsJson = (over = {}) =>
  JSON.stringify({
    moveCooldownMs: 120,
    locale: "zh-CN",
    baseFace: "D",
    sixColorBase: true,
    rulerEnabled: true,
    parallaxIntensity: 2,
    ...over,
  });

/** 先载入编辑器拿到一条合法 Pose，再用它构造种子库 → reload。返回 { pose, storage } */
async function seedEditorLibrary(page, build) {
  await openApp(page, "/editor");
  await waitEditor(page);
  const pose = await page.evaluate(() => JSON.parse(JSON.stringify(window.motionCubeHand.getState().pose)));
  const storage = build(pose);
  await page.evaluate((kv) => {
    localStorage.clear();
    for (const [k, v] of Object.entries(kv)) {
      if (v !== null && v !== undefined) localStorage.setItem(k, String(v));
    }
  }, storage);
  // 重新挂载编辑器（组件 setup 会重新读 localStorage 里的库）
  await navHash(page, "/start");
  await sleep(300);
  await navHash(page, "/editor");
  await waitEditor(page);
  return { pose, storage };
}

// ================= 场景 A：P0-8 库加载容错 =================
async function scenarioA(page) {
  const ev = [];
  const goodFormula = makeFormula("f-good", "好公式", "R U R' U'");
  const goodT1 = { id: "t-good-1", name: "好手法一", formulaId: "f-good", frameRate: 60, keyframes: [], stepMapping: [], contactTracks: [] };
  const goodT2 = { id: "t-good-2", name: "好手法二", formulaId: "f-good", frameRate: 60, keyframes: [], stepMapping: [], contactTracks: [] };
  // 坏条目：frameRate 负数 → deserializeTechnique/validateTechnique 必抛
  const badT = { id: "t-bad", name: "坏手法", formulaId: "f-good", frameRate: -5, keyframes: [], stepMapping: [], contactTracks: [] };
  await seedEditorLibrary(page, () => ({
    [K.library]: libJson([goodFormula], [goodT1, goodT2, badT]),
  }));

  // 1) 其余条数仍在
  await openSbGroup(page, "手法");
  const names = await page.evaluate(() => [...document.querySelectorAll(".tec-item")].map((b) => (b.textContent ?? "").trim()));
  ev.push("加载后手法列表=" + short(names));
  assert(names.length >= 2, "坏条目导致整库丢弃：加载后只剩 " + names.length + " 条手法（期望 2 条好手法保留）", ev.join("；"));
  assert(names.includes("好手法一") && names.includes("好手法二"), "好手法未全部保留：" + short(names), ev.join("；"));
  assert(!names.includes("坏手法"), "坏手法未被跳过（仍出现在列表）：" + short(names), ev.join("；"));

  // 2) UI 有跳过提示
  const body = await bodyText(page);
  const status1 = await textOf(page, "#editor-status");
  const warnHit = ["跳过", "损坏", "非法", "skip", "corrupt"].find((w) => body.includes(w));
  ev.push("跳过提示=" + (warnHit ? "命中『" + warnHit + "』" : "未命中") + " / status=" + short(status1, 80));
  assert(!!warnHit, "UI 无任何跳过/损坏提示（应提示已跳过 1 条坏数据）", ev.join("；"));

  // 3) 保存不会把库清空
  await clickTechnique(page, "好手法一");
  const metaBefore = await textOf(page, "#tl-meta");
  assert(metaBefore.length > 0, "选中好手法后编辑器未进入可编辑态（#tl-meta 空）", ev.join("；"));
  await clickSel(page, "#editor-save");
  await sleep(400);
  const savedRaw = await page.evaluate((k) => localStorage.getItem(k), K.library);
  let saved = null;
  try {
    saved = JSON.parse(savedRaw);
  } catch {
    saved = null;
  }
  ev.push(
    "保存后库=" +
      (saved
        ? "techniques " + (saved.techniques || []).length + " / formulas " + (saved.formulas || []).length
        : "无法解析(" + short(savedRaw, 60) + ")"),
  );
  assert(saved !== null, "保存后 localStorage 库不可解析（疑似被清空）：" + short(savedRaw, 120), ev.join("；"));
  assert((saved.techniques || []).length >= 2, "保存后手法条数减少（被清空）：" + (saved.techniques || []).length, ev.join("；"));
  assert((saved.formulas || []).length >= 1, "保存后公式条数减少（被清空）：" + (saved.formulas || []).length, ev.join("；"));
  const saveStatus = await textOf(page, "#editor-status");
  ev.push("保存状态=" + short(saveStatus, 80));
  return ev;
}

// ================= 场景 B：P0-9 帧率切换重映射 =================
async function scenarioB(page) {
  const ev = [];
  await seedEditorLibrary(page, (pose) => ({
    [K.library]: libJson(
      [makeFormula("f-b", "公式B", "R U R' U'")],
      [
        {
          id: "t-1000",
          name: "千帧手法",
          formulaId: "f-b",
          frameRate: 1000,
          keyframes: [0, 1, 10].map((f) => ({ frame: f, left: clone(pose), right: clone(pose) })),
          stepMapping: [{ stepIndex: 0, startFrame: 0, endFrame: 24 }],
          contactTracks: [],
        },
      ],
    ),
  }));
  await clickTechnique(page, "千帧手法");
  await waitFn(page, () => document.querySelectorAll("#tl-ruler .tl-kf").length > 0, 10000, "时间线关键帧未渲染");
  const before = await kfFrames(page);
  const frBefore = await valOf(page, "#kf-framerate");
  ev.push("切换前帧号=" + short(before) + " / frameRate=" + frBefore);
  assert(before.length === 3 && new Set(before).size === 3, "构造失败：切换前关键帧不是 3 个不重复（" + short(before) + "）", ev.join("；"));

  await selectOption(page, "#kf-framerate", "24");
  await sleep(500);

  const after = await kfFrames(page);
  const status = await textOf(page, "#editor-status");
  const frAfter = await valOf(page, "#kf-framerate");
  const meta = await textOf(page, "#tl-meta");
  ev.push("切换后帧号=" + short(after) + " / frameRate=" + frAfter + " / status=" + short(status, 120) + " / meta=" + short(meta, 80));
  const uniq = new Set(after).size;
  assert(after.length === 3 && uniq === 3, "1000→24 帧率切换未被拒绝：关键帧塌陷为 " + short(after) + "（重复 " + (after.length - uniq) + " 个）", ev.join("；"));
  assert(frAfter === "1000", "拒绝写入后帧率选择框未回退实际值（select=" + frAfter + "）", ev.join("；"));
  const warned = /重合|拒绝|上限|非法|失败|collide|reject/i.test(status) || /重合|拒绝|上限|非法|失败|collide|reject/i.test(await bodyText(page));
  assert(warned, "帧率切换被拒绝但无任何提示（status 空）", ev.join("；"));
  return ev;
}

// ================= 场景 C：P1-3 帧号/单步时长上限 =================
async function scenarioC(page) {
  const ev = [];
  await seedEditorLibrary(page, (pose) => ({
    [K.library]: libJson(
      [makeFormula("f-c", "公式C", "R U")],
      [
        {
          id: "t-dur",
          name: "时长手法",
          formulaId: "f-c",
          frameRate: 60,
          keyframes: [0, 18].map((f) => ({ frame: f, left: clone(pose), right: clone(pose) })),
          stepMapping: [{ stepIndex: 0, startFrame: 0, endFrame: 18 }],
          contactTracks: [],
        },
      ],
    ),
  }));
  await clickTechnique(page, "时长手法");
  const bands = await stepBandCount(page);
  assert(bands >= 1, "构造失败：没有动作块（stepMapping 未渲染）", ev.join("；"));

  // 选中第 1 个动作块 → 出现单步时长输入框
  await page.click('#tl-track .tl-step-band[data-step-index="0"]');
  await waitSel(page, "#step-dur-0", 10000);
  const metaBefore = await textOf(page, "#tl-meta");

  // C-1：单步时长灌 1e8（旧实现会生成 ~6e9 帧刻度 → 主线程阻塞数十秒~数分钟）
  const t0 = Date.now();
  let timedOut = false;
  try {
    await raceTimeout(
      page.$eval("#step-dur-0", (el) => {
        el.value = "100000000";
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }),
      8000,
      "单步时长 1e8 提交",
    );
  } catch (e) {
    if (e instanceof TimeoutError) timedOut = true;
    else throw e;
  }
  const elapsed = Date.now() - t0;
  ev.push("单步时长=1e8 耗时=" + elapsed + "ms" + (timedOut ? "（超时 8s）" : ""));
  if (timedOut) {
    assert(false, "单步时长灌 1e8 后主线程阻塞 >8s（页面卡死），未被拒绝", ev.join("；"));
  }
  assert(elapsed < 5000, "单步时长灌 1e8 后耗时 " + elapsed + "ms（>5s，页面卡顿）", ev.join("；"));

  const resp = await raceTimeout(page.evaluate(() => 1), 5000, "卡顿后交互").then(
    () => true,
    () => false,
  );
  assert(resp, "单步时长提交后页面 5s 内仍无响应", ev.join("；"));

  const statusC = await textOf(page, "#editor-status");
  const metaAfter = await textOf(page, "#tl-meta");
  const durVal = await valOf(page, "#step-dur-0");
  ev.push("status=" + short(statusC, 120) + " / meta=" + short(metaAfter, 80) + " / 输入框回填=" + durVal);
  const rejected = /过大|上限|超出|非法|too large|max|limit/i.test(statusC);
  assert(rejected, "单步时长 1e8 未被显式拒绝（无上限提示）；疑似被静默接受", ev.join("；"));
  assert(metaAfter === metaBefore, "单步时长被拒绝但总帧数/摘要已变（metaBefore=" + short(metaBefore, 60) + " metaAfter=" + short(metaAfter, 60) + "）", ev.join("；"));

  // C-2：关键帧帧号灌 1e8
  await page.click('#tl-ruler .tl-kf[data-frame="0"]');
  await waitFn(page, () => document.getElementById("kf-frame") !== null, 8000, "关键帧面板未打开");
  const t1 = Date.now();
  let timedOut2 = false;
  try {
    await raceTimeout(
      page.$eval("#kf-frame", (el) => {
        el.value = "100000000";
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }),
      8000,
      "关键帧帧号 1e8 提交",
    );
  } catch (e) {
    if (e instanceof TimeoutError) timedOut2 = true;
    else throw e;
  }
  const elapsed2 = Date.now() - t1;
  ev.push("关键帧帧号=1e8 耗时=" + elapsed2 + "ms" + (timedOut2 ? "（超时 8s）" : ""));
  assert(!timedOut2, "关键帧帧号灌 1e8 后主线程阻塞 >8s", ev.join("；"));
  assert(elapsed2 < 5000, "关键帧帧号灌 1e8 后耗时 " + elapsed2 + "ms（>5s）", ev.join("；"));
  const status2 = await textOf(page, "#editor-status");
  const frames2 = await kfFrames(page);
  ev.push("status=" + short(status2, 120) + " / 帧号=" + short(frames2));
  assert(frames2.length === 2 && !frames2.includes(100000000), "关键帧帧号 1e8 未被拒绝（时间线出现超大帧号：" + short(frames2) + "）", ev.join("；"));
  assert(/上限|超出|非法|too large|max|limit/i.test(status2), "关键帧帧号 1e8 被拒绝但无上限提示（status=" + short(status2, 80) + "）", ev.join("；"));
  return ev;
}

// ================= 场景 D：P0-10 手部默认配置单例 =================
async function scenarioD(page) {
  const ev = [];
  await openApp(page, "/hand", {});
  await waitHandPage(page);
  const palm0 = await valOf(page, "#palm-width");
  const scale0 = await valOf(page, "#hand-scale");
  ev.push("初始 palm.width=" + palm0 + " / handScale=" + scale0);
  assert(Number(palm0) === 1.35, "初始 palm.width 非设计默认 1.35（读回 " + palm0 + "）", ev.join("；"));
  assert(Number(scale0) === 1.85, "初始 handScale 非设计默认 1.85（读回 " + scale0 + "）", ev.join("；"));

  // 模拟拖动滑条/输入：就地改写 cfg（旧实现会污染模块级 DEFAULT_HAND_CONFIG 常量本体）
  await setInput(page, "#palm-width", "9.9", ["input"]);
  await sleep(250);
  const palmDirty = await valOf(page, "#palm-width");
  ev.push("改写后 palm.width=" + palmDirty);
  assert(Number(palmDirty) === 9.9, "标定页未能写入 9.9（读回 " + palmDirty + "）", ev.join("；"));

  await clickSel(page, "#hand-reset");
  await sleep(450);
  const palmReset = await valOf(page, "#palm-width");
  const scaleReset = await valOf(page, "#hand-scale");
  const status = await textOf(page, "#hand-status");
  ev.push("重置后 palm.width=" + palmReset + " / handScale=" + scaleReset + " / status=" + short(status, 40));
  assert(Number(palmReset) === 1.35, "点击【重置】未回到设计默认 1.35（读回 " + palmReset + "，默认常量已被就地污染）", ev.join("；"));
  assert(Number(scaleReset) === 1.85, "重置后 handScale 非 1.85（读回 " + scaleReset + "）", ev.join("；"));
  return ev;
}

// ================= 场景 E：P0-6 左手填充棱绕向 + P0-7 mirrorPose 拇指镜像 =================
async function scenarioE(page) {
  const ev = [];
  await openApp(page, "/editor", {});
  await waitEditor(page);

  // E-1 几何绕向（UI 级 sanity，硬断言在 scripts/verify-hand-mesh.ts）
  // 对「指根间填充棱」(userData.part === "knuckle-filler") 求面法线外向度：
  // 逐三角 dot(normalize(faceNormal), normalize(faceCentroid - partCentroid)) 取均值；
  // 绕向翻转 → 符号反转（审计实测 右手 +0.1792 / 左手 -0.1792）。
  const geo = await page.evaluate(() => {
    const ed = window.__motionCubeEditor;
    const outwardScores = (hand) => {
      const scores = [];
      hand.group.traverse((o) => {
        if (!o.isMesh || !o.geometry) return;
        if (!o.userData || o.userData.part !== "knuckle-filler") return;
        const g = o.geometry;
        const pos = g.getAttribute("position");
        const nrm = g.getAttribute("normal");
        if (!pos) return;
        const n = pos.count;
        let cx = 0, cy = 0, cz = 0;
        for (let i = 0; i < n; i++) {
          cx += pos.getX(i); cy += pos.getY(i); cz += pos.getZ(i);
        }
        cx /= n; cy /= n; cz /= n;
        let sum = 0, cnt = 0;
        const faceCount = nrm ? n / 3 : Math.floor(n / 3);
        for (let f = 0; f < faceCount; f++) {
          const a = f * 3, b = a + 1, c = a + 2;
          const mx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3 - cx;
          const my = (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3 - cy;
          const mz = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3 - cz;
          const ml = Math.hypot(mx, my, mz) || 1;
          let nx, ny, nz;
          if (nrm) {
            nx = nrm.getX(a); ny = nrm.getY(a); nz = nrm.getZ(a);
          } else {
            const ax = pos.getX(a), ay = pos.getY(a), az = pos.getZ(a);
            const ux = pos.getX(b) - ax, uy = pos.getY(b) - ay, uz = pos.getZ(b) - az;
            const vx = pos.getX(c) - ax, vy = pos.getY(c) - ay, vz = pos.getZ(c) - az;
            nx = uy * vz - uz * vy; ny = uz * vx - ux * vz; nz = ux * vy - uy * vx;
          }
          const nl = Math.hypot(nx, ny, nz) || 1;
          sum += ((nx / nl) * mx + (ny / nl) * my + (nz / nl) * mz) / ml;
          cnt++;
        }
        scores.push(cnt ? sum / cnt : 0);
      });
      return scores;
    };
    return { left: outwardScores(ed.handLeft), right: outwardScores(ed.handRight) };
  });
  const round = (arr) => arr.map((v) => Number(v.toFixed(4)));
  ev.push("填充棱外向度 左=" + short(round(geo.left)) + " 右=" + short(round(geo.right)));
  assert(geo.right.length > 0 && geo.left.length > 0, "未找到指根间填充棱网格（userData.part=knuckle-filler）", ev.join("；"));
  assert(geo.left.length === geo.right.length, "左右手填充棱数量不一致：" + geo.left.length + " vs " + geo.right.length, ev.join("；"));
  assert(geo.right.every((v) => v > 0.02), "右手填充棱法线非外向（绕向异常）：" + short(round(geo.right)), ev.join("；"));
  assert(geo.left.every((v) => v > 0.02), "左手填充棱法线内向（P0-6 未修复：左手背面剔除不可见）：" + short(round(geo.left)), ev.join("；"));

  // E-2 mirrorPose：API 对称驱动后，左右手拇指世界方向应互为 X 镜像
  const thumb = await page.evaluate((poseIn) => {
    const ed = window.__motionCubeEditor;
    const r = window.motionCubeHand.setPose(poseIn);
    const wp = (obj) => {
      obj.updateWorldMatrix(true, false);
      const e = obj.matrixWorld.elements;
      return [e[12], e[13], e[14]];
    };
    const dirOf = (hand) => {
      const segs = hand.fingers && hand.fingers.thumb ? hand.fingers.thumb.segments : null;
      if (!segs || segs.length === 0) return null;
      const tip = wp(segs[segs.length - 1].joint);
      const base = wp(hand.thumbDof || hand.thumbRoot);
      const d = [tip[0] - base[0], tip[1] - base[1], tip[2] - base[2]];
      const len = Math.hypot(d[0], d[1], d[2]) || 1;
      return [d[0] / len, d[1] / len, d[2] / len];
    };
    return { ok: r.ok, error: r.error ?? null, left: dirOf(ed.handLeft), right: dirOf(ed.handRight) };
  }, poseVariant(await page.evaluate(() => JSON.parse(JSON.stringify(window.motionCubeHand.getState().pose))), { abduction: 25, rotation: -35 }));
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const fmt = (v) => (v ? v.map((x) => Number(x.toFixed(3))) : null);
  assert(thumb.ok, "API setPose 失败：" + short(thumb.error), ev.join("；"));
  assert(thumb.left && thumb.right, "取不到左右手拇指方向（HandRigView 内部结构变更）", ev.join("；"));
  const mirrored = [thumb.right[0] * -1, thumb.right[1], thumb.right[2]];
  const d = dot(thumb.left, mirrored);
  ev.push("拇指方向 左=" + short(fmt(thumb.left)) + " 右=" + short(fmt(thumb.right)) + " 镜像点积=" + d.toFixed(3));
  assert(d > 0.98, "左右手拇指方向不互为 X 镜像（点积 " + d.toFixed(3) + "，P0-7 mirrorPose 可能仍二次取反）", ev.join("；"));

  // E-3 UI 级视觉证据：双手掌心朝镜（镜像对称）+ 左手指根特写（肉眼确认指根间无黑洞）
  const showcase = {
    palm: {
      transform: {
        position: { x: 1.05, y: -0.9, z: 2.1 },
        quaternion: { w: 0.7071, x: -0.7071, y: 0, z: 0 },
      },
      thumbBase: { position: { x: 0, y: 0, z: 0 }, quaternion: { w: 1, x: 0, y: 0, z: 0 } },
    },
    bends: {
      thumb: [180, 180, 180],
      index: [180, 180, 180],
      middle: [180, 180, 180],
      ring: [180, 180, 180],
      pinky: [180, 180, 180],
    },
    thumbCMC: { abduction: 45, elevation: -20, rotation: 30 },
    contacts: [],
  };
  await page.evaluate((p) => window.motionCubeHand.setPose(p), showcase);
  await page.evaluate(() => {
    try {
      globalThis.__motionCubeEditor.player.setCamera(0, 0, 8.0);
    } catch {
      /* ignore */
    }
  });
  await sleep(800);
  const shots = [];
  const shotCanvas = async (name) => {
    const el = await page.$("#editor-view");
    const path = join(OUT, name);
    if (el) await el.screenshot({ path });
    else await page.screenshot({ path });
    shots.push("spike-shots/" + name);
  };
  await shotCanvas("batch2-E-both-hands-mirror.png");
  await page.evaluate(() => window.motionCubeHand.setHandType("left"));
  await sleep(700);
  await shotCanvas("batch2-E-left-knuckle-closeup.png");
  await page.evaluate(() => window.motionCubeHand.setHandType("right"));
  await sleep(500);
  await shotCanvas("batch2-E-right-knuckle-closeup.png");
  ev.push("视觉证据截图=" + short(shots, 220));
  return ev;
}

// ================= 场景 F：P1-1 外部驱动所有权 + P1-2 playFrames 循环 =================
async function scenarioF(page) {
  const ev = [];
  const { pose } = await seedEditorLibrary(page, (p) => ({
    [K.library]: libJson(
      [makeFormula("f-f", "公式F", "R U R' U' F2 D")],
      [
        {
          id: "t-play",
          name: "播放手法",
          formulaId: "f-f",
          frameRate: 60,
          keyframes: [0, 60].map((f) => ({ frame: f, left: clone(p), right: clone(p) })),
          stepMapping: [{ stepIndex: 0, startFrame: 0, endFrame: 60 }],
          contactTracks: [],
        },
      ],
    ),
  }));
  await clickTechnique(page, "播放手法");
  await waitSel(page, "#editor-big-play");

  // F-1：播放中 setPose 不被 60Hz 预览覆盖
  await clickSel(page, "#editor-big-play");
  await sleep(300);
  const playing = await page.$eval("#editor-big-play", (el) => el.classList.contains("playing"));
  ev.push("播放态=" + playing);
  assert(playing, "编辑器未能进入播放态（#editor-big-play 无 playing 类）", ev.join("；"));
  const poseExternal = poseVariant(pose, { x: 1.234, abduction: 33 });
  const setRes = await page.evaluate((p) => window.motionCubeHand.setPose(p), poseExternal);
  assert(setRes.ok, "播放中 setPose 返回失败：" + short(setRes.error), ev.join("；"));
  await sleep(500); // ≥ 30 个 60Hz 预览 tick
  const st = await page.evaluate(() => window.motionCubeHand.getState());
  const xNow = st && st.pose ? st.pose.palm.transform.position.x : null;
  ev.push("播放中 setPose 后 x=" + (xNow === null ? "null" : Number(xNow).toFixed(3)) + "（期望 1.234）");
  assert(xNow !== null && Math.abs(xNow - 1.234) < 0.02, "播放中注入的 API 姿态被编辑器预览覆盖（x=" + short(xNow, 40) + "，期望 1.234）", ev.join("；"));

  // F-1b：用户交互（点关键帧）应归还外部驱动所有权 → 编辑器重新接管姿态
  await page.click('#tl-ruler .tl-kf[data-frame="0"]');
  await sleep(500);
  const st2 = await readApiPoseX(page);
  const xAfterUser = st2.x;
  ev.push(
    "用户交互（点关键帧）后 pose 类型=" +
      st2.type +
      " 键=" +
      short(st2.keys) +
      " x=" +
      (xAfterUser === null ? "null" : Number(xAfterUser).toFixed(3)) +
      (st2.raw ? " raw=" + st2.raw : "") +
      "（应已归还编辑器）",
  );
  assert(
    xAfterUser !== null && Math.abs(xAfterUser - 1.234) > 0.02,
    "外部驱动所有权未在用户交互后归还（x 仍为 API 注入的 1.234）",
    ev.join("；"),
  );

  // 停止编辑器播放，避免与 playFrames 定时器相互影响
  await clickSel(page, "#editor-big-play");
  await sleep(200);
  await page.evaluate(() => window.motionCubeHand.stop());

  // ---------- F-2：playFrames({loop:true}) 至少 2 个周期回到起点 ----------
  // 断言口径依据 docs/hand-api-spec.md 第 3 节第 3 条：**playFrames 帧间不插值**
  // （原文："playFrames 的帧间插值不做（保持实现最小）；外部要平滑就自己密帧"）。
  // 因此帧 f 的姿态在 [f/fps, (f+1)/fps) 区间保持；loop=true 时按跨度 span 取模回绕，
  // 周期 = span/fps。
  // 【旧断言错误】只给 2 帧且假设姿态会插值：采样几乎永远落在「保持首帧」区间，
  // 于是把「正确的循环」误判为「未推进」。现改用 6 帧互异姿态的片段
  // （帧号 0..50、fps 60 → 周期 50/60≈0.833 s，每帧保持 10/60 s），按相位判定回绕，
  // 并用 loop=false 作负对照证明采样器能识别「卡在末帧」。
  const clipXs = [-3, -2, -1, 0, 1, 2];
  const clip = clipXs.map((x, i) => ({ frame: i * 10, pose: poseVariant(pose, { x }) }));
  const PERIOD = (50 / 60) * 1000; // ms
  const near = (v, target) => v !== null && Math.abs(v - target) < 0.05;
  const sampleClip = async (durMs) =>
    page.evaluate(async (dur) => {
      const out = [];
      const t0 = performance.now();
      while (performance.now() - t0 < dur) {
        const s = window.motionCubeHand.getState();
        out.push({
          t: performance.now() - t0,
          x: s && s.pose ? s.pose.palm.transform.position.x : null,
        });
        await new Promise((r) => setTimeout(r, 20));
      }
      return out;
    }, durMs);

  // F-2a 负对照：loop=false → 播一遍后永久停在末帧（证明采样器能识别「卡末帧」）
  const noLoopRes = await page.evaluate(
    (f) => window.motionCubeHand.playFrames(f, { fps: 60, loop: false }),
    clip,
  );
  assert(noLoopRes.ok, "playFrames(loop:false) 返回失败：" + short(noLoopRes.error), ev.join("；"));
  const noLoopSamples = await sampleClip(Math.round(PERIOD * 1.8));
  await page.evaluate(() => window.motionCubeHand.stop());
  const noLoopTail = noLoopSamples.filter((s) => s.t > PERIOD * 1.15);
  assert(noLoopTail.length >= 5, "负对照采样点不足（" + noLoopTail.length + "）", ev.join("；"));
  const stuckAtEnd = noLoopTail.every((s) => near(s.x, 2));
  ev.push(
    "F-2a 负对照 loop:false → 末段 " +
      noLoopTail.length +
      " 个采样点 x=" +
      short(noLoopTail.map((s) => Number(s.x).toFixed(2))) +
      "（末帧 x=2，应全部停在末帧=" +
      stuckAtEnd +
      "）",
  );
  assert(stuckAtEnd, "负对照异常：loop:false 未停在末帧（采样器可能测不到推进，断言无意义）", ev.join("；"));

  // F-2b loop=true：≥2 个周期回到起点
  const loopRes = await page.evaluate(
    (f) => window.motionCubeHand.playFrames(f, { fps: 60, loop: true }),
    clip,
  );
  assert(loopRes.ok, "playFrames(loop:true) 返回失败：" + short(loopRes.error), ev.join("；"));
  const loopSamples = await sampleClip(Math.round(PERIOD * 3.2));
  await page.evaluate(() => window.motionCubeHand.stop());
  const bad = loopSamples.filter((s) => s.x === null || !clipXs.some((v) => near(s.x, v)));
  assert(bad.length === 0, "loop 采样出现片段外姿态 x=" + short(bad.slice(0, 3).map((s) => s.x)), ev.join("；"));
  const distinct = [...new Set(loopSamples.map((s) => clipXs.find((v) => near(s.x, v))))];
  // 起点姿态（x=-3）出现的「簇」：簇内相邻采样 <300 ms，簇间 ≥ 一个回绕间隔
  const starts = loopSamples.filter((s) => near(s.x, -3));
  const bursts = [];
  for (const s of starts) {
    const last = bursts[bursts.length - 1];
    if (!last || s.t - last[last.length - 1].t > 300) bursts.push([s]);
    else last.push(s);
  }
  const burstStarts = bursts.map((b) => b[0].t);
  const gaps = [];
  for (let i = 1; i < burstStarts.length; i++) gaps.push(Math.round(burstStarts[i] - burstStarts[i - 1]));
  ev.push(
    "F-2b loop:true 采样 " +
      loopSamples.length +
      " 点 / 周期≈" +
      PERIOD.toFixed(0) +
      "ms / 出现姿态 x=" +
      short(distinct) +
      " / 起点(x=-3)出现 " +
      starts.length +
      " 次、聚成 " +
      bursts.length +
      " 簇（簇起点=" +
      short(burstStarts.map((v) => Math.round(v))) +
      "）",
  );
  assert(distinct.length >= 4, "loop 采样只见到 " + distinct.length + " 种姿态（片段 6 帧）：播放没有推进", ev.join("；"));
  assert(bursts.length >= 2, "loop 未回绕：起点姿态只出现 " + bursts.length + " 簇（需 ≥2 个周期各回起点一次）", ev.join("；"));
  assert(
    gaps.length >= 1 && gaps.every((g) => Math.abs(g - PERIOD) < 150),
    "回绕周期异常：" + short(gaps) + "ms（期望 ≈" + PERIOD.toFixed(0) + "ms = span/fps）",
    ev.join("；"),
  );
  return ev;
}

// ================= 场景 G：P1-4 关键帧面板单一真相 =================
async function scenarioG(page) {
  const ev = [];
  await seedEditorLibrary(page, (p) => ({
    [K.library]: libJson(
      [makeFormula("f-g", "公式G", "R U R' U'")],
      [
        {
          id: "t-kf",
          name: "面板手法",
          formulaId: "f-g",
          frameRate: 60,
          keyframes: [0, 60, 120].map((f, i) => ({
            frame: f,
            left: poseVariant(p, { x: -0.5 + i * 0.5 }),
            right: poseVariant(p, { x: -0.5 + i * 0.5 }),
          })),
          stepMapping: [
            { stepIndex: 0, startFrame: 0, endFrame: 60 },
            { stepIndex: 1, startFrame: 60, endFrame: 120 },
          ],
          contactTracks: [],
        },
      ],
    ),
  }));
  await clickTechnique(page, "面板手法");
  await waitFn(page, () => document.querySelectorAll("#tl-ruler .tl-kf").length === 3, 10000, "关键帧未渲染");

  // G-1：移动关键帧后输入框不回弹
  await page.click('#tl-ruler .tl-kf[data-frame="60"]');
  await waitFn(
    page,
    () => {
      const p = document.getElementById("kf-edit-panel");
      return !!p && p.style.display !== "none";
    },
    8000,
    "关键帧编辑面板未打开",
  );
  const frameBefore = await valOf(page, "#kf-frame");
  await setInput(page, "#kf-frame", "30", ["change"]);
  await sleep(400);
  const frameAfter = await valOf(page, "#kf-frame");
  const framesAfter = await kfFrames(page);
  ev.push("改帧号前=" + frameBefore + " 改后输入框=" + frameAfter + " 时间线帧号=" + short(framesAfter));
  assert(frameBefore === "60", "面板帧号初值异常：" + frameBefore, ev.join("；"));
  assert(frameAfter === "30", "移动关键帧后输入框回弹（读回 " + frameAfter + "，期望 30；Panel 与播放头双真相）", ev.join("；"));
  assert(framesAfter.length === 3 && new Set(framesAfter).size === 3, "移动关键帧后时间线帧号异常：" + short(framesAfter), ev.join("；"));
  assert(framesAfter.includes(30) && !framesAfter.includes(60), "关键帧未真正移动到 30：" + short(framesAfter), ev.join("；"));

  // ---------- G-2：改缓动必须作用在「面板当前显示帧」（= 播放头）上 ----------
  // 审计原症状：onKfEasingChange 读 selectedFrame —— 选完手法后 selectedFrame=null，
  // 缓动下拉静默无效；播放头移动后它改的又是另一个关键帧。
  // 当前面板显示帧 = 30（G-1 刚把 60 号关键帧移到 30，该帧确有关键帧）。
  const panelFrame = await valOf(page, "#kf-frame");
  ev.push("面板当前显示帧=" + panelFrame + "（关键帧集合=" + short(framesAfter) + "）");
  assert(Number(panelFrame) === 30, "面板显示帧异常：" + panelFrame + "（期望 30）", ev.join("；"));
  await selectOption(page, "#kf-easing", "easeIn");
  await sleep(400);
  const easingNow = await valOf(page, "#kf-easing");
  ev.push("改缓动后面板读回 easing=" + easingNow);
  assert(easingNow === "easeIn", "改缓动后未生效（面板读回 " + easingNow + "）", ev.join("；"));
  // 逐关键帧读回：只有面板显示的那一帧被改
  const readEasingAt = async (frame) => {
    await page.click('#tl-ruler .tl-kf[data-frame="' + frame + '"]');
    await sleep(250);
    return valOf(page, "#kf-easing");
  };
  const e30 = await readEasingAt(30);
  const e0 = await readEasingAt(0);
  const e120 = await readEasingAt(120);
  ev.push("逐帧读回 easing: 帧0=" + e0 + " 帧30=" + e30 + " 帧120=" + e120);
  assert(e30 === "easeIn", "缓动没有落在面板显示帧(30)：读回 " + e30, ev.join("；"));
  assert(e0 !== "easeIn" && e120 !== "easeIn", "缓动被写到了别的关键帧（帧0=" + e0 + " 帧120=" + e120 + "）", ev.join("；"));

  // ---------- G-3：关键帧面板布局（不得溢出侧栏 / 内部可滚 / 末字段可达可改） ----------
  // 【本轮修复①】.kf-edit-panel 加 flex:0 0 auto + max-height:100% + overflow-y:auto。
  // 修复前：面板高 1372px（布局 px）> 侧栏 779px（视口 px），溢出 593 视口 px；面板自身
  //   overflow-y:visible 不可滚 → 末段手指关节字段落在视口外（y≈1020 视口 px），
  //   用户够不到也改不动（实测末字段 150→150 没写进姿态）。
  // 【口径说明】不断言「面板不遮标尺」——先前那句是误判（把 offsetLeft 当视口 px 传给了
  //   elementFromPoint）；面板本就锁在侧栏 248px 内、离标尺左缘还有 28px，不会横向压住标尺。
  //   这里只断言真实缺陷：① 溢出量；② 面板内部可滚；③ 末字段可达可操作（改了姿态真的变）。
  {
    const geom = await page.evaluate(() => {
      const panel = document.getElementById("kf-edit-panel");
      const sidebar = document.querySelector(".editor-sidebar");
      if (!panel || !sidebar) return null;
      const pr = panel.getBoundingClientRect();
      const sr = sidebar.getBoundingClientRect();
      const cs = getComputedStyle(panel);
      return {
        panelTop: pr.top,
        panelBottom: pr.bottom,
        panelHeight: pr.height,
        sidebarBottom: sr.bottom,
        overflowY: cs.overflowY,
        clientHeight: panel.clientHeight,
        scrollHeight: panel.scrollHeight,
      };
    });
    assert(geom, "关键帧面板 #kf-edit-panel / 侧栏 .editor-sidebar 未找到", ev.join("；"));
    const overflow = Math.round(geom.panelBottom - geom.sidebarBottom);
    ev.push(
      "面板 底=" + Math.round(geom.panelBottom) + "（高 " + Math.round(geom.panelHeight) + "） / 侧栏 底=" +
        Math.round(geom.sidebarBottom) + " → 溢出=" + overflow + "px / overflow-y=" + geom.overflowY +
        " / scrollHeight=" + geom.scrollHeight + " clientHeight=" + geom.clientHeight,
    );
    assert(
      overflow <= 2,
      "关键帧面板溢出侧栏 " + overflow + " 视口 px（面板底 " + Math.round(geom.panelBottom) + " > 侧栏底 " +
        Math.round(geom.sidebarBottom) + "）：.kf-edit-panel 的 flex:0 0 auto / max-height:100% 修复丢了",
      ev.join("；"),
    );
    assert(
      geom.overflowY === "auto",
      "关键帧面板 computed overflow-y=" + geom.overflowY + "（应为 auto：面板必须能内部滚动，否则末段字段落在视口外够不到）",
      ev.join("；"),
    );
    assert(
      geom.scrollHeight > geom.clientHeight,
      "关键帧面板内容没有超出可视高度（scrollHeight=" + geom.scrollHeight + " ≤ clientHeight=" + geom.clientHeight +
        "）：无法验证「面板内部可滚」",
      ev.join("；"),
    );

    // 主位手切到左手：编辑落在左轨，而外部注入 API 读的就是左手（registerHandApi(handLeft, handRight)）
    const lBtn = await page.evaluate(() => {
      const b = document.getElementById("kf-edit-hand-left");
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    assert(lBtn, "找不到主位手切换按钮 #kf-edit-hand-left", ev.join("；"));
    await page.mouse.click(lBtn.x, lBtn.y);
    await sleep(250);

    // 真实滚轮把面板滚到底（每步 200px，滚到 scrollTop 达上限即停；不直接写 scrollTop）
    let sc = null;
    for (let i = 0; i < 60; i++) {
      sc = await page.evaluate(() => {
        const p = document.getElementById("kf-edit-panel");
        const r = p.getBoundingClientRect();
        return {
          top: p.scrollTop,
          max: p.scrollHeight - p.clientHeight,
          cx: r.left + r.width / 2,
          cy: r.top + Math.min(90, r.height / 2),
        };
      });
      if (sc.top >= sc.max - 1) break;
      await page.mouse.move(sc.cx, sc.cy);
      await page.mouse.wheel({ deltaY: 200 });
      await sleep(140);
    }
    assert(
      sc && sc.top >= sc.max - 1,
      "真实滚轮没能把关键帧面板滚到底（scrollTop=" + (sc ? Math.round(sc.top) : "null") + " / 上限=" +
        (sc ? Math.round(sc.max) : "null") + "）",
      ev.join("；"),
    );

    // 末字段（手指关节）：按实际 DOM 取最后一个可操作字段
    const last = await page.evaluate(() => {
      const panel = document.getElementById("kf-edit-panel");
      const pr = panel.getBoundingClientRect();
      const inputs = [...panel.querySelectorAll("input")];
      const el = inputs.filter((e) => (e.id || "").startsWith("kf-bend-")).pop() || inputs.pop();
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return {
        id: el.id,
        value: el.value,
        min: el.min,
        max: el.max,
        top: b.top,
        bottom: b.bottom,
        left: b.left,
        height: b.height,
        panelTop: pr.top,
        panelBottom: pr.bottom,
        inPanel: b.top >= pr.top - 1 && b.bottom <= pr.bottom + 1,
        inViewport: b.top >= 0 && b.bottom <= window.innerHeight,
      };
    });
    assert(last, "关键帧面板里找不到任何输入框", ev.join("；"));
    const vh = await page.evaluate(() => window.innerHeight);
    ev.push(
      "滚到底 scrollTop=" + Math.round(sc.top) + "/" + Math.round(sc.max) + " → 末字段 #" + last.id +
        " 值=" + last.value + " 位置 top=" + Math.round(last.top) + " bottom=" + Math.round(last.bottom) +
        "（面板 " + Math.round(last.panelTop) + ".." + Math.round(last.panelBottom) + "，视口高 " + vh + "）",
    );
    assert(
      last.inPanel,
      "面板滚到底后末字段 #" + last.id + " 仍不在面板盒内（top=" + Math.round(last.top) + " bottom=" +
        Math.round(last.bottom) + "，面板 " + Math.round(last.panelTop) + ".." + Math.round(last.panelBottom) + "）",
      ev.join("；"),
    );
    assert(
      last.inViewport,
      "面板滚到底后末字段 #" + last.id + " 落在视口外（top=" + Math.round(last.top) + " bottom=" +
        Math.round(last.bottom) + "，视口高 " + vh + "）：用户够不到也改不动",
      ev.join("；"),
    );

    // 真改它的值 → 姿态真的变（bends.pinky）
    const poseBefore = await page.evaluate(() => {
      const s = window.motionCubeHand?.getState?.();
      return s && s.pose ? JSON.stringify(s.pose.bends?.pinky ?? null) : null;
    });
    assert(poseBefore !== null, "读不到手部姿态（window.motionCubeHand.getState().pose 为空）", ev.join("；"));
    const lo = Number(last.min || 0);
    const hi = Number(last.max || 180);
    let newVal = Number(last.value) === 120 ? 130 : 120;
    newVal = Math.min(hi, Math.max(lo, newVal));
    await page.mouse.click(last.left + 8, last.top + last.height / 2);
    await sleep(250);
    const activeId = await page.evaluate(() => document.activeElement?.id || "");
    assert(
      activeId === last.id,
      "真实鼠标点击末字段后焦点没落在它上面（activeElement=" + activeId + "，期望 " + last.id + "）",
      ev.join("；"),
    );
    await page.keyboard.down("Control");
    await page.keyboard.press("KeyA");
    await page.keyboard.up("Control");
    await page.keyboard.type(String(newVal), { delay: 40 });
    await sleep(600);
    const poseAfter = await page.evaluate(() => {
      const s = window.motionCubeHand?.getState?.();
      return s && s.pose ? JSON.stringify(s.pose.bends?.pinky ?? null) : null;
    });
    ev.push("改末字段 #" + last.id + " " + last.value + "→" + newVal + " → 姿态 bends.pinky " + poseBefore + " → " + poseAfter);
    assert(
      poseBefore !== poseAfter,
      "改末字段的值没写进姿态（bends.pinky 仍是 " + poseAfter + "）：末字段够不到/写不进（修复前实测 150→150）",
      ev.join("；"),
    );
  }

  // ---------- G-4：面板显示帧没有关键帧时，改缓动必须显式提示（不得静默吞掉） ----------
  const total = await totalFramesOf(page);
  assert(total > 0, "读不到时间线总帧数（#tl-meta）", ev.join("；"));
  // 标尺的「像素 ↔ 帧」映射不能假设 = 宽度×frame/total（可见窗口/缩放会变），
  // 改用关键帧标记的真实位置做两点标定，再取「两相邻关键帧中间的无关键帧帧」来验证分支。
  // 【坐标系坑（已修）】应用在 <html> 上加了全局 CSS 缩放（motion-cube.uiScale，默认 1.5）：
  //   el.offsetLeft 是【布局 px】，PointerEvent.clientX 是【视口 px】，两者差一个缩放系数。
  //   之前用 offsetLeft 标定却当成 clientX 用 → seek 落点被缩成「目标帧/1.5」（15 → 10），
  //   而断言只看「落点是否有关键帧」→ 落点错位也没被发现（还被误判成产品问题）。
  //   现在统一用 getBoundingClientRect（视口 px，与产品 seekFromEvent 同一坐标系），
  //   并显式断言「落点 = 目标帧」。
  const ruler = await page.$eval("#tl-ruler", (el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height, styleWidth: el.style.width };
  });
  const markers = await page.$$eval("#tl-ruler .tl-kf", (els) =>
    els
      .map((el) => {
        const b = el.getBoundingClientRect();
        return { frame: Number(el.dataset.frame), x: b.left + b.width / 2 };
      })
      .filter((m) => Number.isFinite(m.frame))
      .sort((a, b) => a.frame - b.frame),
  );
  ev.push("标尺标记=" + JSON.stringify(markers) + " 总长=" + total);
  assert(markers.length >= 2, "标尺关键帧标记不足，无法标定像素↔帧映射：" + JSON.stringify(markers), ev.join("；"));
  // 取目标帧：夹在两个相邻关键帧正中间、且必然不是关键帧的那一帧
  let target = null;
  for (let i = 0; i + 1 < markers.length; i++) {
    const a = markers[i], b = markers[i + 1];
    const mid = Math.floor((a.frame + b.frame) / 2);
    if (mid > a.frame && mid < b.frame && !framesAfter.includes(mid)) { target = mid; break; }
  }
  assert(target !== null, "找不到夹在两个关键帧之间的无关键帧帧（标记=" + JSON.stringify(markers) + "）", ev.join("；"));
  // 两点标定（视口 px，与产品 seekFromEvent 同坐标系）：
  //   x = a.x + (frame - a.frame) * (b.x - a.x) / (b.frame - a.frame)
  // 两点标定公式（视口 px，与产品 seekFromEvent 同坐标系）：
  //   x = lo.x + (frame - lo.frame) * (hi.x - lo.x) / (hi.frame - lo.frame)
  //   —— 关键帧标记中心恰好落在 rulerLeft + frame×pxPerFrame。
  //   实际点击由 clickRulerAtFrame 内部按同一公式标定（滚动 .tl-wrap 后会重新标定）。
  // 【本轮修复③】改用【真实鼠标点击】标尺做 seek（不再派发合成 pointerdown）：
  //   合成事件绕过命中测试（面板压住标尺时照样"成功"），真实点击才是这一轮要守住的东西。
  //   .tl-wrap 是横向滚动容器 → 目标点落在可视区外时先横向滚动容器（真实用户也会这么做），
  //   滚动后必须按新的标记位置【重新两点标定】（calibrateX 在 clickRulerAtFrame 内部做）。
  const click = await clickRulerAtFrame(page, target);
  ev.push(
    "标尺真实鼠标点击：目标帧=" + target + "（点击视口像素 " + Math.round(click.x) + "）命中元素=" +
      (click.hit ? click.hit.tag + (click.hit.id ? "#" + click.hit.id : "") : "null"),
  );
  // 播放头（#tl-playhead 的 left = previewFrame × pxPerFrame，布局 px；pxPerFrame = 标尺布局宽/总帧）
  // 是「面板显示帧」的单一真相源 → 先读播放头，再比对面板显示帧。
  const pxPerFrame = parseFloat(ruler.styleWidth || "0") / Math.max(1, total);
  const playheadFrame = await page.evaluate((ppf) => {
    const ph = document.getElementById("tl-playhead");
    if (!ph || !(ppf > 0)) return null;
    return Math.round(parseFloat(ph.style.left || "0") / ppf);
  }, pxPerFrame);
  const frame3 = Number(await valOf(page, "#kf-frame"));
  ev.push(
    "标尺 seek 目标帧=" + target + "（点击视口像素 " + Math.round(click.x) + "）→ 播放头帧=" + playheadFrame +
      " 面板显示帧=" + frame3 + "（时间线总长 " + total + " 帧）",
  );
  assert(
    playheadFrame === target,
    "标尺 seek 落点错位：目标帧 " + target + "，实际播放头在 " + playheadFrame + "（像素标定与坐标系不一致）",
    ev.join("；"),
  );
  assert(
    frame3 === target,
    "seek 后关键帧面板帧号没有跟随播放头（面板=" + frame3 + "，播放头=" + playheadFrame + "）——P1-4 单一真相源未覆盖 seek 路径",
    ev.join("；"),
  );
  assert(!framesAfter.includes(frame3), "seek 落点 " + frame3 + " 恰有关键帧，无法验证「无关键帧」分支", ev.join("；"));
  await selectOption(page, "#kf-easing", "easeOut");
  await sleep(400);
  const st3 = await textOf(page, "#editor-status");
  ev.push("无关键帧帧改缓动 → status=" + short(st3, 90));
  assert(/没有关键帧|缓动未生效/.test(st3), "面板显示帧无关键帧时改缓动未提示（status=" + short(st3, 90) + "）", ev.join("；"));

  // ---------- G-5：标尺最左/中/右三段真实鼠标点击，帧号必须精确命中 ----------
  // 【本轮修复③】面板修好后标尺不再被遮挡 → 三段都用真实鼠标点击（page.mouse.click），
  //   并断言播放头/面板帧号【精确等于】按 getBoundingClientRect 标定出的目标帧。
  {
    const geom = await rulerGeom(page);
    assert(geom && geom.marks.length >= 2, "标尺关键帧标记不足，无法取三段目标帧", ev.join("；"));
    const marks = geom.marks;
    // 目标帧必须既不是关键帧、也不贴着关键帧标记（否则点到的是 .tl-kf 按钮 → selectKf 覆盖 seek）
    const clearOf = (f) => marks.every((m) => Math.abs(m.frame - f) > 1);
    const picks = [];
    const first = marks[0];
    const second = marks[1];
    const lastMark = marks[marks.length - 1];
    const prevMark = marks[marks.length - 2];
    const leftF = first.frame + 2;
    if (leftF < second.frame - 1 && clearOf(leftF)) picks.push({ name: "左", frame: leftF });
    const midA = marks.length >= 3 ? marks[marks.length - 2] : first;
    const midB = marks.length >= 3 ? lastMark : second;
    const midF = Math.floor((midA.frame + midB.frame) / 2);
    if (midF > midA.frame && midF < midB.frame && clearOf(midF)) picks.push({ name: "中", frame: midF });
    const rightF = lastMark.frame - 8;
    if (rightF > prevMark.frame + 1 && clearOf(rightF)) picks.push({ name: "右", frame: rightF });
    assert(picks.length >= 2, "标尺三段目标帧取不满（marks=" + JSON.stringify(marks) + "）", ev.join("；"));
    for (const p of picks) {
      const r = await clickRulerAtFrame(page, p.frame);
      const phFrame = await readPlayheadFrame(page, pxPerFrame);
      const panelFrame = Number(await valOf(page, "#kf-frame"));
      ev.push(
        p.name + "段 目标帧=" + p.frame + " 点击 x=" + Math.round(r.x) + " 命中=" +
          (r.hit ? r.hit.tag + (r.hit.id ? "#" + r.hit.id : "") : "null") + " → 播放头帧=" + phFrame +
          " 面板帧号=" + panelFrame,
      );
      assert(
        phFrame === p.frame,
        p.name + "段真实点击标尺：目标帧 " + p.frame + "，播放头却落在 " + phFrame + "（像素↔帧标定不一致）",
        ev.join("；"),
      );
      assert(
        panelFrame === p.frame,
        p.name + "段真实点击标尺：目标帧 " + p.frame + "，关键帧面板帧号 " + panelFrame + " 未跟随播放头",
        ev.join("；"),
      );
    }
  }
  return ev;
}

// ================= 场景 H：P1-7 快照完整序列 + P1-8 复制解法含 endAlg =================
async function scenarioH(page) {
  const ev = [];
  const steps = { H1: [], H2: [], H3: [], H4: [] };
  await openApp(page, "/game", {
    [K.settings]: settingsJson({ baseFace: "F", moveCooldownMs: 0 }),
    [K.solveBase]: JSON.stringify(["F"]),
  });
  await waitGame(page);

  // ---- H-1：严格连打 30 键 → 恰好 30 步（无兜底）；>24 步后快照恢复状态一致 ----
  try {
    // 【本轮修复②】旧实现无条件忽略落在 INPUT/TEXTAREA 上的按键（只看 tagName），
    //   cubing 内部控件抢焦点就整段吞键：45ms 间隔连按 30 次只记到 23 步（丢 7 键）。
    //   修复后判据换成 src/input/textEntry.ts 的 isTextEntryTarget（只保护「用户真在文本框里打字」）。
    // 【严格口径】按 30 次就必须是 30 步 —— 不带任何「等 currentAlg 增长、没增长就补按」的兜底：
    //   兜底会把丢键掩盖掉（旧实现正是靠兜底才「看起来通过」）。
    const keys = ["r", "u", "f", "d", "l", "b"];
    const algLen = () =>
      page.evaluate(() => (window.__motionCube?.player?.currentAlg || "").split(/\s+/).filter(Boolean).length);
    await page.evaluate(() => {
      const a = document.activeElement;
      if (a && typeof a.blur === "function") a.blur();
    });
    const stepsBefore = await algLen();
    assert(stepsBefore === 0, "游戏页起始步数应为 0（openApp 已清 localStorage），实际 " + stepsBefore, ev.join("；"));
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press(keys[i % keys.length]);
      await sleep(45);
    }
    await page.waitForFunction(() => !!window.__motionCube, { timeout: 15000 });
    await sleep(500);
    const fullAlg = await page.evaluate(() => window.__motionCube.player.currentAlg);
    const snapRaw = await page.evaluate((k) => localStorage.getItem(k), K.snapshot);
    const snapAlg = snapRaw ? JSON.parse(snapRaw).alg : "";
    const tok = (s) => (s || "").split(/\s+/).filter(Boolean);
    ev.push("H1 严格连打 30 键（45ms 间隔，无兜底）→ currentAlg=" + tok(fullAlg).length + " 步 / 快照=" + tok(snapAlg).length + " 步");
    assert(tok(fullAlg).length === 30, "严格连打丢键：按 30 次只记到 " + tok(fullAlg).length + " 步（修复前实测 23/30）：焦点判据仍在吞键", ev.join("；"));
    assert(tok(snapAlg).length >= 28, "快照只存了 " + tok(snapAlg).length + " 步（P1-7：从 24 条封顶的显示日志写入）", ev.join("；"));
    assert(tok(snapAlg).join(" ") === tok(fullAlg).join(" "), "快照序列与实际完整序列不一致：快照 " + tok(snapAlg).length + " 步 vs 实际 " + tok(fullAlg).length + " 步", ev.join("；"));
    // 重载恢复
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitGame(page);
    await page.waitForFunction(() => document.querySelector("#hud-status")?.textContent?.includes("已恢复"), { timeout: 15000 }).catch(() => {});
    const hud = await textOf(page, "#hud-status");
    const restoredAlg = await page.evaluate(() => window.__motionCube.player.currentAlg);
    const logCount = await page.evaluate(() => document.getElementById("move-log")?.children.length ?? 0);
    ev.push("H1 重载后 status=" + short(hud, 40) + " / currentAlg=" + tok(restoredAlg).length + " 步 / 显示日志=" + logCount + " 条");
    assert(hud.includes("已恢复"), "重载后未恢复进度（status=" + short(hud, 60) + "）", ev.join("；"));
    assert(tok(restoredAlg).join(" ") === tok(fullAlg).join(" "), "重载恢复的状态与离开时不一致：恢复 " + tok(restoredAlg).length + " 步 vs 离开 " + tok(fullAlg).length + " 步（P1-7 进度静默丢失）", ev.join("；"));
    assert(logCount <= 24, "显示日志未按 24 条封顶（" + logCount + " 条）", ev.join("；"));
    steps.H1.push("PASS");
  } catch (e) {
    steps.H1.push(e.message);
    ev.push("H1 ✗ " + e.message);
  }

  // ---- H-3：焦点上下文判据（非文本控件不得吞游戏键 / 真在文本框打字必须被保护） ----
  // 【本轮修复②】keymap 改用 src/input/textEntry.ts 的 isTextEntryTarget：
  //   只保护「用户真在文本框里打字」；hidden / readonly / 禁用 / 非文本类型 input /
  //   不可见控件 / cubing（twisty-player）内部控件【都不得】吞掉游戏按键。
  try {
    const algLen = () =>
      page.evaluate(() => (window.__motionCube?.player?.currentAlg || "").split(/\s+/).filter(Boolean).length);
    const pressN = async (n) => {
      for (let i = 0; i < n; i++) {
        await page.keyboard.press("r");
        await sleep(50);
      }
      await sleep(350);
    };

    // (1) hidden input：input[type=hidden] 按规范不可聚焦（focus() 是空操作），
    //     故用带 bubbles 的合成 keydown 把 event.target 精确设成它 —— 判据只看 event.target。
    const hidden = await page.evaluate(async () => {
      const inp = document.createElement("input");
      inp.type = "hidden";
      inp.id = "probe-hidden-input";
      document.body.appendChild(inp);
      const before = (window.__motionCube?.player?.currentAlg || "").split(/\s+/).filter(Boolean).length;
      for (let i = 0; i < 5; i++) {
        inp.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyR", key: "r", bubbles: true, cancelable: true }));
      }
      await new Promise((r) => setTimeout(r, 250));
      const after = (window.__motionCube?.player?.currentAlg || "").split(/\s+/).filter(Boolean).length;
      inp.remove();
      return { before, after };
    });
    ev.push("H3 hidden input（合成 keydown，target=隐藏框）按 5 键 → " + hidden.before + " → " + hidden.after + " 步");
    assert(
      hidden.after - hidden.before === 5,
      "目标落在 hidden input 上时游戏键被吞（5 键只记 " + (hidden.after - hidden.before) +
        " 步）：isTextEntryTarget 把隐藏框当成了文本框",
      ev.join("；"),
    );

    // (2)(3) readonly 文本框 / input[type=range]：真实聚焦 + 真实按键
    const focusCase = async (id, attrs) => {
      await page.evaluate((i, a) => {
        const old = document.getElementById(i);
        if (old) old.remove();
        const el = document.createElement("input");
        el.id = i;
        el.style.cssText = "position:fixed;left:24px;top:24px;width:180px;height:36px;z-index:99999";
        for (const [k, v] of Object.entries(a)) el.setAttribute(k, v);
        document.body.appendChild(el);
        el.focus();
      }, id, attrs);
      const focused = await page.evaluate(() => document.activeElement?.id || "");
      const before = await algLen();
      await pressN(5);
      const after = await algLen();
      await page.evaluate((i) => document.getElementById(i)?.remove(), id);
      return { focused, before, after, delta: after - before };
    };
    for (const c of [
      { label: "readonly 文本框", id: "probe-readonly-input", attrs: { type: "text", readonly: "readonly" } },
      { label: "input[type=range]", id: "probe-range-input", attrs: { type: "range" } },
    ]) {
      const r = await focusCase(c.id, c.attrs);
      ev.push(
        "H3 " + c.label + " 聚焦=" + (r.focused === c.id ? "是" : "否(" + r.focused + ")") + " 按 5 键 → " +
          r.before + " → " + r.after + " 步",
      );
      assert(r.focused === c.id, c.label + " 聚焦失败（activeElement=" + r.focused + "）", ev.join("；"));
      assert(
        r.delta === 5,
        "焦点在 " + c.label + " 上时游戏键被吞（5 键只记 " + r.delta + " 步）：焦点判据仍在吞键",
        ev.join("；"),
      );
    }

    // (4) twisty-player 宿主（cubing 内部控件的宿主）：不得吞
    const twistyFocus = await page.evaluate(() => {
      const tp = document.querySelector("twisty-player");
      if (!tp) return null;
      tp.setAttribute("tabindex", "0");
      tp.focus();
      return document.activeElement === tp ? "twisty-player" : (document.activeElement?.tagName || "null");
    });
    const tBefore = await algLen();
    await pressN(5);
    const tAfter = await algLen();
    ev.push("H3 twisty-player 宿主 聚焦=" + twistyFocus + " 按 5 键 → " + tBefore + " → " + tAfter + " 步");
    assert(twistyFocus === "twisty-player", "焦点没能落到 twisty-player 宿主上（activeElement=" + twistyFocus + "）", ev.join("；"));
    assert(
      tAfter - tBefore === 5,
      "焦点在 twisty-player 宿主上时游戏键被吞（5 键只记 " + (tAfter - tBefore) + " 步）",
      ev.join("；"),
    );

    // (5) 真在文本框打字：游戏页公式框 → 值正确、步数不变、hash 不变
    const hashBefore = await page.evaluate(() => location.hash);
    const typeBefore = await algLen();
    const focusedAlg = await page.evaluate(() => {
      const el = document.querySelector(".hud-alg input");
      if (!el) return false;
      el.focus();
      return document.activeElement === el;
    });
    assert(focusedAlg, "游戏页公式框（.hud-alg input）未找到或聚焦失败", ev.join("；"));
    await page.keyboard.type("R U F' D2", { delay: 30 });
    await sleep(500);
    const typedVal = await page.evaluate(() => document.querySelector(".hud-alg input")?.value ?? null);
    const typeAfter = await algLen();
    const hashAfter = await page.evaluate(() => location.hash);
    ev.push(
      "H3 游戏页公式框键入 \"R U F' D2\" → 值=" + JSON.stringify(typedVal) + " 步数 " + typeBefore + "→" +
        typeAfter + " hash " + hashBefore + "→" + hashAfter,
    );
    assert(typedVal === "R U F' D2", "公式框键入结果不对：" + JSON.stringify(typedVal), ev.join("；"));
    assert(typeAfter === typeBefore, "在文本框里打字竟然触发了游戏动作（步数 " + typeBefore + "→" + typeAfter + "）", ev.join("；"));
    assert(hashAfter === hashBefore, "在文本框里打字改变了路由 hash（" + hashBefore + "→" + hashAfter + "）", ev.join("；"));
    steps.H3.push("PASS");
  } catch (e) {
    steps.H3.push(e.message);
    ev.push("H3 ✗ " + e.message);
  }

  // ---- H-2：复制解法包含 endAlg（与演示收尾朝向一致） ----
  try {
    // 场景选择（关键）：全局底 = F（六色底）、解法底 = D（≠ 全局底）。
    //   · 全局底 = D 时 endAlg 合法为空（标准全局底视角下 T 已 = target），验不到 P1-8；
    //   · 解法底 = 全局底时 setupAlg/endAlg 同样为空（无需整块旋转）。
    //   只有「全局底 ≠ D 且 解法底 ≠ 全局底」才必然产生 setupAlg 与 endAlg。
    await page.evaluate((k) => localStorage.setItem(k, JSON.stringify(["D"])), K.solveBase);
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitGame(page);

    const algBox = await page.$("#btn-apply").catch(() => null);
    assert(!!algBox, "游戏页缺少 #btn-apply");
    const typed = await page.evaluate(() => {
      const host = document.querySelector(".hud-alg");
      const el = host && (host.querySelector("input") || host.querySelector("textarea"));
      return !!el;
    });
    assert(typed, "找不到公式输入框（.hud-alg 内 input/textarea）", ev.join("；"));
    await page.evaluate(() => {
      const host = document.querySelector(".hud-alg");
      const el = host.querySelector("input") || host.querySelector("textarea");
      el.focus();
      el.value = "R U R' U' F2 D L2 B'";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await sleep(150);
    await clickSel(page, "#btn-apply");
    await sleep(600);
    await clickSel(page, "#btn-solve");
    await page.waitForFunction(
      () => !!document.querySelector(".solve-panel .solve-stage, .solve-panel .solve-error"),
      { timeout: 90000 },
    ).catch(() => {});
    await page.waitForFunction(() => !document.querySelector(".solve-panel .solve-title")?.textContent?.includes("求解中"), { timeout: 90000 }).catch(() => {});
    const err = await textOf(page, ".solve-error");
    assert(!err, "求解失败：" + short(err, 120), ev.join("；"));

    const stages = await page.evaluate(() =>
      [...document.querySelectorAll(".solve-panel .solve-stage")].map((li) => ({
        rotate: li.classList.contains("solve-stage-rotate"),
        short: (li.querySelector(".stage-short")?.textContent ?? "").trim(),
        moves: (li.querySelector(".stage-moves")?.textContent ?? "").trim(),
      })),
    );
    // 面板里两个整块旋转阶段靠「相对解法阶段的位置」区分（不依赖文案，兼容中/英）：
    // 模板顺序 = setupAlg 阶段 → 解法阶段 → endAlg 阶段。
    // 旧解析把「第一个 rotate 阶段」当 setup、「第二个」当 end —— 当场景只产生收尾旋转
    // （setupAlg 合法为空）时会把 endAlg 误判成 setupAlg、endAlg 读成空。
    const rotateIdx = stages.map((s, i) => (s.rotate ? i : -1)).filter((i) => i >= 0);
    const moveIdx = stages.map((s, i) => (s.rotate ? -1 : i)).filter((i) => i >= 0);
    const setupIdx = rotateIdx.filter((i) => moveIdx.length === 0 || i < moveIdx[0]);
    const endIdx = rotateIdx.filter((i) => moveIdx.length === 0 || i > moveIdx[moveIdx.length - 1]);
    const moveStages = stages.filter((s) => !s.rotate);
    const setupAlg = setupIdx.length ? stages[setupIdx[setupIdx.length - 1]].moves : "";
    const endAlg = endIdx.length ? stages[endIdx[0]].moves : "";
    // 空阶段的 moves 在面板里渲染成占位符「–」（模板：s.moves.join(" ") || "–"），
    // 它不是一步公式，比对复制内容时必须剔除，否则期望步数多 1。
    const isPlaceholder = (t) => t === "\u2013" || t === "-" || t === "\u2014";
    const solveMoves = moveStages.flatMap((s) => s.moves.split(/\s+/).filter(Boolean).filter((t) => !isPlaceholder(t)));
    ev.push(
      "H2 阶段=" +
        short(
          stages.map((s) => (s.rotate ? "R:" + s.short + "(" + s.moves + ")" : "M(" + s.moves.split(/\s+/).length + "步)")),
          220,
        ),
    );
    assert(solveMoves.length > 0, "解法 moves 为空（无法复制）", ev.join("；"));
    ev.push("H2 setupAlg=" + short(setupAlg) + " / endAlg=" + short(endAlg));
    assert(!!endAlg, "endAlg 为空：场景未产生收尾旋转，无法验证 P1-8", ev.join("；"));

    // 拦截剪贴板
    const stubOk = await page.evaluate(() => {
      window.__copied = null;
      try {
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            writeText: async (t) => {
              window.__copied = t;
            },
          },
        });
      } catch {
        /* ignore */
      }
      return typeof navigator.clipboard?.writeText === "function";
    });
    assert(stubOk, "无法拦截剪贴板（navigator.clipboard 不可用）", ev.join("；"));
    await clickSel(page, "#btn-copy-solve");
    await sleep(500);
    const copied = await page.evaluate(() => window.__copied);
    const status = await textOf(page, "#hud-status");
    ev.push("H2 复制=" + short(copied, 200) + " / status=" + short(status, 40));
    assert(!!copied, "复制未产生文本（status=" + short(status, 40) + "）", ev.join("；"));
    const expected = [...(setupAlg ? setupAlg.split(/\s+/) : []), ...solveMoves, ...(endAlg ? endAlg.split(/\s+/) : [])];
    const got = copied.split(/\s+/).filter(Boolean);
    ev.push("H2 复制步数=" + got.length + " 期望=" + expected.length + "（setup+moves+end）");
    assert(got.join(" ") === expected.join(" "), "复制内容与演示口径不一致（缺 endAlg 或多步）：复制 " + got.length + " 步 / 期望 " + expected.length + " 步（setup+moves+end）", ev.join("；"));
    assert(status.includes("已复制"), "复制状态未提示成功（status=" + short(status, 40) + "）", ev.join("；"));
    // P1-8 专项：复制内容必须以 endAlg 结尾（旧实现漏掉 endAlg）
    const endTokens = endAlg.split(/\s+/).filter(Boolean);
    assert(
      got.slice(-endTokens.length).join(" ") === endTokens.join(" "),
      "复制内容结尾不是 endAlg（期望末尾 " + endTokens.join(" ") + "，实际末尾 " + got.slice(-endTokens.length).join(" ") + "）",
      ev.join("；"),
    );

    // ---- 终点朝向与演示一致：真跑一次演示，比对演示实际施加的序列尾部 ----
    // 演示口径 = setupAlg → moves → endAlg（GamePage.demoSolve）。演示结束后
    // player.currentAlg 的尾部应与复制内容逐 token 相同 ⇒ 终点朝向必然一致。
    const speedRect = await page.$eval("#speed .win-slider", (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    });
    await page.mouse.click(speedRect.left + 1, speedRect.top + speedRect.height / 2);
    await sleep(300);
    const speedLabel = await textOf(page, ".speed-label");
    ev.push("H2 演示速度=" + short(speedLabel, 40));
    const demoClicked = await page.evaluate(() => {
      const btns = [...document.querySelectorAll(".solve-actions button")];
      const b = btns.find((x) => !x.id) || btns[0];
      if (!b) return false;
      b.click();
      return true;
    });
    assert(demoClicked, "找不到演示按钮（.solve-actions）", ev.join("；"));
    const demoDone = await page
      .waitForFunction(
        (tail) => {
          const alg = window.__motionCube?.player?.currentAlg ?? "";
          const toks = alg.split(/\s+/).filter(Boolean);
          const tailToks = tail.split(/\s+/).filter(Boolean);
          return toks.length >= tailToks.length && toks.slice(-tailToks.length).join(" ") === tailToks.join(" ");
        },
        { timeout: 120000, polling: 300 },
        copied.trim(),
      )
      .then(() => true)
      .catch(() => false);
    const demoAlg = await page.evaluate(() => window.__motionCube?.player?.currentAlg ?? "");
    const demoTok = demoAlg.split(/\s+/).filter(Boolean);
    const demoTail = demoTok.slice(-got.length).join(" ");
    ev.push("H2 演示后 currentAlg=" + demoTok.length + " 步 / 尾部=" + short(demoTail, 160));
    assert(demoDone, "演示实际施加序列与复制内容不一致（终点朝向可能与演示不同）：演示尾部=" + short(demoTail, 160), ev.join("；"));
    steps.H2.push("PASS");
  } catch (e) {
    steps.H2.push(e.message);
    ev.push("H2 ✗ " + e.message);
  }

  // ---- H-4：库页 #f-name 真在文本框打字 → 值正确、hash 不变、库内容未被误改 ----
  try {
    await navHash(page, "/library");
    await waitSel(page, "#f-name", 15000);
    await sleep(500);
    const hashBefore = await page.evaluate(() => location.hash);
    const rowsBefore = await page.evaluate(() => document.getElementById("formula-rows")?.children.length ?? -1);
    const libBefore = await page.evaluate((k) => localStorage.getItem(k), K.library);
    const focused = await page.evaluate(() => {
      const el = document.getElementById("f-name");
      if (!el) return false;
      el.focus();
      return document.activeElement === el;
    });
    assert(focused, "库页 #f-name 未找到或聚焦失败", ev.join("；"));
    await page.keyboard.type("R U F' D2", { delay: 30 });
    await sleep(500);
    const val = await page.evaluate(() => document.getElementById("f-name")?.value ?? null);
    const hashAfter = await page.evaluate(() => location.hash);
    const rowsAfter = await page.evaluate(() => document.getElementById("formula-rows")?.children.length ?? -1);
    const libAfter = await page.evaluate((k) => localStorage.getItem(k), K.library);
    const formulaCount = (raw) => {
      try {
        const j = JSON.parse(raw || "{}");
        return (j.formulas || []).length;
      } catch {
        return -1;
      }
    };
    ev.push(
      "H4 库页 #f-name 键入 \"R U F' D2\" → 值=" + JSON.stringify(val) + " hash " + hashBefore + "→" + hashAfter +
        " 公式行 " + rowsBefore + "→" + rowsAfter + " 库公式数 " + formulaCount(libBefore) + "→" + formulaCount(libAfter),
    );
    assert(val === "R U F' D2", "库页 #f-name 键入结果不对：" + JSON.stringify(val), ev.join("；"));
    assert(hashAfter === hashBefore, "库页文本框打字改变了路由 hash（" + hashBefore + "→" + hashAfter + "）", ev.join("；"));
    assert(rowsAfter === rowsBefore, "库页文本框打字意外新增了公式行（" + rowsBefore + "→" + rowsAfter + "）", ev.join("；"));
    assert(
      formulaCount(libAfter) === formulaCount(libBefore),
      "库页文本框打字意外改写了手法库（公式数 " + formulaCount(libBefore) + "→" + formulaCount(libAfter) + "）",
      ev.join("；"),
    );
    steps.H4.push("PASS");
  } catch (e) {
    steps.H4.push(e.message);
    ev.push("H4 ✗ " + e.message);
  }

  // 任一子项失败 → 整项 FAIL，但证据都保留
  const failed = Object.entries(steps).filter(([, v]) => v[0] !== "PASS").map(([k]) => k);
  if (failed.length) {
    const err = new Error(
      "子项失败：" + Object.entries(steps).map(([k, v]) => k + " " + (v[0] === "PASS" ? "PASS" : "FAIL")).join(" / "),
    );
    err.evidence = ev.join("；");
    throw err;
  }
  return ev;
}

// ================= 场景表 =================
const SCENARIOS = [
  { id: "A", label: "P0-8 库加载容错（坏条目跳过 + 保存不清库）", run: scenarioA },
  { id: "B", label: "P0-9 帧率切换重映射（1000→24 重合必须拒绝）", run: scenarioB },
  { id: "C", label: "P1-3 帧号/单步时长上限（1e8 不卡死）", run: scenarioC, isolated: true },
  { id: "D", label: "P0-10 手部默认配置单例（重置回设计默认）", run: scenarioD },
  { id: "E", label: "P0-6/P0-7 左手填充棱绕向 + 拇指镜像（UI sanity）", run: scenarioE },
  { id: "F", label: "P1-1/P1-2 API 外部驱动所有权 + playFrames 循环", run: scenarioF },
  { id: "G", label: "P1-4 关键帧面板单一真相（不回弹 / 缓动生效）", run: scenarioG },
  { id: "H", label: "P1-7/P1-8 快照完整序列 + 复制含 endAlg", run: scenarioH },
];

// ================= 主流程 =================
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const only = onlyArg ? onlyArg.slice("--only=".length).split(",").map((s) => s.trim().toUpperCase()).filter(Boolean) : null;
const todo = only ? SCENARIOS.filter((s) => only.includes(s.id)) : SCENARIOS;

const results = [];
let browser = null;

async function runScenario(browserRef, sc) {
  const t0 = Date.now();
  let page = null;
  const row = { id: sc.id, label: sc.label, status: "FAIL", evidence: "", ms: 0 };
  try {
    page = await newPage(browserRef);
    const ev = await sc.run(page);
    row.evidence = Array.isArray(ev) ? ev.join(" ｜ ") : String(ev);
    row.status = "PASS";
  } catch (e) {
    row.status = e && e.skip ? "SKIP" : "FAIL";
    const pageErrors = page && page.__errors && page.__errors.length ? "｜pageerror: " + short(page.__errors.slice(-2).join(" | "), 200) : "";
    const stack = e && e.stack ? "｜stack: " + short(e.stack.split("\n").slice(0, 3).join(" ⏎ "), 300) : "";
    row.evidence = (e && e.evidence ? e.evidence + "｜" : "") + (e && e.message ? e.message : String(e)) + stack + pageErrors;
    if (page) {
      try {
        await raceTimeout(page.screenshot({ path: join(OUT, "batch2-" + sc.id + "-fail.png") }), 5000, "screenshot");
        row.evidence += "｜截图: spike-shots/batch2-" + sc.id + "-fail.png";
      } catch {
        /* ignore */
      }
    }
  } finally {
    row.ms = Date.now() - t0;
    if (page) {
      try {
        await raceTimeout(page.close(), 6000, "close page");
      } catch {
        /* 页面可能被主线程阻塞，忽略 */
      }
    }
  }
  results.push(row);
  console.log("[" + row.status + "] " + row.id + " " + row.label + " (" + row.ms + "ms)");
  console.log("     证据: " + short(row.evidence, 1200));
  return row;
}

/** 矩阵表（列宽按显示宽度计算，证据另起一行；旧版本表头/分隔线与数据行列数不一致） */
function matrixText(rows) {
  const widthOf = (s) =>
    [...s].reduce((w, ch) => w + (/[\u3000-\u9FFF\uFF00-\uFFEF]/.test(ch) ? 2 : 1), 0);
  const pad = (s, n) => (widthOf(s) >= n ? s : s + " ".repeat(n - widthOf(s)));
  const ID_W = 3;
  const ST_W = 6;
  const MS_W = 9;
  const lines = [];
  lines.push(
    "ID  | 状态   | 耗时       | 条目 / 证据",
    "----+--------+------------+--------------------------------------------------------------",
  );
  for (const r of rows) {
    lines.push(
      pad(r.id, ID_W) + " | " + pad(r.status, ST_W) + " | " + pad(r.ms + "ms", MS_W) + " | " + r.label,
    );
    lines.push(" ".repeat(ID_W + 3 + ST_W + 3 + MS_W + 3) + "证据: " + short(r.evidence, 420));
  }
  return lines.join("\n");
}

async function main() {
  appendFileSync(
    LOG,
    "\n===== run " + new Date().toISOString() + "  (SPIKE_URL=" + BASE + ", only=" + (only ? only.join(",") : "ALL") + ") =====\n",
  );
  const normal = todo.filter((s) => !s.isolated);
  const isolated = todo.filter((s) => s.isolated);

  if (normal.length) {
    browser = await launchBrowser("main");
    for (const sc of normal) await runScenario(browser, sc);
    try {
      await raceTimeout(browser.close(), 15000, "browser.close");
    } catch {
      try {
        browser.process()?.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }
    browser = null;
  }
  // 隔离浏览器：C 项一旦把主线程卡死，直接杀掉整个浏览器进程，不污染其它项
  for (const sc of isolated) {
    let b = null;
    try {
      b = await launchBrowser("isolated-" + sc.id);
      await runScenario(b, sc);
    } finally {
      if (b) {
        try {
          await raceTimeout(b.close(), 10000, "isolated browser.close");
        } catch {
          try {
            b.process()?.kill("SIGKILL");
          } catch {
            /* ignore */
          }
        }
      }
    }
  }

  const pass = results.filter((r) => r.status === "PASS").length;
  const fail = results.filter((r) => r.status === "FAIL").length;
  const skip = results.filter((r) => r.status === "SKIP").length;
  const text = matrixText(results);
  console.log("\n" + text + "\n");
  console.log("合计: PASS " + pass + " / FAIL " + fail + " / SKIP " + skip + "（共 " + results.length + " 项）");
  appendFileSync(LOG, text + "\n合计: PASS " + pass + " / FAIL " + fail + " / SKIP " + skip + "\n");
  const exitCode = fail > 0 ? 1 : 0;
  console.log("退出码: " + exitCode);
  await new Promise((r) => setTimeout(r, 50));
  process.exit(exitCode);
}

main().catch(async (e) => {
  console.error("脚本自身失败: " + (e && e.stack ? e.stack : String(e)));
  try {
    if (browser) await browser.close();
  } catch {
    /* ignore */
  }
  process.exit(2);
});
