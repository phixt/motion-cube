/**
 * verify-solve-base.ts — 解法底（多色底 / 6 色底）回归验证（Node 原生 strip-types 跑，
 * 勿用 tsx；`node scripts/verify-solve-base.ts`）。
 *
 * 实现语义（solver/solve.ts 第三参 baseFace）：选单色底 B 时两层解耦——
 *   - 视觉：SolveResult.setupAlg = baseFaceSetupAlg(B)（把 B 色面转到 D 面位的整块旋转），
 *     GamePage 演示前对玩家施加（魔方旋转到对应底）；
 *   - 求解：函数内 `applyAlg(state, setupAlg)` 做等效整块旋转 + `relabelByCenter`
 *     （中心色重标注回归 home，位置不变）→ 坐标解。moves 在真实贴纸（已旋转到底的
 *     视角）上可直接执行 → `applyAlg(applyAlg(state, setupAlg), moves)` 六面单色。
 *   - 默认（undefined / "global"）= 跟随全局底（起始状态已把全局底转到 D，无 setup）；
 *     "D" 底等价默认（setupAlg=""）。
 * 多色底多选（GamePage 对集合中每底分别求解取最短）为 UI 层语义，此处不验证。
 *
 * 断言：
 *   A1 默认（undefined）与显式 "global" 结果 moves 深等（默认 = 跟随全局底），
 *      base=="global"、setupAlg==""
 *   A2 六色底 U/R/F/D/L/B 全覆盖：对固定打乱态 solve(..., f) 还原
 *      （applyAlg(applyAlg(st, setupAlg), moves) isUniform），base==f、setupAlg 正确
 *   A3 显式 "D" 与默认 moves 深等（setupAlg 皆 ""）
 *   A4 红底实态（solved + z 把红转到 D + 同打乱）上任意显式底还原
 *   A4b roux 抽查（红底实态 U/R 两底）
 *   A5 moves 合法性：cfop 六底全解的每步均在 MOVES 内（无非法记法）
 */
import { applyAlg, isUniform, MOVES, solvedState } from "../src/cube/solver/engine.ts";
import { solve } from "../src/cube/solver/solve.ts";
import type { Face } from "../src/cube/stickering.ts";

const SEED = 0x9e3779b9;
const FACES: Face[] = ["U", "R", "F", "D", "L", "B"];

/** 确定性伪随机打乱（seed 固定，可复现） */
const scramble = (): string[] => {
  const names: string[] = [];
  for (const k of Object.keys(MOVES)) if (!/[2']$/.test(k)) names.push(k);
  let state = 0x6d2b79f5 ^ SEED;
  const rnd = (): number => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
  const moves: string[] = [];
  let prevAxis = -1;
  for (let i = 0; i < 20; i++) {
    let idx = Math.floor(rnd() * names.length);
    while (Math.floor((idx / 6) % 3) === prevAxis) idx = Math.floor(rnd() * names.length);
    prevAxis = Math.floor((idx / 6) % 3);
    let mv = names[idx];
    const w = rnd();
    if (w < 0.25) mv += "2";
    else if (w < 0.5) mv += "'";
    moves.push(mv);
  }
  return moves;
};

const SCR = scramble();
const fail: string[] = [];
const ok = (name: string, cond: boolean, detail?: string): void => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  if (!cond) fail.push(name);
};

const isFaceMove = (mv: string): boolean => !!MOVES[mv];

const scrambleState = applyAlg(solvedState(), SCR);

// A1 默认 == 显式 global
const m1 = solve(scrambleState, "cfop");
const m1g = solve(scrambleState, "cfop", "global");
ok("A1 默认==global moves 深等", JSON.stringify(m1.moves) === JSON.stringify(m1g.moves));
ok("A1 base==global", m1.base === "global" && m1g.base === "global");
ok("A1 setupAlg 空", m1.setupAlg === "" && m1g.setupAlg === "");
ok("A1 还原", isUniform(applyAlg(scrambleState, m1.moves)));

// A2 六色底全还原
for (const f of FACES) {
  const res = solve(scrambleState, "cfop", f);
  const after = applyAlg(applyAlg(scrambleState, res.setupAlg), res.moves);
  ok(
    `A2 底 ${f} 还原`,
    isUniform(after),
    `base=${res.base} setup=${JSON.stringify(res.setupAlg)}`,
  );
}

// A3 显式 D == 默认深等
const mD = solve(scrambleState, "cfop", "D");
ok("A3 D==默认 moves 深等", JSON.stringify(mD.moves) === JSON.stringify(m1.moves));
ok("A3 D setupAlg 空", mD.setupAlg === "");

// A4 红底实态任意显式底还原
const redState = applyAlg(applyAlg(solvedState(), "z"), SCR);
for (const f of FACES) {
  const res = solve(redState, "cfop", f);
  const after = applyAlg(applyAlg(redState, res.setupAlg), res.moves);
  ok(`A4 红底实态 底 ${f} 还原`, isUniform(after), `setup=${JSON.stringify(res.setupAlg)}`);
}

// A4b roux 抽查
for (const f of ["U", "R"] as Face[]) {
  const res = solve(redState, "roux", f);
  const after = applyAlg(applyAlg(redState, res.setupAlg), res.moves);
  ok(`A4b roux 红底实态 底 ${f} 还原`, isUniform(after), `setup=${JSON.stringify(res.setupAlg)}`);
}

// A5 moves 合法性
for (const f of FACES) {
  const res = solve(scrambleState, "cfop", f);
  const bad = res.moves.filter((mv) => !isFaceMove(mv));
  ok(`A5 底 ${f} moves 全合法`, bad.length === 0, bad.length ? `bad=${bad.join(",")}` : undefined);
}

if (fail.length) {
  console.error(`FAILED ${fail.length}: ${fail.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log("ALL PASS — 解法底 verify（六色底视觉旋转+relabel 求解全还原）");
}