/**
 * roux.ts — Roux 桥式阶段解（移植自 rubik-cube.html solver-roux.js）。
 *   1. 左块   ：D-L 1x2x3，全面前转 IDA*。
 *   2. 右块   ：D-R 1x2x3，<R,U,M> IDA*（保证不破坏左块）。
 *   3. CMLL  ：四个 U 角，块安全公式图 BFS。
 *   4. LSE   ：<M,U> 内最后六棱，4a 棱定向 → 4b UL/UR → 4c L4E。
 */
import { ALG_LIBRARY, algGraph } from "./algs";
import {
  applyAlg, cubieSolved, edgeDecode, edgeHomeCode, edgeSlot, normalsOf, pos, posKey, tidyAlg, FACE_MOVES,
} from "./engine";
import type { State } from "./engine";
import { ItemSolver, itemCenter, itemCorner, itemEdge } from "./search";

const LEFT = [itemCorner("DLF"), itemCorner("DLB"), itemEdge("DL"), itemEdge("LF"), itemEdge("LB")];
const RIGHT = [itemCorner("DRF"), itemCorner("DBR"), itemEdge("DR"), itemEdge("RF"), itemEdge("RB")];
export const LEFT_NAMES = ["DLF", "DLB", "DL", "LF", "LB"];
export const RIGHT_NAMES = ["DRF", "DBR", "DR", "RF", "RB"];
const RUM = ["R", "R2", "R'", "U", "U2", "U'", "M", "M2", "M'"];
const MU = ["M", "M2", "M'", "U", "U2", "U'"];

const LSE_EDGE_NAMES = ["UF", "UB", "DF", "DB", "UL", "UR"];
const LSE_EDGES = LSE_EDGE_NAMES.map(itemEdge);
const LSE_SLOTS = new Set(["UF", "UR", "UB", "UL", "DF", "DB"].map((n) => edgeSlot[posKey(pos(n))]));
const M_SLOTS = new Set(["UF", "UB", "DF", "DB"].map((n) => edgeSlot[posKey(pos(n))]));

/** 这个棱坐在"后六棱"集合内、且为 Roux 定向的每一个 code */
function orientedCodes(homeName: string, slotFilter?: Set<number>): number[] {
  const firstIsY = normalsOf(pos(homeName))[0][1] !== 0;
  const out: number[] = [];
  for (let code = 0; code < 24; code++) {
    const d = edgeDecode(code);
    if (!LSE_SLOTS.has(d.slot)) continue;
    if (slotFilter && !slotFilter.has(d.slot)) continue;
    if ((d.carrier[1] !== 0) === firstIsY) out.push(code);
  }
  return out;
}

export type RouxTables = {
  block1: ItemSolver;
  block2: ItemSolver;
  cmll: ReturnType<typeof algGraph>;
  eo: ItemSolver;
  ulur: ItemSolver;
  l4e: ItemSolver;
  ms: number;
};

let TABLES: RouxTables | null = null;
export function prepare(): RouxTables {
  if (TABLES) return TABLES;
  const t0 = Date.now();
  const block1 = new ItemSolver(LEFT, FACE_MOVES, { subsetSize: 3, name: "block1" });
  const block2 = new ItemSolver(RIGHT, RUM, { subsetSize: 3, name: "block2" });
  const cmll = algGraph(cmllCode, ALG_LIBRARY.filter((a) => a.rouxSafe));

  const centerU = itemCenter("U");
  const cornerUFR = itemCorner("UFR");
  const eo = new ItemSolver(LSE_EDGES.concat([centerU]), MU, {
    subsetSize: 3, name: "lse-eo",
    goalCodes: LSE_EDGE_NAMES.map((n) => orientedCodes(n)).concat([[0, 3]]),
  });
  const ulur = new ItemSolver(LSE_EDGES.concat([centerU]), MU, {
    subsetSize: 3, name: "lse-ulur",
    goalCodes: [
      orientedCodes("UF", M_SLOTS), orientedCodes("UB", M_SLOTS), orientedCodes("DF", M_SLOTS), orientedCodes("DB", M_SLOTS),
      [edgeHomeCode("UL")], [edgeHomeCode("UR")],
    ].concat([[0, 3]]),
  });
  const l4e = new ItemSolver(LSE_EDGES.concat([centerU, cornerUFR]), MU, { subsetSize: 3, name: "lse-l4e" });
  TABLES = { block1, block2, cmll, eo, ulur, l4e, ms: Date.now() - t0 };
  return TABLES;
}

import { cmllCode } from "./algs";
import type { SolveStage } from "./cfop";

export function solve(state0: State): { stages: SolveStage[]; state: State } {
  const T = prepare();
  const stages: SolveStage[] = [];
  let st = state0;

  const runItem = (solver: ItemSolver, maxDepth: number, budget: number): string[] | null => {
    const mv = solver.solve(solver.read(st), maxDepth, budget);
    if (!mv) return null;
    st = applyAlg(st, mv);
    return tidyAlg(mv);
  };

  let mv = runItem(T.block1, 12, 6e6);
  if (!mv) throw new Error("first block failed");
  stages.push({ key: "block1", label: "左侧一层块", short: "Block 1", moves: mv });
  if (!LEFT_NAMES.every((n) => cubieSolved(st, n))) throw new Error("first block wrong");

  mv = runItem(T.block2, 14, 8e6);
  if (!mv) throw new Error("second block failed");
  stages.push({ key: "block2", label: "右侧一层块", short: "Block 2", moves: mv });
  if (!RIGHT_NAMES.every((n) => cubieSolved(st, n))) throw new Error("second block wrong");

  const path = T.cmll.solve(st);
  if (!path) throw new Error("CMLL state not recognised");
  let cm: string[] = [], names: string[] = [];
  for (const step of path) { cm = cm.concat(step.moves); if (!/^U/.test(step.name)) names.push(step.name); }
  cm = tidyAlg(cm);
  st = applyAlg(st, cm);
  stages.push({ key: "cmll", label: "顶层角块 CMLL", short: "CMLL", moves: cm, algs: names });

  mv = runItem(T.eo, 12, 4e6);
  if (!mv) throw new Error("LSE edge orientation failed");
  stages.push({ key: "lse-eo", label: "棱定向 EO (4a)", short: "4a EO", moves: mv });

  mv = runItem(T.ulur, 14, 4e6);
  if (!mv) throw new Error("LSE UL/UR failed");
  stages.push({ key: "lse-ulur", label: "UL/UR 归位 (4b)", short: "4b UL/UR", moves: mv });

  mv = runItem(T.l4e, 16, 6e6);
  if (!mv) throw new Error("LSE last four edges failed");
  stages.push({ key: "lse-l4e", label: "最后四棱 (4c)", short: "4c L4E", moves: mv });

  return { stages, state: st };
}

export const ROUX = { prepare, solve, LEFT_NAMES, RIGHT_NAMES };