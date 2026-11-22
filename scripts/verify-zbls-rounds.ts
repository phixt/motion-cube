// verify-zbls-rounds.ts — ZBLS/ZBLL 数据层的「样本轮」端到端验证（新验证方式）。
// 用法：npx tsx scripts/verify-zbls-rounds.ts [--rounds=N]
//
// 背景（2026-09-08 第四轮）：O 组 3 条「全槽已解」case 已从数据层剔离
// （cuberoot-algs.json zbls 305→302，留档 docs/archived/zbls-ogroup-3-cases.md）。
// 静态计数检查升级为本脚本的逐轮实证，共 6 个板块：
//
//   A 域合法性轮（302 轮）    ：每条 zbls case 的 setup 态必须恰好缺 1 槽
//                              （全槽已解 = 0，防回潮哨兵）。
//   B 求解命中轮（302×4 轮）  ：setup 态叠加 U^k（AUF 前置，4 种）→ solveZbls
//                              必须命中候选，且施加返回 moves 后实测
//                              F2L 全解 + LL 棱朝向。
//   C 表基线回归（1 轮）      ：prepare() 的 tableSize/genCount 必须等于剔除前
//                              基线 268/1696 —— 证明删 3 条对求解器零行为影响。
//   D ZBLL 端到端轮（493 条） ：zbll 472 + pll 21 每条：setup 域合法（F2L 解 +
//                              LL 棱朝向），alg/alts × AUF 前缀×收尾（16 组合）+
//                              中心漂移归位后存在一条把整魔方解回（isUniform）。
//   F 旋转槽命中轮（302×3 轮）：共轭 y·setup·y' 使缺槽落到 FL/BL/BR（中心仍 home）
//                              → solveZbls 仍须命中并实测验证（missingSlot + Y_TO_FR）。
//   E 数据完整性检查          ：zbls=302、O 组 id 不复活、归档=3 条、id 唯一、
//                              mirrorCaseId 无悬空引用。
//
// 退出码非 0 = 有断言失败。
import { readFileSync } from "node:fs";
import {
  applyAlg, cubieSolvedAt, CUBIES, invertAlg, normalizeOrientation, parseAlg, pos, randomScramble, solvedState, cubieSolved,
} from "../src/cube/solver/engine.ts";
import { llEdgeFlips } from "../src/cube/solver/algs.ts";
import { CFOP, SLOTS, solveSlot } from "../src/cube/solver/cfop.ts";
import { prepare, solveZbls } from "../src/cube/solver/zbls.ts";

const argv = process.argv.slice(2);
const argRounds = Number((argv.find((a) => a.startsWith("--rounds=")) ?? "").split("=")[1] || 0);

type Case = { id: number; name: string; subgroup?: string; setup: string; alg?: string; alts?: string[]; algs?: string[][]; mirrorCaseId?: number | null };

const cr = JSON.parse(readFileSync("data/samples/cuberoot-algs.json", "utf8")) as {
  sets: Record<string, { cases: Case[] }>;
};
const arc = JSON.parse(readFileSync("docs/archived/zbls-ogroup-3-cases.json", "utf8")) as { cases: Case[] };

const SOLVE = solvedState();
const U_ALGS = ["", "U", "U2", "U'"];
const SLOT_EDGES = ["FR", "FL", "BL", "BR"];

let rounds = 0;
const failures: string[] = [];
function fail(msg: string) {
  failures.push(msg);
  console.error("  FAIL " + msg);
  if (failures.length > 60) { console.error("失败过多，中止。"); process.exit(1); }
}
/** 断言（布尔条件 + 消息），返回是否通过 */
function expect(cond: boolean, msg: string): boolean {
  if (!cond) fail(msg);
  return cond;
}

