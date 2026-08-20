/**
 * solve.ts — 求解器公开入口（移植自 rubik-cube.html solver.js）。
 *
 * 处理阶段求解器不该关心的两件事：
 *   1. 中心漂移：slice 步会转中心，先把状态拨回 home 朝向，再把解法每步映射回真魔方。
 *   2. 校验：重放解法序列，除非六面真的一致否则拒绝。
 */
import { applyAlg, isSolved, isUniform, normalizeOrientation, transformMove } from "./engine";
import type { State } from "./engine";
import { CFOP, prepare as cfopPrepare, type SolveStage } from "./cfop";
import { ROUX, prepare as rouxPrepare } from "./roux";
import { prepare as zblPrepare } from "./zbl";
import { prepare as zblsPrepare } from "./zbls";

export type SolveMethodKey = "cfop" | "cfop-adv" | "roux";
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
    key: "roux", label: "桥式解法 Roux", short: "Roux",
    blurb: "左块 → 右块 → CMLL → LSE",
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
};

/**
 * @param state 当前魔方
 * @param method 'cfop' | 'roux'
 * @returns {method,label,stages,moves,stageOf,ms,rotated}
 */
export function solve(state: State, method?: SolveMethodKey): SolveResult {
  const key = method ?? "cfop";
  const m = SOLVER_METHODS[key];
  const t0 = now();
  m.prepare();
  const norm = normalizeOrientation(state);
  const res = m.run(norm.state);
  const mapBack = norm.alg.length ? (mv: string) => transformMove(mv, norm.inverse) : (mv: string) => mv;

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
  };
}