/**
 * search.ts — ItemSolver：子集模式数据库 (PDB) + IDA*（移植自 rubik-cube.html search.js）。
 *
 * 求解对象是"物品"（棱/角/中心块），每个物品的 24/6-值 code 表示它在哪个槽位、
 * 如何朝向。搜索在 code 空间推进（每步查表），不碰贴纸。
 */
import {
  CORNER_MOVE, CENTER_MOVE, EDGE_MOVE, MOVES, applyAlg, cubieSolved, cubieSolvedAt,
  centerHomeCode, cornerHomeCode, edgeHomeCode, readCenter, readCorner, readEdge, solvedState,
  type State,
} from "./engine.ts";

export type ItemKind = "edge" | "corner" | "center";
export type Item = { kind: ItemKind; home: string };
export type PDB = { sub: number[]; strides: number[]; sizes: number[]; dist: Uint8Array };
export type PDBResult = { sub: number[]; strides: number[]; sizes: number[]; dist: Uint8Array };

export const itemEdge = (home: string): Item => ({ kind: "edge", home });
export const itemCorner = (home: string): Item => ({ kind: "corner", home });
export const itemCenter = (home: string): Item => ({ kind: "center", home });

const SIZE_OF: Record<ItemKind, number> = { edge: 24, corner: 24, center: 6 };
export const itemSize = (it: Item): number => SIZE_OF[it.kind];

function moveTable(kind: ItemKind, mv: string): Uint8Array {
  return kind === "edge" ? EDGE_MOVE[mv] : kind === "corner" ? CORNER_MOVE[mv] : CENTER_MOVE[mv];
}
function readItem(state: State, it: Item): number {
  return it.kind === "edge" ? readEdge(state, it.home) : it.kind === "corner" ? readCorner(state, it.home) : readCenter(state, it.home);
}
function homeOf(it: Item): number {
  return it.kind === "edge" ? edgeHomeCode(it.home) : it.kind === "corner" ? cornerHomeCode(it.home) : centerHomeCode(it.home);
}

const BASE_ORDER = ["U", "u", "E", "d", "D", "R", "r", "M", "l", "L", "F", "f", "S", "b", "B", "x", "y", "z"];
const baseRank = (b: string): number => BASE_ORDER.indexOf(b);

/** 哪些步可跟在哪些步后——杀掉同面合并与同轴交换的重复顺序 */
export function buildAllowed(moveNames: string[]): Uint8Array[] {
  const n = moveNames.length, ok: Uint8Array[] = [];
  for (let i = 0; i < n; i++) {
    const a = MOVES[moveNames[i]];
    const row = new Uint8Array(n);
    for (let j = 0; j < n; j++) {
      const b = MOVES[moveNames[j]];
      let allow = true;
      if (a.base === b.base) allow = false;
      else if (a.axis === b.axis && !a.layers.some((l) => b.layers.includes(l))) {
        if (baseRank(b.base) < baseRank(a.base)) allow = false;
      }
      row[j] = allow ? 1 : 0;
    }
    ok.push(row);
  }
  return ok;
}

export function combinations(n: number, k: number): number[][] {
  const out: number[][] = [], cur: number[] = [];
  (function rec(start: number): void {
    if (cur.length === k) { out.push(cur.slice()); return; }
    for (let i = start; i < n; i++) { cur.push(i); rec(i + 1); cur.pop(); }
  })(0);
  return out;
}

export type ItemSolverOptions = {
  subsetSize?: number;
  goalCodes?: number[][];
  name?: string;
};

export class ItemSolver {
  readonly items: Item[];
  readonly moves: string[];
  readonly name: string;
  private readonly sizes: number[];
  private readonly tabs: Uint8Array[][];
  private readonly allowed: Uint8Array[];
  private readonly goalCodes: number[][];
  private readonly goalMask: Uint8Array[];
  readonly subsets: number[][];
  private readonly pdbs: PDB[];
  readonly exact: boolean;
  nodes = 0;

  constructor(items: Item[], moveNames: string[], opts: ItemSolverOptions = {}) {
    this.items = items;
    this.moves = moveNames.slice();
    this.name = opts.name || "stage";
    this.sizes = items.map((it) => SIZE_OF[it.kind]);
    this.tabs = this.moves.map((mv) => items.map((it) => moveTable(it.kind, mv)));
    this.allowed = buildAllowed(this.moves);
    this.goalCodes = items.map((it, i) => {
      const g = opts.goalCodes && opts.goalCodes[i];
      return g && g.length ? Array.from(new Set(g)) : [homeOf(it)];
    });
    this.goalMask = this.goalCodes.map((codes, i) => {
      const m = new Uint8Array(this.sizes[i]);
      for (const c of codes) m[c] = 1;
      return m;
    });
    const k = Math.min(opts.subsetSize || 3, items.length);
    this.subsets = items.length <= k ? [items.map((_, i) => i)] : combinations(items.length, k);
    this.pdbs = this.subsets.map((sub) => this.buildPDB(sub));
    this.exact = this.subsets.length === 1 && this.subsets[0].length === items.length;
  }

