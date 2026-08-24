// 求解器冒烟测试：随机打乱 → CFOP/Roux 求解 → 六面 uniform + 步合法。
// 用法：npx tsx scripts/smoke-solver.ts [iterations] [--seed N]
import { solve, prepareSolvers } from "../src/cube/solver/index.ts";
import { applyAlg, isUniform, MOVES, parseAlg, randomScramble, solvedState, tidyAlg } from "../src/cube/solver/index.ts";

const args = process.argv.slice(2);
const iters = args[0] ? parseInt(args[0], 10) : 3;
const seedIdx = args.indexOf("--seed");
let seed = seedIdx >= 0 ? parseInt(args[seedIdx + 1], 10) : 12345;

function rng(): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

console.log("== solver smoke test ==", { iters, seed });
const t0 = Date.now();
prepareSolvers();
console.log(`prepare: ${Date.now() - t0}ms`);

const failures: string[] = [];
const r = rng();
for (let i = 0; i < iters; i++) {
  const scramble = randomScramble(25, r);
  const state = applyAlg(solvedState(), scramble);
  const scrambleStr = tidyAlg(scramble).join(" ");

  for (const method of ["cfop", "cfop-adv", "roux"] as const) {
    const ts = performance.now();
    let res;
    try { res = solve(state, method); } catch (e) {
      failures.push(`[${i}] ${method}: solve threw: ${(e as Error).message}`);
      continue;
    }
    const ms = Math.round(performance.now() - ts);
    const end = applyAlg(state, res.moves);
    const uniform = isUniform(end);
    const moveOk = res.moves.every((m) => MOVES[m] !== undefined);
    const stageLen = res.stages.map((s) => s.moves.length).join("+");
    console.log(
      `[${i}] ${method}: ${res.moves.length} moves (${stageLen}) ${uniform && moveOk ? "OK" : "FAIL"} ${ms}ms` +
      `  scramble=${scrambleStr}`,
    );
    if (!uniform) failures.push(`[${i}] ${method}: not uniform`);
    if (!moveOk) failures.push(`[${i}] ${method}: invalid move`);
    // 每步序列合法（parseAlg 可重解析）
    try { parseAlg(res.moves.join(" ")); } catch (e) { failures.push(`[${i}] ${method}: unparseable: ${(e as Error).message}`); }
  }
}

if (failures.length) { console.error("FAILURES:\n" + failures.join("\n")); process.exit(1); }
console.log("all OK");