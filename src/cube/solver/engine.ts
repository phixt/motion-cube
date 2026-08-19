/**
 * engine.ts — 3x3 贴纸级引擎（移植自 rubik-cube.html engine.js，仅状态/转动/块读取）。
 *
 * 状态 = Uint8Array(54)，按 face 顺序 U R F D L B 各 9 个贴纸。
 * 颜色 id = 面序号（U=0 R=1 F=2 D=3 L=4 B=5）。坐标系右手系：
 *   +x → R 面，+y → U 面，+z → F 面。
 * 块的 24-值 code（棱 slot*2+ori / 角 slot*3+ori / 中心 6 槽无朝向）供求解器
 * O(1) 推进，搜索过程不碰贴纸。
 */

export type Vec3 = [number, number, number];
export type State = Uint8Array;
export type CubieType = "center" | "edge" | "corner";
export type CubieSticker = { face: number; normal: Vec3; index: number };
export type Cubie = { i: number; pos: Vec3; stickers: CubieSticker[]; type: CubieType };
export type Move = {
  name: string;
  base: string;
  turns: number;
  axis: number;
  layers: number[];
  amount: number;
  perm: Uint8Array;
  dest: Uint8Array;
  isWholeCube: boolean;
  inverse: string;
};
export type Orientation = { state: State; matrix: Vec3[]; inverse: Vec3[]; alg: string[] };

export const FACE_NAMES = ["U", "R", "F", "D", "L", "B"] as const;
export const FACE_NORMAL: Vec3[] = [[0, 1, 0], [1, 0, 0], [0, 0, 1], [0, -1, 0], [-1, 0, 0], [0, 0, -1]];
// 每个面在展开图内的"上"方向
export const FACE_UP: Vec3[] = [[0, 0, -1], [0, 1, 0], [0, 1, 0], [0, 0, 1], [0, 1, 0], [0, 1, 0]];

const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const veq = (a: Vec3, b: Vec3): boolean => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
export function faceOfNormal(n: Vec3): number {
  for (let f = 0; f < 6; f++) if (veq(FACE_NORMAL[f], n)) return f;
  return -1;
}

/** 立方体位置 `pos` 处、朝向外法线 `n` 的贴纸索引 */
export function stickerIndex(pos: Vec3, n: Vec3): number {
  const f = faceOfNormal(n);
  const u = FACE_UP[f];
  const r = cross(u, FACE_NORMAL[f]);
  return f * 9 + (1 - dot(pos, u)) * 3 + (1 + dot(pos, r));
}

/** 整数向量旋转：`amount` 个顺时针 90°（从 +axis 方向看） */
export function rot(v: Vec3, axis: number, amount: number): Vec3 {
  let x = v[0], y = v[1], z = v[2];
  const n = ((amount % 4) + 4) % 4;
  for (let i = 0; i < n; i++) {
    if (axis === 0) { const ny = z, nz = -y; y = ny; z = nz; }
    else if (axis === 1) { const nx = -z, nz = x; x = nx; z = nz; }
    else { const nx = y, ny = -x; x = nx; y = ny; }
  }
  return [x, y, z];
}

// ---------------------------------------------------------------- cubies ----
const ALL_POS: Vec3[] = [];
for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
  if (x || y || z) ALL_POS.push([x, y, z]);
}
export const posKey = (p: Vec3): number => (p[0] + 1) * 9 + (p[1] + 1) * 3 + (p[2] + 1);
export const CUBIE_INDEX: Record<number, number> = {};
export const CUBIES: Cubie[] = ALL_POS.map((pos, i) => {
  CUBIE_INDEX[posKey(pos)] = i;
  const stickers: CubieSticker[] = [];
  for (let f = 0; f < 6; f++) {
    if (dot(pos, FACE_NORMAL[f]) === 1) stickers.push({ face: f, normal: FACE_NORMAL[f], index: stickerIndex(pos, FACE_NORMAL[f]) });
  }
  const t = Math.abs(pos[0]) + Math.abs(pos[1]) + Math.abs(pos[2]);
  return { i, pos, stickers, type: (t === 1 ? "center" : t === 2 ? "edge" : "corner") as CubieType };
});

