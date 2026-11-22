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

const ALL_METHODS = ["cfop", "cfop-adv", "roux", "roux-merge", "roux-adv"] as const;
const failures: string[] = [];
const r = rng();
let zblsHits = 0, zbllHits = 0, eolrHits = 0, eolrDiffMerge = 0;
for (let i = 0; i < iters; i++) {
  const scramble = randomScramble(25, r);
  const state = applyAlg(solvedState(), scramble);
  const scrambleStr = tidyAlg(scramble).join(" ");

  const results: Record<string, ReturnType<typeof solve>> = {};
  for (const method of ALL_METHODS) {
    const ts = performance.now();
    let res;
    try { res = solve(state, method); } catch (e) {
      failures.push(`[${i}] ${method}: solve threw: ${(e as Error).message}`);
      continue;
    }
    results[method] = res;
    const ms = Math.round(performance.now() - ts);
    const end = applyAlg(state, res.moves);
    const uniform = isUniform(end);
    const moveOk = res.moves.every((m) => MOVES[m] !== undefined);
    const stageLen = res.stages.map((s) => s.moves.length).join("+");
    console.log(
      `[${i}] ${method.padEnd(10)}: ${res.moves.length} moves (${stageLen}) ${uniform && moveOk ? "OK" : "FAIL"} ${ms}ms` +
      `  scramble=${scrambleStr}`,
    );
    if (!uniform) failures.push(`[${i}] ${method}: not uniform`);
    if (!moveOk) failures.push(`[${i}] ${method}: invalid move`);
    // 每步序列合法（parseAlg 可重解析）
    try { parseAlg(res.moves.join(" ")); } catch (e) { failures.push(`[${i}] ${method}: unparseable: ${(e as Error).message}`); }
  }
  if (results["cfop"] && results["cfop-adv"]) {
    if (results["cfop-adv"].moves.length > results["cfop"].moves.length) {
      failures.push(`[${i}] cfop-adv (${results["cfop-adv"].moves.length}) > cfop (${results["cfop"].moves.length})`);
    }
    if (results["cfop-adv"].stages.some((s) => s.key === "zbls")) zblsHits++;
    if (results["cfop-adv"].stages.some((s) => s.key === "zbl")) zbllHits++;
  }
  if (results["roux-merge"] && results["roux-adv"]) {
    if (results["roux-adv"].moves.length > results["roux-merge"].moves.length) {
      failures.push(`[${i}] roux-adv (${results["roux-adv"].moves.length}) > roux-merge (${results["roux-merge"].moves.length})`);
    }
    if (results["roux-adv"].stages.some((s) => s.key === "lse-eolr")) eolrHits++;
    if (results["roux-adv"].moves.join(" ") !== results["roux-merge"].moves.join(" ")) eolrDiffMerge++;
  }
}

console.log(`adv summary (${iters} iters): zbls=${zblsHits}/${iters} zbll=${zbllHits}/${iters} eolr=${eolrHits}/${iters} rouxAdv!=merge=${eolrDiffMerge}/${iters}`);
if (iters >= 10) {
  if (zblsHits === 0) failures.push("cfop-adv never triggered zbls stage");
  if (zbllHits === 0) failures.push("cfop-adv never triggered zbl stage");
  if (eolrHits === 0) failures.push("roux-adv never triggered lse-eolr stage");
  if (eolrDiffMerge === 0) failures.push("roux-adv produced identical moves to roux-merge in all cases");
}

if (failures.length) { console.error("FAILURES:\n" + failures.join("\n")); process.exit(1); }
console.log("all OK");