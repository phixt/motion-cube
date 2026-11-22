/**
 * roux.ts — Roux 桥式阶段解（移植自 rubik-cube.html solver-roux.js）。
 *   1. 左块   ：D-L 1x2x3，全面前转 IDA*。
 *   2. 右块   ：D-R 1x2x3，<R,U,M> IDA*（保证不破坏左块）。
 *   3. CMLL  ：四个 U 角，块安全公式图 BFS。
 *   4. LSE   ：<M,U> 内最后六棱：
 *      - 普通（solveBasic）：4a 棱定向 → 4b UL/UR 归位 → 4c M 层四棱归位
 *      - 合并（solveMerge4c）：4a 棱定向 → 4b+4c 合并一步（l4e）
 *      - 高级（solve / roux-adv）：EOLR 一步（EO + UL/UR 放到 DF/DB、UF/UB 或 UL/UR 伪位，
 *        通过 3 张轻量 <M,U> ItemSolver 保证 100% 覆盖；并与 4a+6E2C 择短保证 0 例变长）→ 6E2C。
 */
import { ALG_LIBRARY, algGraph, cmllCode } from "./algs.ts";
import {
  applyAlg, cubieSolved, edgeDecode, edgeHomeCode, edgeSlot, normalsOf, parseAlg, pos, posKey,
  readCenter, readEdge, solvedState, tidyAlg, CUBIES, FACE_MOVES,
} from "./engine.ts";
import type { State, Vec3 } from "./engine.ts";
import { ItemSolver, itemCenter, itemCorner, itemEdge } from "./search.ts";
import type { SolveStage } from "./cfop.ts";
import cuberootJson from "../../../data/samples/cuberoot-algs.json" with { type: "json" };

const LEFT = [itemCorner("DLF"), itemCorner("DLB"), itemEdge("DL"), itemEdge("LF"), itemEdge("LB")];
const RIGHT = [itemCorner("DRF"), itemCorner("DBR"), itemEdge("DR"), itemEdge("RF"), itemEdge("RB")];
export const LEFT_NAMES = ["DLF", "DLB", "DL", "LF", "LB"];
export const RIGHT_NAMES = ["DRF", "DBR", "DR", "RF", "RB"];
const RUM = ["R", "R2", "R'", "U", "U2", "U'", "M", "M2", "M'"];
const MU = ["M", "M2", "M'", "U", "U2", "U'"];
const U_MOVES = ["", "U", "U2", "U'"];
const U_INV = ["", "U'", "U2", "U"];