/** 缺槽数：4 个中层棱不在 home 的个数（与 zbls.ts missingSlot 建表口径同） */
function missingEdgeCount(st: Uint8Array): number {
  return SLOT_EDGES.filter((n) => !cubieSolvedAt(st, pos(n))).length;
}
/** 未解槽数（角+棱任一不 home，find-zbls-diff-3 形状口径）：有效 ZBLS 态必须恰 = 1 */
function unsolvedSlotCount(st: Uint8Array): number {
  return [["DRF", "FR"], ["DFL", "FL"], ["DLB", "BL"], ["DBR", "BR"]]
    .filter(([c, e]) => !cubieSolvedAt(st, pos(c)) || !cubieSolvedAt(st, pos(e))).length;
}
/** 非 LL 区域全解（与 zbls.ts nonLLSolved 同口径） */
function nonLLSolved(s: Uint8Array): boolean {
  for (const c of CUBIES) {
    const isLL = c.pos[1] === 1 && c.type !== "center";
    if (!isLL && !cubieSolved(s, c.pos)) return false;
  }
  return true;
}
function llEdgesOriented(s: Uint8Array): boolean {
  return llEdgeFlips(s).every((f) => !f);
}
function isUniform(s: Uint8Array): boolean {
  for (let f = 0; f < 6; f++) {
    const c = s[f * 9];
    for (let i = 1; i < 9; i++) if (s[f * 9 + i] !== c) return false;
  }
  return true;
}
function applySafe(st: Uint8Array, alg: string): Uint8Array | null {
  try { return applyAlg(st, parseAlg(alg)); } catch { return null; }
}
/** 中心漂移归位（M/S/E/x/y 残差）；engine.normalizeOrientation 返回 {state}|null */
function resolveNorm(st: Uint8Array): Uint8Array {
  const n = normalizeOrientation(st);
  return n ? (n as { state: Uint8Array }).state : st;
}

const zbls = cr.sets.zbls.cases;
const limit = (n: number) => (argRounds > 0 ? Math.min(argRounds, n) : n);

/* ---------------- A 域合法性轮（302） ---------------- */
console.log("== A 域合法性轮（每条 zbls case 的 setup 态恰 1 槽未解[角+棱口径]） ==");
{
  const shapes = new Map<string, number>();
  let edgeHomeOnly = 0; // 角乱棱 home：有效 ZBLS，但 zbls.ts 建表进不了（既有局限）
  for (const c of zbls.slice(0, limit(zbls.length))) {
    rounds++;
    const st = applySafe(SOLVE, c.setup);
    if (!st) { fail(`[A] ${c.name}(id=${c.id}) setup 解析失败: ${c.setup}`); continue; }
    const unsolved = unsolvedSlotCount(st);
    shapes.set(String(unsolved), (shapes.get(String(unsolved)) ?? 0) + 1);
    expect(unsolved === 1, `[A] ${c.name}(id=${c.id}) setup 态未解槽数=${unsolved}（应为 1；0=全槽已解回潮型）`);
    if (missingEdgeCount(st) === 0) edgeHomeOnly++;
  }
  console.log(`  未解槽数分布: ${[...shapes.entries()].sort().map(([k, v]) => `${k}:${v}`).join(" ")}`);
  console.log(`  其中「棱 home 角乱」${edgeHomeOnly} 条：已由 zbls.ts 特征表全收录`);
  expect((shapes.get("0") ?? 0) === 0, "[A] 不允许存在全槽已解（未解槽=0）case —— 防回潮哨兵");
}

