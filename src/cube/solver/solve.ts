/**
 * solve.ts — 求解器公开入口（移植自 rubik-cube.html solver.js）。
 *
 * 处理阶段求解器不该关心的两件事：
 *   1. 中心漂移：slice 步会转中心，先把状态拨回 home 朝向，再把解法每步映射回真魔方。
 *   2. 校验：重放解法序列，除非六面真的一致否则拒绝。
 */
import { applyAlg, isSolved, isUniform, normalizeOrientation, solvedState, transformMove } from "./engine.ts";
import type { State } from "./engine.ts";
import { baseFaceSetupAlg, FACES, type Face } from "../stickering.ts";
import { CFOP, prepare as cfopPrepare, type SolveStage } from "./cfop.ts";
import { ROUX, prepare as rouxPrepare } from "./roux.ts";
import { prepare as zblPrepare } from "./zbl.ts";
import { prepare as zblsPrepare } from "./zbls.ts";

/** engine 面序 U/R/F/D/L/B（solve.ts/engine.ts 布局约定）：Face→面位号 与 面位号→Face */
export const FACE_INDEX: Record<Face, number> = { U: 0, R: 1, F: 2, D: 3, L: 4, B: 5 };
export const FACE_BY_INDEX: Face[] = ["U", "R", "F", "D", "L", "B"];

export type SolveMethodKey = "cfop" | "cfop-adv" | "roux" | "roux-merge" | "roux-adv";
export type Method = {
  key: SolveMethodKey;
  label: string;
  short: string;
  blurb: string;
  prepare: () => unknown;
  run: (s: State) => { stages: SolveStage[]; state: State };
};

export const SOLVER_METHODS: Record<SolveMethodKey, Method> = {
  cfop: {
    key: "cfop", label: "CFOP 解法", short: "CFOP",
    blurb: "十字 → F2L → OLL → PLL",
    prepare: () => cfopPrepare(), run: (s) => CFOP.solve(s),
  },
  "cfop-adv": {
    key: "cfop-adv", label: "CFOP 高级（ZBLL）", short: "CFOP+",
    blurb: "十字 → F2L×3 → ZBLS（最后一组 + 十字）→ 一步 ZBLL",
    prepare: () => { cfopPrepare(); zblPrepare(); zblsPrepare(); }, run: (s) => CFOP.solveAdvanced(s),
  },
  roux: {
    key: "roux", label: "桥式解法 Roux（普通）", short: "Roux",
    blurb: "左块 → 右块 → CMLL → LSE（4a/4b/4c 分步）",
    prepare: () => rouxPrepare(), run: (s) => ROUX.solveBasic(s),
  },
  "roux-merge": {
    key: "roux-merge", label: "桥式 Roux（合并 4b+4c）", short: "Roux✚",
    blurb: "左块 → 右块 → CMLL → LSE（4a 分步 + 4b+4c 合并一步）",
    prepare: () => rouxPrepare(), run: (s) => ROUX.solveMerge4c(s),
  },
  "roux-adv": {
    key: "roux-adv", label: "桥式高级 Roux（EOLR）", short: "Roux+",
    blurb: "左块 → 右块 → CMLL → LSE（EOLR 一步 + 6E2C）",
    prepare: () => rouxPrepare(), run: (s) => ROUX.solve(s),
  },
};

const now = (): number => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());

export function prepareSolvers(method?: SolveMethodKey): void {
  const list = method ? [SOLVER_METHODS[method]] : Object.values(SOLVER_METHODS);
  for (const m of list) if (m) m.prepare();
}

