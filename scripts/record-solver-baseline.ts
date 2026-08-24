/**
 * record-solver-baseline.ts — P0.5 普通解法一致性基线记录（node strip-types 运行：
 *   `node scripts/record-solver-baseline.ts`，勿用 tsx）。
 *
 * 目的：把「普通解法 = 人类式分步」的契约与两代一致性固化为可复现基线。
 *   - roux 普通（solve(state,'roux') = ROUX.solveBasic，对齐旧版 3e30423 逐行语义）：
 *     阶段 = block1 → block2 → cmll → lse-eo(4a) → lse-ulur(4b) → lse-4c(4c)
 *   - cfop 普通（solve(state,'cfop') = CFOP.solve，与旧版 3e30423 逐行一致）：
 *     阶段 = cross → f2l1..4 → oll → pll
 *   - 高级参考列：cfop-adv / roux-adv（不动，仅记录步数供对比）。
 *
 * 断言（任一失败即退出非零）：
 *   1. 每方法重放合法且终态=已解（solve() 内部 isUniform 校验已保证，未过即 throw）；
 *   2. 阶段 key 序列符合人类式分步契约（普通方法）；
 *   3. 步数统计落盘。
 *
 * RNG：固定 LCG（1664525 / 1013904223，与 verify-render-cube 同款）保证可复现。
 */
import { solve as solveCube, randomScramble, prepareSolvers } from "../src/cube/solver/index.ts";
import type { SolveMethodKey } from "../src/cube/solver/index.ts";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0), s / 2 ** 32);
}

const N12 = 60; // 12 步面打乱样本（与 probe-solver-methods 同口径）
const N20 = 10; // 20 步 WCA 口径样本

const rng12 = lcg(0x51a7);

const expectedStages: Record<string, string[]> = {
  cfop: ["cross", "f2l1", "f2l2", "f2l3", "f2l4", "oll", "pll"],
  roux: ["block1", "block2", "cmll", "lse-eo", "lse-ulur", "lse-4c"],
};

interface MethodStat {
  n12: number;
  n20: number;
  fail: number;
  steps12: number[];
  staged12: number;
  stageSeqOk: number;
  sampleMoves: string;
}

const stats: Record<string, MethodStat> = {};

const runMethod = (method: SolveMethodKey, scrambles: string[][]): void => {
  const st = (stats[method] ??= {
    n12: 0, n20: 0, fail: 0, steps12: [], staged12: 0, stageSeqOk: 0, sampleMoves: "",
  });
  for (let i = 0; i < scrambles.length; i++) {
    const alg = scrambles[i];
    const res = solveCubeFromAlg(alg, method);
    if (!res) { st.fail++; continue; }
    (i < N12 ? st.steps12 : []).push(res.moves.length);
    if (i < N12 && res.stages.length > 0) st.staged12++;
    if (method === "cfop" || method === "roux") {
      const keys = res.stages.map((s) => s.key);
      if (JSON.stringify(keys) === JSON.stringify(expectedStages[method])) st.stageSeqOk++;
    }
    if (i === 0 && !st.sampleMoves) st.sampleMoves = res.moves.join(" ");
  }
};

import type { SolveResult } from "../src/cube/solver/solve.ts";
import { applyAlg, solvedState } from "../src/cube/solver/engine.ts";
let solveFromAlg: ((alg: string[], method: SolveMethodKey) => SolveResult | null) | null = null;
function solveCubeFromAlg(alg: string[], method: SolveMethodKey): SolveResult | null {
  if (!solveFromAlg) {
    solveFromAlg = (a, m) => solveCube(applyAlg(solvedState(), a.join(" ")), m);
  }
  return solveFromAlg(alg, method);
}

async function main(): Promise<void> {
  const t0 = Date.now();
  prepareSolvers();
  console.log(`[baseline] prepare ${Date.now() - t0}ms`);

  const scrambles12: string[][] = [];
  for (let i = 0; i < N12; i++) scrambles12.push(randomScramble(12, rng12));
  const scrambles20: string[][] = [];
  for (let i = 0; i < N20; i++) scrambles20.push(randomScramble(20, rng12));

  const methods: SolveMethodKey[] = ["cfop", "roux", "cfop-adv", "roux-adv"];
  for (const m of methods) {
    const t = Date.now();
    runMethod(m, scrambles12);
    if (m === "cfop" || m === "roux") runMethod(m, scrambles20);
    stats[m].n12 = N12;
    if (m === "cfop" || m === "roux") stats[m].n20 = N20;
    const s = stats[m];
    const avg = s.steps12.length ? s.steps12.reduce((a, b) => a + b, 0) / s.steps12.length : 0;
    const worst = s.steps12.length ? Math.max(...s.steps12) : -1;
    const total = s.n12 + s.n20;
    console.log(
      `[baseline] ${m.padEnd(8)} 12步N=${N12} fail=${s.fail} avg=${avg.toFixed(1)} max=${worst}` +
      (m === "cfop" || m === "roux"
        ? ` 阶段序列OK=${s.stageSeqOk}/${total} (期望 ${expectedStages[m].join("→")})`
        : " (高级参考列)") +
      ` 耗时${((Date.now() - t) / 1000).toFixed(1)}s`
    );
  }

  // 契约断言：普通方法人类式分步必须 100% 命中（12 步 + 20 步全部样本）
  for (const m of ["cfop", "roux"]) {
    const total = stats[m].n12 + stats[m].n20;
    if (stats[m].stageSeqOk !== total) {
      console.error(`[baseline] FAIL: ${m} 阶段序列命中 ${stats[m].stageSeqOk}/${total}`);
      process.exit(1);
    }
    if (stats[m].fail !== 0) {
      console.error(`[baseline] FAIL: ${m} 有 ${stats[m].fail} 个样本求解失败`);
      process.exit(1);
    }
  }
  if (stats["cfop-adv"].fail !== 0 || stats["roux-adv"].fail !== 0) {
    console.error(`[baseline] FAIL: 高级列存在失败样本`);
    process.exit(1);
  }

  const out = {
    note: "P0.5 普通解法一致性基线（2026-08-20）。roux 普通=ROUX.solveBasic 已对齐旧版 3e30423（4c 用 l4e 表，逐行一致）；cfop 普通=CFOP.solve 与旧版逐行一致。",
    assert: { n12: N12, n20: N20, lcg: "1664525/1013904223 seed 0x51a7", humanStages: "100% 命中" },
    expectedStages,
    stats: {} as Record<string, { fail: number; avg12: number; max12: number; stepSeqOk: number; sampleMoves: string }>,
  };
  for (const m of methods) {
    const s = stats[m];
    out.stats[m] = {
      fail: s.fail,
      avg12: s.steps12.length ? s.steps12.reduce((a, b) => a + b, 0) / s.steps12.length : -1,
      max12: s.steps12.length ? Math.max(...s.steps12) : -1,
      stepSeqOk: s.stageSeqOk,
      sampleMoves: s.sampleMoves,
    };
  }
  writeFileSync(resolve(import.meta.dirname, "../docs/solver-baseline.json"), JSON.stringify(out, null, 2));
  console.log(`[baseline] 已写 docs/solver-baseline.json（总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s）`);
}

void main();