export const STICKER_POS: Vec3[] = new Array(54);
export const STICKER_NORMAL: Vec3[] = new Array(54);
for (const c of CUBIES) for (const s of c.stickers) { STICKER_POS[s.index] = c.pos; STICKER_NORMAL[s.index] = s.normal; }

/** 面字母名 → 位置向量，如 "UF"→[0,1,1]，"DLF"→[-1,-1,1] */
export function pos(name: string): Vec3 {
  const p: Vec3 = [0, 0, 0];
  for (const ch of name) {
    const f = FACE_NAMES.indexOf(ch as (typeof FACE_NAMES)[number]);
    if (f < 0) throw new Error("bad piece name " + name);
    const n = FACE_NORMAL[f];
    p[0] += n[0]; p[1] += n[1]; p[2] += n[2];
  }
  return p;
}

export const EDGE_NAMES = ["UF", "UR", "UB", "UL", "DF", "DR", "DB", "DL", "FR", "FL", "BR", "BL"];
export const CORNER_NAMES = ["UFR", "URB", "UBL", "ULF", "DRF", "DFL", "DLB", "DBR"];
export const EDGE_POS: Vec3[] = EDGE_NAMES.map(pos);
export const CORNER_POS: Vec3[] = CORNER_NAMES.map(pos);
export const edgeSlot: Record<number, number> = {}; EDGE_POS.forEach((p, i) => { edgeSlot[posKey(p)] = i; });
export const cornerSlot: Record<number, number> = {}; CORNER_POS.forEach((p, i) => { cornerSlot[posKey(p)] = i; });

/** 立方体位置的法线，按轴序（x,y,z）排列 */
export function normalsOf(p: Vec3): Vec3[] {
  const out: Vec3[] = [];
  for (let a = 0; a < 3; a++) if (p[a] !== 0) { const n: Vec3 = [0, 0, 0]; n[a] = p[a]; out.push(n); }
  return out;
}

// ----------------------------------------------------------------- moves ----
//  cw = +1：从 +axis 侧看顺时针 90°
const BASE: Record<string, { axis: number; layers: number[]; cw: number }> = {
  U: { axis: 1, layers: [1], cw: 1 }, D: { axis: 1, layers: [-1], cw: -1 }, E: { axis: 1, layers: [0], cw: -1 },
  R: { axis: 0, layers: [1], cw: 1 }, L: { axis: 0, layers: [-1], cw: -1 }, M: { axis: 0, layers: [0], cw: -1 },
  F: { axis: 2, layers: [1], cw: 1 }, B: { axis: 2, layers: [-1], cw: -1 }, S: { axis: 2, layers: [0], cw: 1 },
  u: { axis: 1, layers: [0, 1], cw: 1 }, d: { axis: 1, layers: [-1, 0], cw: -1 },
  r: { axis: 0, layers: [0, 1], cw: 1 }, l: { axis: 0, layers: [-1, 0], cw: -1 },
  f: { axis: 2, layers: [0, 1], cw: 1 }, b: { axis: 2, layers: [-1, 0], cw: -1 },
  x: { axis: 0, layers: [-1, 0, 1], cw: 1 }, y: { axis: 1, layers: [-1, 0, 1], cw: 1 }, z: { axis: 2, layers: [-1, 0, 1], cw: 1 },
};
const ALIAS: Record<string, string> = { Uw: "u", Dw: "d", Rw: "r", Lw: "l", Fw: "f", Bw: "b", X: "x", Y: "y", Z: "z" };

