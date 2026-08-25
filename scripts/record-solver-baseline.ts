/**
 * record-solver-baseline.ts — 求解方法一致性基线记录（node strip-types 运行：
 *   `node scripts/record-solver-baseline.ts`，勿用 tsx）。
 *
 * 目的：把「普通解法 = 人类式分步」的契约与两代一致性固化为可复现基线。
 *   - cfop 普通（solve('cfop') = CFOP.solve）：cross → f2l1..4 → oll → pll
 *   - roux 普通（solve('roux') = ROUX.solveBasic）：block1 → block2 → cmll →
 *     lse-eo(4a) → lse-ulur(4b) → lse-4c(4c)（与旧版 3e30423 逐行一致）
 *   - roux 合并（solve('roux-merge') = ROUX.solveMerge4c）：block1 → block2 → cmll →
 *     lse-eo(4a) → lse-4c(4b+4c 合并一步)——人类式两段，默认 Roux 选项（merge4b4c 默认勾选）
 *   - 高级参考列：cfop-adv / roux-adv（不动，仅记录步数供对比）
 * RNG 固定 LCG（1664525 / 1013904223，与 verify-render-cube 同款）保证可复现。
 * 断言（任一失败即 exit 1）：普通类阶段序列 100% 命中契约；无求解失败样本。
 */
import { randomScramble, prepareSolvers } from "../src/cube/solver/index.ts";
import type { SolveMethodKey } from "../src/cube/solver/index.ts";
import { solve as solveFromAlg, type SolveResult } from "../src/cube/solver/solve.ts";
import { applyAlg, solvedState } from "../src/cube/solver/engine.ts";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0), s / 2 ** 32);
}

const N12 = 60; // 12 步面打乱样本
const N20 = 10; // 20 步 WCA 口径样本
const rng12 = lcg(0x51a7);

const expectedStages: Record<string, string[]> = {
  cfop: ["cross", "f2l1", "f2l2", "f2l3", "f2l4", "oll", "pll"],
  roux: ["block1", "block2", "cmll", "lse-eo", "lse-ulur", "lse-4c"],
  "roux-merge": ["block1", "block2", "cmll", "lse-eo", "lse-4c"],
};

const NORMAL = ["cfop", "roux", "roux-merge"];

interface MethodStat {
  n12: number;
  n20: number;
  fail: number;
  steps12: number[];
  stageSeqOk: number;
  sampleMoves: string;
}

const stats: Record<string, MethodStat> = {};

const solveCubeFromAlg = (alg: string[], method: SolveMethodKey): SolveResult | null =>
  solveFromAlg(applyAlg(solvedState(), alg.join(" ")), method);

const runMethod = (method: SolveMethodKey, scrambles: string[][]): void => {
  const st = (stats[method] ??= { n12: 0, n20: 0, fail: 0, steps12: [], stageSeqOk: 0, sampleMoves: "" });
  for (let i = 0; i < scrambles.length; i++) {
    const res = solveCubeFromAlg(scrambles[i], method);
    if (!res) { st.fail++; continue; }
    if (i < N12) st.steps12.push(res.moves.length);
    if (res.stages.length && NORMAL.includes(method)) {
      const keys = res.stages.map((s) => s.key);
      if (JSON.stringify(keys) === JSON.stringify(expectedStages[method])) st.stageSeqOk++;
    }
    if (i === 0 && !st.sampleMoves) st.sampleMoves = res.moves.join(" ");
  }
};

async function main(): Promise<void> {
  const t0 = Date.now();
  prepareSolvers();
  console.log(`[baseline] prepare ${Date.now() - t0}ms`);

  const scrambles12: string[][] = [];
  for (let i = 0; i < N12; i++) scrambles12.push(randomScramble(12, rng12));
  const scrambles20: string[][] = [];
  for (let i = 0; i < N20; i++) scrambles20.push(randomScramble(20, rng12));

  const methods: SolveMethodKey[] = ["cfop", "roux", "roux-merge", "cfop-adv", "roux-adv"];
  for (const m of methods) {
    const t = Date.now();
    runMethod(m, scrambles12);
    if (NORMAL.includes(m)) runMethod(m, scrambles20);
    stats[m].n12 = N12;
    if (NORMAL.includes(m)) stats[m].n20 = N20;
    const s = stats[m];
    const avg = s.steps12.length ? s.steps12.reduce((a, b) => a + b, 0) / s.steps12.length : 0;
    const worst = s.steps12.length ? Math.max(...s.steps12) : -1;
    const total = s.n12 + s.n20;
    console.log(
      `[baseline] ${m.padEnd(10)} 12步N=${N12} fail=${s.fail} avg=${avg.toFixed(1)} max=${worst}` +
      (NORMAL.includes(m)
        ? ` 阶段序列OK=${s.stageSeqOk}/${total} (期望 ${expectedStages[m].join("→")})`
        : " (高级参考列)") +
      ` 耗时${((Date.now() - t) / 1000).toFixed(1)}s`
    );
  }

  // 契约断言：普通类方法人类式分步必须 100% 命中
  for (const m of NORMAL) {
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
  for (const m of ["cfop-adv", "roux-adv"]) {
    if (stats[m].fail !== 0) {
      console.error(`[baseline] FAIL: ${m} 存在失败样本`);
      process.exit(1);
    }
  }

  const out: {
    note: string;
    assert: { n12: number; n20: number; lcg: string; humanStages: string };
    expectedStages: Record<string, string[]>;
    stats: Record<string, { fail: number; avg12: number; max12: number; stageSeqOk: number; sampleMoves: string }>;
  } = {
    note: "求解方法基线（2026-08-20）。cfop/roux 普通=人类式分步契约（roux 与旧版 3e30423 逐行一致）；roux-merge=默认合并 4b+4c（4a + 4b+4c 两段）；cfop-adv/roux-adv=高级参考列。",
    assert: { n12: N12, n20: N20, lcg: "1664525/1013904223 seed 0x51a7", humanStages: "100% 命中" },
    expectedStages,
    stats: {},
  };
  for (const m of methods) {
    const s = stats[m];
    out.stats[m] = {
      fail: s.fail,
      avg12: s.steps12.length ? s.steps12.reduce((a, b) => a + b, 0) / s.steps12.length : -1,
      max12: s.steps12.length ? Math.max(...s.steps12) : -1,
      stageSeqOk: s.stageSeqOk,
      sampleMoves: s.sampleMoves,
    };
  }
  writeFileSync(resolve(import.meta.dirname, "../docs/solver-baseline.json"), JSON.stringify(out, null, 2));
  console.log(`[baseline] 已写 docs/solver-baseline.json（总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s）`);
}

void main();