/**
 * zbls.ts — ZBLS 一步：最后一组 F2L + 顶层十字 EO（CFOP 高级 solveAdvanced 用）。
 *
 * 数据：cuberoot 302 条 ZBLS case（O 组全槽已解 3 条已按决议剔离数据层，
 *   留档 docs/archived/zbls-ogroup-3-cases.md）。
 *
 * 坐标与槽位归一（2026-11-23 重构，彻底解决旧版 llCode 过拟合与非 FR 槽脱靶）：
 *   1. 缺槽检测：同时检查 4 个 F2L 槽的角+棱（DRF/FR、DBR/BR、DLB/BL、DFL/FL），
 *      必须恰 1 槽未解（同时覆盖原被遗漏的 32 条「棱 home 角乱」case）。
 *   2. 槽位视角归一：用 engine.viewState(state, slot.rotAlg) 将缺槽无损映射到 FR 视角
 *      （其余 3 个已解槽仍为 home，避免旧版整块 y 旋转破坏其余 3 槽 home 判定），
 *      解出 FR 视角公式后再用 transformMove(m, slot.minv) 映回真实魔方。
 *   3. 特征键 zblsKey(view)：仅编码 ZBLS 真正依赖的 3 个维度——
 *      (DRF 角 code, FR 棱 code, 其余 4 个活跃槽 {UF,UR,UB,UL,FR} 上 LL 棱 U 色朝向 4-bit)，
 *      总空间 ≤ 1200（302 条 cuberoot case × 4 AUF 恰好覆盖 100% 合法 ZBLS 态！）。
 *   4. 零中心漂移：建表时用 stripWholeRotations / toFaceMovesOnly 吸收整块旋转与宽层漂移，
 *      保证每条入库公式均为零中心漂移的纯面/安全步，并实测验证 F2L 全解 + LL EO 全 0。
 */
import {
  applyAlg, cubieSolved, normalizeOrientation, parseAlg, pos, readCorner, readEdge, rot,
  rotMatrix, solvedState, stickerIndex, stripWholeRotations, tidyAlg, toFaceMovesOnly,
  transformMove, veq, viewState, CUBIES, EDGE_POS,
} from "./engine.ts";
import type { State, Vec3 } from "./engine.ts";
import { llEdgeFlips } from "./algs.ts";
import cuberootJson from "../../../data/samples/cuberoot-algs.json" with { type: "json" };

type SlotMeta = {
  name: string;
  corner: string;
  edge: string;
  rotAlg: string[];
  minv: Vec3[];
};

/** 四个 F2L 槽位，各带把它无损映到 FR 视角的旋转及逆矩阵（与 cfop.ts SLOTS 同构） */
const ZBLS_SLOTS: SlotMeta[] = ["DRF", "DBR", "DLB", "DFL"].map((corner, i) => {
  const target = pos("DRF"), p = pos(corner);
  let k = 0;
  for (let t = 0; t < 4; t++) if (veq(rot(p, 1, t), target)) k = t;
  const rotAlg = k === 0 ? [] : k === 1 ? ["y"] : k === 2 ? ["y2"] : ["y'"];
  const M = rotMatrix(rotAlg);
  const minv: Vec3[] = [[M[0][0], M[1][0], M[2][0]], [M[0][1], M[1][1], M[2][1]], [M[0][2], M[1][2], M[2][2]]];
  const edge = ["FR", "BR", "BL", "FL"][i];
  return { name: edge, corner, edge, rotAlg, minv };
});

const U_MOVES = ["", "U", "U2", "U'"];
/** 活跃 5 个棱槽：UF(0), UR(1), UB(2), UL(3), FR(8) */
const ACTIVE_SLOTS = [0, 1, 2, 3, 8];

function nonLLSolved(s: State): boolean {
  for (const c of CUBIES) {
    const isLL = c.pos[1] === 1 && c.type !== "center";
    if (!isLL && !cubieSolved(s, c.pos)) return false;
  }
  return true;
}

/** 检测唯一未解 F2L 槽（角或棱任一未 home 视为未解）；全解或缺 >1 槽返回 null */
function findMissingSlot(state: State): SlotMeta | null {
  let missing: SlotMeta | null = null;
  for (const slot of ZBLS_SLOTS) {
    if (!cubieSolved(state, slot.corner) || !cubieSolved(state, slot.edge)) {
      if (missing) return null;
      missing = slot;
    }
  }
  return missing;
}

/**
 * FR 视角下的 ZBLS 特征键（空间 ≤ 1200）：
 *   (DRF 角 code, FR 棱 code, 其余 4 个活跃槽上 LL 棱 U 色贴纸朝向 4-bit)。
 * 不编码 LL 角置换/朝向或 LL 棱置换，故真实任意 LL 态均可 100% 命中对应 ZBLS case。
 */
export function zblsKey(view: State): number {
  const cc = readCorner(view, "DRF");
  const ec = readEdge(view, "FR");
  if (cc < 0 || ec < 0) return -1;
  const frSlot = ec >> 1;
  let eoBits = 0;
  let bit = 0;
  for (const slot of ACTIVE_SLOTS) {
    if (slot === frSlot) continue;
    const p = EDGE_POS[slot];
    const bad = slot < 4
      ? (view[stickerIndex(p, [0, 1, 0])] === 0 ? 0 : 1)
      : (view[stickerIndex(p, [0, 0, 1])] === 0 ? 0 : 1);
    eoBits |= bad << bit++;
  }
  return ((cc * 24 + ec) << 4) | eoBits;
}