export const MOVES: Record<string, Move> = {};
export const MOVE_NAMES: string[] = [];
function buildMove(base: string, turns: number): Move {
  const b = BASE[base];
  const amount = ((b.cw * turns) % 4 + 4) % 4;
  const name = base + (turns === 1 ? "" : turns === 2 ? "2" : "'");
  const dest = new Uint8Array(54);
  for (let i = 0; i < 54; i++) {
    const p = STICKER_POS[i], n = STICKER_NORMAL[i];
    if (b.layers.includes(p[b.axis])) dest[i] = stickerIndex(rot(p, b.axis, amount), rot(n, b.axis, amount));
    else dest[i] = i;
  }
  const perm = new Uint8Array(54); // gather 形式：next[i] = cur[perm[i]]
  for (let i = 0; i < 54; i++) perm[dest[i]] = i;
  const m: Move = {
    name, base, turns, axis: b.axis, layers: b.layers.slice(), amount, perm, dest,
    isWholeCube: b.layers.length === 3,
    inverse: base + (turns === 1 ? "'" : turns === 2 ? "2" : ""),
  };
  MOVES[name] = m; MOVE_NAMES.push(name);
  return m;
}
for (const base of Object.keys(BASE)) for (const t of [1, 2, 3]) buildMove(base, t);

export const FACE_MOVES: string[] = [];
for (const base of ["U", "R", "F", "D", "L", "B"]) for (const t of [1, 2, 3]) FACE_MOVES.push(base + (t === 1 ? "" : t === 2 ? "2" : "'"));

