/**
 * probe-solver-methods.ts — 对比 CFOP 普通 / CFOP 高级(ZBLL) / Roux 步数（随机打乱样本）。
 * 目的：实证「CFOP 高级常比普通多步」是否仍存在；双路线取短修复后应恒 adv ≤ normal。
 * 运行：npx tsx scripts/probe-solver-methods.ts [N]（Windows 侧；WSL 缺 linux esbuild 二进制）
 */
import { CFOP } from "../src/cube/solver/cfop";
import { ROUX } from "../src/cube/solver/roux";
import { applyAlg, solvedState, MOVE_NAMES, MOVES } from "../src/cube/solver/engine";

const FACE_MOVES = MOVE_NAMES.filter((n) => {
  const l = MOVES[n].layers;
  return l.length === 1 && l[0] !== 0;
});
const totalOf = (stages: Array<{ moves: string[] }>): number => stages.reduce((a, s) => a + s.moves.length, 0);

const N = Number(process.argv[2] ?? "20");
let seed = 0x9e3779b9;
const rnd = (): number => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const scramble = (n = 12): string[] => {
  const out: string[] = [];
  let lastFace: string | null = null;
  while (out.length < n) {
    const name = FACE_MOVES[(rnd() * FACE_MOVES.length) | 0];
    const face = name[0];
    if (face === lastFace) continue;
    lastFace = face;
    out.push(name);
  }
  return out;
};

// 预热：表构建一次（后续样本共享缓存）
CFOP.solve(applyAlg(solvedState(), scramble()));
ROUX.solve(applyAlg(solvedState(), scramble()));

const rows: Array<{ n: number; a: number; r: number; rb: number }> = [];
for (let i = 0; i < N; i++) {
  const s = applyAlg(solvedState(), scramble());
  const n0 = totalOf(CFOP.solve(s).stages);
  const a0 = totalOf(CFOP.solveAdvanced(s).stages);
  const r0 = totalOf(ROUX.solve(s).stages);
  const rb0 = totalOf(ROUX.solveBasic(s).stages);
  rows.push({ n: n0, a: a0, r: r0, rb: rb0 });
}
const advMore = rows.filter((x) => x.a > x.n).length;
const avg = (f: (x: { n: number; a: number; r: number; rb: number }) => number): number =>
  rows.reduce((s, x) => s + f(x), 0) / N;

console.log(`样本 ${N}（12 步面打乱）`);
for (let i = 0; i < rows.length; i++) {
  const x = rows[i];
  console.log(
    `#${String(i).padStart(2, "0")} cfop=${String(x.n).padStart(2)} cfopAdv=${String(x.a).padStart(2)} (Δ${x.a - x.n >= 0 ? "+" : ""}${x.a - x.n}) roux=${String(x.r).padStart(2)} rouxBasic=${String(x.rb).padStart(2)}`,
  );
}
console.log(
  `\n高级>普通: ${advMore}/${N}  高级==普通: ${rows.filter((x) => x.a === x.n).length}  高级<普通: ${rows.filter((x) => x.a < x.n).length}`,
);
console.log(
  `均值 — CFOP ${avg((x) => x.n).toFixed(2)} / CFOP高级 ${avg((x) => x.a).toFixed(2)} / Roux ${avg((x) => x.r).toFixed(2)} / Roux普通 ${avg((x) => x.rb).toFixed(2)}`,
);