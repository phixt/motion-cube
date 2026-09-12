// UI 流程验证：路由切换 / 游戏页 / 按键设置（改键+冷却）/ 改键后生效 / 快速连击冷却。
// 运行：node scripts/playtest-ui.mjs（先起 dev server）
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
  // 新壳优先：WinUI 导航项（文本含图标字 + 标签，用 includes 匹配）
  const winItems = await page.$$(".win-nav-item");
  for (const h of winItems) {
    const t = await h.evaluate((n) => n.textContent ?? "");
    if (t.includes(label)) {
      await h.click();
      await sleep(350);
      console.log(`  -> clicked win-nav-item, hash=${await page.evaluate(() => location.hash)}`);
      return;
    }
  }
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
const clearAndType = async (selector, text) => {
  await page.$eval(selector, (el) => {
    el.value = "";
  });
  await page.type(selector, text);
};
/** 展开公式库/编辑器所有折叠的分类组（分类可嵌套，父组展开后才会渲染子组，需多轮） */
const expandFormulaGroups = () =>
  page.evaluate(async () => {
    for (let i = 0; i < 6; i++) {
      const closed = [...document.querySelectorAll(".formula-group-label")].filter((b) =>
        (b.textContent ?? "").includes("\u25B8"),
      );
      if (closed.length === 0) break;
      closed.forEach((b) => b.click());
      await new Promise((r) => setTimeout(r, 50));
    }
  });
/** 侧边栏分组按标题展开（编辑器；默认全折叠） */
const openSbGroup = (title) =>
  page.evaluate((ti) => {
    const head = [...document.querySelectorAll(".sb-group-head")].find((b) =>
      (b.textContent ?? "").includes(ti),
    );
    if (head && (head.textContent ?? "").includes("\u25B8")) head.click();
  }, title);
/** 编辑器中按名称点选手法（.tec-item 按钮） */
const clickTecItem = (name) =>
  page.evaluate((n) => {
    const btn = [...document.querySelectorAll(".tec-item")].find((b) =>
      (b.textContent ?? "").trim() === n,
    );
    if (!btn) throw new Error(`手法未找到：${n}`);
    btn.click();
  }, name);
/** 读取编辑器播放头魔方公式（自身维护的 currentAlg） */
const edAlg = () => page.evaluate(() => globalThis.__motionCubeEditor?.player?.currentAlg ?? "");

// 1) 开始页
await page.goto(URL, { waitUntil: "networkidle0", timeout: 30000 });
await page.reload({ waitUntil: "networkidle0", timeout: 30000 }); // 预热 Vite 依赖优化，规避 Outdated Optimize Dep
await page.waitForSelector(".start-page");
const startTitle = await page.$eval(".start-title", (el) => el.textContent);
if (startTitle !== "Motion Cube") throw new Error(`开始页标题异常：${startTitle}`);
const hasPlayBtn = (await page.$(".start-play")) !== null;
if (!hasPlayBtn) throw new Error("开始页缺少开始游戏按钮");
console.log("start page ok");
await shot("ui-01-start");

// 2) 进入游戏
await page.click(".start-play");
await page.waitForFunction(() => location.hash === "#/game", { timeout: 10000 });
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

// 4) 设置页：把 R 改绑到 T + 底色选择
await clickNav("设置");
await page.waitForSelector('[data-action="R"] .rebind');
await shot("ui-03-keymap");
await page.click('[data-action="R"] .rebind');
await sleep(150);
await page.keyboard.press("t");
await sleep(250);
const bindingT = await page.$eval('[data-action="R"] .binding', (el) => el.textContent);
if (bindingT !== "T") throw new Error(`R 应改绑为 T，实际：${bindingT}`);
console.log(`rebind ok: R → ${bindingT}`);
await page.click('.base-swatch[data-face="U"]');
await sleep(150);
const baseActive = await page.$eval('.base-swatch[data-face="U"]', (el) => el.classList.contains("active"));
if (!baseActive) throw new Error("底色选择未生效");
console.log("base face swatch ok");
await page.click('.base-swatch[data-face="D"]'); // 恢复默认底，保证后续预设按 D 适配
await sleep(150);
await shot("ui-04-keymap-rebound");

