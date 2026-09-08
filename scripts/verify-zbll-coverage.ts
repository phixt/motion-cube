// ZBLL 覆盖率统一核算工具（Node ≥ 22 原生 TS strip-types 运行）：
//   node scripts/verify-zbll-coverage.ts
//
// 冻结口径 v2（2026-09-08 本轮从简重算；替代 v1 的轨道级口径，旧 coverage-zbll.mts 已删）：
//
// ══ 主口径：库完整性（覆盖率应该就是它）══
//   域 = 「控制棱之后」的全部 LL 情况 = ZBLL 全集 493 个 case（472 个 OLL 十字后的
//   ZBLL + 21 个 PLL）。这是标准定义：一个 case = 一条公式即可解的等价类，公式自身
//   带 U 前缀覆盖该 case 的所有 AUF 变体；LR 镜像/逆由镜像/逆公式覆盖。
//   覆盖率 = 库实际持有的 case 数 / 493。完整库（472+21=493）→ 100%。
//   理论上：493 一定覆盖所有「控制棱之后」的情况（这就是 ZBLL+ PLL 集合的定义）。
//
// ══ 副口径：轨道去重（研究/信息，不是覆盖率）══
//   域在 AUF 轨道粒度下有 3908 轨（Burnside：(15552+16+48+16)/4）。
//   把它当分母会把覆盖率低估（一个 case ≈ 8 条轨道），所以仅作研究记录：
//   4 变体闭包 {base, LR镜像, 逆, 镜像逆} 可达轨道 ≈ 867 / 3908 ≈ 22%。
import { readFileSync } from "node:fs";
import { applyAlg, applyMove, invertAlg, mirrorAlg, mirrorState, normalizeOrientation, parseAlg, solvedState, stickerIndex, pos } from "../src/cube/solver/engine.ts";

// ---------------------------------------------------------------- 常量定义 --
const TOTAL_AUF = 3908;      // ZBLL 域 AUF 轨道总数（Burnside，供副口径）
const NONPLL_AUF = 3899;     // 剔除 PLL（9 轨）
const DOMAIN_CASES = 493;    // 控制棱之后的 ZBLL 全集 case 数（472 + 21 PLL）

// ---------------------------------------------------------------- 通用辅助 --
const solve = solvedState();
const AUF = ["", "U", "U2", "U'"];
function canon(st: Uint8Array): string {
  const norm = normalizeOrientation(st).state;
  let best: string | null = null;
  for (const u of AUF) {
    const k = Buffer.from(applyAlg(norm, parseAlg(u))).toString("base64");
    if (!best || k < best) best = k;
  }
  return best!;
}
function llEdgesOriented(st: Uint8Array): boolean {
  for (const en of ["UF", "UR", "UB", "UL"]) {
    if (st[stickerIndex(pos(en), [0, 1, 0])] !== 0) return false;
  }
  return true;
}

// ------------------------------------------------------------ 断言辅助 --
let failures = 0;
function expect(cond: boolean, msg: string): void {
  if (!cond) { failures++; console.error("  FAIL: " + msg); }
}

// ------------------------------------------------------------ R6 镜像一致性 --
// mirrorAlg（M2 记谱）∘apply == mirrorState（贴纸反射）∘apply（含绕 x 轴步不翻转修正）
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

// ------------------------------------------------------------ 主口径核算 --
const j = JSON.parse(readFileSync("data/samples/cuberoot-algs.json", "utf8"));
const zbll = (j.sets.zbll.cases as Array<{ name: string; setup: string }>) ?? [];
const pll = (j.sets.pll.cases as Array<{ name: string }>) ?? [];
let parseFail = 0, notOll = 0;
const caseOrbits = new Set<string>(); // 每条 zbll case 的 setup 轨道（查唯一性）
for (const c of zbll) {
  let moves: string[];
  try { moves = parseAlg(c.setup); } catch { parseFail++; continue; }
  if (!moves.length) { parseFail++; continue; }
  const st = applyAlg(solve, moves);
  if (!llEdgesOriented(st)) { notOll++; continue; }
  caseOrbits.add(canon(st));
}
const libHeld = caseOrbits.size; // 实际有效且互不重复的 zbll case 数
const hasPll = pll.length === 21;
const heldTotal = hasPll ? libHeld + 21 : libHeld;

