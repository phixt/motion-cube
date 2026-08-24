/**
 * algs.ts — 顶层坐标 + 经核验的公式库 + 图搜索（移植自 rubik-cube.html algs.js）。
 *
 * 公式库不做盲信：每条算法都在已解魔方上执行并按 code 分类（pureLL / rouxSafe）。
 * 不符合类别的算法被丢弃——错误序列只会让库变小，绝不可能污染解法。
 * 阶段解 = 在"整条算法为边"的坐标图上 BFS（algGraph）；代表元是真实魔方状态，
 * 因此转移不可能出错，解序列天然正确。
 */
import { applyAlg, cubieSolved, cubieSolvedAt, invertAlg, parseAlg, readCorner, readEdge, solvedState, stickerIndex, CORNER_POS, EDGE_POS, normalsOf, CUBIES, MOVES } from "./engine.ts";
import type { State } from "./engine.ts";
import { ALG_RAW } from "./algsRaw.ts";

export const LL_CORNERS = ["UFR", "URB", "UBL", "ULF"];
export const LL_EDGES = ["UF", "UR", "UB", "UL"];
export const ROUX_BLOCKS = ["DLB", "DL", "DLF", "LB", "L", "LF", "DRB", "DR", "DRF", "RB", "R", "RF"];

// ------------------------------------------------------------ coordinates --
/** 角槽位法线按外对角线逆时针排列 */
function orderedCornerNormals(p: [number, number, number]): [number, number, number][] {
  const ns = normalsOf(p);
  return p[0] * p[1] * p[2] === 1 ? ns : [ns[0], ns[2], ns[1]];
}

const CORNER_ORDER = CORNER_POS.map(orderedCornerNormals);
const CORNER_YIDX = CORNER_ORDER.map((ns) => ns.findIndex((n) => n[1] !== 0));

/** 0 = U/D 贴纸朝上下，否则为 1 或 2 转开（手性一致） */
export function cornerTwistAt(state: State, slot: number): number {
  const p = CORNER_POS[slot], ns = CORNER_ORDER[slot];
  for (let i = 0; i < 3; i++) {
    const c = state[stickerIndex(p, ns[i])];
    if (c === 0 || c === 3) return (i - CORNER_YIDX[slot] + 3) % 3;
  }
  return 0;
}
/** 0 = U/D 贴纸在 y 法线上 */
export function edgeFlipAt(state: State, slot: number): number {
  const p = EDGE_POS[slot], ns = normalsOf(p);
  const yn = ns.find((n) => n[1] !== 0);
  if (!yn) return 0;
  const c = state[stickerIndex(p, yn)];
  return (c === 0 || c === 3) ? 0 : 1;
}

const PERM_INDEX = (() => {
  const cache = new Map<string, number>();
  return (perm: number[]): number => {
    const k = perm.join(",");
    const hit = cache.get(k);
    if (hit !== undefined) return hit;
    let idx = 0;
    for (let i = 0; i < perm.length; i++) {
      let smaller = 0;
      for (let j = i + 1; j < perm.length; j++) if (perm[j] < perm[i]) smaller++;
      idx = idx * (perm.length - i) + smaller;
    }
    cache.set(k, idx);
    return idx;
  };
})();
export const permIndex = PERM_INDEX;

/** slot -> 哪个 LL 块坐在那里 (0..3) */
export function llCornerPerm(state: State): number[] {
  const perm = [0, 0, 0, 0];
  for (let p = 0; p < 4; p++) perm[(readCorner(state, LL_CORNERS[p]) / 3) | 0] = p;
  return perm;
}
export function llEdgePerm(state: State): number[] {
  const perm = [0, 0, 0, 0];
  for (let p = 0; p < 4; p++) perm[readEdge(state, LL_EDGES[p]) >> 1] = p;
  return perm;
}
export const llCornerTwists = (state: State): number[] => [0, 1, 2, 3].map((s) => cornerTwistAt(state, s));
export const llEdgeFlips = (state: State): number[] => [0, 1, 2, 3].map((s) => edgeFlipAt(state, s));

const base3 = (v: number[]): number => v[0] + 3 * v[1] + 9 * v[2] + 27 * v[3];
const base2 = (v: number[]): number => v[0] + 2 * v[1] + 4 * v[2] + 8 * v[3];

export const ollCode = (state: State): number => base3(llCornerTwists(state)) * 16 + base2(llEdgeFlips(state));
export const pllCode = (state: State): number => PERM_INDEX(llCornerPerm(state)) * 24 + PERM_INDEX(llEdgePerm(state));
export const cmllCode = (state: State): number => PERM_INDEX(llCornerPerm(state)) * 81 + base3(llCornerTwists(state));