  buildPDB(sub: number[]): PDBResult {
    const sizes = sub.map((i) => this.sizes[i]);
    const strides: number[] = [];
    let total = 1;
    for (let j = 0; j < sub.length; j++) { strides.push(total); total *= sizes[j]; }
    const dist = new Uint8Array(total).fill(255);
    const seeds: number[] = [];
    const self = this;
    (function enumerate(j: number, idx: number): void {
      if (j === sub.length) { if (dist[idx] === 255) { dist[idx] = 0; seeds.push(idx); } return; }
      for (const c of self.goalCodes[sub[j]]) enumerate(j + 1, idx + c * strides[j]);
    })(0, 0);
    const codes = new Int32Array(sub.length);
    let cur = Int32Array.from(seeds);
    for (let d = 0; cur.length; d++) {
      const next: number[] = [];
      for (let fi = 0; fi < cur.length; fi++) {
        const idx = cur[fi];
        for (let j = 0; j < sub.length; j++) codes[j] = ((idx / strides[j]) | 0) % sizes[j];
        for (let m = 0; m < this.moves.length; m++) {
          const tab = this.tabs[m];
          let nidx = 0;
          for (let j = 0; j < sub.length; j++) nidx += tab[sub[j]][codes[j]] * strides[j];
          if (dist[nidx] === 255) { dist[nidx] = d + 1; next.push(nidx); }
        }
      }
      cur = Int32Array.from(next);
    }
    return { sub, strides, sizes, dist };
  }

  read(state: State): number[] { return this.items.map((it) => readItem(state, it)); }
  isGoal(codes: number[]): boolean {
    for (let i = 0; i < codes.length; i++) if (!this.goalMask[i][codes[i]]) return false;
    return true;
  }

  h(codes: number[]): number {
    let best = 0;
    for (let p = 0; p < this.pdbs.length; p++) {
      const { sub, strides, dist } = this.pdbs[p];
      let idx = 0;
      for (let j = 0; j < sub.length; j++) idx += codes[sub[j]] * strides[j];
      const d = dist[idx];
      if (d > best) best = d;
    }
    return best;
  }

  /** IDA*：返回步名数组；budget 内解不出返回 null */
  solve(codes0: number[], maxDepth = 14, budget = 3e6): string[] | null {
    const n = this.items.length, nm = this.moves.length;
    const codes = codes0.slice();
    if (this.isGoal(codes)) return [];
    this.nodes = 0;
    const path = new Int32Array(maxDepth + 2);
    const scratch: Int32Array[] = [];
    for (let d = 0; d <= maxDepth + 1; d++) scratch.push(new Int32Array(n));
    const self = this;
    let over = false;

    function dfs(cur: Int32Array | number[], depth: number, limit: number, last: number): number {
      const hv = self.h(cur as number[]);
      if (hv === 0 && self.isGoal(cur as number[])) return depth;
      if (depth + hv > limit) return -1;
      if (++self.nodes > budget) { over = true; return -1; }
      for (let m = 0; m < nm; m++) {
        if (last >= 0 && !self.allowed[last][m]) continue;
        const nxt = scratch[depth];
        const tab = self.tabs[m];
        for (let i = 0; i < n; i++) nxt[i] = tab[i][cur[i]];
        path[depth] = m;
        const r = dfs(nxt, depth + 1, limit, m);
        if (r >= 0) return r;
        if (over) return -1;
      }
      return -1;
    }

    for (let limit = this.h(codes); limit <= maxDepth; limit++) {
      over = false;
      const r = dfs(codes, 0, limit, -1);
      if (r >= 0) { const out: string[] = []; for (let i = 0; i < r; i++) out.push(this.moves[path[i]]); return out; }
      if (over) return null;
    }
    return null;
  }

  /** exact PDB（单个覆盖全部物品的子集）→ 沿 PDB 最优下坡 */
  descend(codes0: number[]): string[] | null {
    if (!this.exact) return null;
    const { sub, strides, dist } = this.pdbs[0];
    const idxOf = (c: number[]): number => { let i = 0; for (let j = 0; j < sub.length; j++) i += c[sub[j]] * strides[j]; return i; };
    let codes = codes0.slice(), d = dist[idxOf(codes)];
    if (d === 255) return null;
    const out: string[] = [];
    let guard = 0;
    while (d > 0 && guard++ < 64) {
      let stepped = false;
      for (let m = 0; m < this.moves.length && !stepped; m++) {
        const tab = this.tabs[m];
        const nxt = codes.map((c, i) => tab[i][c]);
        if (dist[idxOf(nxt)] === d - 1) { out.push(this.moves[m]); codes = nxt; d--; stepped = true; }
      }
      if (!stepped) return null;
    }
    return out;
  }
}

export { cubieSolved, cubieSolvedAt, applyAlg, solvedState };