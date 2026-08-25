// probe-eolr-class-ratio.ts — 实证 EOLR 分类键重建的覆盖收益（算法分支研究 R1，最终口径）。
//
// 已实证两件事：
//   (A) 旧实现把「位置级精确指纹（6 棱 + U 中心）」挂在 CMLL 后裸 LSE 态 → 命中 0/300
//       （probe-eolr-rootcause.ts）。
//   (B) cuberoot lse-eolr 的 setup 是 Arrow/1-1 等情形：M/U 序列不动 EO（46 setup 全 EO
//       done），但 UL/UR 可含 M 层位（如 Arrow (UF DF) setup M' U M2 U M' 把 UR 换入 M 层）
//       ——所以正确分类键不是「UL/UR∈U 槽」，而是「(UL,UR,DF,DB) 4 棱在全部 6 LSE 槽的
//       排列组合 × U 中心归一」（EO done 前提下），46 条 setup 即该键的覆盖样例。
//
// 本脚本量化重建后的收益上限：真实管线 4a 后，按 4 槽组合键统计 live 排列，并与
// 46 setup 覆盖的排列取交集 → 表重建后「4a 可被 EOLR 一步替代」的样本上限比例。
// 跑法：node scripts/probe-eolr-class-ratio.ts（Node 24 strip-types，勿用 tsx；import 带 .ts）。
import { prepare } from "../src/cube/solver/roux.ts";
import {
  applyAlg, solvedState, readEdge, parseAlg, randomScramble, edgeDecode, posKey, pos, CUBIES, edgeSlot,
} from "../src/cube/solver/engine.ts";
import { readFileSync } from "node:fs";

const LSE_EDGE_NAMES = ["UF", "UB", "DF", "DB", "UL", "UR"];
const U_EDGE_NAMES = ["UF", "UR", "UB", "UL"];

/** 与 roux.ts:44 lseEoDone 逐行等价（引擎未导出，本地复制） */
function lseEoDone(state: Uint8Array): boolean {
  let nu: number[] = [0, 1, 0];
  for (const c of CUBIES) if (c.type === "center") for (const s of c.stickers) if (state[s.index] === 0) { nu = s.normal; break; }
  for (const n of LSE_EDGE_NAMES) {
    const p = pos(n);
    const cubie = CUBIES.find((c) => c.pos[0] === p[0] && c.pos[1] === p[1] && c.pos[2] === p[2]);
    if (!cubie) return false;
    const ok = cubie.stickers.some(
      (s) => (state[s.index] === 0 || state[s.index] === 3)
        && Math.abs(s.normal[0] * nu[0] + s.normal[1] * nu[1] + s.normal[2] * nu[2]) === 1,
    );
    if (!ok) return false;
  }
  return true;
}

const T = prepare();
/** U 层四槽 slot id（口径同 roux.ts LSE_SLOTS） */
const U_SLOT_SET = new Set<number>();
for (const n of U_EDGE_NAMES) U_SLOT_SET.add(edgeSlot[posKey(pos(n))]);

function slotOf(state: Uint8Array, edgeName: string): number {
  return edgeDecode(readEdge(state, edgeName)).slot;
}
/** (UL,UR,DF,DB) 四棱槽组合键 */
function comboKey(state: Uint8Array): string {
  return ["UL", "UR", "DF", "DB"].map((n) => slotOf(state, n)).join(",");
}

// —— 46 setup 覆盖的四棱槽组合 ——
const setupCombos = new Set<string>();
{
  const j = JSON.parse(readFileSync("data/samples/cuberoot-algs.json", "utf8"));
  for (const c of j.sets["lse-eolr"].cases) {
    try {
      const S = applyAlg(solvedState(), parseAlg(c.setup));
      if (!lseEoDone(S)) continue;
      setupCombos.add(comboKey(S));
    } catch { /* 坏 case 跳过 */ }
  }
}
// 46 setup 应全 EO done（M/U 不动 EO）；若过滤后只有部分，说明数据有非 EO 前提出入

// —— 真实管线：打乱→块1→块2→CMLL→4a 后统计 ——
function postCmllState(scrambleAlg: string[]): Uint8Array | null {
  let st = applyAlg(solvedState(), scrambleAlg.join(" "));
  let mv = T.block1.solve(T.block1.read(st), 12, 6e6);
  if (!mv) return null;
  st = applyAlg(st, mv);
  mv = T.block2.solve(T.block2.read(st), 14, 8e6);
  if (!mv) return null;
  st = applyAlg(st, mv);
  const path = T.cmll.solve(st);
  if (!path) return null;
  let cm: string[] = [];
  for (const step of path) cm = cm.concat(step.moves);
  return applyAlg(st, cm);
}

const N = 300;
let eoDoneAfter4a = 0;
let ulUrInUAfter4a = 0;
const liveCombos = new Map<string, number>();
for (let i = 0; i < N; i++) {
  const sc = randomScramble(12);
  let st = postCmllState(sc);
  if (!st) continue;
  const eoMv = T.eo.solve(T.eo.read(st), 12, 4e6);
  if (!eoMv) continue;
  st = applyAlg(st, eoMv);
  if (!lseEoDone(st)) continue;
  eoDoneAfter4a++;
  if (U_SLOT_SET.has(slotOf(st, "UL")) && U_SLOT_SET.has(slotOf(st, "UR"))) ulUrInUAfter4a++;
  const key = comboKey(st);
  liveCombos.set(key, (liveCombos.get(key) ?? 0) + 1);
}

let covered = 0;
for (const [k, v] of liveCombos) if (setupCombos.has(k)) covered += v;

console.log("=== EOLR 分类键重建覆盖实证（最终口径, N=" + N + "） ===");
console.log("4a 后 EO done（自检）                :", eoDoneAfter4a, "/", N, "=", ((eoDoneAfter4a / N) * 100).toFixed(1) + "%");
console.log("其中 UL/UR 均∈U 槽（Arrow 完整情形）:", ulUrInUAfter4a, "/", N, "=", ((ulUrInUAfter4a / N) * 100).toFixed(1) + "%");
console.log("46 setup 覆盖的四棱槽组合数          :", setupCombos.size);
console.log("live 四棱组合 ∩ setup 组合（命中上限）:", covered, "/", N, "=", ((covered / N) * 100).toFixed(1) + "%");
console.log("live 组合分布 前 8                  :", JSON.stringify([...liveCombos].sort((a, b) => b[1] - a[1]).slice(0, 8)));
console.log("（∩ 上限 = 重建后 EOLR 一步表能在真实 4a 后直接替代 4a 的样本比例上界；");
console.log("  若远低于 43.7%→46 setup 四棱排列覆盖面不足，需补 EOLR 数据或仅 Arrow 情形可用；");
console.log("  若接近→按四棱槽组合键重建即实质命中）");