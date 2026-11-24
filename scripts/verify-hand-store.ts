/**
 * verify-hand-store.ts — P0-10 回归自检（npx tsx scripts/verify-hand-store.ts，无 DOM）。
 *
 * 复现 docs/audit/REVIEW-2026-10.md P0-10 的 5 步链路并断言已修复：
 *   1) DEFAULT_HAND_CONFIG 深冻结：嵌套对象/数组每一层 Object.isFrozen，就地改写抛 TypeError；
 *   2) loadHandRigConfig() 任何分支（空库 / 损坏档 / 迁移）都返回独立副本，绝不返回常量本体；
 *   3) 标定页「重置」得到的是未被污染的设计默认；
 *   4) v3 旧档迁移的缺省兜底取自冻结常量 → palm.width = 1.35（旧 bug：被滑条污染后钳到 5）。
 * 失败时退出码 1。
 */
import { readFileSync } from "node:fs";
import {
  DEFAULT_HAND_CONFIG,
  DEFAULT_SHAPE,
  cloneDefaultHandRigConfig,
  loadHandRigConfig,
  saveHandRigConfig,
} from "../src/hand/handRigStore.ts";

// ---------- 最小 localStorage stub（模块只在调用期访问 localStorage） ----------
const STORE_KEY = "motion-cube.handRig";
const mem = new Map<string, string>();
const memoryStorage = {
  getItem: (k: string): string | null => (mem.has(k) ? mem.get(k) ?? null : null),
  setItem: (k: string, v: string): void => {
    mem.set(k, String(v));
  },
  removeItem: (k: string): void => {
    mem.delete(k);
  },
  clear: (): void => {
    mem.clear();
  },
  key: (i: number): string | null => [...mem.keys()][i] ?? null,
  get length(): number {
    return mem.size;
  },
};
(globalThis as unknown as { localStorage: typeof memoryStorage }).localStorage = memoryStorage;

// ---------- 断言框架 ----------
let failed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    failed++;
    console.error(`FAIL ${name}  →  ${e instanceof Error ? e.message : String(e)}`);
  }
}
function expect(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}
function near(actual: number, want: number, label: string): void {
  expect(Math.abs(actual - want) < 1e-9, `${label} 应为 ${want}（实得 ${actual}）`);
}
function expectThrows(fn: () => void, what: string): void {
  let caught: unknown = null;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  expect(caught instanceof TypeError, `${what} 应抛 TypeError（实得：${String(caught)}）`);
}

// 设计默认快照：任何测试结束后常量必须与之一致
const DESIGN_PALM_WIDTH = 1.35;
const designIndexLength = DEFAULT_HAND_CONFIG.fingers.index[0].length;
const designSnapshot = JSON.stringify(DEFAULT_HAND_CONFIG);

// ---------- 1) 常量深冻结 ----------
check("DEFAULT_HAND_CONFIG 每一层都 Object.isFrozen", () => {
  const targets: [string, unknown][] = [
    ["根", DEFAULT_HAND_CONFIG],
    ["palm", DEFAULT_HAND_CONFIG.palm],
    ["bases", DEFAULT_HAND_CONFIG.bases],
    ["bases.index", DEFAULT_HAND_CONFIG.bases.index],
    ["thumbCorner", DEFAULT_HAND_CONFIG.thumbCorner],
    ["thenar", DEFAULT_HAND_CONFIG.thenar],
    ["thumbCmc", DEFAULT_HAND_CONFIG.thumbCmc],
    ["fingers", DEFAULT_HAND_CONFIG.fingers],
    ["fingers.index", DEFAULT_HAND_CONFIG.fingers.index],
    ["fingers.index[0]", DEFAULT_HAND_CONFIG.fingers.index[0]],
    ["shape", DEFAULT_HAND_CONFIG.shape],
  ];
  for (const [label, v] of targets) expect(Object.isFrozen(v), `${label} 应被冻结`);
  expect(Object.isFrozen(DEFAULT_SHAPE), "DEFAULT_SHAPE 也应被冻结（迁移兜底来源）");
});