const LSE_EDGE_NAMES = ["UF", "UB", "DF", "DB", "UL", "UR"];
const LSE_EDGES = LSE_EDGE_NAMES.map(itemEdge);
const LSE_SLOTS = new Set(["UF", "UR", "UB", "UL", "DF", "DB"].map((n) => edgeSlot[posKey(pos(n))]));
const M_SLOTS = new Set(["UF", "UB", "DF", "DB"].map((n) => edgeSlot[posKey(pos(n))]));
const DF_DB_SLOTS = new Set(["DF", "DB"].map((n) => edgeSlot[posKey(pos(n))]));
const UF_UB_SLOTS = new Set(["UF", "UB"].map((n) => edgeSlot[posKey(pos(n))]));
const UL_UR_SLOTS = new Set(["UL", "UR"].map((n) => edgeSlot[posKey(pos(n))]));

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
  /** 基础 LSE 4c：M 层四棱归位（普通桥式分步用；goal=全 home，无角项） */
  lse4c: ItemSolver;
  /** EOLR 一步 <M,U> 求解器：EO + UL/UR 放到 DF/DB（教科书经典伪位） */
  eolrDb: ItemSolver;
  /** EOLR 一步 <M,U> 求解器：EO + UL/UR 放到 UF/UB（顶面 M 层伪位） */
  eolrUb: ItemSolver;
  /** EOLR 一步 <M,U> 求解器：EO + UL/UR 放到 UL/UR（U 层对位） */
  eolrPseudo: ItemSolver;
  /** cuberoot EOLR 经典命名表（键值配对已按 U 归一修正）：用于命中经典 case 时附带 case 名 */
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
  const lse4c = new ItemSolver(LSE_EDGES.concat([centerU]), MU, { subsetSize: 3, name: "lse-4c" });

  // 三张轻量 <M,U> EOLR 求解器（建表合计 ~15ms）：一步完成 EO + UL/UR 伪位，100% 覆盖任意后 CMLL 态
  const eolrDb = new ItemSolver(LSE_EDGES.concat([centerU]), MU, {
    subsetSize: 3, name: "lse-eolr-db",
    goalCodes: [
      orientedCodes("UF"), orientedCodes("UB"), orientedCodes("DF"), orientedCodes("DB"),
      orientedCodes("UL", DF_DB_SLOTS), orientedCodes("UR", DF_DB_SLOTS),
    ].concat([[0, 3]]),
  });
  const eolrUb = new ItemSolver(LSE_EDGES.concat([centerU]), MU, {
    subsetSize: 3, name: "lse-eolr-ub",
    goalCodes: [
      orientedCodes("UF"), orientedCodes("UB"), orientedCodes("DF"), orientedCodes("DB"),
      orientedCodes("UL", UF_UB_SLOTS), orientedCodes("UR", UF_UB_SLOTS),
    ].concat([[0, 3]]),
  });
  const eolrPseudo = new ItemSolver(LSE_EDGES.concat([centerU]), MU, {
    subsetSize: 3, name: "lse-eolr-pseudo",
    goalCodes: [
      orientedCodes("UF", M_SLOTS), orientedCodes("UB", M_SLOTS),
      orientedCodes("DF", M_SLOTS), orientedCodes("DB", M_SLOTS),
      orientedCodes("UL", UL_UR_SLOTS), orientedCodes("UR", UL_UR_SLOTS),
    ].concat([[0, 3]]),
  });

  // cuberoot EOLR 命名表：键 = S·U^um 的归一指纹，值 = 能解 S·U^um 的公式（即 U^-um · alg），
  // 修正旧版丢弃 um 导致 11/22 条配错键的缺陷，并在入库时校验对归一态施加后 lseEoDone 必成立。
  const eolr = new Map<number, { moves: string[]; name: string }>();
  for (const c of EOLR_RAW.cases) {
    let S: State, moves: string[];
    try { S = applyAlg(solvedState(), parseAlg(c.setup)); } catch { continue; }
    try { moves = parseAlg(c.alg); } catch { continue; }
    const { fp, um } = eolrFingerprint(S);
    const normS = um ? applyAlg(S, parseAlg(U_MOVES[um])) : S;
    const normMoves = um ? tidyAlg([...parseAlg(U_INV[um]), ...moves]) : tidyAlg(moves);
    let T: State;
    try { T = applyAlg(normS, normMoves); } catch { continue; }
    if (!lseEoDone(T)) continue;
    if (!eolr.has(fp)) eolr.set(fp, { moves: normMoves, name: c.name });
  }

  TABLES = { block1, block2, cmll, eo, ulur, l4e, lse4c, eolrDb, eolrUb, eolrPseudo, eolr, ms: Date.now() - t0 };
  return TABLES;
}

/** 公共前缀：Block 1 → Block 2 → CMLL（深度上限按审计 F12 放宽余量：block2 14→16） */
function solvePrefix(T: RouxTables, state0: State): { stages: SolveStage[]; state: State } {
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

  mv = runItem(T.block2, 16, 8e6);
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

  return { stages, state: st };
}

/** 高级桥式（roux-adv）：Block 1 → Block 2 → CMLL → EOLR 一步（EO + UL/UR 伪位）→ 6E2C。 */
export function solve(state0: State): { stages: SolveStage[]; state: State } {
  const T = prepare();
  const { stages, state: stCmll } = solvePrefix(T, state0);

  // 基准路线（4a EO + 6E2C，与 roux-merge 同构），用于兜底与防变长比较
  const eoRaw = T.eo.solve(T.eo.read(stCmll), 14, 4e6);
  if (!eoRaw) throw new Error("LSE edge orientation failed");
  const eoMoves = tidyAlg(eoRaw);
  const stAfterEo = applyAlg(stCmll, eoMoves);
  const merge4cRaw = T.l4e.solve(T.l4e.read(stAfterEo), 18, 8e6);
  if (!merge4cRaw) throw new Error("LSE last four edges failed");
  const merge4cMoves = tidyAlg(merge4cRaw);
  const mergeTotal = eoMoves.length + merge4cMoves.length;

  // EOLR 候选：3 种伪位（DF/DB、UF/UB、UL/UR）+ cuberoot 命名表命中，择总步数最短
  type EolrCand = { eolrMoves: string[]; l4eMoves: string[]; state: State; tag: string };
  let best: EolrCand | null = null;
  const consider = (eolrMoves: string[], tag: string): void => {
    const stMid = applyAlg(stCmll, eolrMoves);
    if (!lseEoDone(stMid)) return;
    const restRaw = T.l4e.solve(T.l4e.read(stMid), 18, 8e6);
    if (!restRaw) return;
    const l4eMoves = tidyAlg(restRaw);
    const total = eolrMoves.length + l4eMoves.length;
    if (!best || total < best.eolrMoves.length + best.l4eMoves.length) {
      best = { eolrMoves, l4eMoves, state: applyAlg(stMid, l4eMoves), tag };
    }
  };

  // ① cuberoot 经典命名 case 优先检查（同长时保留人类 case 名）
  const { fp, um } = eolrFingerprint(stCmll);
  const namedHit = T.eolr.get(fp);
  if (namedHit) {
    const seq = tidyAlg([...(um ? parseAlg(U_MOVES[um]) : []), ...namedHit.moves]);
    consider(seq, namedHit.name);
  }

  // ② 三张 <M,U> EOLR 求解器（100% 覆盖任意后 CMLL 态）
  const solvers: Array<[ItemSolver, string]> = [
    [T.eolrDb, "DF/DB"],
    [T.eolrUb, "UF/UB"],
    [T.eolrPseudo, "UL/UR"],
  ];
  for (const [solver, tag] of solvers) {
    const mv = solver.solve(solver.read(stCmll), 16, 6e6);
    if (mv) consider(tidyAlg(mv), tag);
  }

  if (best && (best as EolrCand).eolrMoves.length + (best as EolrCand).l4eMoves.length <= mergeTotal) {
    const picked = best as EolrCand;
    stages.push({
      key: "lse-eolr", label: "棱定向 + UL/UR (EOLR)", short: "EOLR",
      moves: picked.eolrMoves, algs: [picked.tag],
    });
    stages.push({
      key: "lse-l4e", label: "最后六棱二中心 (6E2C)", short: "6E2C",
      moves: picked.l4eMoves,
    });
    return { stages, state: picked.state };
  }

  // 极少数纯 4a EO + 6E2C 严格更短的情形：回退不吃亏
  stages.push({ key: "lse-eo", label: "棱定向 EO (4a)", short: "4a EO", moves: eoMoves });
  stages.push({ key: "lse-l4e", label: "最后六棱二中心 (6E2C)", short: "6E2C", moves: merge4cMoves });
  return { stages, state: applyAlg(stAfterEo, merge4cMoves) };
}

