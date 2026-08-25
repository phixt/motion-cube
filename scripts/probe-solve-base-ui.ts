/**
 * probe-solve-base-ui.ts —— 色底多选 UI 语义测试序列（复刻 GamePage 流程，逐情景断言）。
 * 运行：node scripts/probe-solve-base-ui.ts（Node 原生 strip-types，勿用 tsx）
 *
 * 目的（用户反馈 2026-08-22）：
 *   「选择两个非对面的面作为解法底，桥式和 cfop 都有选择其中一个面的对面作为底面的情况；
 *     cfop 下一次打乱用另一个解法面，但没旋转，把所选底作为侧面。」
 * 本脚本把 GamePage 的 currentState()/doSolve()/demoSolve() 语义逐行复刻成纯函数，
 * 跑一个「情景矩阵」——每个情景 = 全局底设置 + 所选底集合 + （可选）第二轮连续打乱——
 * 断言「演示结束玩家停在所选底（D 面位中心色 ∈ 所选集合）且六面单色」。
 * 若某情景 FAIL，其打印字段（best.base / setupAlg / endAlg / 终态 D 位色）直接定位是哪一环错。
 *
 * 复刻语义（对应 GamePage.vue）：
 *   - playerState(globalBase, sixColorBase, alg) = applyAlg(solvedState, baseFaceSetupAlg(base)+alg)
 *     （= currentState()；base = sixColorBase ? globalBase : "D"）
 *   - chooseBest(pState, bases, method)：对每底 solve(pState, method, b)，取 moves 最短
 *     （严格 <，等长保留列表序第一个）
 *   - playEnd(pState, best) = applyAlg(applyAlg(applyAlg(pState, best.setupAlg), best.moves),
 *     best.endAlg)   —— demoSolve 的播放序列（setupAlg→moves→endAlg），整块步同样进 player alg。
 *   - 两轮连续：轮1 结束 pEnd1 上做第二轮打乱（面步）+ 再选底求解 —— 复刻用户「下一次打乱」。
 */
import { applyAlg, isUniform, solvedState, solve as solveCube } from "../src/cube/solver/index.ts";
import { baseFaceSetupAlg, type Face } from "../src/cube/stickering.ts";
import type { SolveResult } from "../src/cube/solver/index.ts";

type Method = "cfop" | "roux";

// 固定可复现打乱（20 面步，不搅中心 —— 视角分析可控；另一处含中层的场景单独列出）
const SCR1 = "R U R' F L D L' U' B R F' U F R' B L U R' F'";
const SCR2 = "U' L F' R B' D R' U F L' B R U' R F' L U B'";

const playerState = (globalBase: Face, sixColorBase: boolean, alg: string): Uint8Array => {
  const base = sixColorBase ? globalBase : "D";
  const setup = baseFaceSetupAlg(base);
  const full = setup ? `${setup} ${alg}` : alg;
  return applyAlg(solvedState(), full.trim());
};

const chooseBest = (p: Uint8Array, bases: Face[], method: Method): SolveResult => {
  let best: SolveResult | null = null;
  for (const b of bases) {
    const res = solveCube(p, method, b);
    if (!best || res.moves.length < best.moves.length) best = res;
  }
  return best as SolveResult;
};

const playEnd = (p: Uint8Array, best: SolveResult): Uint8Array => {
  let s = p;
  if (best.setupAlg) s = applyAlg(s, best.setupAlg.split(" "));
  s = applyAlg(s, best.moves);
  if (best.endAlg) s = applyAlg(s, best.endAlg.split(" "));
  return s;
};

const centerAtD = (s: Uint8Array): number => s[3 * 9 + 4];
const faceName = (idx: number): string => (idx >= 0 && idx < 6 ? ["U", "R", "F", "D", "L", "B"][idx] : `?${idx}`);

let pass = 0, fail = 0;
const ok = (label: string, cond: boolean, detail?: string): void => {
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (cond) pass++; else fail++;
};

interface Scene {
  id: string;
  label: string;
  globalBase: Face;
  six: boolean;
  bases: Face[];
  second?: boolean; // 两轮连续：轮1 解完 → 轮2 打乱再解
}

const SCENES: Scene[] = [
  { id: "S1", label: "全局D 单底 D（基线）", globalBase: "D", six: true, bases: ["D"] },
  { id: "S2", label: "全局D 单底 U", globalBase: "D", six: true, bases: ["U"] },
  { id: "S3", label: "全局D 非对面两底 [U,R]（用户场景）", globalBase: "D", six: true, bases: ["U", "R"] },
  { id: "S4", label: "全局D 非对面两底 [U,F]", globalBase: "D", six: true, bases: ["U", "F"] },
  { id: "S5", label: "全局D 对面两底 [U,D]", globalBase: "D", six: true, bases: ["U", "D"] },
  { id: "S6", label: "全局R 两底 [U,R]（R 已在 D，p=3 情形）", globalBase: "R", six: true, bases: ["U", "R"] },
  { id: "S7", label: "全局F 两底 [F,R]", globalBase: "F", six: true, bases: ["F", "R"] },
  { id: "S8", label: "全局L 三底 [U,L,R]", globalBase: "L", six: true, bases: ["U", "L", "R"] },
  { id: "S9", label: "六色底关(固定D) 两底 [U,R]", globalBase: "D", six: false, bases: ["U", "R"] },
  { id: "S10", label: "全局D 两轮连续 [U,R]（用户“下一次打乱”）", globalBase: "D", six: true, bases: ["U", "R"], second: true },
];

for (const scene of SCENES) {
  for (const method of ["cfop", "roux"] as Method[]) {
    const tag = `${scene.id} ${method}`;
    // 轮1
    const p1 = playerState(scene.globalBase, scene.six, SCR1);
    const best1 = chooseBest(p1, scene.bases, method);
    console.log(`  ${tag} best.base=${best1.base} setup=${JSON.stringify(best1.setupAlg)} end=${JSON.stringify(best1.endAlg)} moves=${best1.moves.length}`);
    const end1 = playEnd(p1, best1);
    const d1 = faceName(centerAtD(end1));
    const inBases1 = scene.bases.includes(d1 as Face);
    ok(`${tag} 轮1 停在所选底(D位∈所选=${scene.bases.join("/")})`,
      isUniform(end1) && inBases1,
      `best.base=${best1.base} setup=${JSON.stringify(best1.setupAlg)} end=${JSON.stringify(best1.endAlg)} moves=${best1.moves.length} 终态D位=${d1} uniform=${isUniform(end1)}`);
    if (!scene.second) continue;
    // 两轮：轮2 打乱在轮1 终态上做（复刻用户「下一次打乱」）
    const p2 = applyAlg(end1, SCR2.split(" "));
    // currentState() 语义：solved+全局底setup+玩家全链（整块步在 player alg 里）== p2 自身
    const best2 = chooseBest(p2, scene.bases, method);
    const end2 = playEnd(p2, best2);
    const d2 = faceName(centerAtD(end2));
    const inBases2 = scene.bases.includes(d2 as Face);
    ok(`${tag} 轮2 停在所选底(D位∈所选)`,
      isUniform(end2) && inBases2,
      `best.base=${best2.base} setup=${JSON.stringify(best2.setupAlg)} end=${JSON.stringify(best2.endAlg)} moves=${best2.moves.length} 终态D位=${d2} uniform=${isUniform(end2)}`);
  }
}

console.log(`\n=== 结果：${pass} pass / ${fail} fail ===`);
process.exit(fail ? 1 : 0);