/**
 * zbls.ts — ZBLS 一步：最后一组 F2L + 顶层十字 EO（CFOP 高级 solveAdvanced 用）。
 *
 * 数据：cuberoot 305 条 ZBLS case，每条 4 组槽位方向候选（组 0 = FR 槽公式）。
 * 坐标：状态 = 「3 组 F2L 完成 + 1 组缺 + LL 任意」。
 *   normalize(state) = 缺槽（中层棱判定，4 棱全 home 或缺 >1 槽 → 无效码 -1）
 *   → 槽位 y 归一到 FR → LL 坐标（角置换×朝向×棱置换×翻色）AUF U 归一的取小。
 * 表：候选逆施加到已解 = 该候选的 setup 态 → normalize 码 → 候选列表（查表，含组内 alts）。
 * 求解：state 归一码查表 → 候选；构造 moves = y^n + U^um + 候选 + U'^um + y'^n，
 *   施加后验证（F2L solved && LL 棱定向）→ 通过即返回；无匹配/验证失败 → null（回退传统 F2L+OLL）。
 * 注：整转 x/y 前置候选逆会产生中心漂移态 → normalize 判 -1 → 自动排除（主候选已覆盖）。
 */
import { applyAlg, cubieSolved, normalizeOrientation, parseAlg, solvedState, CUBIES } from "./engine";
import type { State } from "./engine";
import { llCornerPerm, llCornerTwists, llEdgeFlips, llEdgePerm, permIndex } from "./algs";
import cuberootJson from "../../../data/samples/cuberoot-algs.json";

const SLOT_EDGE_POS: Array<[string, [number, number, number]]> = [
  ["FR", [1, 0, 1]],
  ["FL", [-1, 0, 1]],
  ["BL", [-1, 0, -1]],
  ["BR", [1, 0, -1]],
];
// 缺槽 → 槽位归一到 FR 的 y 整转次数（engine.rot(v,1,1): FR→FL→BL→BR→FR，故 BR→FR 需 1 次 y）
const Y_TO_FR: Record<string, number> = { FR: 0, FL: 3, BL: 2, BR: 1 };
const Y_MOVES = ["", "y", "y2", "y'"];
const U_MOVES = ["", "U", "U2", "U'"];

const base3 = (v: number[]): number => v[0] + 3 * v[1] + 9 * v[2] + 27 * v[3];
const base2 = (v: number[]): number => v[0] + 2 * v[1] + 4 * v[2] + 8 * v[3];

/** LL 完整坐标：角置换 × 角朝向 × 棱置换 × 棱翻色（U 层 8 块任意状态） */
const llCode = (state: State): number =>
  permIndex(llCornerPerm(state)) * 81 * 24 * 16 +
  base3(llCornerTwists(state)) * 24 * 16 +
  permIndex(llEdgePerm(state)) * 16 +
  base2(llEdgeFlips(state));

function nonLLSolved(s: State): boolean {
  for (const c of CUBIES) {
    const isLL = c.pos[1] === 1 && c.type !== "center";
    if (!isLL && !cubieSolved(s, c.pos)) return false;
  }
  return true;
}

function missingSlot(state: State): string | null {
  let missing: string | null = null;
  for (const [name, p] of SLOT_EDGE_POS) {
    if (!cubieSolved(state, p)) {
      if (missing && missing !== name) return null; // 缺 >1 槽 → 非 ZBLS 态
      missing = name;
    }
  }
  return missing; // null = 4 棱全 home → 非 ZBLS 态
}

/**
 * 槽位归一（y）→ FR + AUF 归一（U）的 LL 码；非 ZBLS 态返回 -1。
 * 先做整转归位（cuberoot ZBLS 公式含整转残差：setup+公式 闭环 up to 整转，gen 校验用
 * normalizeOrientation 吸收；表与求解必须同口径），再按缺槽 y 归一到 FR。
 * 注意：y 整转会把 home 棱带走，旋转后不可再按位置判缺槽——缺槽必须由调用方预先判定（miss 参数）。
 */
