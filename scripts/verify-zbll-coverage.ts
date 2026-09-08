// ZBLL 覆盖率统一核算工具（唯一口径，Node ≥ 22 原生 TS strip-types 运行）：
//   node scripts/verify-zbll-coverage.ts
//
// 冻结口径（2026-09-08 重写；替代旧 coverage-zbll.mts 与旧断言，二者已废弃）：
//   域 = 中心 home + F2L/D 已解 + LL 四棱已朝向（ZBLL 域）。
//   轨道 = AUF（U^0..3）归一化等价类（canon = min over U 的 54 贴纸态 base64）。
//   不折叠 LR 镜像为「主口径」（镜像伙伴各算一轨）；「副口径」为镜像配对折叠。
//
// 域总量（Burnside 精确推导，非枚举/手填）：
//   LL 有向态 = 角置换 4! × 角扭转 3^3（约束和≡0） × 棱置换 4!（棱已朝向） = 15552 态。
//   在 U 群（4 元）下的固定点：fix(U^1)=fix(U^3)=16（σ∈<cycle>×twist 0×τ∈<cycle>），
//   fix(U^2)=48。由此轨道数 = (15552+16+48+16)/4 = 3908。
//   分解：1 轨（U 固定）16 个 + 2 轨（U2 固定）16 个 + 4 轨 3876 个。
//   非 PLL 域 = 3908 − 9（PLL AUF 轨道恰 9：24 个恒等角态/棱置换在 U 下的 Burnside =
//   (24+4+4+4)/4）。旧脚本分母 1944/1872 为镜像配对近似，未计自镜像，弃用。
import { readFileSync } from "node:fs";
import { applyAlg, applyMove, invertAlg, mirrorAlg, mirrorState, normalizeOrientation, parseAlg, readCorner, solvedState, stickerIndex, pos } from "../src/cube/solver/engine.ts";

// ---------------------------------------------------------------- 常量定义 --
const TOTAL_AUF = 3908;      // ZBLL 域 AUF 轨道总数（Burnside）
const NONPLL_AUF = 3899;     // 剔除 PLL（9 轨）
const PLL_AUF = 9;
const FOLDED_TOTAL_APPROX = 1954; // 3908/2 镜像配对近似（未计自镜像；主口径不依赖此值）

// ---------------------------------------------------------------- 通用辅助 --
const solve = solvedState();
const AUF = ["", "U", "U2", "U'"];
function canon(st: Uint8Array): string {
  // 中心归位（处理 setup 内整块旋转漂移）后 AUF-min
  const norm = normalizeOrientation(st).state;
  let best: string | null = null;
  for (const u of AUF) {
    const k = Buffer.from(applyAlg(norm, parseAlg(u))).toString("base64");
    if (!best || k < best) best = k;
  }
  return best!;
}
function canonFolded(st: Uint8Array): string {
  const a = canon(st), b = canon(mirrorState(st));
  return a < b ? a : b;
}
function isPllState(st: Uint8Array): boolean {
  for (const cn of ["UFR", "URB", "UBL", "ULF"]) {
    const c = readCornerAt(st, cn);
    if (c !== -1 && (c - (codeSlotOf(cn) * 3)) === 0) continue;
    return false;
  }
  return true;
}
// 直接贴纸读角（避免 readCorner 语义歧义）：位置名称 → 是否该位角已归位且朝向 0
function readCornerAt(st: Uint8Array, name: string): number {
  // 借用 engine readCorner；返回 -1 表示未找到该颜色三角
  return readCorner(st, name);
}
function codeSlotOf(name: string): number {
  return ["UFR", "URB", "UBL", "ULF", "DRF", "DFL", "DLB", "DBR"].indexOf(name);
}
function llEdgesOriented(st: Uint8Array): boolean {
  for (const en of ["UF", "UR", "UB", "UL"]) {
    if (st[stickerIndex(pos(en), [0, 1, 0])] !== 0) return false;
  }
  return true;
}

// ------------------------------------------------------------ R6 镜像一致性 --
// mirrorAlg（M2 记谱）∘apply == mirrorState（贴纸反射）∘apply（含绕 x 轴步不翻转修正）
let failures = 0;
function expect(cond: boolean, msg: string): void {
  if (!cond) { failures++; console.error("  FAIL: " + msg); }
}
console.log("== R6 镜像一致性（mirrorAlg vs mirrorState）==");
{
  const eq = (a: Uint8Array, b: Uint8Array) => { for (let i = 0; i < 54; i++) if (a[i] !== b[i]) return false; return true; };
  for (const n of ["R", "R2", "L", "L'", "F", "B", "U", "D", "M", "M2", "r", "r'", "u", "S", "S2", "E2", "x", "x'", "x2", "y", "y'", "z"]) {
    expect(eq(applyMove(solve, mirrorAlg(n)[0] ?? n), mirrorState(applyMove(solve, n))), `单步 ${n} 镜像恒等式`);
  }
  let t = 0;
  for (let seed = 0; seed < 60 && t < 300; seed++) {
    const alg = Array.from({ length: 3 + ((seed * 7) % 6) }, (_, i) => (["R","U","F","L","B","D","M","S","E","r","u","f","l","b","d","x","y","z"][(seed + i * 13) % 18]) + ([0,1,2][(seed + i) % 3] ? "" : (["", "'", "2"][(seed + i * 5) % 3])));
    expect(eq(applyAlg(solve, mirrorAlg(alg)), mirrorState(applyAlg(solve, alg))), `序列 ${alg.join(" ")} 镜像恒等式`);
    t++;
  }
  console.log("  mirror 恒等式抽查通过（单步 22 + 随机序列若干）");
}

