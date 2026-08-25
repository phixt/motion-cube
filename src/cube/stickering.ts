/**
 * 标灰系统数据层（docs/todo.md）。
 * 54 个小面用 {face}{row*3+col} 标识；标灰绑定绝对坐标（随魔方转动移动）。
 * 两类灰：mutable（可变，教学可随时改）/ immutable（不可变，固定）。
 * 预设按六色底适配：先在规范朝向（底=D、左=L）定义，再用旋转映射到任意底色。
 */

export const FACES = ["U", "D", "L", "R", "F", "B"] as const;
export type Face = (typeof FACES)[number];

export type StickerId = `${Face}${number}`;

export type GrayKind = "mutable" | "immutable";

export type GrayState = {
  mutable: StickerId[];
  immutable: StickerId[];
};

export type GrayPreset = "cross" | "roux-left" | "roux-right";

export const FACE_NORMALS: Record<Face, { x: number; y: number; z: number }> = {
  U: { x: 0, y: 1, z: 0 },
  D: { x: 0, y: -1, z: 0 },
  L: { x: -1, y: 0, z: 0 },
  R: { x: 1, y: 0, z: 0 },
  F: { x: 0, y: 0, z: 1 },
  B: { x: 0, y: 0, z: -1 },
};

export function allStickerIds(): StickerId[] {
  const out: StickerId[] = [];
  for (const face of FACES) {
    for (let i = 0; i < 9; i++) out.push(`${face}${i}` as StickerId);
  }
  return out;
}

export function stickerAt(face: Face, row: number, col: number): StickerId {
  return `${face}${row * 3 + col}` as StickerId;
}

export function stickerRowCol(id: StickerId): { row: number; col: number } {
  const n = Number(id.slice(1));
  return { row: Math.floor(n / 3), col: n % 3 };
}

/** 小面在规范坐标系中的位置：面法向偏移 ±1.5，面内坐标 ±1/0（便于与 three.js 场景匹配） */
export function stickerWorldPos(id: StickerId): { x: number; y: number; z: number } {
  const face = id[0] as Face;
  const { row, col } = stickerRowCol(id);
  const x = col - 1;
  const y = 1 - row;
  switch (face) {
    case "U":
      return { x, y: 1.5, z: 1 - row };
    case "D":
      return { x, y: -1.5, z: 1 - row };
    case "F":
      return { x, y, z: 1.5 };
    case "B":
      return { x: 1 - col, y, z: -1.5 };
    case "R":
      return { x: 1.5, y, z: col - 1 };
    case "L":
      return { x: -1.5, y, z: 1 - col };
  }
}

/** 由规范/世界坐标反查小面 id；面轴取模最大分量，面内坐标四舍五入到 ±1/0 */
export function stickerIdFromWorld(x: number, y: number, z: number): StickerId | null {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);
  // 规范坐标：面法向偏移 ±1.5，面内 ±1/0（three.js 场景数据先换算到该尺度）
  const qx = Math.round(x);
  const qy = Math.round(y);
  const qz = Math.round(z);
  let face: Face;
  let row: number;
  let col: number;
  if (ax >= ay && ax >= az) {
    face = x > 0 ? "R" : "L";
    row = 1 - qy;
    col = face === "R" ? qz + 1 : 1 - qz;
  } else if (ay >= ax && ay >= az) {
    face = y > 0 ? "U" : "D";
    row = 1 - qz;
    col = qx + 1;
  } else {
    face = z > 0 ? "F" : "B";
    row = 1 - qy;
    col = face === "F" ? qx + 1 : 1 - qx;
  }
  if (row < 0 || row > 2 || col < 0 || col > 2) return null;
  return stickerAt(face, row, col);
}

// ---------- 状态操作 ----------

export function createGrayState(): GrayState {
  return { mutable: [], immutable: [] };
}

export function graySet(state: GrayState): Set<StickerId> {
  return new Set([...state.mutable, ...state.immutable]);
}

export function toggleSticker(state: GrayState, id: StickerId, kind: GrayKind): GrayState {
  if (state.mutable.includes(id)) return { ...state, mutable: state.mutable.filter((s) => s !== id) };
  if (state.immutable.includes(id)) return { ...state, immutable: state.immutable.filter((s) => s !== id) };
  return { ...state, [kind]: [...state[kind], id] };
}

export function setStickers(state: GrayState, ids: StickerId[], on: boolean, kind: GrayKind): GrayState {
  const set = new Set(ids);
  const mutable = state.mutable.filter((s) => !set.has(s));
  const immutable = state.immutable.filter((s) => !set.has(s));
  if (on) {
    return { ...state, mutable, immutable, [kind]: [...mutable, ...immutable, ...ids] };
  }
  return { mutable, immutable };
}