// ------------------------------------------------------- classification ----
export type AlgInfo = {
  moves: string[];
  state: State;
  pureLL: boolean;
  rouxSafe: boolean;
  orientationNeutral: boolean;
  length: number;
};
export function analyzeAlg(alg: string | string[]): AlgInfo {
  const moves = parseAlg(alg);
  const st = applyAlg(solvedState(), moves);
  const cornersInU = LL_CORNERS.every((n) => ((readCorner(st, n) / 3) | 0) < 4);
  const edgesInU = LL_EDGES.every((n) => (readEdge(st, n) >> 1) < 4);
  let restSolved = true;
  for (const c of CUBIES) {
    const isLL = c.pos[1] === 1 && c.type !== "center";
    if (!isLL && !cubieSolvedAt(st, c.pos)) { restSolved = false; break; }
  }
  const pureLL = restSolved && cornersInU && edgesInU;
  const rouxSafe = cornersInU && ROUX_BLOCKS.every((n) => cubieSolved(st, n));
  const orientationNeutral = ollCode(st) === ollCode(solvedState());
  return { moves, state: st, pureLL, rouxSafe, orientationNeutral, length: moves.length };
}

// ----------------------------------------------------------- the library --
export type LibEntry = {
  name: string;
  moves: string[];
  invName: string;
  invMoves: string[];
  pureLL: boolean;
  rouxSafe: boolean;
  orientationNeutral: boolean;
  length: number;
  isAUF?: boolean;
};

const AUF: Array<[string, string]> = [["U", "U"], ["U'", "U'"], ["U2", "U2"]];

export const ALG_LIBRARY: LibEntry[] = [];
export const ALG_REJECTED: Array<{ name: string; reason: string }> = [];
for (const [name, alg] of ALG_RAW) {
  let info: AlgInfo;
  try { info = analyzeAlg(alg); } catch (e) { ALG_REJECTED.push({ name, reason: String((e && (e as Error).message) || e) }); continue; }
  if (!info.pureLL && !info.rouxSafe) { ALG_REJECTED.push({ name, reason: "not a last-layer / block-safe algorithm" }); continue; }
  const invMoves = invertAlg(info.moves);
  ALG_LIBRARY.push({
    name, moves: info.moves, invName: name + " (inv)", invMoves,
    pureLL: info.pureLL, rouxSafe: info.rouxSafe, orientationNeutral: info.orientationNeutral, length: info.length,
  });
}
for (const [name, alg] of AUF) {
  const info = analyzeAlg(alg);
  const inv = invertAlg(info.moves);
  ALG_LIBRARY.push({
    name, moves: info.moves, invName: inv.join(" "), invMoves: inv,
    pureLL: info.pureLL, rouxSafe: info.rouxSafe, orientationNeutral: info.orientationNeutral, length: 1, isAUF: true,
  });
}

export type GraphStep = { name: string; moves: string[]; inverted: boolean };
export type Graph = {
  size: number;
  has: (state: State) => boolean;
  cost: (state: State) => number;
  dist: (state: State) => number;
  solve: (state: State) => GraphStep[] | null;
};

/**
 * 以"整条算法为边、四分之一转为权"在抽象坐标上跑 Dijkstra。
 * @returns { size, has, cost, dist, solve(state)->steps|null }
 */
export function algGraph(codeOf: (state: State) => number, gens: LibEntry[]): Graph {
  const cost = gens.map((g) => g.moves.filter((m) => !MOVES[m].isWholeCube).length || 1);
  const solved = solvedState();
  const start = codeOf(solved);
  const map = new Map<number, { state: State; prev: number; gen: number; c: number; done: boolean }>();
  map.set(start, { state: solved, prev: -1, gen: -1, c: 0, done: false });
  const buckets: (number[] | null)[] = [[start]];
  for (let c = 0; c < buckets.length; c++) {
    const bucket = buckets[c];
    if (!bucket) continue;
    for (let bi = 0; bi < bucket.length; bi++) {
      const key = bucket[bi], cur = map.get(key);
      if (!cur || cur.done || cur.c !== c) continue;
      cur.done = true;
      for (let gi = 0; gi < gens.length; gi++) {
        const st = applyAlg(cur.state, gens[gi].moves);
        const code = codeOf(st);
        const nc = c + cost[gi];
        const old = map.get(code);
        if (old && old.c <= nc) continue;
        map.set(code, { state: st, prev: key, gen: gi, c: nc, done: false });
        while (buckets.length <= nc) buckets.push(null);
        (buckets[nc] || (buckets[nc] = [])).push(code);
      }
    }
  }
  return {
    size: map.size,
    has: (state) => map.has(codeOf(state)),
    cost: (state) => { const n = map.get(codeOf(state)); return n ? n.c : -1; },
    dist: (state) => { const n = map.get(codeOf(state)); return n ? n.c : -1; },
    solve(state) {
      let node = map.get(codeOf(state));
      if (!node) return null;
      const out: GraphStep[] = [];
      let guard = 0;
      while (node.gen >= 0 && guard++ < 64) {
        const g = gens[node.gen];
        out.push({ name: g.name, moves: g.invMoves, inverted: true });
        node = map.get(node.prev)!;
      }
      return out;
    },
  };
}