export function parseAlg(s: string | string[]): string[] {
  if (Array.isArray(s)) return s.slice();
  const out: string[] = [];
  const re = /([UDLRFBMESudlrfbxyzXYZ]w?|Uw|Dw|Rw|Lw|Fw|Bw)(2|'|’)?/g;
  let m: RegExpExecArray | null;
  const str = String(s).replace(/[()]/g, " ");
  while ((m = re.exec(str))) {
    let base = m[1];
    if (ALIAS[base]) base = ALIAS[base];
    if (base.length === 2 && base[1] === "w") base = ALIAS[base] || base[0].toLowerCase();
    if (!BASE[base]) throw new Error("unknown move: " + m[0]);
    const suf = m[2] === "2" ? "2" : m[2] ? "'" : "";
    out.push(base + suf);
  }
  return out;
}
export const invertAlg = (alg: string | string[]): string[] => parseAlg(alg).slice().reverse().map((n) => MOVES[n].inverse);
export const algString = (alg: string | string[]): string => parseAlg(alg).join(" ");

export const solvedState = (): State => { const s = new Uint8Array(54); for (let i = 0; i < 54; i++) s[i] = (i / 9) | 0; return s; };

export function applyMove(state: State, name: string): State {
  const p = MOVES[name].perm, out = new Uint8Array(54);
  for (let i = 0; i < 54; i++) out[i] = state[p[i]];
  return out;
}
export function applyAlg(state: State, alg: string | string[]): State {
  let s = state;
  for (const n of parseAlg(alg)) s = applyMove(s, n);
  return s;
}

const SOLVED = solvedState();
export const isSolved = (s: State): boolean => { for (let i = 0; i < 54; i++) if (s[i] !== SOLVED[i]) return false; return true; };
/** 六面各自同色（整块旋转意义下的已还原） */
export function isUniform(s: State): boolean {
  for (let f = 0; f < 6; f++) { const c = s[f * 9 + 4]; for (let k = 0; k < 9; k++) if (s[f * 9 + k] !== c) return false; }
  return true;
}

export function cubieSolvedAt(state: State, p: Vec3): boolean {
  const c = CUBIES[CUBIE_INDEX[posKey(p)]];
  for (const s of c.stickers) if (state[s.index] !== s.face) return false;
  return true;
}
export const cubieSolved = (state: State, name: string | Vec3): boolean => cubieSolvedAt(state, typeof name === "string" ? pos(name) : name);

// ------------------------------------------------- piece state (24 codes) --
// 棱 code = slot*2 + ori；ori：槽位哪个法线承载"home 第一法线"的颜色
// 角 code = slot*3 + ori；ori：承载"home x 法线"颜色的法线轴
export function edgeCode(slotIdx: number, carrier: Vec3): number {
  const ns = normalsOf(EDGE_POS[slotIdx]);
  return slotIdx * 2 + (veq(ns[0], carrier) ? 0 : 1);
}
export function edgeDecode(code: number): { slot: number; carrier: Vec3 } {
  const slotIdx = code >> 1, ns = normalsOf(EDGE_POS[slotIdx]);
  return { slot: slotIdx, carrier: ns[code & 1] };
}
export function cornerCode(slotIdx: number, carrier: Vec3): number {
  let a = 0; for (let i = 0; i < 3; i++) if (carrier[i] !== 0) a = i;
  return slotIdx * 3 + a;
}
export function cornerDecode(code: number): { slot: number; carrier: Vec3 } {
  const slotIdx = (code / 3) | 0, a = code % 3, p = CORNER_POS[slotIdx];
  const n: Vec3 = [0, 0, 0]; n[a] = p[a];
  return { slot: slotIdx, carrier: n };
}
// 中心：6 槽无朝向（Roux LSE 需要，因为 M 会转动中心）
export const CENTER_NAMES = ["U", "R", "F", "D", "L", "B"];
export const CENTER_POS: Vec3[] = CENTER_NAMES.map(pos);
export const centerSlot: Record<number, number> = {}; CENTER_POS.forEach((p, i) => { centerSlot[posKey(p)] = i; });
export function readCenter(state: State, homeName: string | number): number {
  const col = typeof homeName === "string" ? FACE_NAMES.indexOf(homeName as (typeof FACE_NAMES)[number]) : homeName;
  for (let s = 0; s < 6; s++) if (state[stickerIndex(CENTER_POS[s], normalsOf(CENTER_POS[s])[0])] === col) return s;
  return -1;
}
export const centerHomeCode = (homeName: string | number): number => (typeof homeName === "string" ? FACE_NAMES.indexOf(homeName as (typeof FACE_NAMES)[number]) : homeName);

// piece code 上的转动表
export const EDGE_MOVE: Record<string, Uint8Array> = {};
export const CORNER_MOVE: Record<string, Uint8Array> = {};
export const CENTER_MOVE: Record<string, Uint8Array> = {};
for (const name of MOVE_NAMES) {
  const m = MOVES[name];
  const et = new Uint8Array(24), ct = new Uint8Array(24);
  for (let c = 0; c < 24; c++) {
    const d = edgeDecode(c), p = EDGE_POS[d.slot];
    if (m.layers.includes(p[m.axis])) et[c] = edgeCode(edgeSlot[posKey(rot(p, m.axis, m.amount))], rot(d.carrier, m.axis, m.amount));
    else et[c] = c;
  }
  for (let c = 0; c < 24; c++) {
    const d = cornerDecode(c), p = CORNER_POS[d.slot];
    if (m.layers.includes(p[m.axis])) ct[c] = cornerCode(cornerSlot[posKey(rot(p, m.axis, m.amount))], rot(d.carrier, m.axis, m.amount));
    else ct[c] = c;
  }
  const kt = new Uint8Array(6);
  for (let c = 0; c < 6; c++) {
    const p = CENTER_POS[c];
    kt[c] = m.layers.includes(p[m.axis]) ? centerSlot[posKey(rot(p, m.axis, m.amount))] : c;
  }
  EDGE_MOVE[name] = et; CORNER_MOVE[name] = ct; CENTER_MOVE[name] = kt;
}

/** 读取 home 槽位为 `homeName` 的棱块的当前 code */
export function readEdge(state: State, homeName: string | Vec3): number {
  const home = typeof homeName === "string" ? pos(homeName) : homeName;
  const hn = normalsOf(home);
  const c0 = faceOfNormal(hn[0]), c1 = faceOfNormal(hn[1]);
  for (let s = 0; s < 12; s++) {
    const q = EDGE_POS[s], ns = normalsOf(q);
    const a = state[stickerIndex(q, ns[0])], b = state[stickerIndex(q, ns[1])];
    if (a === c0 && b === c1) return s * 2 + 0;
    if (a === c1 && b === c0) return s * 2 + 1;
  }
  return -1;
}
export function readCorner(state: State, homeName: string | Vec3): number {
  const home = typeof homeName === "string" ? pos(homeName) : homeName;
  const hn = normalsOf(home);
  const cols = hn.map(faceOfNormal);
  for (let s = 0; s < 8; s++) {
    const q = CORNER_POS[s], ns = normalsOf(q);
    const got = ns.map((n) => state[stickerIndex(q, n)]);
    if (got.slice().sort().join() !== cols.slice().sort().join()) continue;
    const a = got.indexOf(cols[0]);
    return s * 3 + a;
  }
  return -1;
}
export const edgeHomeCode = (homeName: string | Vec3): number => { const s = edgeSlot[posKey(typeof homeName === "string" ? pos(homeName) : homeName)]; return s * 2; };
export const cornerHomeCode = (homeName: string | Vec3): number => {
  const p = typeof homeName === "string" ? pos(homeName) : homeName;
  const s = cornerSlot[posKey(p)];
  return s * 3 + 0; // x 法线承载自身颜色
};

// ------------------------------------------------- whole cube orientation --
const ROTATIONS: { alg: string[]; state: State }[] = (() => {
  const seen = new Map<string, boolean>(), out: { alg: string[]; state: State }[] = [];
  const key = (s: State) => [0, 1, 2, 3, 4, 5].map((f) => s[f * 9 + 4]).join(",");
  let frontier: { alg: string[]; state: State }[] = [{ alg: [], state: SOLVED }];
  seen.set(key(SOLVED), true); out.push({ alg: [], state: SOLVED });
  while (frontier.length && out.length < 24) {
    const next: { alg: string[]; state: State }[] = [];
    for (const node of frontier) {
      for (const mv of ["x", "x'", "x2", "y", "y'", "y2", "z", "z'", "z2"]) {
        const st = applyMove(node.state, mv), k = key(st);
        if (seen.has(k)) continue;
        seen.set(k, true);
        const rec = { alg: node.alg.concat([mv]), state: st };
        out.push(rec); next.push(rec);
      }
    }
    frontier = next;
  }
  return out;
})();

/** 整块旋转 alg 的 3x3 矩阵（基向量像） */
export function rotMatrix(alg: string | string[]): Vec3[] {
  let basis: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (const n of parseAlg(alg)) {
    const m = MOVES[n];
    if (!m.isWholeCube) throw new Error("not a whole cube rotation: " + n);
    basis = basis.map((v) => rot(v, m.axis, m.amount));
  }
  return basis;
}
export const matApply = (M: Vec3[], v: Vec3): Vec3 => [
  M[0][0] * v[0] + M[1][0] * v[1] + M[2][0] * v[2],
  M[0][1] * v[0] + M[1][1] * v[1] + M[2][1] * v[2],
  M[0][2] * v[0] + M[1][2] * v[1] + M[2][2] * v[2],
];

// 规范描述 → 名字，用于旋转后重命名一步
const MOVE_BY_KEY: Record<string, string> = {};
function moveKey(axis: number, layers: number[], amount: number): string {
  return axis + "|" + layers.slice().sort((a, b) => a - b).join(",") + "|" + (((amount % 4) + 4) % 4);
}
for (const name of MOVE_NAMES) { const m = MOVES[name]; MOVE_BY_KEY[moveKey(m.axis, m.layers, m.amount)] = name; }

/** 魔方被旋转 M 后、行为与 `name` 等价的步 */
export function transformMove(name: string, M: Vec3[]): string {
  const m = MOVES[name];
  const av: Vec3 = [0, 0, 0]; av[m.axis] = 1;
  const w = matApply(M, av);
  let axis = 0; for (let i = 0; i < 3; i++) if (w[i] !== 0) axis = i;
  const sign = w[axis];
  let layers = m.layers, amount = m.amount;
  if (sign < 0) { layers = layers.map((v) => -v); amount = -amount; }
  const k = moveKey(axis, layers, amount);
  const res = MOVE_BY_KEY[k];
  if (!res) throw new Error("cannot transform " + name);
  return res;
}
export const transformAlg = (alg: string | string[], M: Vec3[]): string[] => parseAlg(alg).map((n) => transformMove(n, M));

/** 单层步名：axis、层坐标（-1|0|1）、从 +axis 顺时针转数 */
export function moveFor(axis: number, layerValue: number, amount: number): string | null {
  return MOVE_BY_KEY[moveKey(axis, [layerValue], amount)] || null;
}

/**
 * 把中心漂移（slice 步）的状态转回 home 朝向。返回 {state, matrix, inverse, alg}：
 * `state` 中心归位；解法步需用 transformMove(name, inverse) 映射回真实魔方。
 */
export function normalizeOrientation(state: State): Orientation {
  for (const r of ROTATIONS) {
    let ok = true;
    for (let f = 0; f < 6; f++) if (applyAlg(state, r.alg)[f * 9 + 4] !== f) { ok = false; break; }
    if (ok) {
      const M = rotMatrix(r.alg);
      // 旋转矩阵的逆 = 转置
      const Minv: Vec3[] = [[M[0][0], M[1][0], M[2][0]], [M[0][1], M[1][1], M[2][1]], [M[0][2], M[1][2], M[2][2]]];
      return { state: applyAlg(state, r.alg), matrix: M, inverse: Minv, alg: r.alg };
    }
  }
  throw new Error("no orientation found");
}

/**
 * 从旋转后的视角看魔方：位置与颜色都映射——已解魔方保持已解，
 * 原来在旋转走槽位里的块真的变成"DRF 块"。
 */
export function viewState(state: State, rotAlg: string | string[]): State {
  const alg = parseAlg(rotAlg);
  if (!alg.length) return state;
  const st = applyAlg(state, alg);
  const M = rotMatrix(alg);
  const cmap = new Uint8Array(6);
  for (let f = 0; f < 6; f++) cmap[f] = faceOfNormal(matApply(M, FACE_NORMAL[f]));
  const out = new Uint8Array(54);
  for (let i = 0; i < 54; i++) out[i] = cmap[st[i]];
  return out;
}

// -------------------------------------------------------------- scramble --
export function randomScramble(len = 25, rng: () => number = Math.random): string[] {
  const out: string[] = [];
  let lastBase = "", lastAxis = -1, axisRun = 0;
  while (out.length < len) {
    const n = FACE_MOVES[(rng() * FACE_MOVES.length) | 0];
    const m = MOVES[n];
    if (m.base === lastBase) continue;
    if (m.axis === lastAxis && axisRun >= 2) continue;
    if (m.axis === lastAxis) axisRun++; else { axisRun = 1; lastAxis = m.axis; }
    lastBase = m.base;
    out.push(n);
  }
  return out;
}
/** 简化步序列：合并同面、去掉抵消 */
export function tidyAlg(alg: string | string[]): string[] {
  const src = parseAlg(alg);
  const out: string[] = [];
  for (const n of src) {
    const m = MOVES[n];
    let merged = false;
    for (let i = out.length - 1; i >= 0; i--) {
      const p = MOVES[out[i]];
      if (p.base === m.base) {
        let t = (p.turns + m.turns) % 4;
        out.splice(i, 1);
        if (t !== 0) out.splice(i, 0, m.base + (t === 1 ? "" : t === 2 ? "2" : "'"));
        merged = true; break;
      }
      // 只允许穿过同轴不同层的单层步
      if (!(p.axis === m.axis && p.layers.length === 1 && m.layers.length === 1)) break;
    }
    if (!merged) out.push(n);
  }
  return out;
}