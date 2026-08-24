/**
 * cfop.ts — CFOP 阶段解（移植自 rubik-cube.html solver-cfop.js）。
 *   Cross：精确 4 棱模式库 + 最优下坡。
 *   F2L  ：生成的 <R,U,F> case 表 + 标准 eject（对块在别的槽时），贪心选最短槽位。
 *   OLL  ：翻色坐标 BFS，边 = 经核验的纯 LL 公式。
 *   PLL  ：置换坐标 BFS，边 = 朝向中性公式。
 */
import { ALG_LIBRARY, algGraph } from "./algs";
import { applyAlg, cubieSolved, edgeHomeCode, cornerHomeCode, isSolved, pos, readCorner, readEdge, rot, rotMatrix, transformMove, veq, viewState, FACE_MOVES, parseAlg } from "./engine";
import { solveZbls } from "./zbls";
import type { State, Vec3 } from "./engine";
import { ItemSolver, itemEdge } from "./search";
import { F2L_TABLE } from "./f2lTable";
import { solveLL } from "./zbl";

export const CROSS_EDGES = ["DF", "DR", "DB", "DL"];
const EJECT: Record<number, string> = { 4: "R U R'", 5: "L' U' L", 6: "L U L'", 7: "R' U R" };
const EJECT_E: Record<number, string> = { 8: "R U R'", 9: "L' U' L", 10: "R' U R", 11: "L U L'" };

export type Slot = {
  corner: string;
  edge: string;
  name: string;
  rotAlg: string[];
  minv: Vec3[];
  index: number;
};

/** 四个 F2L 槽位，各带把它映到 FR 的整块旋转 */
export const SLOTS: Slot[] = ["DRF", "DBR", "DLB", "DFL"].map((cornerName, i) => {
  const target = pos("DRF"), p = pos(cornerName);
  let k = 0;
  for (let t = 0; t < 4; t++) if (veq(rot(p, 1, t), target)) k = t;
  const rotAlg = k === 0 ? [] : k === 1 ? ["y"] : k === 2 ? ["y2"] : ["y'"];
  const M = rotMatrix(rotAlg);
  const minv: Vec3[] = [[M[0][0], M[1][0], M[2][0]], [M[0][1], M[1][1], M[2][1]], [M[0][2], M[1][2], M[2][2]]];
  const edgeName = ["FR", "BR", "BL", "FL"][i];
  return { corner: cornerName, edge: edgeName, name: edgeName, rotAlg, minv, index: i };
});

export type CFOPTables = {
  cross: ItemSolver;
  oll: ReturnType<typeof algGraph>;
  pll: ReturnType<typeof algGraph>;
  ms: number;
};

let TABLES: CFOPTables | null = null;
export function prepare(): CFOPTables {
  if (TABLES) return TABLES;
  const t0 = Date.now();
  const cross = new ItemSolver(CROSS_EDGES.map(itemEdge), FACE_MOVES, { subsetSize: 4, name: "cross" });
  const pure = ALG_LIBRARY.filter((a) => a.pureLL);
  const neutral = pure.filter((a) => a.orientationNeutral);
  const oll = algGraph(ollCode, pure);
  const pll = algGraph(pllCode, neutral);
  TABLES = { cross, oll, pll, ms: Date.now() - t0 };
  return TABLES;
}

import { ollCode, pllCode } from "./algs";

export type SlotResult = { state: State; moves: string[]; failed?: boolean };

/** 解一个 F2L 槽位；返回 {state, moves} */
export function solveSlot(state: State, slot: Slot, limit = 8): SlotResult {
  let st = state;
  const moves: string[] = [];
  const homeC = cornerHomeCode("DRF"), homeE = edgeHomeCode("FR");
  for (let iter = 0; iter < limit; iter++) {
    const view = viewState(st, slot.rotAlg);
    const cc = readCorner(view, "DRF"), ec = readEdge(view, "FR");
    if (cc === homeC && ec === homeE) return { state: st, moves };
    let alg = F2L_TABLE[cc + "_" + ec];
    if (!alg) {
      const cSlot = (cc / 3) | 0, eSlot = ec >> 1;
      if (cSlot > 4) alg = EJECT[cSlot];
      else if (eSlot > 8) alg = EJECT_E[eSlot];
      else alg = EJECT[4];
    }
    const real = parseAlg(alg).map((m) => transformMove(m, slot.minv));
    st = applyAlg(st, real);
    for (const m of real) moves.push(m);
  }
  return { state: st, moves, failed: true };
}