function normalize(state: State, miss?: string | null): number {
  let s = state;
  try {
    const norm = normalizeOrientation(state);
    if (norm) s = norm.state;
  } catch { /* 保持原状态 */ }
  const m = miss !== undefined ? miss : missingSlot(s);
  if (!m) return -1;
  const yn = Y_TO_FR[m];
  let st = s;
  if (yn) st = applyAlg(st, parseAlg(Y_MOVES[yn]));
  let best = llCode(st);
  for (let um = 1; um < 4; um++) best = Math.min(best, llCode(applyAlg(st, parseAlg(U_MOVES[um]))));
  return best;
}

const RAW = (cuberootJson as {
  sets: { zbls: { cases: Array<{ name: string; subgroup: string | null; setup: string | null; algs: string[][] }> } };
}).sets.zbls;

export type ZBLSTables = {
  table: Map<number, Array<{ moves: string[]; name: string }>>;
  ms: number;
  genCount: number;
};

let TABLES: ZBLSTables | null = null;
export function prepare(): ZBLSTables {
  if (TABLES) return TABLES;
  const t0 = Date.now();
  const table = new Map<number, Array<{ moves: string[]; name: string }>>();
  let genCount = 0;
  for (const c of RAW.cases) {
    // 建表键 = setup 态码（cuberoot 语义：候选解「setup 态 → F2L solved + LL EO」，
    // 非「→ solved」——所以不能用候选逆态作键）。组内全部候选挂同一码，求解时逐个验证。
    let setupMoves: string[];
    try { setupMoves = parseAlg(c.setup ?? ""); } catch { continue; }
    if (!setupMoves.length) continue;
    let st: State;
    try { st = applyAlg(solvedState(), setupMoves); } catch { continue; }
    const code = normalize(st);
    if (code < 0) continue; // setup 态非 ZBLS 态（如 D 类 4 棱 home）→ 该 case 不可用
    let list = table.get(code);
    if (!list) table.set(code, (list = []));
    for (const group of c.algs) {
      for (const alg of group) {
        let moves: string[];
        try { moves = parseAlg(alg); } catch { continue; }
        if (!moves.length) continue;
        // 去重（同 case 同公式）
        const key = moves.join(" ");
        if (!list.some((e) => e.moves.join(" ") === key)) list.push({ moves, name: c.name });
        genCount++;
      }
    }
  }
  TABLES = { table, ms: Date.now() - t0, genCount };
  return TABLES;
}

export type ZBLStage = {
  key: "zbls";
  label: string;
  short: string;
  moves: string[];
  algs: string[];
};

/** 对「3 组 F2L 完成 + 1 组缺」的状态做 ZBLS 一步；无匹配/验证失败返回 null（调用方回退）。 */
export function solveZbls(state0: State): ZBLStage | null {
  const T = prepare();
  const miss = missingSlot(state0);
  if (!miss) return null;
  const yn = Y_TO_FR[miss];
  const code = normalize(state0, miss); // 与建表同口径（归位 + 槽归一 + AUF 归一）
  const cands = T.table.get(code);
  if (!cands || !cands.length) return null;
  for (const cand of cands) {
    for (let um = 0; um < 4; um++) {
      const pre: string[] = [];
      if (yn) pre.push(Y_MOVES[yn]);
      if (um) pre.push(U_MOVES[um]);
      const post: string[] = [];
      if (um) post.push(U_MOVES[(4 - um) % 4]);
      if (yn) post.push(Y_MOVES[(4 - yn) % 4]);
      const moves = [...pre, ...cand.moves, ...post];
      const st = applyAlg(state0, moves);
      // 候选可能含整转残差（cuberoot 数据特性）——归位后验证
      let stv = st;
      try {
        const norm = normalizeOrientation(st);
        if (norm) stv = norm.state;
      } catch { /* 保持原状态 */ }
      if (nonLLSolved(stv) && llEdgeFlips(stv).every((f) => !f)) {
        return { key: "zbls", label: "最后一组 F2L + 顶层十字 (ZBLS)", short: "ZBLS", moves, algs: [cand.name] };
      }
    }
  }
  return null;
}

export const ZBLS = { prepare, solveZbls, normalize, llCode };
