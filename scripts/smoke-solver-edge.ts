// 边界用例：已解状态 + 含 M/E/S 打乱（中心漂移映射回真实魔方）。
import { solve, type SolveMethodKey } from "../src/cube/solver/index.ts";
import { applyAlg, isSolved, isUniform, MOVES, solvedState } from "../src/cube/solver/index.ts";
import { finishRotBetween } from "../src/cube/solver/solve.ts";

const ALL_METHODS: SolveMethodKey[] = ["cfop", "cfop-adv", "roux", "roux-merge", "roux-adv"];

let ok = true;
const check = (name: string, state: Uint8Array, method: SolveMethodKey) => {
  const res = solve(state, method);
  const end = applyAlg(state, res.moves);
  const pass = isUniform(end) && res.moves.every((m) => MOVES[m] !== undefined);
  console.log(`${name} [${method}]: ${res.moves.length} moves uniform=${isUniform(end)} solved=${isSolved(end)} rotated=${res.rotated} ${pass ? "OK" : "FAIL"}`);
  if (!pass) ok = false;
};

// 1. 已解
for (const m of ALL_METHODS) check("solved", solvedState(), m);

// 2. 纯 slice 打乱（中心漂移）
for (const alg of ["M2", "M' U2 M U2", "M2 S2 E2", "M' E' M E", "z M2 U M2 U' M2"]) {
  const st = applyAlg(solvedState(), alg);
  for (const m of ALL_METHODS) check(`slice "${alg}"`, st, m);
}

// 3. 混合 face + slice
for (const alg of ["R U M2 U2 M2 U M2 R'", "F M U M' U' F'", "y M2 U M2 U2 M2 U M2"]) {
  const st = applyAlg(solvedState(), alg);
  for (const m of ALL_METHODS) check(`mixed "${alg}"`, st, m);
}

// 4. 整块旋转表覆盖：24 种整块朝向必须两两可达（回归 2026-10-27 的 P0-5）
//    —— WHOLE_ROT24 误用 z（绕 F 轴）当 D 轴自转，24 个条目只覆盖 16 种朝向，
//    endAlg 会返回 ""，演示收尾底色错。此处断言「任意朝向都能整块旋转回标准 solved」。
{
  const centers = (s: Uint8Array): string => {
    const o: string[] = [];
    for (let f = 0; f < 6; f++) o.push(String(s[f * 9 + 4]));
    return o.join(",");
  };
  const rots: string[] = [];
  for (const a of ["", "x", "x2", "x'"]) for (const b of ["", "y", "y2", "y'"]) for (const c of ["", "z", "z2", "z'"]) {
    const s = [a, b, c].filter(Boolean).join(" ");
    if (s) rots.push(s);
  }
  const target = solvedState();
  const tc = centers(target);
  const orientations = [...new Set(rots.map((r) => centers(applyAlg(solvedState(), r))))];
  let unreachable = 0;
  for (const o of orientations) {
    const src = rots.find((r) => centers(applyAlg(solvedState(), r)) === o)!;
    const from = applyAlg(solvedState(), src);
    const g = finishRotBetween(from, target);
    // "" 只在「本就到位」时合法；否则必须给出一个能转到目标的整块旋转
    const good = g === "" ? centers(from) === tc : centers(applyAlg(from, g)) === tc;
    if (!good) {
      unreachable++;
      if (unreachable <= 3) console.log(`  不可达朝向 ${o} (src="${src}")`);
    }
  }
  const pass = unreachable === 0 && orientations.length === 24;
  console.log(`整块旋转覆盖：${orientations.length} 种朝向，不可达 ${unreachable} ${pass ? "OK" : "FAIL"}`);
  if (!pass) ok = false;
}

if (!ok) process.exit(1);
console.log("edge cases OK");