// 4b) 键位作用域：编辑器独立功能键（默认 Space 播放），与游戏公式键互不影响
// （同步按钮已移除，编辑器不再拥有 R 等游戏键）。
await page.evaluate(() => {
  const el = [...document.querySelectorAll(".scope-btn")].find((b) => (b.textContent ?? "").includes("编辑器"));
  if (!el) throw new Error("找不到编辑器作用域按钮");
  el.click();
});
await sleep(250);
const edPlayBinding = await page.$eval('[data-action="play"] .binding', (el) => el.textContent);
if (edPlayBinding !== "Space") throw new Error(`编辑器 play 默认应为 Space：${edPlayBinding}`);
const edHasGameR = await page.$('[data-action="R"]');
if (edHasGameR) throw new Error("编辑器作用域不应出现游戏键 R");
// 游戏 R 已在 4) 改绑为 T，编辑器功能键必须保持默认（相互独立）
const edPlayAfter = await page.$eval('[data-action="play"] .binding', (el) => el.textContent);
if (edPlayAfter !== "Space") throw new Error(`游戏改键不应影响编辑器：${edPlayAfter}`);
await page.evaluate(() => {
  const el = [...document.querySelectorAll(".scope-btn")].find((b) => (b.textContent ?? "").includes("游戏"));
  el?.click();
});
await sleep(250);
console.log("keymap scope independence ok");

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

// 6b) 标灰：面板、预设、点选、清除
await page.keyboard.press("Escape"); // 重置到求解态，保证视图与预设一致
await sleep(300);
await page.click("#btn-gray");
await sleep(300);
const panelVisible = await page.$eval("#gray-panel", (el) => !el.hidden);
if (!panelVisible) throw new Error("标灰面板未显示");
await page.click('.gray-preset[data-preset="cross"]');
await sleep(400);
let grayCount = await page.$$eval("#gray-panel [data-sticker]", (els) =>
  els.filter((e) => e.getAttribute("fill") === "#8f959e").length,
);
if (grayCount !== 45) throw new Error(`初始十字灰数应为 45：${grayCount}`);
await page.click('#gray-panel [data-sticker="D4"]');
await sleep(250);
grayCount = await page.$$eval("#gray-panel [data-sticker]", (els) =>
  els.filter((e) => e.getAttribute("fill") === "#8f959e").length,
);
if (grayCount !== 46) throw new Error(`点选后应为 46：${grayCount}`);
await page.click('.gray-preset[data-preset="clear"]');
await sleep(300);
grayCount = await page.$$eval("#gray-panel [data-sticker]", (els) =>
  els.filter((e) => e.getAttribute("fill") === "#8f959e").length,
);
if (grayCount !== 0) throw new Error(`清除后应为 0：${grayCount}`);
console.log("gray panel ok");
await shot("ui-13-gray");

