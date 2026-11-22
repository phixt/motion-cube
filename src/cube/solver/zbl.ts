/**
 * zbl.ts — ZBLL 一步还原（CFOP 高级）。
 *
 * 思路：不按 OLL→PLL 两段走，而是先确保 4 条 LL 棱已定向（ZBLS 已完成时 0 步跳过；
 * 否则先做棱定向预置），再一步 ZBLL 还原整个顶层。
 *   - 棱定向预置：在 4 棱置换×翻色坐标上 BFS，边 = 经核验的纯 LL 公式。
 *   - ZBLL：以 cuberoot 472 条 ZBLL + 21 条 PLL（含内置 PLL）为源，经 post-AUF × y 共轭
 *     展开成零中心漂移面步表——精确覆盖全部 7776 个合法「棱已定向」LL 态（24×27×12），
 *     运行时一步查表 100% 命中（O(1) + 4 种 pre-AUF 取最短）。
 */
import {
  applyAlg, cubieSolved, invertAlg, normalizeOrientation, parseAlg, rotMatrix, solvedState,
  stripWholeRotations, tidyAlg, toFaceMovesOnly, transformMove, viewState, CUBIES,
} from "./engine.ts";
import type { State } from "./engine.ts";
import { ALG_LIBRARY, algGraph, llCornerPerm, llCornerTwists, llEdgeFlips, llEdgePerm, permIndex } from "./algs.ts";
import cuberootJson from "../../../data/samples/cuberoot-algs.json" with { type: "json" };

const base3 = (v: number[]): number => v[0] + 3 * v[1] + 9 * v[2] + 27 * v[3];
const base2 = (v: number[]): number => v[0] + 2 * v[1] + 4 * v[2] + 8 * v[3];

/** ZBLL 坐标：角置换 × 角朝向 × 棱置换（棱已定向，仅置换） */
export const zblCode = (state: State): number =>
  permIndex(llCornerPerm(state)) * 81 * 24 + base3(llCornerTwists(state)) * 24 + permIndex(llEdgePerm(state));

/** 棱定向预置坐标：棱置换 × 翻色。必须含置换，否则代表元回退路径不适用于任意同翻色态 */
const eoCode = (state: State): number => permIndex(llEdgePerm(state)) * 16 + base2(llEdgeFlips(state));

type RawCase = { name: string; alg: string; alts?: string[]; variants?: string[] };
const RAW_SETS = (cuberootJson as { sets: { zbll: { cases: RawCase[] }; pll: { cases: RawCase[] } } }).sets;

const U_MOVES = ["", "U", "U2", "U'"];
const Y_MOVES = ["", "y", "y2", "y'"];
const Y_MATS = Y_MOVES.map((ym) => (ym ? rotMatrix(ym) : null));

function isPureOrientedLL(st: State): boolean {
  for (const c of CUBIES) {
    const isLL = c.pos[1] === 1 && c.type !== "center";
    if (!isLL && !cubieSolved(st, c.pos)) return false;
  }
  return llEdgeFlips(st).every((f) => !f);
}

/** 转为零中心漂移且保留原手感的纯 LL 公式；不合法返回 null */
function normalizeZblMoves(algStr: string): string[] | null {
  let raw: string[];
  try { raw = parseAlg(algStr); } catch { return null; }
  if (!raw.length) return null;
  let moves = stripWholeRotations(raw);
  let st = applyAlg(solvedState(), moves);
  if (normalizeOrientation(st).alg.length > 0) {
    moves = toFaceMovesOnly(raw);
    st = applyAlg(solvedState(), moves);
  }
  if (!moves.length || normalizeOrientation(st).alg.length > 0) return null;
  return isPureOrientedLL(st) ? moves : null;
}

export type ZBLTables = {
  eoPreset: ReturnType<typeof algGraph>;
  /** 一步 ZBLL 查表：zblCode → 最短无漂移公式（含 post-AUF 与 y 共轭展开，全空间 7776 覆盖） */
  zbl: Map<number, { moves: string[]; name: string }>;
  skipped: Array<{ name: string; reason: string }>;
  ms: number;
};