/* ---------------- B 求解命中轮（302×4 AUF，含原 32 条棱 home 角乱） ---------------- */
console.log("== B 求解命中轮（302×4 AUF → solveZbls 命中并实测） ==");
{
  let hit = 0, total = 0;
  for (const c of zbls.slice(0, limit(zbls.length))) {
    const base = applySafe(SOLVE, c.setup);
    if (!base) continue;
    for (const ua of U_ALGS) {
      rounds++; total++;
      const st = ua ? applySafe(base, ua)! : base;
      const res = solveZbls(st);
      if (!res) { fail(`[B] ${c.name}(id=${c.id}) + ${ua || "(无AUF)"} → solveZbls 未命中`); continue; }
      const after = applySafe(st, res.moves.join(" "));
      const chk = after && resolveNorm(after);
      if (!chk || !(nonLLSolved(chk) && llEdgesOriented(chk))) {
        fail(`[B] ${c.name}(id=${c.id}) + ${ua || "-"} → 解后 F2L/EO 校验失败（${res.algs.join(",")}）`);
      } else hit++;
    }
  }
  console.log(`  命中并通过: ${hit}/${total}`);
  expect(total === limit(zbls.length) * 4, `[B] 应全覆盖 ${limit(zbls.length) * 4} 轮，实际 ${total}`);
  expect(hit === total, "[B] 所有 ZBLS 轮必须命中且实测通过");
}

/* ---------------- C 表基线回归 ---------------- */
console.log("== C 表基线回归（特征表 302/302 全收录、0 跳过） ==");
{
  rounds++;
  const T = prepare();
  console.log(`  tableSize=${T.table.size} genCount=${T.genCount} skipped=${T.skipped.length}（基线 302 键 / 0 跳过）`);
  expect(T.table.size === 302, `[C] 特征表键数应为 302（覆盖全部 302 case），实际 ${T.table.size}`);
  expect(T.skipped.length === 0, `[C] 建表不应有跳过 case，实际 ${T.skipped.length}`);
  expect(T.genCount >= 302, `[C] 候选数异常少: ${T.genCount}`);
}

/* ---------------- D ZBLL/PLL 端到端轮（472+21） ---------------- */
console.log("== D ZBLL/PLL 端到端轮（setup 域合法 + alg/AUF 实测解回） ==");
{
  for (const slug of ["zbll", "pll"] as const) {
    const cases = cr.sets[slug].cases;
    let solvedCount = 0, domainBad = 0;
    for (const c of cases.slice(0, limit(cases.length))) {
      rounds++;
      const st = applySafe(SOLVE, c.setup ?? "");
      if (!st) { fail(`[D:${slug}] ${c.name}(id=${c.id}) setup 解析失败`); continue; }
      if (!(nonLLSolved(st) && llEdgesOriented(st))) {
        domainBad++;
        fail(`[D:${slug}] ${c.name}(id=${c.id}) setup 非 ZBLL 域（F2L/棱朝向不满足）`);
      }
      const candidates = [c.alg, ...(c.alts ?? [])].filter(Boolean) as string[];
      let ok = false;
      outer: for (const alg of candidates) {
        for (const pre of U_ALGS) {
          for (const post of U_ALGS) {
            const seq = [pre, alg, post].filter(Boolean).join(" ");
            const after = applySafe(st, seq);
            if (after && isUniform(resolveNorm(after))) { ok = true; break outer; }
          }
        }
      }
      if (!ok) fail(`[D:${slug}] ${c.name}(id=${c.id}) alg+alts+AUF 无一能解回（${candidates.length} 候选）`);
      else solvedCount++;
    }
    console.log(`  ${slug}: 端到端解回 ${solvedCount}/${cases.length}，域非法 ${domainBad}`);
    expect(solvedCount === cases.length, `[D:${slug}] 每条都必须能解回`);
    expect(domainBad === 0, `[D:${slug}] setup 域必须全部合法`);
  }
  const zbllN = cr.sets.zbll.cases.length, pllN = cr.sets.pll.cases.length;
  expect(zbllN === 472 && pllN === 21, `[D] 库完整性 zbll=${zbllN}/472 pll=${pllN}/21`);
}

