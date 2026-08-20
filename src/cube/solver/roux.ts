/**
 * roux.ts — Roux 桥式阶段解（移植自 rubik-cube.html solver-roux.js）。
 *   1. 左块   ：D-L 1x2x3，全面前转 IDA*。
 *   2. 右块   ：D-R 1x2x3，<R,U,M> IDA*（保证不破坏左块）。
 *   3. CMLL  ：四个 U 角，块安全公式图 BFS。
 *   4. LSE   ：<M,U> 内最后六棱；4a 棱定向（优先 EOLR 一步：EO + UL/UR 伪位）→
 *      6E2C（4c L4E 一步，UL/UR 伪位并入——4b 不再单列）。
 */
import { ALG_LIBRARY, algGraph } from "./algs";
import {
  applyAlg, cubieSolved, edgeDecode, edgeHomeCode, edgeSlot, normalsOf, parseAlg, pos, posKey, readCenter, readEdge, solvedState, tidyAlg, CUBIES, FACE_MOVES,
} from "./engine";
import type { State, Vec3 } from "./engine";
import { ItemSolver, itemCenter, itemCorner, itemEdge } from "./search";
import cuberootJson from "../../../data/samples/cuberoot-algs.json";

const LEFT = [itemCorner("DLF"), itemCorner("DLB"), itemEdge("DL"), itemEdge("LF"), itemEdge("LB")];
const RIGHT = [itemCorner("DRF"), itemCorner("DBR"), itemEdge("DR"), itemEdge("RF"), itemEdge("RB")];
export const LEFT_NAMES = ["DLF", "DLB", "DL", "LF", "LB"];
export const RIGHT_NAMES = ["DRF", "DBR", "DR", "RF", "RB"];
const RUM = ["R", "R2", "R'", "U", "U2", "U'", "M", "M2", "M'"];
const MU = ["M", "M2", "M'", "U", "U2", "U'"];
const U_MOVES = ["", "U", "U2", "U'"];

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

/** LSE 动态 EO 判定：棱的 U/D 色贴纸（0/3）法线平行于「当前 U 中心法线」（M 层偏移系） */
function lseEoDone(state: State): boolean {
  let nu: Vec3 = [0, 1, 0];
  for (const c of CUBIES) if (c.type === "center") for (const s of c.stickers) if (state[s.index] === 0) { nu = s.normal; break; }
  for (const n of LSE_EDGE_NAMES) {
    const p = pos(n);
    const cubie = CUBIES.find((c) => c.pos[0] === p[0] && c.pos[1] === p[1] && c.pos[2] === p[2]);
    if (!cubie) return false;
    const ok = cubie.stickers.some(
      (s) => (state[s.index] === 0 || state[s.index] === 3)
        && Math.abs(s.normal[0] * nu[0] + s.normal[1] * nu[1] + s.normal[2] * nu[2]) === 1,
    );
    if (!ok) return false;
  }
  return true;
}

/** EOLR 表指纹：6 棱 code + U 中心 code，U 旋转 4 种取最小 */
function eolrFingerprint(state: State): { fp: number; um: number } {
  let best = Infinity, um = 0;
  for (let m = 0; m < 4; m++) {
    const st = m ? applyAlg(state, parseAlg(U_MOVES[m])) : state;
    let fp = readCenter(st, "U");
    for (const n of LSE_EDGE_NAMES) fp = fp * 24 + readEdge(st, n);
    if (fp < best) { best = fp; um = m; }
  }
  return { fp: best, um };
}

const EOLR_RAW = (cuberootJson as {
  sets: { "lse-eolr": { cases: Array<{ name: string; setup: string; alg: string }> } };
}).sets["lse-eolr"];

export type RouxTables = {
  block1: ItemSolver;
  block2: ItemSolver;
  cmll: ReturnType<typeof algGraph>;
  eo: ItemSolver;
  ulur: ItemSolver;
  l4e: ItemSolver;
  /** EOLR 一步表：状态指纹（U 旋转归一 + U 中心）→ {公式, case 名}。仅收「施加后全 EO」case。 */
  eolr: Map<number, { moves: string[]; name: string }>;
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

  // EOLR 一步表：setup 态指纹 → 公式。仅保留「施加后动态 EO done」的全 EO case（Arrow 等中间态不入表）。
  const eolr = new Map<number, { moves: string[]; name: string }>();
  for (const c of EOLR_RAW.cases) {
    let S: State, T: State, moves: string[];
    try { S = applyAlg(solvedState(), parseAlg(c.setup)); } catch { continue; }
    try { moves = parseAlg(c.alg); } catch { continue; }
    try { T = applyAlg(S, moves); } catch { continue; }
    if (!lseEoDone(T)) continue;
    const { fp } = eolrFingerprint(S);
    if (!eolr.has(fp)) eolr.set(fp, { moves, name: c.name });
  }

  TABLES = { block1, block2, cmll, eo, ulur, l4e, eolr, ms: Date.now() - t0 };
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

  // 4a 棱定向：优先 EOLR 一步（EO + UL/UR 伪位）；未匹配回退搜索
  let eolrUsed = false;
  const { fp, um } = eolrFingerprint(st);
  const eolrHit = T.eolr.get(fp);
  if (eolrHit) {
    const pre = um ? parseAlg(U_MOVES[um]) : [];
    const st2 = applyAlg(st, [...pre, ...eolrHit.moves]);
    if (lseEoDone(st2)) {
      st = st2;
      stages.push({
        key: "lse-eolr", label: "棱定向 + UL/UR (EOLR)", short: "EOLR",
        moves: [...pre, ...eolrHit.moves], algs: [eolrHit.name],
      });
      eolrUsed = true;
    }
  }
  if (!eolrUsed) {
    mv = runItem(T.eo, 12, 4e6);
    if (!mv) throw new Error("LSE edge orientation failed");
    stages.push({ key: "lse-eo", label: "棱定向 EO (4a)", short: "4a EO", moves: mv });
  }

  // 6E2C：UL/UR 伪位并入 4c 一步（4b 不再单列——l4e 从「UL/UR 任意」解到已解，已验证 8/8）
  mv = runItem(T.l4e, 18, 8e6);
  if (!mv) throw new Error("LSE last four edges failed");
  stages.push({ key: "lse-l4e", label: "最后六棱二中心 (6E2C)", short: "6E2C", moves: mv });

  return { stages, state: st };
}

export const ROUX = { prepare, solve, LEFT_NAMES, RIGHT_NAMES };