/** 普通桥式：1-look CMLL（标准、复用）+ 基础 LSE 分步（4a 棱定向 → 4b UL/UR 归位 →
 *  4c M 层四棱归位）。与高级（EOLR 一步 + 6E2C）区分：普通不用 EOLR、LSE 逐步演示。 */
export function solveBasic(state0: State): { stages: SolveStage[]; state: State } {
  const T = prepare();
  const { stages, state: st0 } = solvePrefix(T, state0);
  let st = st0;
  const runItem = (solver: ItemSolver, maxDepth: number, budget: number): string[] | null => {
    const mv = solver.solve(solver.read(st), maxDepth, budget);
    if (!mv) return null;
    st = applyAlg(st, mv);
    return tidyAlg(mv);
  };

  let mv = runItem(T.eo, 14, 4e6);
  if (!mv) throw new Error("LSE edge orientation failed");
  stages.push({ key: "lse-eo", label: "棱定向 EO (4a)", short: "4a EO", moves: mv });
  mv = runItem(T.ulur, 14, 5e6);
  if (!mv) throw new Error("LSE UL/UR placement failed");
  stages.push({ key: "lse-ulur", label: "UL/UR 归位 (4b)", short: "4b ULUR", moves: mv });
  mv = runItem(T.l4e, 16, 6e6);
  if (!mv) throw new Error("LSE last four edges failed");
  stages.push({ key: "lse-4c", label: "M 层四棱归位 (4c)", short: "4c L4E", moves: mv });

  return { stages, state: st };
}

/** 普通 + 合并 4b+4c：4a 棱定向（分步）→ 4b/4c 合并一步（l4e，UL/UR 伪位并入）。
 *  Roux 选项「合并 4b+4c」（默认勾选，调研实测净省 ~2.46 步、0 例变长）走此路径。 */
export function solveMerge4c(state0: State): { stages: SolveStage[]; state: State } {
  const T = prepare();
  const { stages, state: st0 } = solvePrefix(T, state0);
  let st = st0;
  const runItem = (solver: ItemSolver, maxDepth: number, budget: number): string[] | null => {
    const mv = solver.solve(solver.read(st), maxDepth, budget);
    if (!mv) return null;
    st = applyAlg(st, mv);
    return tidyAlg(mv);
  };

  let mv = runItem(T.eo, 14, 4e6);
  if (!mv) throw new Error("LSE edge orientation failed");
  stages.push({ key: "lse-eo", label: "棱定向 EO (4a)", short: "4a EO", moves: mv });

  mv = runItem(T.l4e, 16, 6e6);
  if (!mv) throw new Error("LSE last four edges failed");
  stages.push({ key: "lse-4c", label: "合并 4b+4c（UL/UR+L4E 一步）", short: "4b+4c", moves: mv });

  return { stages, state: st };
}

export const ROUX = { prepare, solve, solveBasic, solveMerge4c, LEFT_NAMES, RIGHT_NAMES };