/** 普通 LL：OLL（一步）+ PLL（一步）。高级双路线取短也用它（保证高级 LL 段不劣于普通） */
function solveOllPll(st0: State, stages: SolveStage[]): State {
  const T = prepare();
  let st = st0;
  const ollPath = T.oll.solve(st);
  if (!ollPath) throw new Error("OLL state not recognised");
  let ollMoves: string[] = [], ollNames: string[] = [];
  for (const step of ollPath) { ollMoves = ollMoves.concat(step.moves); if (!/^U/.test(step.name)) ollNames.push(step.name); }
  st = applyAlg(st, ollMoves);
  stages.push({ key: "oll", label: "顶层翻色 OLL", short: "OLL", moves: ollMoves, algs: ollNames });

  const pllPath = T.pll.solve(st);
  if (!pllPath) throw new Error("PLL state not recognised");
  let pllMoves: string[] = [], pllNames: string[] = [];
  for (const step of pllPath) { pllMoves = pllMoves.concat(step.moves); if (!/^U/.test(step.name)) pllNames.push(step.name); }
  st = applyAlg(st, pllMoves);
  stages.push({ key: "pll", label: "顶层归位 PLL", short: "PLL", moves: pllMoves, algs: pllNames });
  return st;
}

export function solve(state0: State): { stages: SolveStage[]; state: State } {
  const T = prepare();
  const stages: SolveStage[] = [];
  let st = state0;

  let mv = T.cross.descend(T.cross.read(st));
  if (!mv) mv = T.cross.solve(T.cross.read(st), 10, 4e6) || [];
  st = applyAlg(st, mv);
  stages.push({ key: "cross", label: "底层十字", short: "Cross", moves: mv });
  if (!CROSS_EDGES.every((n) => cubieSolved(st, n))) throw new Error("cross failed");

  const remaining = SLOTS.slice();
  for (let n = 1; n <= 4; n++) {
    let best: { slot: Slot; r: SlotResult } | null = null;
    for (const slot of remaining) {
      const r = solveSlot(st, slot);
      if (r.failed) continue;
      if (!best || r.moves.length < best.r.moves.length) best = { slot, r };
    }
    if (!best) throw new Error("F2L failed");
    st = best.r.state;
    remaining.splice(remaining.indexOf(best.slot), 1);
    stages.push({ key: "f2l" + n, label: `F2L 第 ${n} 组`, short: "F2L " + n, moves: best.r.moves, slot: best.slot.name });
  }

  st = solveOllPll(st, stages);

  return { stages, state: st };
}

export function solveAdvanced(state0: State): { stages: SolveStage[]; state: State } {
  const T = prepare();
  const stages: SolveStage[] = [];
  let st = state0;

  let mv = T.cross.descend(T.cross.read(st));
  if (!mv) mv = T.cross.solve(T.cross.read(st), 10, 4e6) || [];
  st = applyAlg(st, mv);
  stages.push({ key: "cross", label: "底层十字", short: "Cross", moves: mv });
  if (!CROSS_EDGES.every((n) => cubieSolved(st, n))) throw new Error("cross failed");

  const remaining = SLOTS.slice();
  for (let n = 1; n <= 3; n++) {
    let best: { slot: Slot; r: SlotResult } | null = null;
    for (const slot of remaining) {
      const r = solveSlot(st, slot);
      if (r.failed) continue;
      if (!best || r.moves.length < best.r.moves.length) best = { slot, r };
    }
    if (!best) throw new Error("F2L failed");
    st = best.r.state;
    remaining.splice(remaining.indexOf(best.slot), 1);
    stages.push({ key: "f2l" + n, label: `F2L 第 ${n} 组`, short: "F2L " + n, moves: best.r.moves, slot: best.slot.name });
  }

  // 第 4 组双路线：普通 F2L 插入 vs ZBLS 一步（插入最后一组 F2L + 顶层十字 EO），
  // 取 moves 短者——保证「高级」F2L 段绝不劣于普通
  const r4 = solveSlot(st, remaining[0]);
  const zb4 = solveZbls(st);
  if (zb4 && zb4.moves.length < r4.moves.length) {
    st = applyAlg(st, zb4.moves);
    stages.push({ key: zb4.key, label: zb4.label, short: zb4.short, moves: zb4.moves, algs: zb4.algs });
  } else {
    if (r4.failed) throw new Error("F2L failed");
    st = r4.state;
    stages.push({ key: "f2l4", label: `F2L 第 4 组`, short: "F2L 4", moves: r4.moves, slot: remaining[0].name });
  }

  // LL 双路线取短：高级（EO 预置 + 一步 ZBLL；仅全 solved 且更短才用）vs 普通（OLL+PLL）
  const adv = solveLL(st);
  const advLen = adv.stages.reduce((a, s) => a + s.moves.length, 0);
  const normStages: SolveStage[] = [];
  const normState = solveOllPll(st, normStages);
  const normLen = normStages.reduce((a, s) => a + s.moves.length, 0);
  if (isSolved(adv.state) && advLen < normLen) {
    for (const s of adv.stages) stages.push({ key: s.key, label: s.label, short: s.short, moves: s.moves, algs: s.algs });
    st = adv.state;
  } else {
    for (const s of normStages) stages.push(s);
    st = normState;
  }
  return { stages, state: st };
}

export type SolveStage = {
  key: string;
  label: string;
  short: string;
  moves: string[];
  algs?: string[] | null;
  slot?: string;
  start?: number;
  end?: number;
};

export const CFOP = { prepare, solve, solveAdvanced, SLOTS, solveSlot };