// probe-eolr-rootcause.ts — 实证 EOLR 命中率 ~0 的根因（数据密集型）。
// 用 node 直接跑（Node 24 strip-types，与 record-solver-baseline.ts 同款）：
//   node scripts/probe-eolr-rootcause.ts
// 复刻 roux.ts solve() 内部管线，在 CMLL 之后、4a 之前算 eolrFingerprint（与
// roux.ts:61-70 逐行等价）并查表，统计：真实后 CMLL LSE 状态的指纹多样性、U 中心
// 漂移分布、命中率，以及 46 条 setup 能覆盖的指纹数——量化「位置级精确指纹」为何几乎不命中。
import { prepare } from "../src/cube/solver/roux.ts";
import {
  applyAlg, solvedState, readCenter, readEdge, parseAlg, randomScramble,
} from "../src/cube/solver/engine.ts";
import { readFileSync } from "node:fs";

const T = prepare();

const LSE_EDGE_NAMES = ["UF", "UB", "DF", "DB", "UL", "UR"];
const U_MOVES = ["", "U", "U2", "U'"];

// 与 roux.ts:61-70 eolrFingerprint 逐行等价
function eolrFingerprint(state: Uint8Array): { fp: number; um: number } {
  let best = Infinity, um = 0;
  for (let m = 0; m < 4; m++) {
    const st = m ? applyAlg(state, parseAlg(U_MOVES[m])) : state;
    let fp = readCenter(st, "U");
    for (const n of LSE_EDGE_NAMES) fp = fp * 24 + readEdge(st, n);
    if (fp < best) { best = fp; um = m; }
  }
  return { fp: best, um };
}

// 46 条 setup 的指纹集合（= 建表覆盖的指纹面）
const setupFPs = new Set<number>();
{
  const j = JSON.parse(readFileSync("data/samples/cuberoot-algs.json", "utf8"));
  for (const c of j.sets["lse-eolr"].cases) {
    try {
      const S = applyAlg(solvedState(), parseAlg(c.setup));
      setupFPs.add(eolrFingerprint(S).fp);
    } catch (e) { /* 解析失败跳过 */ }
  }
}

// 跑完整管线到 CMLL 后（复刻 roux.ts solve 前三步）→ 返回 LSE 前状态
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
  st = applyAlg(st, cm);
  return st;
}

const N = 300;
let hit = 0;
const liveFPs = new Set<number>();
const liveUms = new Set<number>();
for (let i = 0; i < N; i++) {
  const sc = randomScramble(12);
  const st = postCmllState(sc);
  if (!st) continue;
  const { fp, um } = eolrFingerprint(st);
  liveFPs.add(fp);
  liveUms.add(um);
  if (T.eolr.has(fp)) hit++;
}

let overlap = 0;
for (const fp of liveFPs) if (setupFPs.has(fp)) overlap++;

console.log("=== 实证结果 === (N=" + N + ")");
console.log("EOLR 表条目数 (prepare 建表)     :", T.eolr.size);
console.log("46 setup distinct 指纹           :", setupFPs.size);
console.log("真实后 CMLL 状态 distinct 指纹   :", liveFPs.size, "(样本内)");
console.log("live 指纹 ∩ setup 指纹           :", overlap, "/", liveFPs.size);
console.log("EOLR 表命中                       :", hit, "/", N, "=", ((hit / N) * 100).toFixed(1) + "%");
console.log("U 中心漂移 um 取值 (0=U,1=U,2=U2,3=U') :", [...liveUms].sort((a, b) => a - b).join(","));
console.log("（EOLR 表收的是 setup 规范位的指纹；真实后 CMLL 状态 6 棱位置任意，位置级指纹几乎必不匹配）");