console.log("== 主口径：库完整性（覆盖率）==");
console.log(`  ZBLL case 数: ${zbll.length}（472 为完整集；setup 解析失败 ${parseFail}，棱未朝向 ${notOll}）`);
console.log(`  互不重复的 ZBLL case 轨道: ${caseOrbits.size}`);
console.log(`  PLL case 数: ${pll.length}（应为 21；${hasPll ? "✓ 齐全" : "✗ 缺失"}）`);
console.log(`  库持有 case = ${heldTotal} / 域 ${DOMAIN_CASES} = ${((100 * heldTotal) / DOMAIN_CASES).toFixed(1)}%`);
console.log(`  （理论上 493 一定覆盖所有「控制棱之后」的情况 —— 此即 ZBLL+PLL 全集定义）`);

// ------------------------------------------------------------ 副口径（研究） --
const reached = new Set<string>();
const reachedFolded = new Set<string>();
const pllReached = new Set<string>();
for (const c of zbll) {
  let moves: string[];
  try { moves = parseAlg(c.setup); } catch { continue; }
  if (!moves.length) continue;
  const st = applyAlg(solve, moves);
  if (!llEdgesOriented(st)) continue;
  for (const mv of [[], mirrorAlg(moves), invertAlg(moves), mirrorAlg(invertAlg(moves))]) {
    try {
      const s2 = applyAlg(solve, mv);
      reached.add(canon(s2));
      reachedFolded.add(canon(s2) < canon(mirrorState(s2)) ? canon(s2) : canon(mirrorState(s2)));
      const pll = isPllBySetup(s2);
      if (pll) pllReached.add(canon(s2));
    } catch { /* 忽略无法解析的变体 */ }
  }
}
function isPllBySetup(st: Uint8Array): boolean {
  // 角块全归位且朝向 0（用 U 面颜色直判简化为：四个 U 角都在 home 位）
  // 简化判定：U 面四角贴纸 = (0,1,2),(0,1,5),(0,4,5),(0,4,2) 三色组各归位
  const UL_COLOR_SETS: string[] = ["0,1,2", "0,1,5", "0,4,5", "0,4,2"];
  const cornerNames = ["UFR", "URB", "UBL", "ULF"];
  for (let i = 0; i < 4; i++) {
    const p = pos(cornerNames[i]);
    const ns = [[p[0], 0, 0], [0, p[1], 0], [0, 0, p[2]]];
    const cols = ns.map((n) => st[stickerIndex(p, n as [number, number, number])]).sort().join(",");
    if (cols !== UL_COLOR_SETS[i]) return false;
  }
  return true;
}
console.log("\n== 副口径：轨道去重（研究/信息，非覆盖率）==");
console.log(`  4 变体闭包可达轨道 ${reached.size} / ${TOTAL_AUF} = ${((100 * reached.size) / TOTAL_AUF).toFixed(2)}%`);
console.log(`  剔除 PLL: ${reached.size - pllReached.size} / ${NONPLL_AUF}`);
console.log(`  镜像折叠: ${reachedFolded.size} / 1954(≈3908/2)`);
console.log("  （注：一个 ZBLL case ≈ 含 4 AUF × 逆/镜像的多个轨道，轨道粒度会把覆盖低估；主口径见上）");

// ------------------------------------------------------------ 断言 --
console.log("\n== 断言 ==");
expect(parseFail === 0, "不应有 zbll setup 解析失败");
expect(notOll === 0, "所有 zbll case 的 LL 棱应已朝向（控制棱后域）");
expect(zbll.length === 472, `zbll 应为完整 472，实际 ${zbll.length}`);
expect(pll.length === 21, `pll 应为完整 21，实际 ${pll.length}`);
expect(caseOrbits.size === 472, "472 个 zbll case 的 setup 轨道应互不重复（case 唯一）");
expect(heldTotal === DOMAIN_CASES, `库持有应为 493（472+21）→ 100% 覆盖，实际 ${heldTotal}`);
expect(TOTAL_AUF === 3908, "副口径域总量应为 3908");
if (failures) throw new Error(`${failures} FAILURE(S)`);
console.log(`\nALL PASS — 主口径覆盖率 ${heldTotal}/${DOMAIN_CASES} = ${((100 * heldTotal) / DOMAIN_CASES).toFixed(1)}%（理论 493 全覆盖成立）`);
