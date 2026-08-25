/**
 * solve.ts — 求解器公开入口（移植自 rubik-cube.html solver.js）。
 *
 * 处理阶段求解器不该关心的两件事：
 *   1. 中心漂移：slice 步会转中心，先把状态拨回 home 朝向，再把解法每步映射回真魔方。
 *   2. 校验：重放解法序列，除非六面真的一致否则拒绝。
 */
import { applyAlg, isSolved, isUniform, normalizeOrientation, transformMove } from "./engine.ts";
import type { State } from "./engine.ts";
import { baseFaceSetupAlg, type Face } from "../stickering.ts";
import { CFOP, prepare as cfopPrepare, type SolveStage } from "./cfop.ts";
import { ROUX, prepare as rouxPrepare } from "./roux.ts";
import { prepare as zblPrepare } from "./zbl.ts";
import { prepare as zblsPrepare } from "./zbls.ts";

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
  const setupAlg = baseFace && baseFace !== "global" && baseFace !== "D" ? baseFaceSetupAlg(baseFace) : "";
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
  return {
    method: m.key, label: m.label, short: m.short, blurb: m.blurb,
    stages, moves, stageOf, ms: Math.max(0, now() - t0),
    rotated: !isSolved(end),
    base: baseFace && baseFace !== "global" ? baseFace : "global",
    setupAlg,
  };
}