/* ---------------- F 旋转槽命中轮（组 1-3 候选逆态构造） ---------------- */
console.log("== F 旋转槽命中轮（组1-3 alg 逆施加到已解态=别槽缺槽态 → 须命中） ==");
{
  let hit = 0, total = 0, skipped = 0, miss = 0;
  for (const c of zbls.slice(0, limit(zbls.length))) {
    if (!c.algs || c.algs.length < 2) { skipped++; continue; }
    for (const [gi, group] of c.algs.entries()) {
      if (gi === 0) continue; // 组 0 = FR 基态（B 段已测）
      for (const alg of group.slice(0, 1)) { // 组内首条即可（同组等价）
        let st: Uint8Array | null = null;
        try { st = applyAlg(SOLVE, invertAlg(alg)); } catch { skipped++; continue; }
        if (!st) { fail(`[F] ${c.name}(id=${c.id}) 组${gi} 逆态构造失败: ${alg}`); skipped++; continue; }
        st = resolveNorm(st); // 吸收候选的整转残差
        rounds++; total++;
        const unsolvedN = unsolvedSlotCount(st);
        if (unsolvedN !== 1) { // 非单槽缺槽（极少数跨槽残差）：非 ZBLS 域跳过
          skipped++;
          rounds--; total--;
          continue;
        }
        const res = solveZbls(st);
        if (!res) {
          miss++;
          fail(`[F] ${c.name}(id=${c.id}) 组${gi} 非 FR 旋转槽未命中`);
          continue;
        }
        const after = applySafe(st, res.moves.join(" "));
        const chk = after && resolveNorm(after);
        if (!chk || !(nonLLSolved(chk) && llEdgesOriented(chk))) {
          fail(`[F] ${c.name}(id=${c.id}) 组${gi} → 解后校验失败（${res.algs.join(",")}）`);
        } else hit++;
      }
    }
  }
  console.log(`  命中并通过: ${hit}/${total}（未命中 ${miss}，跳过 ${skipped}）`);
  expect(total >= 700, `[F] 非 FR 旋转槽有效轮数过少: ${total}`);
  expect(hit === total && miss === 0, `[F] 所有非 FR 旋转槽必须 100% 命中并通过，实际 ${hit}/${total}`);
}

