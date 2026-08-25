/**
 * zbl.ts — ZBLL 一步还原（CFOP 高级）。
 *
 * 思路：不按 OLL→PLL 两段走，而是先做"棱定向预置"（把 4 条 LL 棱定向，
 * 不关心角块），再一步 ZBLL 还原整个顶层。
 *   - 棱定向预置：在 2^3=8 个棱翻色坐标上 BFS，边 = 核验过的纯 LL 公式。
 *   - ZBLL：在完整 ZBLL 状态空间（角置换 24 × 角朝向 27 × 棱置换 12 = 7776）
 *     上以 cuberoot 466 条 ZBLL 公式为边 BFS——库完整，故任意"棱已定向"的
 *     顶层态都恰有一条 ZBLL 一步解；找不到即回退 OLL→PLL。
 */
import { applyAlg, invertAlg, parseAlg, solvedState } from "./engine.ts";
import type { State } from "./engine.ts";
import { ALG_LIBRARY, algGraph, analyzeAlg, llCornerPerm, llCornerTwists, llEdgeFlips, llEdgePerm, permIndex } from "./algs.ts";
import type { LibEntry } from "./algs.ts";
import cuberootJson from "../../../data/samples/cuberoot-algs.json" with { type: "json" };

const base3 = (v: number[]): number => v[0] + 3 * v[1] + 9 * v[2] + 27 * v[3];
const base2 = (v: number[]): number => v[0] + 2 * v[1] + 4 * v[2] + 8 * v[3];

/** ZBLL 坐标：角置换 × 角朝向 × 棱置换（棱已定向，仅置换） */
export const zblCode = (state: State): number =>
  permIndex(llCornerPerm(state)) * 81 * 24 + base3(llCornerTwists(state)) * 24 + permIndex(llEdgePerm(state));

/** 棱定向预置坐标：棱置换 × 翻色。必须含置换，否则代表元回退路径不适用于任意同翻色态 */
const eoCode = (state: State): number => permIndex(llEdgePerm(state)) * 16 + base2(llEdgeFlips(state));

const RAW = (cuberootJson as {
  sets: { zbll: { cases: Array<{ name: string; alg: string; variants?: string[] }> } };
}).sets.zbll;

const ZBL_GENS: LibEntry[] = [];
let droppedZBL = 0;
const seenGens = new Set<string>();
for (const c of RAW.cases) {
  const add = (alg: string, suffix: string): void => {
    let moves: string[];
    try { moves = parseAlg(alg); } catch { return; }
    if (!analyzeAlg(alg).pureLL) { droppedZBL++; return; }
    const key = moves.join(" ");
    if (seenGens.has(key)) return; // 去重（变体与主公式/mirror 间等价）
    seenGens.add(key);
    ZBL_GENS.push({
      name: c.name + suffix, moves, invName: c.name + suffix + " (inv)", invMoves: invertAlg(moves),
      pureLL: true, rouxSafe: false, orientationNeutral: false, length: moves.length,
    });
  };
  add(c.alg, "");
  for (const v of c.variants ?? []) add(v, " (variant)");
}

export type ZBLTables = {
  eoPreset: ReturnType<typeof algGraph>;
  /** 一步 ZBLL 查表：轨道码（zblCode，AUF 变体由查询端 4 种 U 旋转遍历）→ 公式 */
  zbl: Map<number, { moves: string[]; name: string }>;
  ms: number;
};

let TABLES: ZBLTables | null = null;
export function prepare(): ZBLTables {
  if (TABLES) return TABLES;
  const t0 = Date.now();
  const pure = ALG_LIBRARY.filter((a) => a.pureLL && !a.isAUF);
  const eoPreset = algGraph(eoCode, pure);
  // 一步 ZBLL 查表：每个公式逆施加到已解 = 该公式解前状态 → 轨道码 → 公式本身。
  // O(gens) 毫秒级（替代全空间 BFS——多步链已禁用，BFS 无意义）。
  const zbl = new Map<number, { moves: string[]; name: string }>();
  for (const g of ZBL_GENS) {
    try {
      const st = applyAlg(solvedState(), g.invMoves);
      const code = zblCode(st);
      const old = zbl.get(code);
      if (!old || old.moves.length > g.moves.length) zbl.set(code, { moves: g.moves, name: g.name });
    } catch { /* 忽略解析失败 */ }
  }
  TABLES = { eoPreset, zbl, ms: Date.now() - t0 };
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

const U_MOVES = ["", "U", "U2", "U'"];

/** 对"已完成 F2L"的状态做 EO 预置 + ZBLL；返回阶段与末态。EO 已定向时跳过预置。 */
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

  // 一步 ZBLL 查表：4 种 AUF 变体码查表（变体库闭包覆盖 ~52% 轨道；未覆盖由调用方回退 OLL+PLL）
  let zblMoves: string[] | null = null;
  let zblName = "";
  for (let um = 0; um < 4 && !zblMoves; um++) {
    const code = zblCode(applyAlg(st, parseAlg(U_MOVES[um])));
    const e = T.zbl.get(code);
    if (e) {
      zblMoves = um ? [U_MOVES[um], ...e.moves] : e.moves;
      zblName = e.name;
    }
  }
  if (zblMoves) {
    st = applyAlg(st, zblMoves);
    stages.push({ key: "zbl", label: "顶层一步 ZBLL", short: "ZBLL", moves: zblMoves, algs: [zblName] });
  }
  return { stages, state: st };
}

export const ZBL = { prepare, solveLL, zblCode };