check("就地改写默认常量被拒（严格模式 TypeError）且值不变", () => {
  expectThrows(() => {
    DEFAULT_HAND_CONFIG.palm.width = 9.9;
  }, "DEFAULT_HAND_CONFIG.palm.width");
  expectThrows(() => {
    DEFAULT_HAND_CONFIG.shape.fingerWidth = 1.44;
  }, "DEFAULT_HAND_CONFIG.shape.fingerWidth");
  expectThrows(() => {
    DEFAULT_HAND_CONFIG.fingers.index[0].length = 4.2;
  }, "DEFAULT_HAND_CONFIG.fingers.index[0].length");
  near(DEFAULT_HAND_CONFIG.palm.width, DESIGN_PALM_WIDTH, "常量 palm.width");
  near(DEFAULT_HAND_CONFIG.fingers.index[0].length, designIndexLength, "常量 fingers.index[0].length");
});

// ---------- 2) loadHandRigConfig 返回独立副本 ----------
check("空库 loadHandRigConfig() 返回独立副本（!== 常量）", () => {
  mem.clear();
  const a = loadHandRigConfig();
  expect(a !== DEFAULT_HAND_CONFIG, "不应返回常量本体");
  expect(a.palm !== DEFAULT_HAND_CONFIG.palm, "palm 不应共享引用");
  expect(a.fingers.index !== DEFAULT_HAND_CONFIG.fingers.index, "fingers.index 不应共享引用");
  near(a.palm.width, DESIGN_PALM_WIDTH, "空库默认 palm.width");
  const b = loadHandRigConfig();
  expect(a !== b, "两次调用应各返回独立副本");
  a.palm.width = 9.9;
  near(b.palm.width, DESIGN_PALM_WIDTH, "改写一份副本不应影响另一份");
});

// ---------- 3) 审计 5 步链路 ----------
check("审计 5 步链路：改副本不污染常量 + 重置回设计默认", () => {
  mem.clear();
  // 1) 初始设计默认
  near(DEFAULT_HAND_CONFIG.palm.width, DESIGN_PALM_WIDTH, "步骤1 常量 palm.width");
  // 2) 旧 bug：返回值 === 常量本体；现在必须是副本
  const cfg = loadHandRigConfig();
  expect(cfg !== DEFAULT_HAND_CONFIG, "步骤2 load 返回值应为副本，不是常量本体");
  // 3) 用户拖动滑条：就地改写返回值
  cfg.palm.width = 9.9;
  cfg.shape.fingerWidth = 1.4;
  cfg.fingers.index[0].length = 2.2;
  near(DEFAULT_HAND_CONFIG.palm.width, DESIGN_PALM_WIDTH, "步骤3 改写副本后常量 palm.width");
  near(DEFAULT_HAND_CONFIG.shape.fingerWidth, DEFAULT_SHAPE.fingerWidth, "步骤3 改写副本后常量 shape.fingerWidth");
  near(DEFAULT_HAND_CONFIG.fingers.index[0].length, designIndexLength, "步骤3 改写副本后常量指段长");
  // 4) 点【重置】= 标定页 reset() 走 cloneDefaultHandRigConfig()
  const resetCfg = cloneDefaultHandRigConfig();
  near(resetCfg.palm.width, DESIGN_PALM_WIDTH, "步骤4 重置后 palm.width");
  near(resetCfg.shape.fingerWidth, DEFAULT_SHAPE.fingerWidth, "步骤4 重置后 shape.fingerWidth");
  expect(resetCfg !== DEFAULT_HAND_CONFIG, "重置结果应是副本，可继续就地编辑");
  resetCfg.palm.width = 2;
  near(DEFAULT_HAND_CONFIG.palm.width, DESIGN_PALM_WIDTH, "步骤4 重置结果可编辑且不污染常量");
});