/** 归一后的特征键（先归位中心、把唯一缺槽映到 FR 视角、再取 4 种 AUF 最小键）；非 ZBLS 态返回 -1 */
export function normalize(state: State): number {
  let s = state;
  try { s = normalizeOrientation(state).state; } catch { /* 保持原状态 */ }
  const slot = findMissingSlot(s);
  if (!slot) return -1;
  const view = viewState(s, slot.rotAlg);
  let best = zblsKey(view);
  for (let um = 1; um < 4; um++) {
    const k = zblsKey(applyAlg(view, [U_MOVES[um]]));
    if (k >= 0 && (best < 0 || k < best)) best = k;
  }
  return best;
}

const RAW = (cuberootJson as {
  sets: { zbls: { cases: Array<{ name: string; subgroup: string | null; setup: string | null; algs: string[][] }> } };
}).sets.zbls;

export type ZBLSEntry = { moves: string[]; name: string };
export type ZBLSTables = {
  table: Map<number, ZBLSEntry[]>;
  skipped: Array<{ name: string; reason: string }>;
  ms: number;
  genCount: number;
};

let TABLES: ZBLSTables | null = null;
export function prepare(): ZBLSTables {
  if (TABLES) return TABLES;
  const t0 = Date.now();
  const table = new Map<number, ZBLSEntry[]>();
  const skipped: Array<{ name: string; reason: string }> = [];
  let genCount = 0;

  for (const c of RAW.cases) {
    let setupMoves: string[];
    try { setupMoves = parseAlg(c.setup ?? ""); } catch (e) {
      skipped.push({ name: c.name, reason: `setup parse: ${String(e)}` });
      continue;
    }
    if (!setupMoves.length) {
      skipped.push({ name: c.name, reason: "empty setup" });
      continue;
    }
    const st = normalizeOrientation(applyAlg(solvedState(), setupMoves)).state;
    const slot = findMissingSlot(st);
    if (!slot || slot.name !== "FR") {
      skipped.push({ name: c.name, reason: `setup missing slot=${slot?.name ?? "none/multi"}` });
      continue;
    }
    const key = zblsKey(st);
    if (key < 0) {
      skipped.push({ name: c.name, reason: "invalid zblsKey" });
      continue;
    }

    const list = table.get(key) ?? [];
    const seen = new Set(list.map((e) => e.moves.join(" ")));
    let addedForCase = 0;

    // 组 0 为 FR 槽候选公式；先尝试消整转（保留人类手感步），若有中心漂移再展开宽层为纯面步
    const group0 = c.algs?.[0] ?? [];
    for (const alg of group0) {
      let raw: string[];
      try { raw = parseAlg(alg); } catch { continue; }
      if (!raw.length) continue;

      let moves = stripWholeRotations(raw);
      let after = applyAlg(st, moves);
      if (normalizeOrientation(after).alg.length > 0) {
        moves = toFaceMovesOnly(raw);
        after = applyAlg(st, moves);
      }
      if (!moves.length || normalizeOrientation(after).alg.length > 0) continue;
      if (!(nonLLSolved(after) && llEdgeFlips(after).every((f) => !f))) continue;

      const sig = moves.join(" ");
      if (!seen.has(sig)) {
        seen.add(sig);
        list.push({ moves, name: c.name });
        genCount++;
      }
      addedForCase++;
    }

    if (addedForCase === 0) {
      skipped.push({ name: c.name, reason: "no valid group0 alg" });
    } else {
      list.sort((a, b) => a.moves.length - b.moves.length);
      table.set(key, list);
    }
  }

  TABLES = { table, skipped, ms: Date.now() - t0, genCount };
  return TABLES;
}

export type ZBLStage = {
  key: "zbls";
  label: string;
  short: string;
  moves: string[];
  algs: string[];
};

/** 对「3 组 F2L 完成 + 1 组未解」的状态做 ZBLS 一步（支持 FR/BR/BL/FL 四槽）；无匹配返回 null。 */
export function solveZbls(state0: State): ZBLStage | null {
  const T = prepare();
  const slot = findMissingSlot(state0);
  if (!slot) return null;

  const view0 = viewState(state0, slot.rotAlg);
  let best: { moves: string[]; name: string } | null = null;

  for (let um = 0; um < 4; um++) {
    const view = um ? applyAlg(view0, [U_MOVES[um]]) : view0;
    const cands = T.table.get(zblsKey(view));
    if (!cands || !cands.length) continue;

    for (const cand of cands) {
      const seqView = um ? tidyAlg([U_MOVES[um], ...cand.moves]) : cand.moves;
      if (best && seqView.length >= best.moves.length) continue;
      const realMoves = seqView.map((m) => transformMove(m, slot.minv));
      const after = applyAlg(state0, realMoves);
      if (nonLLSolved(after) && llEdgeFlips(after).every((f) => !f)) {
        best = { moves: realMoves, name: cand.name };
        break; // cands 已按步长升序，首个通过者即本 um 最短
      }
    }
  }

  if (!best) return null;
  return {
    key: "zbls",
    label: "最后一组 F2L + 顶层十字 (ZBLS)",
    short: "ZBLS",
    moves: best.moves,
    algs: [best.name],
  };
}

export const ZBLS = { prepare, solveZbls, normalize, zblsKey };
