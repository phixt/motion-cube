// 边界用例：已解状态 + 含 M/E/S 打乱（中心漂移映射回真实魔方）。
import { solve } from "../src/cube/solver";
import { applyAlg, isSolved, isUniform, MOVES, solvedState } from "../src/cube/solver";

let ok = true;
const check = (name: string, state: Uint8Array, method: "cfop" | "roux") => {
  const res = solve(state, method);
  const end = applyAlg(state, res.moves);
  const pass = isUniform(end) && res.moves.every((m) => MOVES[m] !== undefined);
  console.log(`${name} [${method}]: ${res.moves.length} moves uniform=${isUniform(end)} solved=${isSolved(end)} rotated=${res.rotated} ${pass ? "OK" : "FAIL"}`);
  if (!pass) ok = false;
};

// 1. 已解
for (const m of ["cfop", "roux"] as const) check("solved", solvedState(), m);

// 2. 纯 slice 打乱（中心漂移）
for (const alg of ["M2", "M' U2 M U2", "M2 S2 E2", "M' E' M E", "z M2 U M2 U' M2"]) {
  const st = applyAlg(solvedState(), alg);
  for (const m of ["cfop", "roux"] as const) check(`slice "${alg}"`, st, m);
}

// 3. 混合 face + slice
for (const alg of ["R U M2 U2 M2 U M2 R'", "F M U M' U' F'", "y M2 U M2 U2 M2 U M2"]) {
  const st = applyAlg(solvedState(), alg);
  for (const m of ["cfop", "roux"] as const) check(`mixed "${alg}"`, st, m);
}

if (!ok) process.exit(1);
console.log("edge cases OK");