/**
 * solve.ts — 求解器公开入口（移植自 rubik-cube.html solver.js）。
 *
 * 处理阶段求解器不该关心的两件事：
 *   1. 中心漂移：slice 步会转中心，先把状态拨回 home 朝向，再把解法每步映射回真魔方。
 *   2. 校验：重放解法序列，除非六面真的一致否则拒绝。
 */
import { applyAlg, isSolved, isUniform, normalizeOrientation, transformMove } from "./engine.ts";
import type { State } from "./engine.ts";
import type { Face } from "../stickering.ts";
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
};

/**
 * @param state 当前魔方
 * @param method 'cfop' | 'cfop-adv' | 'roux' | 'roux-adv'
 * @param baseFace 解法底：undefined / "global" = 跟随全局底（默认）；显式 Face = 指定解法底
 *   （多色底 / 6 色底）。求解器坐标中性——同一坐标解对任意底同构（cross/F2L 按 D 面位
 *   坐标、与颜色无关；isUniform 判定对整块旋转不变 ⇒ moves 对任何底都还原），
 *   因此 baseFace 仅记录为视角标注（SolveResult.base），为未来色底求解器预留接入点；
 *   不做整块旋转（会破坏求解器「中心归 home」前提——探针实证 CFOP 对整块旋转后的
 *   状态解不到 uniform）。默认情形下演示起始状态已把全局底颜色转到 D 面位（六色底），
 *   求解视角即与全局底一致——「默认跟随全局底」语义由此成立。
 * @returns {method,label,stages,moves,stageOf,ms,rotated,base}
 */
export function solve(state: State, method?: SolveMethodKey, baseFace?: Face | "global"): SolveResult {
  const key = method ?? "cfop";
  const m = SOLVER_METHODS[key];
  const t0 = now();
  m.prepare();
  const norm = normalizeOrientation(state);
  const targetDown = baseFace && baseFace !== "global" ? baseFace : null;
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

  const end = applyAlg(state, moves);
  if (!isUniform(end)) throw new Error("内部错误：求解结果未还原");
  return {
    method: m.key, label: m.label, short: m.short, blurb: m.blurb,
    stages, moves, stageOf, ms: Math.max(0, now() - t0),
    rotated: !isSolved(end),
    base: targetDown ?? "global",
  };
}