export type SolveResult = {
  method: SolveMethodKey;
  label: string;
  short: string;
  blurb: string;
  stages: SolveStage[];
  moves: string[];
  stageOf: number[];
  ms: number;
  rotated: boolean;
  /** 解法底：跟随全局底（"global"）或显式选定的面（多色底 / 6 色底） */
  base: Face | "global";
  /** 把魔方整块旋转到解法底的整块旋转 alg（base 为 "global"/"D" 时为空串）；
   *  调用方在演示/执行解前对玩家施加，让玩家处于解法底朝向，moves 即在该视角播放。 */
  setupAlg: string;
  /** 演示收尾整块旋转（动态，实证 2026-08-22）：把「真实还原终点 T」整块旋转到「所选底朝向
   *  solved」——T=applyAlg(applyAlg(state, setupAlg), moves)（真实视角、物理贴纸未 relabel，
   *  经 moves 还原后恒停在「所选底色在 D 面位」的某朝向 solved）。标准全局底视角下 T 已=
   *  所选底朝向 solved ⇒ endAlg="";非标准全局底视角（全局底≠D、state 带整块前缀）下 T 与其
   *  差一个整块旋转 ⇒ endAlg 由第 24 个整块旋转候选匹配自动补出。调用方在演示末尾施加。 */
  endAlg: string;
};

/**
 * 中心色重标注（relabel）：把「整块旋转后」的状态（中心随转、未归 home）重映射为
 * 「中心归 home」——位置不变、仅改颜色标签：每个贴纸的颜色映射为其「中心所在面位」
 * 的 home 色。求解器坐标中性 + 阶段解依赖「中心归 home」坐标前提，故整块旋转底时
 * 必须先把中心拨回 home 才能解；relabel 后解出的坐标操作序列位置不变，在真实贴纸
 * （已整块旋转到对应底的视角）上可直接执行。
 * 布局约定：State=Uint8Array(54)，面序 U/R/F/D/L/B，面位 f 中心索引 f*9+4，
 * 面位 f 的 home 色（solvedState）恰为 f。
 */
const relabelByCenter = (s: State): State => {
  const colorToFace = new Uint8Array(6).fill(255);
  for (let f = 0; f < 6; f++) {
    const c = s[f * 9 + 4];
    if (c < 6) colorToFace[c] = f;
  }
  const out = new Uint8Array(54);
  for (let i = 0; i < 54; i++) out[i] = colorToFace[s[i]] !== 255 ? colorToFace[s[i]] : s[i];
  return out;
};

/** 全部 24 个整块旋转朝向：对每个面 f 用 baseFaceSetupAlg(f)（修方向后：把 f 色面位转到 D）
 *  作底朝向，再绕 D 轴（z 轴）自转 4 分位。覆盖「f 色在 D × 4 自转」= 完整 24 朝向。 */
const WHOLE_ROT24: string[] = (() => {
  const out: string[] = [];
  for (const f of FACES) {
    const setup = baseFaceSetupAlg(f);
    for (const spin of ["", "z", "z2", "z'"]) out.push(spin === "" ? setup : setup + " " + spin);
  }
  return out;
})();

const centerColors = (s: State): string => {
  const o: number[] = [];
  for (let f = 0; f < 6; f++) o.push(s[f * 9 + 4]);
  return o.join(",");
};

/** 求把「真实还原终点 T」整块旋转到「目标朝向 target（=所选底朝向 solved）」的唯一整块旋转。
 *  实证：标准全局底视角下 T 已=solved·setupAlg ⇒ 返回 ""；非标准全局底视角（如红底实态、
 *  st 已带整块前缀）下 T=标准 solved·整块前缀组合，自动补出那一步——统一覆盖两种视角，
 *  这正是「方案 A 的实证正确版」（旧的「setupAlg 静态逆」premise 实测不成立，已废弃）。 */
function finishRotBetween(T: State, target: State): string {
  const tc = centerColors(target);
  for (const g of WHOLE_ROT24) {
    if (centerColors(applyAlg(T, g)) === tc) return g;
  }
  return "";
}