// 6c) 伪3D：悬停不换面、滑环拖拽换面、x 键换面且不转主魔方（用侧面小面坐标验证）
const f4 = () => page.$eval('#gray-panel [data-sticker="F4"]', (el) => el.getAttribute("points"));
const f4Before = await f4();
const grayBox = await page.$eval("#gray-panel svg", (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
await page.mouse.move(grayBox.x + grayBox.w / 2 + 60, grayBox.y + grayBox.h / 2);
await sleep(250);
if ((await f4()) !== f4Before) throw new Error("悬停不应换面");
// 魔方内拖动只涂灰不换面（换面走魔方外滑环）
await page.mouse.move(grayBox.x + grayBox.w / 2, grayBox.y + grayBox.h / 2);
await page.mouse.down();
for (let i = 1; i <= 6; i++) {
  await page.mouse.move(grayBox.x + grayBox.w / 2 - i * 12, grayBox.y + grayBox.h / 2);
  await sleep(15);
}
await page.mouse.up();
await sleep(300);
if ((await f4()) !== f4Before) throw new Error("魔方内拖动不应换面（只涂灰）");
// 滑环：在魔方外环上拖拽换面
const ringBox = await page.$eval("#gray-panel .gray-ring", (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
await page.mouse.move(ringBox.x + ringBox.w - 4, ringBox.y + ringBox.h / 2);
await page.mouse.down();
for (let i = 1; i <= 6; i++) {
  await page.mouse.move(ringBox.x + ringBox.w - 4 - i * 12, ringBox.y + ringBox.h / 2);
  await sleep(15);
}
await page.mouse.up();
await sleep(300);
if ((await f4()) === f4Before) throw new Error("滑环拖拽应换面");
const logBeforeX = await moveLogText();
await page.click('#gray-panel [data-sticker="F4"]');
await sleep(200);
await page.keyboard.press("x");
await sleep(300);
if ((await moveLogText()) !== logBeforeX) throw new Error("按 x 不应转动主魔方");
console.log("pseudo3d hover/drag/keys ok");
await shot("ui-14-pseudo3d-flip");

// 6d) 长拖涂灰 vs 换面拖拽：按住小面 >0.4s 再拖动 → 涂灰且不换面
await page.click('.gray-preset[data-preset="clear"]');
await sleep(300);
const paintBefore = await page.$$eval("#gray-panel [data-sticker]", (els) =>
  els.filter((e) => e.getAttribute("fill") === "#8f959e").length,
);
const f4ptsPaint = await f4();
const f4box = await page.$eval('#gray-panel [data-sticker="F4"]', (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
await page.mouse.move(f4box.x, f4box.y);
await page.mouse.down();
await sleep(450);
await page.mouse.move(f4box.x + 16, f4box.y, { steps: 4 });
await sleep(120);
await page.mouse.up();
await sleep(300);
const paintAfter = await page.$$eval("#gray-panel [data-sticker]", (els) =>
  els.filter((e) => e.getAttribute("fill") === "#8f959e").length,
);
if (paintAfter <= paintBefore) throw new Error(`长拖涂灰未生效：${paintBefore} -> ${paintAfter}`);
if ((await f4()) !== f4ptsPaint) throw new Error("长拖涂灰不应换面");
console.log(`long-press paint ok: ${paintBefore} -> ${paintAfter}`);

// 7) 动画编辑占位页 + 说明页
await clickNav("动画编辑");
await page.waitForSelector(".editor-page");
console.log("editor page ok");
await shot("ui-07-editor");
await clickNav("说明");
await page.waitForSelector(".help-page");
const helpHas = await page.$eval(".help-page", (el) => el.textContent);
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
// 公式按分类分组折叠展示，先展开全部组再断言公式名
await page.evaluate(() => {
  document.querySelectorAll(".formula-group-label").forEach((b) => b.click());
});
await sleep(200);
let formulaText = await page.$eval("#formula-rows", (el) => el.textContent ?? "");
if (!formulaText.includes("V Perm")) throw new Error("示例公式未加载");
const techniqueText = await page.$eval("#technique-rows", (el) => el.textContent ?? "");
if (!techniqueText.includes("单拨 U")) throw new Error("示例手法未加载");
console.log("library samples ok");
await shot("ui-09-library");

// 8b) 动画编辑器骨架：侧边栏选手法、时间线、选中/移动/添加关键帧、保存
await clickNav("动画编辑");
await page.waitForSelector(".editor-page");
await openSbGroup("手法");
await sleep(250);
await clickTecItem("单拨 U（示例）");
await sleep(300);
let kfFrames = await page.$$eval("#tl-ruler .tl-kf", (els) => els.map((e) => e.dataset.frame).sort());
if (kfFrames.join() !== ["0", "30", "60"].join()) throw new Error(`示例手法关键帧应 0/30/60：${kfFrames}`);
const bandCount = await page.$$eval("#tl-track .tl-step-band", (els) => els.length);
if (bandCount < 1) throw new Error(`示例手法应有动作刻度：${bandCount}`);
console.log(`editor technique+timeline ok (${bandCount} bands)`);

// 选中关键帧 30：kf 面板展开、帧号回显
await page.click('#tl-ruler .tl-kf[data-frame="30"]');
await sleep(250);
if ((await page.$eval("#kf-frame", (el) => el.value)) !== "30") throw new Error("选中关键帧未回显帧号");

// 移动 30 → 45：关键帧应随之迁移
await clearAndType("#kf-frame", "45");
await page.$eval("#kf-frame", (el) => el.dispatchEvent(new Event("change")));
await sleep(250);
kfFrames = await page.$$eval("#tl-ruler .tl-kf", (els) => els.map((e) => e.dataset.frame).sort());
if (!kfFrames.includes("45") || kfFrames.includes("30")) throw new Error(`移动关键帧失败：${kfFrames}`);

// 添加关键帧：把播放头拖到 46 帧，点 #kf-add 在该帧建帧
await page.click('#tl-ruler .tl-kf[data-frame="45"]');
await sleep(200);
const rulerBox = await page.$eval("#tl-ruler", (el) => {
  const r = el.getBoundingClientRect();
  return { left: r.x, width: r.width, top: r.y + r.height / 2 };
});
await page.mouse.click(rulerBox.left + rulerBox.width * (46 / 60), rulerBox.top); // 总长 60 帧 → 46 帧处
await sleep(200);
if ((await page.$eval("#kf-frame", (el) => el.value)) !== "46") throw new Error("播放头未定位到 46 帧");
await page.click("#kf-add");
await sleep(250);
kfFrames = await page.$$eval("#tl-ruler .tl-kf", (els) => els.map((e) => e.dataset.frame).sort());
if (!kfFrames.includes("46")) throw new Error(`添加关键帧失败：${kfFrames}`);
console.log("kf move/add ok");

// 8e) 起终自动路径：首末关键帧之间生成中间关键帧（0/45/46/60 → 含 15/30）
await page.click("#auto-path");
await sleep(300);
kfFrames = await page.$$eval("#tl-ruler .tl-kf", (els) => els.map((e) => e.dataset.frame).sort());
if (!kfFrames.includes("15") || !kfFrames.includes("30")) {
  throw new Error(`自动路径未生成中间关键帧：${kfFrames}`);
}
console.log(`auto path ok: ${kfFrames.join(",")}`);

// 8f) 姿态坐标编辑：选中关键帧 30，改手掌 X → 提交后回显（吸附 1/3 块边长）
await page.click('#tl-ruler .tl-kf[data-frame="30"]');
await sleep(250);
await page.$eval("#kf-pose-x", (el) => {
  el.value = "1";
  el.dispatchEvent(new Event("input"));
});
await sleep(250);
await page.click("#kf-frame"); // 失焦，触发面板跟随播放头回写
await sleep(200);
const poseX = await page.$eval("#kf-pose-x", (el) => el.value);
if (poseX !== "1.00") throw new Error(`姿态坐标未更新：${poseX}`);
console.log("pose edit ok");

// 8g) 插入中间帧：选中 30 与其后 45 之间插入 38
await page.click('#tl-ruler .tl-kf[data-frame="30"]');
await sleep(200);
await page.click("#kf-insert-mid");
await sleep(300);
let kfFramesMid = await page.$$eval("#tl-ruler .tl-kf", (els) => els.map((e) => e.dataset.frame).sort());
if (!kfFramesMid.includes("38")) throw new Error(`插入中间帧失败：${kfFramesMid}`);
console.log(`insert mid ok: ${kfFramesMid.join(",")}`);

// 8h) 正弦路径：中间帧关节 bend 改为正弦缓动（与线性插值不同）
await page.click('#tl-ruler .tl-kf[data-frame="15"]');
await sleep(200);
const bendBefore = await page.$eval("#kf-bend-index-1", (el) => el.value);
await page.click("#sine-path");
await sleep(300);
const bendAfter = await page.$eval("#kf-bend-index-1", (el) => el.value);
if (bendBefore === bendAfter) throw new Error(`正弦路径未改变中间帧姿态：${bendBefore}`);
console.log(`sine path ok: index PIP ${bendBefore} -> ${bendAfter}`);

// 保存
await page.click("#editor-save");
await sleep(250);
const edStatus = await page.$eval("#editor-status", (el) => el.textContent ?? "");
if (!edStatus.includes("已保存")) throw new Error(`编辑器保存状态异常：${edStatus}`);
console.log("editor skeleton ok");
await shot("ui-15-editor");

// 8c) 3D 视口：魔方 + 左右手注入（十八轮双轨；手型选择器已由双手显示取代）
if ((await page.$("#editor-view twisty-player")) === null) throw new Error("编辑器缺少 3D 视口魔方");
const handApiOk = await page.evaluate(() => {
  const ed = globalThis.__motionCubeEditor ?? {};
  const l = ed.handLeft, r = ed.handRight;
  return (
    !!l && !!r &&
    typeof l.setPose === "function" && typeof r.setPose === "function" &&
    l.type === "left" && r.type === "right"
  );
});
if (!handApiOk) throw new Error("编辑器手视图 API 未暴露");
console.log("editor 3d viewport ok");

// 8d) 播放器整合：正放从起始态（公式逆序 U'）执行公式 → 驱动魔方
await page.click('#tl-ruler .tl-kf[data-frame="0"]'); // 播放头归零（onPvPlay 会重设起始态）
await sleep(200);
await page.evaluate(() => globalThis.__motionCubeEditor?.player?.reset());
await sleep(200);
const preAlg = await edAlg();
if (preAlg !== "") throw new Error(`重置后魔方应为空：${preAlg}`);
await page.click("#editor-big-play");
await sleep(1200);
const cubeAlg = await edAlg();
if (cubeAlg === "" || cubeAlg === preAlg) throw new Error(`正放未驱动魔方：${preAlg} -> ${cubeAlg}`);
await page.click("#editor-big-play"); // 暂停
console.log(`player integration ok: ${preAlg} -> ${cubeAlg}`);

// 8d2) 编辑器功能键（独立配置）：←/→ 逐帧、Shift+→ 跳下一关键帧（16→30）
await page.click('#tl-ruler .tl-kf[data-frame="15"]');
await sleep(200);
await page.evaluate(() => document.activeElement?.blur?.()); // 移出输入框焦点
await page.keyboard.press("ArrowRight"); // 15 → 16
await sleep(200);
if ((await page.$eval("#kf-frame", (el) => el.value)) !== "16") throw new Error("→ 步进未生效");
await page.keyboard.down("Shift");
await page.keyboard.press("ArrowRight"); // 跳到 16 之后最近关键帧 = 30
await page.keyboard.up("Shift");
await sleep(200);
if ((await page.$eval("#kf-frame", (el) => el.value)) !== "30") throw new Error(`Shift+→ 跳关键帧未生效`);
console.log("editor functional keys ok");

// 8i) 编辑器标灰面板 + 不可变选项
await openSbGroup("标灰");
await sleep(300);
await page.click('#gray-panel .gray-preset[data-preset="cross"]');
await sleep(400);
const egrayCount = await page.$$eval("#gray-panel [data-sticker]", (els) =>
  els.filter((e) => e.getAttribute("fill") === "#8f959e").length,
);
if (egrayCount !== 45) throw new Error(`编辑器初始十字灰数应为 45：${egrayCount}`);
await page.click(".editor-gray-kind-toggle");
await sleep(200);
await page.click('#gray-panel [data-sticker="D4"]');
await sleep(300);
const d4fill = await page.$eval('#gray-panel [data-sticker="D4"]', (el) => el.getAttribute("fill"));
if (d4fill !== "#565c66") throw new Error(`不可变点选未生效（应为深灰 #565c66）：${d4fill}`);
console.log("editor gray panel ok");

await page.$eval("#editor-view", (el) => el.scrollIntoView({ block: "center" }));
await sleep(400);
await shot("ui-16-editor-view");

// 8k) 复杂公式播放：V Perm 手法（无关键帧、16 个动作刻度）播放逐步驱动魔方
await clickTecItem("V Perm（手法）");
await sleep(500);
const vSteps = await page.$$eval("#tl-track .tl-step-band", (els) => els.length);
if (vSteps < 2) throw new Error(`V Perm 手法应有多个动作刻度：${vSteps}`);
const vA0 = await edAlg();
await page.click("#editor-big-play");
await sleep(1200);
const vA1 = await edAlg();
if (vA1 === vA0) throw new Error(`复杂公式播放未驱动魔方：${vA0}`);
await page.click("#editor-big-play"); // 暂停
console.log(`auto step mapping + complex play ok (${vSteps} steps)`);

await clickNav("公式库");
await page.waitForSelector("#formula-rows");
await page.select("#f-page-size", "50"); // 分页：调大每页避免后续断言跨页
await page.type("#f-name", "测试 OLL");
await page.type("#f-moves", "R U R' U R U2' R'");
await page.click("#f-submit");
await sleep(250);
await expandFormulaGroups(); // 新公式进入（未）分类组，展开后才能断言
await sleep(150);
formulaText = await page.$eval("#formula-rows", (el) => el.textContent ?? "");
if (!formulaText.includes("测试 OLL")) throw new Error("添加公式失败");

await page.type("#f-name", "bad");
await page.type("#f-moves", "R U ???");
await page.click("#f-submit");
await sleep(250);
const libErr = await page.$eval("#lib-status", (el) => el.textContent ?? "");
if (!libErr.includes("添加失败")) throw new Error(`非法公式未报错：${libErr}`);
console.log("library invalid rejected");

await expandFormulaGroups();
await page.click('[data-name="测试 OLL"] .del');
await sleep(200);
formulaText = await page.$eval("#formula-rows", (el) => el.textContent ?? "");
if (formulaText.includes("测试 OLL")) throw new Error("删除公式失败");
console.log("library add/error/delete ok");
await shot("ui-10-library-edit");

// 9) 分类：根分类 + 子分类 + 公式多归属 + 深度限制 + 删除清理
await page.type("#cat-name", "OLL");
await page.click("#cat-add");
await sleep(200);
const ollId = await page.$eval('#category-rows [data-name="OLL"]', (el) => el.dataset.id);
await page.type("#cat-name", "ZBLL");
await page.select("#cat-parent", ollId);
await page.click("#cat-add");
await sleep(200);
const zbllId = await page.$eval('#category-rows [data-name="ZBLL"]', (el) => el.dataset.id);
const zbllIndent = await page.$eval('#category-rows [data-name="ZBLL"]', (el) => el.style.marginLeft);
if (!zbllIndent) throw new Error("子分类应有缩进");
console.log("category add ok");

await clearAndType("#f-name", "分类测试");
await clearAndType("#f-moves", "R U R'");
// 级联分类下拉：1LLL → ZBLL（示例分类）
const oneLookId = await page.$eval('#category-rows [data-name="1LLL"]', (el) => el.dataset.id);
await page.select("#cat-cascade select:nth-child(1)", oneLookId);
await sleep(200);
await page.select("#cat-cascade select:nth-child(2)", zbllId);
await sleep(200);
// 标签：加号添加，最多 4 个
for (const tg of ["CFOP", "Roux", "ZZ", "单手"]) {
  await clearAndType("#f-tags", tg);
  await page.click("#tag-add");
  await sleep(120);
}
if ((await page.$eval("#tag-chips", (el) => el.children.length)) !== 4) throw new Error("标签应 4 个");
await clearAndType("#f-tags", "第五个");
await page.click("#tag-add");
await sleep(150);
const tagErr = await page.$eval("#lib-status", (el) => el.textContent ?? "");
if (!tagErr.includes("最多 4 个标签")) throw new Error(`标签上限未生效：${tagErr}`);
await page.click("#f-submit");
await sleep(250);
await expandFormulaGroups(); // 新公式进入（未）分类组，展开后才能断言
await sleep(150);
let catRowText = await page.$eval('#formula-rows [data-name="分类测试"]', (el) => el.textContent ?? "");
if (!catRowText.includes("ZBLL")) throw new Error("公式未显示分类");
if (!catRowText.includes("CFOP")) throw new Error("公式未显示标签");

// 9b) 分类级联改选（回归：选择之后应能更改）
await expandFormulaGroups();
await page.click('#formula-rows [data-name="分类测试"] .edit');
await sleep(250);
let cascadeSelCount = await page.$$eval("#cat-cascade select", (els) => els.length);
if (cascadeSelCount !== 2) throw new Error(`编辑回显级联应为 2 级：${cascadeSelCount}`);
// 用户新建的 ZBLL 挂在示例 OLL 下（重名按 DOM 顺序取最后一个）
const userZbllId = (await page.$$eval('#category-rows [data-name="ZBLL"]', (els) => els.map((e) => e.dataset.id))).at(-1);
await page.select("#cat-cascade select:nth-child(1)", ollId); // 1LLL → 示例 OLL
await sleep(250);
const firstSelVal = await page.$eval("#cat-cascade select:nth-child(1)", (s) => s.value);
if (firstSelVal !== ollId) throw new Error(`级联第一级改选未生效（旧 bug：改选后回弹）：${firstSelVal}`);
// 改选第一级应清空深层选择（回到"（到此为止）"）
const secondVal = await page.$eval("#cat-cascade select:nth-child(2)", (s) => s.value);
if (secondVal !== "") throw new Error(`深层选择应清空回到（到此为止）：${secondVal}`);
await page.select("#cat-cascade select:nth-child(2)", userZbllId); // 再选用户 ZBLL
await sleep(250);
await page.click("#f-submit");
await sleep(250);
await expandFormulaGroups(); // 改挂到用户 ZBLL（新出现的折叠组）
await sleep(150);
catRowText = await page.$eval('#formula-rows [data-name="分类测试"]', (el) => el.textContent ?? "");
if (!catRowText.includes("ZBLL")) throw new Error("改选分类未保存");
console.log("category cascade change ok");

let parentId = zbllId;
for (const name of ["L1", "L2"]) {
  await page.type("#cat-name", name);
  await page.select("#cat-parent", parentId);
  await page.click("#cat-add");
  await sleep(150);
  parentId = await page.$eval(`#category-rows [data-name="${name}"]`, (el) => el.dataset.id);
}
await page.type("#cat-name", "L5");
await page.select("#cat-parent", parentId);
await page.click("#cat-add");
await sleep(250);
const catErr = await page.$eval("#lib-status", (el) => el.textContent ?? "");
if (!catErr.includes("超出最大嵌套深度")) throw new Error(`深度限制未生效：${catErr}`);
console.log("category depth limit ok");

// 9b 把公式改挂到用户 ZBLL（重名行中的最后一个），删除它验证级联清理
const zbllRows = await page.$$('#category-rows [data-name="ZBLL"]');
const delBtn = await zbllRows.at(-1).$(".cat-del");
await delBtn.click();
await sleep(250);
catRowText = await page.$eval('#formula-rows [data-name="分类测试"]', (el) => el.textContent ?? "");
if (catRowText.includes("ZBLL")) throw new Error("删分类后公式未清理");
console.log("category delete cleanup ok");
await shot("ui-11-categories");

// 10) 删除公式连带删除其手法（手法不能单独存在）
await expandFormulaGroups();
await page.click('#formula-rows [data-name="单拨 U"] .del');
await sleep(250);
const techAfter = await page.$eval("#technique-rows", (el) => el.textContent ?? "");
if (techAfter.includes("单拨 U（示例）")) throw new Error("删公式未连带删手法");
console.log("formula delete cascades to techniques ok");
await shot("ui-12-cascade");

// 11) 手部标定页：平铺手掌 + 标尺 + 参数编辑 + 固化落库
await clickNav("手部");
await page.waitForSelector("#hand-calib-view", { timeout: 15000 });
await sleep(1500);
const calibBox = await page.$eval("#hand-calib-view", (el) => {
  const r = el.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height) };
});
if (calibBox.w < 300 || calibBox.h < 300) throw new Error(`标定视口过小：${JSON.stringify(calibBox)}`);
const ruler = await page.$eval("#hand-calib-view svg", (el) => ({
  lines: el.querySelectorAll("line").length,
  texts: [...el.querySelectorAll("text")].map((t) => t.textContent),
}));
if (ruler.lines < 10 || ruler.texts.length < 4) throw new Error(`标尺异常：${JSON.stringify(ruler)}`);
console.log(`hand calib ruler ok: ${ruler.texts.slice(0, 6).join(",")} …`);
await page.$eval("#len-middle-0", (el) => {
  el.value = "1.00";
  el.dispatchEvent(new Event("input"));
});
await sleep(300);
const middleLen = await page.$eval("#len-middle-0", (el) => el.value);
if (middleLen !== "1.00") throw new Error(`段长输入未生效：${middleLen}`);
await page.click("#hand-save");
await sleep(250);
const savedRig = await page.evaluate(() => JSON.parse(localStorage.getItem("motion-cube.handRig") ?? "null"));
if (!savedRig || savedRig.fingers.middle[0].length !== 1) throw new Error("固化数据未写入 localStorage");
console.log("hand calib save ok");
await page.click("#hand-reset");
await sleep(250);
await shot("ui-17-hand-calib");

// 12) 键位预设：新手直觉（方向键）→ U 显示 ↑；切回默认恢复 KeyU
await clickNav("设置");
await page.waitForSelector('[data-action="U"] .binding', { timeout: 15000 });
await page.click(".preset-beginner");
await sleep(250);
const upBinding = await page.$eval('[data-action="U"] .binding', (el) => el.textContent);
if (upBinding !== "↑") throw new Error(`新手预设 U 应为方向键上：${upBinding}`);
await page.click(".preset-default");
await sleep(250);
const defaultBinding = await page.$eval('[data-action="U"] .binding', (el) => el.textContent);
if (defaultBinding !== "U") throw new Error(`默认预设 U 应回 KeyU：${defaultBinding}`);
console.log("keymap presets ok");

await browser.close();
console.log(`\nSHOTS: ${shots.join(", ")}`);

