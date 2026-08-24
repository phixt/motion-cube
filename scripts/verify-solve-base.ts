/**
 * verify-solve-base.ts — 解法底（多色底 / 6 色底）回归验证（Node 原生 strip-types 跑，
 * 勿用 tsx；`node scripts/verify-solve-base.ts`）。
 *
 * 实现语义（solver/solve.ts 第三参 baseFace）：求解器坐标中性 —— 同一坐标解对任意底色
 * 同构（cross/F2L 按 D 面位坐标、与颜色无关；isUniform 对整块旋转不变），故显式底不改
 * 变解法输出（moves 还原性对任何底成立），baseFace 记录为视角标注（SolveResult.base），
 * 为未来色底求解器预留；不做整块旋转（会破坏求解器「中心归 home」前提）。
 * 默认 = 跟随全局底：演示起始状态已把全局底颜色转到 D 面位（六色底），求解视角与其一致。
 * 断言：
 *   A1 默认（undefined）与显式 "global" 结果 moves 深等（默认 = 跟随全局底）。
 *   A2 6 色底全覆盖：对固定打乱态显式传每个面作底的解法都还原（isUniform）。
 *   A3 显式 "D" 与默认 moves 深等（底已在 D，无视角差）。
 *   A4 红底实态（solved + z 把红转到 D + 同打乱）默认跟随还原（六色底全局语义）。
 *   A5 红底实态上显式其它底（如 U）还原（任意显式底均可）。
 */
import { applyAlg, isUniform, solvedState } from "../src/cube/solver/engine.ts";
import { solve } from "../src/cube/solver/solve.ts";

/** 固定可复现面打乱（12 步） */
const SCRAMBLE = ["R", "U", "F2", "L'", "B", "U2", "R'", "F", "D'", "R2", "U", "B'"];

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = ""): void => {
  if (ok) {
    pass++;
    console.log(`PASS ${name}`);
  } else {
    fail++;
    console.log(`FAIL ${name} ${detail}`);
  }
};

// 白/D 起始 + 打乱
const stW = applyAlg(solvedState(), SCRAMBLE);
const resDefault = solve(stW, "cfop"); // baseFace 缺省 → 跟随全局底
const resGlobal = solve(stW, "cfop", "global");
check(
  "A1 default 与显式 global moves 深等",
  JSON.stringify(resDefault.moves) === JSON.stringify(resGlobal.moves),
  `def=${resDefault.moves.length} glb=${resGlobal.moves.length}`,
);
check("A1 默认解法还原（isUniform）", isUniform(applyAlg(stW, resDefault.moves)), `n=${resDefault.moves.length}`);

// 6 色底全覆盖
for (const f of ["U", "R", "F", "D", "L", "B"] as const) {
  const r = solve(stW, "cfop", f);
  check(`A2 六色底 ${f} 还原（isUniform）`, isUniform(applyAlg(stW, r.moves)), `n=${r.moves.length}`);
}

// 显式 D（无需整块旋转）与默认等价
const resD = solve(stW, "cfop", "D");
check("A3 显式 D 与默认 moves 深等", JSON.stringify(resD.moves) === JSON.stringify(resDefault.moves));

// 红底实态：solved + z（红→D） + 同打乱；默认跟随（红底）应还原
const stR = applyAlg(applyAlg(solvedState(), "z"), SCRAMBLE);
const resR = solve(stR, "cfop");
check("A4 红底实态默认跟随还原（isUniform）", isUniform(applyAlg(stR, resR.moves)), `n=${resR.moves.length}`);

// 红底实态上显式其它底（U）→ 整块旋转视角，同样还原
const resR_U = solve(stR, "cfop", "U");
check("A5 红底实态显式 U 底还原（isUniform）", isUniform(applyAlg(stR, resR_U.moves)), `n=${resR_U.moves.length}`);

console.log(`\n${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);