/**
 * @param state 当前魔方
 * @param method 'cfop' | 'cfop-adv' | 'roux' | 'roux-adv'
 * @param baseFace 解法底：
 *   - undefined / "global"：跟随全局底。演示起始状态已把全局底颜色转到 D 面位（六色底），
 *     求解视角即与全局底一致，无需额外处理，setupAlg=""
 *   - 显式 Face B：单色底——魔方旋转到 B 底朝向（B 色面到 D 面位）后按该底解。两层解耦：
 *     本函数对输入态做等效整块旋转（applyAlg(state, baseFaceSetupAlg(B))）+ relabelByCenter
 *     （中心归 home、位置不变），解出的坐标 moves 可在真实贴纸（已旋转到 B 底）上直接执行；
 *     SolveResult.setupAlg = baseFaceSetupAlg(B)，由调用方在演示前对玩家施加（视觉整块旋转）。
 *     验证：applyAlg(applyAlg(state, setupAlg), moves) 六面单色（isUniform 对整块旋转不变）。
 * 坐标中性结论：同底坐标解对任意底色同构（cross/F2L 按 D 面位坐标），默认全局底与显式
 * "D" 的 moves 深等。
 * @returns {method,label,stages,moves,stageOf,ms,rotated,base,setupAlg}
 */
export function solve(state: State, method?: SolveMethodKey, baseFace?: Face | "global"): SolveResult {
  const key = method ?? "cfop";
  const m = SOLVER_METHODS[key];
  const t0 = now();
  m.prepare();
  // 显式单色底（非 global 且非 D）：整块旋转到底 + 中心色重标注；否则直接用输入态
  // setupAlg 动态化：按「base 色中心当前所在面位」构造（把该面位整块转到 D），而非固定
  // baseFaceSetupAlg(base)——非标准全局底视角（如红底实态 state 已带整块旋转前缀）下 base
  // 色可能不在其 home 面位，固定语法会转错（把"对面的面"转到 D = 用户观察到的「对面」）。
  // 面位 p → D 的整块旋转 = baseFaceSetupAlg(FACE_BY_INDEX[p])（修方向后 p 面位→D 正确）。
  const setupAlg = ((): string => {
    if (!baseFace || baseFace === "global" || baseFace === "D") return "";
    const want = FACE_INDEX[baseFace];
    let p = -1;
    for (let f = 0; f < 6; f++) if (state[f * 9 + 4] === want) { p = f; break; }
    return p === 3 || p === -1 ? "" : baseFaceSetupAlg(FACE_BY_INDEX[p]);
  })();
  const input = setupAlg ? relabelByCenter(applyAlg(state, setupAlg)) : state;
  const norm = normalizeOrientation(input);
  const mapBack = norm.alg.length ? (mv: string) => transformMove(mv, norm.inverse) : (mv: string) => mv;
  const res = m.run(norm.state);

  const stages: SolveStage[] = [];
  const moves: string[] = [], stageOf: number[] = [];
  for (const s of res.stages) {
    const mapped = s.moves.map(mapBack);
    const stage: SolveStage = { key: s.key, label: s.label, short: s.short, algs: s.algs || null, moves: mapped, start: moves.length };
    for (const mv of mapped) { moves.push(mv); stageOf.push(stages.length); }
    stage.end = moves.length;
    stages.push(stage);
  }

  const end = applyAlg(input, moves);
  if (!isUniform(end)) throw new Error("内部错误：求解结果未还原");
  // 真实视角还原终点（玩家状态经 setup+moves，物理贴纸不 relabel）与目标朝向（所选底朝向的
  // solved）。标准全局底视角下 T==target ⇒ endAlg="（无需收尾）；非标准全局底视角（红底实态）
  // 下 T 与 target 差一个整块旋转 ⇒ endAlg 动态补出。实证 2026-08-22：六底×两视角全对齐。
  const T = setupAlg ? applyAlg(applyAlg(state, setupAlg), moves) : end;
  const target = setupAlg ? applyAlg(solvedState(), setupAlg) : end;
  return {
    method: m.key, label: m.label, short: m.short, blurb: m.blurb,
    stages, moves, stageOf, ms: Math.max(0, now() - t0),
    rotated: !isSolved(end),
    base: baseFace && baseFace !== "global" ? baseFace : "global",
    setupAlg,
    endAlg: finishRotBetween(T, target),
  };
}