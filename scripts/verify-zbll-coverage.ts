// ZBLL 覆盖回归工具（node 直接运行，Node ≥ 22 原生 TS strip-types）：
//   node scripts/verify-zbll-coverage.ts
// 依据 .research_zbll 结论（per_set_coverage2.mjs / sticker_analysis.mjs）：
//   - cuberoot 472 case 的「family 并集」= 每 case 的 {case, mirror(case), inverse(case),
//     mirror-inverse(case)} 在「中心归位 + 4 种 AUF」canon 下的不同轨道总数。
//   - 当前断言：TOTAL=926（1872 非 PLL 轨道的 49.5%），各 set 覆盖见下。
// 前置一致性校验（R6）：mirrorAlg（算法级 M2 记谱）与 mirrorState（贴纸级 x 平面
//  反射 + R↔L 重标）必须逐单步与随机序列完全一致，否则工具直接失败。
import { readFileSync } from "fs";
import {
  MOVE_NAMES,
  applyAlg,
  applyMove,
  invertAlg,
  mirrorAlg,
  mirrorState,
  normalizeOrientation,
  randomScramble,
  solvedState,
} from "../src/cube/solver/engine.ts";

let failures = 0;
function expect(cond: boolean, msg: string): void {
  if (!cond) { failures++; console.error("  FAIL: " + msg); }
}
function check(title: string, fn: () => void): void {
  console.log("== " + title);
  fn();
  if (failures) throw new Error(`${failures} FAILURE(S) after [${title}]`);
}

// ------------------------------------------------------------ mirror 一致性 --
check("mirror: mirrorAlg 与 mirrorState 恒等式", () => {
  const solved = solvedState();
  const eq = (a: Uint8Array, b: Uint8Array) => { for (let i = 0; i < 54; i++) if (a[i] !== b[i]) return false; return true; };
  for (const n of MOVE_NAMES) {
    const lhs = applyMove(solved, mirrorAlg(n)[0] ?? n);
    const rhs = mirrorState(applyMove(solved, n));
    expect(eq(lhs, rhs), `单步 ${n} 镜像：apply(mirrorAlg) 应等于 mirrorState(apply)`);
  }
  for (let t = 0; t < 300; t++) {
    const alg = randomScramble(2 + ((t * 7) % 7));
    const lhs = applyAlg(solved, mirrorAlg(alg));
    const rhs = mirrorState(applyAlg(solved, alg));
    expect(eq(lhs, rhs), `序列 ${alg.join(" ")} 镜像恒等式`);
  }
  // mirror 对合：mirror(mirror(A)) == A
  for (let t = 0; t < 200; t++) {
    const alg = randomScramble(10);
    expect(mirrorAlg(mirrorAlg(alg)).join(" ") === alg.join(" "), `mirror 对合 ${alg.join(" ")}`);
  }
});

// ------------------------------------------------------------ coverage 核算 --
check("zbll coverage: family 并集 = 926", () => {
  const data = JSON.parse(readFileSync("data/samples/cuberoot-algs.json", "utf8")) as {
    sets: { zbll: { cases: Array<{ name: string; setup?: string }> } };
  };
  const cases = data.sets.zbll.cases;
  const solved = solvedState();
  const stKey = (s: Uint8Array) => Buffer.from(s).toString("base64");
  const canon = (state: Uint8Array): string | null => {
    const norm = normalizeOrientation(state);
    let best: string | null = null;
    let cur = norm.state;
    for (let k = 0; k < 4; k++) {
      const kk = stKey(cur);
      if (!best || kk < best) best = kk;
      cur = applyMove(cur, "U");
    }
    return best;
  };
  const TRUE: Record<string, number> = { T: 288, U: 288, L: 288, Pi: 288, S: 288, AS: 288, H: 144 };
  const setOf = (n: string) => n.split(" ")[1];
  const perSetFam = new Map<string, Set<string>>();
  const allFam = new Set<string>();
  const EXPECTED: Record<string, number> = { T: 148, U: 152, L: 226, Pi: 148, S: 232, AS: 234, H: 87 };

  for (const c of cases) {
    if (!c.setup) continue;
    const st = applyAlg(solved, c.setup);
    const invSt = applyAlg(solved, invertAlg(c.setup));
    const keys = [canon(st), canon(mirrorState(st)), canon(invSt), canon(mirrorState(invSt))].filter(Boolean) as string[];
    const set = setOf(c.name);
    if (!perSetFam.has(set)) perSetFam.set(set, new Set());
    for (const k of keys) { perSetFam.get(set)!.add(k); allFam.add(k); }
  }

  expect(cases.length === 472, `cases 应 472，实际 ${cases.length}`);
  for (const [set, fam] of [...perSetFam.entries()].sort()) {
    const e = EXPECTED[set];
    expect(e !== undefined, `未知 set ${set}`);
    if (e !== undefined) {
      const cov = (100 * fam.size / TRUE[set]).toFixed(1);
      expect(fam.size === e, `${set}: family-union 应 ${e}，实际 ${fam.size}（${cov}%）`);
      console.log(`  ${set}: family=${fam.size}/${TRUE[set]} (${cov}%)`);
    }
  }
  expect(allFam.size === 926, `TOTAL family union 应 926，实际 ${allFam.size}`);
  console.log(`  TOTAL family union (AUF-orbits): ${allFam.size}  = 49.5% of non-PLL 1872, 47.6% of 1944`);
});

if (failures) throw new Error(`${failures} FAILURE(S)`);
console.log("\nALL PASS");