export function clearGray(_state: GrayState): GrayState {
  return createGrayState();
}

// ---------- 预设（六色底适配） ----------

/** 规范朝向（底=D、左=L）下的预设保留集（世界坐标，面偏移 ±1.5） */
const CANONICAL_KEEP: Record<"cross" | "roux-left" | "roux-right", [number, number, number][]> = {
  cross: [
    [0, -1.5, 0],
    [-1, -1.5, 0],
    [0, -1.5, 1],
    [1, -1.5, 0],
    [0, -1.5, -1],
    [-1.5, -1, 0],
    [0, -1, 1.5],
    [1.5, -1, 0],
    [0, -1, -1.5],
  ],
  "roux-left": [
    [-1.5, 0, -1],
    [-1.5, 0, 0],
    [-1.5, 0, 1],
    [-1.5, -1, -1],
    [-1.5, -1, 0],
    [-1.5, -1, 1],
    [-1, 0, 1.5],
    [-1, -1, 1.5],
    [-1, 0, -1.5],
    [-1, -1, -1.5],
    [-1, -1.5, 0],
    [-1, -1.5, 1],
    [-1, -1.5, -1],
  ],
  "roux-right": [
    [1.5, 0, -1],
    [1.5, 0, 0],
    [1.5, 0, 1],
    [1.5, -1, -1],
    [1.5, -1, 0],
    [1.5, -1, 1],
    [1, 0, 1.5],
    [1, -1, 1.5],
    [1, 0, -1.5],
    [1, -1, -1.5],
    [1, -1.5, 0],
    [1, -1.5, 1],
    [1, -1.5, -1],
  ],
};

/** 每个底色对应的"左"面（其余由右手系推出），使旋转为真旋转 */
const LEFT_FOR_BASE: Record<Face, Face> = {
  D: "L",
  U: "R",
  F: "L",
  B: "R",
  L: "B",
  R: "F",
};

function cross(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/** 规范朝向（底=D、左=L）→ 目标底色 的旋转矩阵（列主序） */
function rotationForBase(base: Face): number[][] {
  const n = FACE_NORMALS[base];
  const ln = FACE_NORMALS[LEFT_FOR_BASE[base]];
  const fn = cross(ln, n);
  // R·(0,-1,0)=n → 第 2 列 = -n；R·(-1,0,0)=ln → 第 1 列 = -ln；R·(0,0,1)=fn → 第 3 列 = fn
  return [
    [-ln.x, -n.x, fn.x],
    [-ln.y, -n.y, fn.y],
    [-ln.z, -n.z, fn.z],
  ];
}

function applyRotation(p: [number, number, number], m: number[][]): [number, number, number] {
  return [
    m[0][0] * p[0] + m[0][1] * p[1] + m[0][2] * p[2],
    m[1][0] * p[0] + m[1][1] * p[1] + m[1][2] * p[2],
    m[2][0] * p[0] + m[2][1] * p[1] + m[2][2] * p[2],
  ];
}

/** 预设 → 灰色集合（可变灰；不可变由编辑器/教学场景追加） */
export function presetGrayStickers(preset: GrayPreset, base: Face): StickerId[] {
  const rot = rotationForBase(base);
  const keep = new Set<StickerId>();
  for (const p of CANONICAL_KEEP[preset]) {
    const [x, y, z] = applyRotation(p, rot);
    const id = stickerIdFromWorld(x, y, z);
    if (id) keep.add(id);
  }
  const grayed = allStickerIds().filter((id) => !keep.has(id));
  return grayed;
}

export function presetGrayState(preset: GrayPreset, base: Face): GrayState {
  return { mutable: presetGrayStickers(preset, base), immutable: [] };
}

/** 把「base 色当前所在面位」整体旋转到 D 面位的整块旋转（游戏起始朝向；D 已在下、无需转动）。
 *  实证（applyAlg(solved, baseFaceSetupAlg(f)) 的 D 面位中心色 == f 的 home 色，2026-08-22
 *  探针验证）：U→"x2"（U↔D）、R→"z"（R 层绕 z 顺时针→D）、L→"z'"、F→"x'"（F 色转到 D）；
 *  **注意方向曾反**：旧表 F="x" 实测把 B 色转到 D、B="x'" 把 F 色转到 D（「所选底的对面」）。
 *  整块旋转步的坐标方向以 engine quarterMat(axis, -n*π/2)=绕 +axis 顺时针为 x/x' 语义基准。 */
export function baseFaceSetupAlg(base: Face): string {
  switch (base) {
    case "D":
      return "";
    case "U":
      return "x2";
    case "F":
      return "x'";
    case "B":
      return "x";
    case "R":
      return "z";
    case "L":
      return "z'";
  }
}
