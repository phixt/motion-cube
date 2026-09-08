// find-zbls-diff-3.ts — 辅助定位「cuberoot 305 vs mihlefeld 302」差的 3 条。
// 用法：node scripts/find-zbls-diff-3.ts
//
// 结论（2026-09-08 已实锤，本脚本即复现手段）：
//   cuberoot 305 = 302 个「FR 槽未解」形（与 mihlefeld 302 同形态空间）
//               + 3 个「全槽已解」形（恰 = O 组 I/V/D）。
//   即差 3 = O 组 3 条「最后槽已解、对棱已朝向」的极简 case（严格非 ZBLS）。
//
// 决议（2026-09-08 用户）：ZBLS 必然控棱，运行中不会出现「全槽已解」回退情形，
// 后续分析一律刨除这 3 条 → 有效 ZBLS 全集 = 302（与 mihlefeld 302 计数一致）。
//
// 若想继续深对齐「FR 形 209 条」（两库仅 96/302 状态级重合），那需要逐
// compiler 的 case 枚举表，属于深水区，本脚本不提供（按用户原则暂停）。
import { readFileSync } from "node:fs";
import { applyAlg, cubieSolvedAt, parseAlg, pos, solvedState } from "../src/cube/solver/engine.ts";

const cr = JSON.parse(readFileSync("data/samples/cuberoot-algs.json", "utf8"));
const mi = JSON.parse(readFileSync("reference/mihlefeld-alg-trainers/3x3-ZBLS-Trainer-algs_info.json", "utf8"));
const crCases = cr.sets.zbls.cases as Array<{ name: string; subgroup: string; setup: string; id: number }>;
const solve = solvedState();

const SLOTS = [
  { name: "FR", corner: "DRF", edge: "FR" },
  { name: "FL", corner: "DFL", edge: "FL" },
  { name: "BR", corner: "DBR", edge: "BR" },
  { name: "BL", corner: "DLB", edge: "BL" },
];
function shapeOf(st: Uint8Array): string {
  const unsolved = SLOTS.filter((sl) => !(cubieSolvedAt(st, pos(sl.corner)) && cubieSolvedAt(st, pos(sl.edge)))).map((s) => s.name);
  return unsolved.join("+") || "ALL-SOLVED";
}

// ---- cuberoot 305 形状分布 ----
const dist = new Map<string, number>();
const extra: Array<{ subgroup: string; name: string; id: number; setup: string }> = [];
let fail = 0;
for (const c of crCases) {
  let st: Uint8Array;
  try { const m = parseAlg(c.setup); if (!m.length) throw new Error("empty"); st = applyAlg(solve, m); }
  catch { fail++; continue; }
  const shape = shapeOf(st);
  dist.set(shape, (dist.get(shape) ?? 0) + 1);
  if (shape === "ALL-SOLVED") extra.push({ subgroup: c.subgroup, name: c.name, id: c.id, setup: c.setup });
}
console.log("== cuberoot 305：槽位形状分布 ==");
for (const [k, v] of [...dist.entries()].sort()) console.log(`  ${k}: ${v}`);
console.log(`  解析失败: ${fail}`);

// ---- 差的 3 条（全槽已解）----
console.log("\n== 差的 3 条（O 组，全槽已解形）==");
for (const e of extra) console.log(`  [${e.subgroup}] ${e.name}  id=${e.id}  setup=${e.setup}`);

// ---- mihlefeld 302 里不存在全槽已解形（呼应）----
let miAllSolved = 0;
for (const v of Object.values(mi) as any[]) {
  let st: Uint8Array;
  try { const m = parseAlg(v.s); if (!m.length) throw new Error("empty"); st = applyAlg(solve, m); }
  catch { continue; }
  if (shapeOf(st) === "ALL-SOLVED") miAllSolved++;
}
console.log(`\n== mihlefeld 302：全槽已解形条数 = ${miAllSolved}（应为 0，即这 3 条确实不在 302 内）==`);
console.log(`== 决议结论：后续分析刨除 O 组 ${extra.length} 条 → 有效 ZBLS 全集 = 302 ==`);