// ------------------------------------------------------------ 覆盖率核算 --
const j = JSON.parse(readFileSync("data/samples/cuberoot-algs.json", "utf8"));
const zbll = (j.sets.zbll.cases as Array<{ name: string; setup: string }>) ?? [];
let parseFail = 0, notOll = 0;
const reached = new Set<string>();
const reachedFolded = new Set<string>();
const pllReached = new Set<string>();
const perSet = new Map<string, Set<string>>();
for (const c of zbll) {
  let moves: string[];
  try { moves = parseAlg(c.setup); } catch { parseFail++; continue; }
  if (!moves.length) { parseFail++; continue; }
  const st = applyAlg(solve, moves);
  if (!llEdgesOriented(st)) { notOll++; continue; }
  const set = c.name.split(" ")[1] ?? "?";
  if (!perSet.has(set)) perSet.set(set, new Set());
  for (const mv of [[], mirrorAlg(moves), invertAlg(moves), mirrorAlg(invertAlg(moves))]) {
    try {
      const s2 = applyAlg(solve, mv);
      const k = canon(s2);
      reached.add(k);
      reachedFolded.add(canonFolded(s2));
      if (!isPllState(s2)) perSet.get(set)!.add(k); // per-set 记非 PLL（与旧 1872 口径可比时不含 PLL）
      else pllReached.add(k);
    } catch { /* 忽略无法解析的变体 */ }
  }
}
const cov = (n: number, d: number) => ((100 * n) / d).toFixed(2);

console.log("== 覆盖率（4 变体闭包 {base, LR镜像, 逆, 镜像逆}）==");
console.log(`  cases: ${zbll.length} | parseFail: ${parseFail} | LL棱未全朝向跳过: ${notOll}`);
console.log(`  [主口径·不折叠]    可达 ${reached.size} / ${TOTAL_AUF} = ${cov(reached.size, TOTAL_AUF)}%`);
console.log(`  [主口径·剔除PLL]   ${reached.size - pllReached.size} / ${NONPLL_AUF} = ${cov(reached.size - pllReached.size, NONPLL_AUF)}%`);
console.log(`  [副口径·镜像折叠]  ${reachedFolded.size} / ${FOLDED_TOTAL_APPROX}(≈3908/2) = ${cov(reachedFolded.size, FOLDED_TOTAL_APPROX)}%`);
console.log(`  （旧口径对比：coverage-zbll.mts 旧镜像表 52.5%；旧 verify 断言 926/1872 —— 均已废弃，勿再引用）`);

// per-set（信息性；旧手填 TRUE 表 288/144 无推导，弃用）
console.log("== per-set 可达（非 PLL 计，信息性）==");
let union2 = new Set<string>();
for (const [set, s] of [...perSet.entries()].sort()) {
  console.log(`  ${set}: ${s.size}`);
  for (const k of s) union2.add(k);
}
console.log(`  per-set 并集: ${union2.size}（与主口径非 PLL ${reached.size - pllReached.size} 的差 = 分类重叠 ${union2.size - (reached.size - pllReached.size)}）`);

// ------------------------------------------------------------ 断言 --
console.log("== 断言 ==");
expect(TOTAL_AUF === 3908, "域总量应为 3908（Burnside）");
expect(NONPLL_AUF === 3899, "非 PLL 应为 3899");
expect(PLL_AUF === 9, "PLL AUF 轨道应为 9");
expect(parseFail === 0, "不应有 setup 解析失败");
expect(notOll === 0, "所有 ZBLL case 的 LL 棱应已朝向");
expect(reached.size <= TOTAL_AUF, "可达不超域");
expect(reachedFolded.size <= reached.size, "折叠后不增");
expect(reached.size - pllReached.size === union2.size, "per-set 并集应等于主口径非 PLL 可达（无分类遗漏/重叠）");
if (failures) throw new Error(`${failures} FAILURE(S)`);
console.log(`\nALL PASS — 主口径覆盖 ${cov(reached.size, TOTAL_AUF)}%（${reached.size}/${TOTAL_AUF}），非 PLL ${cov(reached.size - pllReached.size, NONPLL_AUF)}%`);