// ---------- 4) v3 旧档迁移兜底未被污染 ----------
check("v3 旧档迁移缺 palm.width → 兜底 1.35（旧 bug 为被污染的 5）", () => {
  mem.clear();
  const v3 = structuredClone(DEFAULT_HAND_CONFIG) as unknown as Record<string, unknown>;
  delete v3.shape; // v3 档没有 shape 参数组
  v3.version = 3;
  const palm = { ...(v3.palm as Record<string, number>) };
  delete palm.width; // 旧档缺字段 → 走常量兜底
  v3.palm = palm;
  mem.set(STORE_KEY, JSON.stringify(v3));
  const migrated = loadHandRigConfig();
  expect(migrated.version === 4, `迁移后 version 应为 4（实得 ${migrated.version}）`);
  near(migrated.palm.width, DESIGN_PALM_WIDTH, "v3 迁移 palm.width");
  near(migrated.shape.fingerWidth, DEFAULT_SHAPE.fingerWidth, "v3 迁移 shape.fingerWidth 应回 DEFAULT_SHAPE");
  near(migrated.thenarFold, DEFAULT_HAND_CONFIG.thenarFold, "v3 迁移缺 thenarFold 应回默认值");
  expect(migrated !== DEFAULT_HAND_CONFIG, "迁移结果也不应等于常量本体");
});

check("损坏档 / 结构不合法档回退为独立副本", () => {
  mem.clear();
  mem.set(STORE_KEY, "{not-json");
  const broken = loadHandRigConfig();
  expect(broken !== DEFAULT_HAND_CONFIG, "损坏档应回退副本");
  near(broken.palm.width, DESIGN_PALM_WIDTH, "损坏档回退 palm.width");
  mem.set(STORE_KEY, JSON.stringify({ version: 3 })); // 缺 fingers → normalize 返回 null
  const invalid = loadHandRigConfig();
  expect(invalid !== DEFAULT_HAND_CONFIG, "非法结构应回退副本");
  near(invalid.palm.width, DESIGN_PALM_WIDTH, "非法结构回退 palm.width");
});

// ---------- 5) 持久化往返（副本语义不破坏 save/load） ----------
check("save/load 往返保留用户值，且不影响常量", () => {
  mem.clear();
  const edited = loadHandRigConfig();
  edited.palm.width = 2.5;
  edited.shape.facets = 12;
  saveHandRigConfig(edited);
  const back = loadHandRigConfig();
  near(back.palm.width, 2.5, "往返 palm.width");
  expect(back.shape.facets === 12, `往返 shape.facets 应为 12（实得 ${back.shape.facets}）`);
  expect(back !== edited, "load 应返回新副本");
  near(DEFAULT_HAND_CONFIG.palm.width, DESIGN_PALM_WIDTH, "往返后常量 palm.width");
});

// ---------- 6) 标定页源码契约（重置必须用未污染默认值） ----------
check("HandCalibPage reset() 使用 cloneDefaultHandRigConfig()", () => {
  const src = readFileSync(new URL("../src/vue/pages/HandCalibPage.vue", import.meta.url), "utf8");
  expect(src.includes("cloneDefaultHandRigConfig"), "标定页应通过 cloneDefaultHandRigConfig() 取默认值");
  expect(!src.includes("structuredClone(DEFAULT_HAND_CONFIG)"), "标定页不应再克隆共享常量本体");
});

// ---------- 7) 全局完整性 ----------
check("全部用例结束后常量仍与初始快照一致", () => {
  mem.clear();
  expect(
    JSON.stringify(DEFAULT_HAND_CONFIG) === designSnapshot,
    "DEFAULT_HAND_CONFIG 在整轮测试后与初始快照不一致（被污染）",
  );
  const fresh = loadHandRigConfig();
  expect(JSON.stringify(fresh) === designSnapshot, "空库 load 结果应等于设计默认");
});

console.log(failed === 0 ? "verify-hand-store: ALL PASS ✓" : `verify-hand-store: ${failed} FAIL`);
if (failed > 0) process.exit(1);
