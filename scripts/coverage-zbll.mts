/**
 * coverage-zbll.mts — ZBLL 覆盖率核算（算法级口径，内联坐标函数，仅依赖自包含 engine.ts）。
 * 口径：AUF 轨道 = LL 状态 up to U 旋转（1944 总）。每个 case 的 setup 态 = 1 轨道代表元。
 * 变体：base / mirror(M2: R↔L' L↔R' F↔F' B↔B' U↔U' D↔D'，r↔l' M↔M') / inverse / mirror-inverse。
 * coverage = 4 变体闭包去重轨道 / 1944。
 */
import { readFileSync } from "node:fs";
import { applyAlg, invertAlg, parseAlg, readCorner, readEdge, solvedState, stickerIndex, CORNER_POS, normalsOf } from "../src/cube/solver/engine.ts";

// ---- 内联 algs.ts 坐标（避免无扩展名 import 链）----
const LL_CORNERS = ["UFR", "URB", "UBL", "ULF"];
const LL_EDGES = ["UF", "UR", "UB", "UL"];
function orderedCornerNormals(p: [number, number, number]): [number, number, number][] {
  const ns = normalsOf(p);
  return p[0] * p[1] * p[2] === 1 ? ns : [ns[0], ns[2], ns[1]];
}
const CORNER_ORDER = CORNER_POS.map(orderedCornerNormals);
const CORNER_YIDX = CORNER_ORDER.map((ns) => ns.findIndex((n) => n[1] !== 0));
function cornerTwistAt(state: Uint8Array, slot: number): number {
  const p = CORNER_POS[slot], ns = CORNER_ORDER[slot];
  for (let i = 0; i < 3; i++) {
    const c = state[stickerIndex(p, ns[i])];
    if (c === 0 || c === 3) return (i - CORNER_YIDX[slot] + 3) % 3;
  }
  return 0;
}
function permIndex(perm: number[]): number {
  let idx = 0;
  for (let i = 0; i < perm.length; i++) {
    let smaller = 0;
    for (let j = i + 1; j < perm.length; j++) if (perm[j] < perm[i]) smaller++;
    idx = idx * (perm.length - i) + smaller;
  }
  return idx;
}
function llCornerPerm(state: Uint8Array): number[] {
  const perm = [0, 0, 0, 0];
  for (let p = 0; p < 4; p++) perm[(readCorner(state, LL_CORNERS[p]) / 3) | 0] = p;
  return perm;
}
function llEdgePerm(state: Uint8Array): number[] {
  const perm = [0, 0, 0, 0];
  for (let p = 0; p < 4; p++) perm[readEdge(state, LL_EDGES[p]) >> 1] = p;
  return perm;
}
const llCornerTwists = (state: Uint8Array): number[] => [0, 1, 2, 3].map((s) => cornerTwistAt(state, s));
const base3 = (v: number[]): number => v[0] + 3 * v[1] + 9 * v[2] + 27 * v[3];
const llCode = (state: Uint8Array): number =>
  permIndex(llCornerPerm(state)) * 81 * 24 + base3(llCornerTwists(state)) * 24 + permIndex(llEdgePerm(state));

// ---- 核算 ----
const j = JSON.parse(readFileSync("data/samples/cuberoot-algs.json", "utf8"));
const zbll = j.sets.zbll.cases as Array<{ name: string; setup: string; alg: string }>;

const U = ["", "U", "U2", "U'"];
function orbitCode(state: Uint8Array): number {
  let best = Infinity;
  for (const u of U) best = Math.min(best, llCode(applyAlg(state, parseAlg(u))));
  return best;
}

// M2 左右镜像（算法级 move 替换）
const MIRROR: Record<string, string> = {
  R: "L'", "R'": "L", R2: "L2", "R2'": "L2'",
  L: "R'", "L'": "R", L2: "R2", "L2'": "R2'",
  F: "F'", "F'": "F", F2: "F2", "F2'": "F2'",
  B: "B'", "B'": "B", B2: "B2", "B2'": "B2'",
  U: "U'", "U'": "U", U2: "U2", "U2'": "U2'",
  D: "D'", "D'": "D", D2: "D2", "D2'": "D2'",
  r: "l'", "r'": "l", r2: "l2", "r2'": "l2'",
  l: "r'", "l'": "r", l2: "r2", "l2'": "r2'",
  M: "M'", "M'": "M", M2: "M2", "M2'": "M2'",
  E: "E'", "E'": "E", E2: "E2",
  S: "S'", "S'": "S", S2: "S2",
  u: "d'", "d'": "u", u2: "d2", "u2'": "d2'",
  d: "u'", "u'": "d", d2: "u2", "d2'": "u2'",
  f: "f'", "f'": "f", f2: "f2", b: "b'", "b'": "b", b2: "b2",
  x: "x'", "x'": "x", x2: "x2", y: "y'", "y'": "y", y2: "y2", z: "z'", "z'": "z", z2: "z2",
};
function mirrorAlg(moves: string[]): string[] {
  return moves.map((m) => MIRROR[m] ?? m);
}

const orbits = new Set<number>();
const baseOnly = new Set<number>();
let parseFail = 0;

for (const c of zbll) {
  let moves: string[];
  try { moves = parseAlg(c.setup); } catch { parseFail++; continue; }
  if (!moves.length) { parseFail++; continue; }
  const st = applyAlg(solvedState(), moves);
  baseOnly.add(orbitCode(st));
  for (const mv of [moves, mirrorAlg(moves), invertAlg(moves), mirrorAlg(invertAlg(moves))]) {
    try { orbits.add(orbitCode(applyAlg(solvedState(), mv))); } catch { /* ignore */ }
  }
}

const TOTAL = 1944;
console.log(`cases: ${zbll.length} | parseFail: ${parseFail}`);
console.log(`base-only: ${baseOnly.size} (${((100 * baseOnly.size) / TOTAL).toFixed(1)}%)`);
console.log(`4-variant closure: ${orbits.size} / ${TOTAL} = ${((100 * orbits.size) / TOTAL).toFixed(1)}%`);
