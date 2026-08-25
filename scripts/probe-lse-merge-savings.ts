// probe-lse-merge-savings.ts — 量化「4b+4c 合并一步（6E2C / l4e）」相对「4b ulur 分列 +
// 4c l4e」的步数节省分布。node scripts/probe-lse-merge-savings.ts
// 方法：对每个打乱，先跑到 CMLL 后、EO 已完成（用 T.eo 做完 4a）的状态；然后
//   split = |ulur| + |l4e|（EO → UL/UR home → 已解）
//   merged= |l4e|（EO → 已解，UL/UR 伪位并入）
// 两者起点都是「EO done + 6 棱任意位置」。差 = 合并一步的净节省。
import { prepare } from "../src/cube/solver/roux.ts";
import { applyAlg, solvedState, randomScramble } from "../src/cube/solver/engine.ts";

const T = prepare();
function postCmllEOState(sc: string[]): Uint8Array | null {
  let st = applyAlg(solvedState(), sc.join(" "));
  let mv = T.block1.solve(T.block1.read(st), 12, 6e6); if (!mv) return null; st = applyAlg(st, mv);
  mv = T.block2.solve(T.block2.read(st), 14, 8e6); if (!mv) return null; st = applyAlg(st, mv);
  const path = T.cmll.solve(st); if (!path) return null;
  let cm: string[] = []; for (const s of path) cm = cm.concat(s.moves); st = applyAlg(st, cm);
  // 4a EO
  mv = T.eo.solve(T.eo.read(st), 12, 4e6); if (!mv) return null; st = applyAlg(st, mv);
  return st;
}
const N = 120;
let splitSum = 0, mergedSum = 0, saveSum = 0, neg = 0, zero = 0;
const saves: number[] = [];
for (let i = 0; i < N; i++) {
  const st = postCmllEOState(randomScramble(12));
  if (!st) continue;
  const m1 = T.ulur.solve(T.ulur.read(st), 12, 5e6); if (!m1) continue;
  const s1 = applyAlg(st, m1);
  const m2 = T.l4e.solve(T.l4e.read(s1), 16, 6e6); if (!m2) continue;
  const split = m1.length + m2.length;
  const mg = T.l4e.solve(T.l4e.read(st), 18, 8e6); if (!mg) continue;
  const merged = mg.length;
  splitSum += split; mergedSum += merged;
  const d = split - merged; saveSum += d; saves.push(d);
  if (d < 0) neg++; else if (d === 0) zero++;
}
console.log("=== 4b+4c 合并 步数节省 (N 有效样本, 已 EO 后) ===");
console.log("样本数:", saves.length);
console.log("split(ulur+l4e) 均值:", (splitSum / saves.length).toFixed(2));
console.log("merged(l4e) 均值  :", (mergedSum / saves.length).toFixed(2));
console.log("净节省 均值        :", (saveSum / saves.length).toFixed(2));
console.log("节省>0:", saves.filter((d) => d > 0).length, " 节省==0:", zero, " 节省<0(反而更长):", neg);
console.log("节省分布 min/max :", Math.min(...saves), "/", Math.max(...saves));