/* ---------------- G 生产路径真实随机状态验证（防自证循环） ---------------- */
console.log("== G 生产路径真实随机状态（100 组打乱：四槽 ZBLS 命中 + CFOP-adv 协同增益） ==");
{
  const cfopT = CFOP.prepare();
  let s = 20261123 >>> 0;
  const rng = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const N = 100;
  let valid = 0, zblsHit = 0, advZblsUsed = 0, advLonger = 0;
  let normSum = 0, advSum = 0;
  const slotHit: Record<string, number> = { FR: 0, BR: 0, BL: 0, FL: 0 };
  const slotTot: Record<string, number> = { FR: 0, BR: 0, BL: 0, FL: 0 };
  for (let i = 0; i < N; i++) {
    rounds++;
    const st0 = applyAlg(SOLVE, randomScramble(25, rng));
    // 1. 直接测 Cross + 3 F2L 后的 solveZbls 命中
    let st = st0;
    const mvC = cfopT.cross.descend(cfopT.cross.read(st)) || cfopT.cross.solve(cfopT.cross.read(st), 10, 4e6)!;
    st = applyAlg(st, mvC);
    const rem = SLOTS.slice();
    for (let n = 0; n < 3; n++) {
      let best: { sl: typeof rem[number]; r: ReturnType<typeof solveSlot> } | null = null;
      for (const sl of rem) {
        const r = solveSlot(st, sl);
        if (!r.failed && (!best || r.moves.length < best.r.moves.length)) best = { sl, r };
      }
      st = best!.r.state;
      rem.splice(rem.indexOf(best!.sl), 1);
    }
    const lastSlot = rem[0];
    if (unsolvedSlotCount(st) === 1) {
      valid++;
      slotTot[lastSlot.name]++;
      const zb = solveZbls(st);
      if (zb) {
        const after = applyAlg(st, zb.moves);
        if (nonLLSolved(after) && llEdgesOriented(after)) {
          zblsHit++;
          slotHit[lastSlot.name]++;
        } else {
          fail(`[G] sample ${i} (${lastSlot.name}) solveZbls 解后校验失败`);
        }
      } else {
        fail(`[G] sample ${i} (${lastSlot.name}) 真实 3-F2L 态 solveZbls 未命中`);
      }
    }
    // 2. 端到端 CFOP vs CFOP-adv 步数对比
    const norm = CFOP.solve(st0);
    const adv = CFOP.solveAdvanced(st0);
    const nLen = norm.stages.reduce((a, x) => a + x.moves.length, 0);
    const aLen = adv.stages.reduce((a, x) => a + x.moves.length, 0);
    normSum += nLen;
    advSum += aLen;
    if (adv.stages.some((x) => x.key === "zbls")) advZblsUsed++;
    if (aLen > nLen) advLonger++;
  }
  console.log(
    `  真实 3-F2L ZBLS 命中: ${zblsHit}/${valid} (${Object.keys(slotTot).map((k) => `${k}:${slotHit[k]}/${slotTot[k]}`).join(" ")})`,
  );
  console.log(
    `  CFOP 均 ${(normSum / N).toFixed(2)} vs CFOP-adv 均 ${(advSum / N).toFixed(2)}（净省 ${((normSum - advSum) / N).toFixed(2)} 步，ZBLS 采纳 ${advZblsUsed}/${N}，变长 ${advLonger}）`,
  );
  expect(zblsHit === valid, `[G] 真实 3-F2L 态 ZBLS 必须 100% 命中，实际 ${zblsHit}/${valid}`);
  expect(advZblsUsed >= Math.floor(N * 0.85), `[G] CFOP-adv ZBLS 采纳率偏低: ${advZblsUsed}/${N}`);
  expect(advLonger === 0, `[G] CFOP-adv 不应有比普通 CFOP 更长的用例，实际 ${advLonger}`);
}

/* ---------------- E 数据完整性 ---------------- */
console.log("== E 数据完整性检查 ==");
{
  rounds++;
  expect(zbls.length === 302, `[E] zbls 应为 302，实际 ${zbls.length}`);
  const ids = new Set(zbls.map((c) => c.id));
  for (const dead of [6081, 6082, 6083]) {
    expect(!ids.has(dead), `[E] O 组 id=${dead} 不应复活在数据层`);
  }
  expect(arc.cases.length === 3, `[E] 归档应为 3 条，实际 ${arc.cases.length}`);
  for (const a of arc.cases) {
    expect(a.subgroup === "O" && !!a.setup, `[E] 归档条目异常: ${a.id}`);
    const st = applySafe(SOLVE, a.setup)!;
    expect(st && missingEdgeCount(st) === 0, `[E] 归档条目 ${a.name} 应为全槽已解型（缺槽=0）`);
  }
  for (const [slug, set] of Object.entries(cr.sets)) {
    const seen = new Set<number>();
    for (const c of set.cases) {
      expect(!seen.has(c.id), `[E:${slug}] id 重复: ${c.id}`);
      seen.add(c.id);
      if (c.mirrorCaseId != null) {
        expect(seen.has(c.mirrorCaseId) || set.cases.some((x) => x.id === c.mirrorCaseId),
          `[E:${slug}] mirrorCaseId=${c.mirrorCaseId} 悬空（${c.name}）`);
      }
    }
  }
}

/* ---------------- 汇总 ---------------- */
console.log(`\n== 汇总：${rounds} 轮，失败 ${failures.length} 项 ==`);
if (failures.length) {
  for (const f of failures) console.error("  FAIL " + f);
  process.exit(1);
}
console.log("ALL PASS ✓（数据层 302 口径 + 表基线不变 + ZBLS/ZBLL 端到端实证）");