let TABLES: ZBLTables | null = null;
export function prepare(): ZBLTables {
  if (TABLES) return TABLES;
  const t0 = Date.now();
  const pure = ALG_LIBRARY.filter((a) => a.pureLL && !a.isAUF);
  const eoPreset = algGraph(eoCode, pure);

  const zbl = new Map<number, { moves: string[]; name: string }>();
  const skipped: Array<{ name: string; reason: string }> = [];
  const seenBase = new Set<string>();

  const registerMoves = (name: string, moves: string[]): void => {
    const key = moves.join(" ");
    if (seenBase.has(key)) return;
    seenBase.add(key);
    for (let q = 0; q < 4; q++) {
      const mvQ = q ? tidyAlg([...moves, U_MOVES[q]]) : moves;
      const stQ = applyAlg(solvedState(), invertAlg(mvQ));
      for (let yi = 0; yi < 4; yi++) {
        // y^yi 共轭后的解前态 = viewState(stQ, y^yi)，免去重复 14 步 applyAlg
        const stY = yi ? viewState(stQ, Y_MOVES[yi]) : stQ;
        const code = zblCode(stY);
        const old = zbl.get(code);
        if (!old || mvQ.length < old.moves.length) {
          const M = Y_MATS[yi];
          const mvY = M ? mvQ.map((m) => transformMove(m, M)) : mvQ;
          zbl.set(code, { moves: mvY, name });
        }
      }
    }
  };

  // 已还原 / 仅 AUF 态
  registerMoves("AUF", []);

  const addSource = (cases: RawCase[], includeVariants: boolean): void => {
    for (const c of cases) {
      const primary = normalizeZblMoves(c.alg);
      if (primary) registerMoves(c.name, primary);
      else skipped.push({ name: c.name, reason: `invalid primary alg: ${c.alg}` });
      if (includeVariants) {
        for (const v of c.variants ?? []) {
          const mv = normalizeZblMoves(v);
          if (mv) registerMoves(c.name, mv);
        }
      }
      for (const alt of c.alts ?? []) {
        const mv = normalizeZblMoves(alt);
        if (mv) registerMoves(c.name, mv);
      }
    }
  };

  addSource(RAW_SETS.zbll.cases, true);
  addSource(RAW_SETS.pll.cases, false);
  for (const a of ALG_LIBRARY) {
    if (a.pureLL && a.orientationNeutral && !a.isAUF) registerMoves(a.name, a.moves);
  }

  TABLES = { eoPreset, zbl, skipped, ms: Date.now() - t0 };
  return TABLES;
}

export type ZBLStage = {
  key: "zbl-eo" | "zbl";
  label: string;
  short: string;
  moves: string[];
  algs: string[];
  skip?: boolean;
};

/** 对"已完成 F2L"的状态做 EO 预置 + 一步 ZBLL；返回阶段与末态。EO 已定向时跳过预置。 */
export function solveLL(state0: State): { stages: ZBLStage[]; state: State } {
  const T = prepare();
  const stages: ZBLStage[] = [];
  let st = state0;

  const eoPath = llEdgeFlips(st).every((f) => !f) ? null : T.eoPreset.solve(st);
  if (eoPath && eoPath.length) {
    const moves: string[] = [];
    const names: string[] = [];
    for (const step of eoPath) { moves.push(...step.moves); if (!/^U/.test(step.name)) names.push(step.name); }
    st = applyAlg(st, moves);
    stages.push({ key: "zbl-eo", label: "棱定向预置", short: "EO", moves, algs: names });
  }

  // 一步 ZBLL 查表：全空间 7776 覆盖，枚举 4 种 pre-AUF 取合并后最短
  let bestMoves: string[] | null = null;
  let bestName = "";
  for (let um = 0; um < 4; um++) {
    const stU = um ? applyAlg(st, [U_MOVES[um]]) : st;
    const e = T.zbl.get(zblCode(stU));
    if (!e) continue;
    const cand = um ? tidyAlg([U_MOVES[um], ...e.moves]) : e.moves;
    if (!bestMoves || cand.length < bestMoves.length) {
      bestMoves = cand;
      bestName = e.name;
    }
  }
  if (bestMoves) {
    st = applyAlg(st, bestMoves);
    stages.push({ key: "zbl", label: "顶层一步 ZBLL", short: "ZBLL", moves: bestMoves, algs: [bestName] });
  }
  return { stages, state: st };
}

export const ZBL = { prepare, solveLL, zblCode };
