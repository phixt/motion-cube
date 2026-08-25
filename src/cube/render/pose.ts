/**
 * pose.ts — R1 阶段 1 自建渲染的纯逻辑层（不依赖 three/DOM，Node 可自检）。
 *
 * 与 solver/engine.ts 同一坐标系（右手系：+x→R、+y→U、+z→F），但尺度用
 * stickering 规范坐标：块中心 ∈ {-1,0,1}³（块半宽 1，块中心距 2），贴纸面中心
 * = 块中心 + 法线*1.5，面内贴纸中心间距 1（±1/0）。three 视图层挂 root.scale=1/3
 * 后世界坐标即 cubing 尺度（块中心 ±1/3、贴纸面 ±0.5、面内 ±1/3），GrayOverlay
 * 的 world→规范换算照常有效。
 *
 * 27 块（含 6 中心）逻辑姿态：每块 { pos(整数格点), rot(3x3 单位矩阵) }。
 * 旋转轴角用 axisAngleMat（Rodrigues），与 engine.rot 的 90° 整数步严格等价
 *（scripts/verify-render-cube.ts 校验）。54 贴纸 state（solver 语义）平行维护，
 * 每 commit 一步用 engine.applyMove 同步；二者一致性由自检保证。
 */

import { applyMove, CUBIES, MOVES, parseAlg, type State, type Vec3 } from "../solver/engine.ts";

/** 3x3 单位矩阵（列向量基：mat[i] = 第 i 轴在世界中的像） */
export const IDENT3: Vec3[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

/** 3x3 矩阵乘：out = A·B（matApply 的矩阵版，逐列） */
export function mm3(A: Vec3[], B: Vec3[]): Vec3[] {
  const out: Vec3[] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 3; i++) {
      out[j][i] = A[0][i] * B[j][0] + A[1][i] * B[j][1] + A[2][i] * B[j][2];
    }
  }
  return out;
}

/**
 * 轴-角旋转矩阵（Rodrigues）：绕单位轴 `axis`（x/y/z 的基向量）右手旋转 `theta` 弧度。
 * 方向约定与 engine.rot 一致：从 +axis 方向看顺时针 = 绕 +axis 右手正角。
 * 列主序返回（子数组 = 列，与 mm3/m3Apply/engine.matApply 一致）。
 */
export function axisAngleMat(axis: number, theta: number): Vec3[] {
  const u: Vec3 = [0, 0, 0];
  u[axis] = 1;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const C = 1 - c;
  const [ux, uy, uz] = u;
  // 行优先元素 Rrc（行 r 列 c）；列主序 out[c] = [R0c, R1c, R2c]
  const R00 = c + ux * ux * C, R01 = ux * uy * C - uz * s, R02 = ux * uz * C + uy * s;
  const R10 = uy * ux * C + uz * s, R11 = c + uy * uy * C, R12 = uy * uz * C - ux * s;
  const R20 = uz * ux * C - uy * s, R21 = uz * uy * C + ux * s, R22 = c + uz * uz * C;
  return [
    [R00, R10, R20],
    [R01, R11, R21],
    [R02, R12, R22],
  ];
}

/** 单位轴向量（axis 0/1/2） */
export const AXIS_VEC: Vec3[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

/** 分量化到最近整数（±1/0；对整数姿态的向量，消除 float 噪声） */
export const snapVec3 = (v: Vec3): Vec3 => [Math.round(v[0]), Math.round(v[1]), Math.round(v[2])];
const snapMat = (M: Vec3[]): Vec3[] => M.map((c) => c.map((x) => Math.round(x)) as Vec3);

/**
 * 90° 整数步轴矩阵（amount 个「从 +axis 看顺时针」90°，与 engine.rot 严格等价）。
 * 方向：engine 的顺时针语义 = 绕 −axis 的右手正角（axisAngleMat 本身是右手标准正角，
 * 故取负）。90° 子群矩阵元素只有 0/±1：算出后 snap 到精确值，保证 committed 姿态
 * 全程精确（stickerIndex 的 faceOfNormal 严格相等匹配不受 float 噪声影响）。
 * scripts/verify-render-cube.ts 断言与 engine.rot 等价。
 */
export function quarterMat(axis: number, amount: number): Vec3[] {
  return snapMat(axisAngleMat(axis, -((((amount % 4) + 4) % 4) * (Math.PI / 2))));
}

/** 矩阵作用于向量（列向量；与 engine.matApply 同为列主序） */
export function m3Apply(M: Vec3[], v: Vec3): Vec3 {
  return [
    M[0][0] * v[0] + M[1][0] * v[1] + M[2][0] * v[2],
    M[0][1] * v[0] + M[1][1] * v[1] + M[2][1] * v[2],
    M[0][2] * v[0] + M[1][2] * v[1] + M[2][2] * v[2],
  ];
}

export type PiecePose = { pos: Vec3; rot: Vec3[] };

/** 27 块逻辑姿态（index 与 engine.CUBIES 对齐；home = CUBIES[i].pos） */
export type PoseState = { pieces: PiecePose[]; state: State };

/**
 * 求解器态（54 贴纸）→ 块姿态（颜色落到 home 槽位）。用于外部 setState 同步：
 * 每块贴纸颜色 = state[stickerIndex(home 当前像)]；仅对整数姿态可逆。
 * 注意：此映射是「从颜色反推块位置」，仅当 state 合法（isUniform 层次）时准确。
 */
export function poseFromState(state: State): PoseState {
  const pieces = CUBIES.map((c) => ({ pos: c.pos.slice() as Vec3, rot: IDENT3.map((v) => v.slice() as Vec3) }));
  return { pieces, state: state.slice() as State };
}

/** 在逻辑姿态上执行一步（90° 整数步）：参与层块的 pos/rot 左乘轴矩阵并同步 54 贴纸态 */
export function applyMovePose(p: PoseState, name: string): PoseState {
  const m = MOVES[name];
  const Q = quarterMat(m.axis, m.amount);
  const pieces = p.pieces.map((pc) => {
    if (!m.layers.includes(pc.pos[m.axis])) return pc;
    return { pos: m3Apply(Q, pc.pos), rot: mm3(Q, pc.rot) };
  });
  return { pieces, state: applyMove(p.state, name) };
}

export function applyAlgPose(p: PoseState, alg: string | string[]): PoseState {
  let cur = p;
  for (const n of parseAlg(alg)) cur = applyMovePose(cur, n);
  return cur;
}

/** 块在姿态下的贴纸世界坐标/法线（规范尺度）：贴纸位置 = H 映射后再投影 */
export function pieceStickerWorld(pc: PiecePose, dir: Vec3): { center: Vec3; normal: Vec3 } {
  // dir 是 home 法线（±基向量）；贴纸面中心 = 块中心 + 1.5 * (块 rot 作用后的 dir)
  const n = m3Apply(pc.rot, dir);
  const center: Vec3 = [
    pc.pos[0] + 1.5 * n[0],
    pc.pos[1] + 1.5 * n[1],
    pc.pos[2] + 1.5 * n[2],
  ];
  return { center, normal: n };
}

/** 54 贴纸的规范世界坐标（块未细分贴纸面时，用于 view 建贴纸） */
export const STICKER_WORLD: Vec3[] = new Array(54);
{
  for (const c of CUBIES) {
    for (const s of c.stickers) {
      STICKER_WORLD[s.index] = [c.pos[0] + 1.5 * s.normal[0], c.pos[1] + 1.5 * s.normal[1], c.pos[2] + 1.5 * s.normal[2]];
    }
  }
}