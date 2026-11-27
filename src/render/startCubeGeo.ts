/**
 * 开始页魔方真实 3D 轻量几何构建器（零 Raymarching）：
 * 1. 26 个独立块体（6 中心 + 12 棱 + 8 角），每块带真实微圆角与精确内挖球面空腔（R_cav = 0.645）；
 * 2. 54 片外露独立贴片（Exposed Cap），带 Florian 不等圆角与 3D 倒角厚边，贴合于块体外表面；
 * 3. 真实 6 轴十字轴芯（中心钛银毂 + ±X/±Y/±Z 六根轴柱直插中心块底面 + 金属调松环 + 面色调松帽）；
 * 4. 按 U/R 交替拧转拓扑预先合并为 4 个静态分区（UR / U_only / R_only / Rest），全场景仅需 ~14 次 Draw Call。
 */
import { BufferAttribute, BufferGeometry, Vector3 } from "three";

export type ChunkKey = "ur" | "uOnly" | "rOnly" | "rest";

export type CubeChunkGeos = {
  shell: BufferGeometry;
  caps: BufferGeometry;
};

export type StartCubeGeometries = {
  chunks: Record<ChunkKey, CubeChunkGeos>;
  core: BufferGeometry;
};

/** 魔方内部球形空腔半径（魔方整体半边长为 1.0） */
export const CAVITY_RADIUS = 0.645;

/** 标准西洋六面鲜亮明快基色（0:+Y 白, 1:-Y 黄, 2:+Z 绿, 3:-Z 蓝, 4:+X 红, 5:-X 橙） */
export const FACE_COLORS: ReadonlyArray<readonly [number, number, number]> = [
  [0.95, 0.97, 1.00], // 0: U 冰白
  [1.00, 0.84, 0.16], // 1: D 明黄
  [0.10, 0.84, 0.48], // 2: F 翡翠绿
  [0.14, 0.56, 1.00], // 3: B 蔚蓝
  [0.96, 0.24, 0.32], // 4: R 竞速红
  [1.00, 0.52, 0.12], // 5: L 活力橙
];

type MeshBuilder = {
  pos: number[];
  norm: number[];
  extra: number[]; // shell: aCavity | caps: aEdge | core: aMetal
  col?: number[];
  faceNorm?: number[]; // caps: 所属面的大面法线（用于精准剔除背面贴片倒角残线）
  idx: number[];
};

function createBuilder(withColor: boolean, withFaceNorm = false): MeshBuilder {
  return {
    pos: [],
    norm: [],
    extra: [],
    col: withColor ? [] : undefined,
    faceNorm: withFaceNorm ? [] : undefined,
    idx: [],
  };
}

function toGeometry(b: MeshBuilder, extraName: string): BufferGeometry {
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(b.pos), 3));
  geo.setAttribute("normal", new BufferAttribute(new Float32Array(b.norm), 3));
  geo.setAttribute(extraName, new BufferAttribute(new Float32Array(b.extra), 1));
  if (b.col) {
    geo.setAttribute("color", new BufferAttribute(new Float32Array(b.col), 3));
  }
  if (b.faceNorm) {
    geo.setAttribute("aFaceNormal", new BufferAttribute(new Float32Array(b.faceNorm), 3));
  }
  geo.setIndex(b.idx);
  geo.computeBoundingSphere();
  return geo;
}

/** 沿单轴返回块体边界 [min, max]（外表面留出 0.030 给外露贴片，内侧块缝留 0.016） */
function axisSpan(i: -1 | 0 | 1): [number, number] {
  const innerHalf = 0.3253; // P/2 - 0.008 (P = 2/3)
  const innerStart = 0.3413; // P/2 + 0.008 -> 块间物理细缝 = 0.016
  const outerBody = 0.968; // 留 0.032 厚度给外露贴片（贴片顶面齐平 ±1.000）
  if (i === -1) return [-outerBody, -innerStart];
  if (i === 1) return [innerStart, outerBody];
  return [-innerHalf, innerHalf];
}

// 兼顾边缘倒角平滑与内腔圆弧精度的 1D 网格分布（7 段 = 8 节点）
const FACE_GRID_STOPS = [-1.0, -0.90, -0.60, -0.22, 0.22, 0.60, 0.90, 1.0];

type BoxFaceDef = {
  n: [number, number, number];
  u: [number, number, number];
  v: [number, number, number];
};

// 右手系外向绕序：u × v = n
const BOX_FACES: BoxFaceDef[] = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
];

/**
 * 向构建器追加一个带真实微圆角 + 精确内挖球面空腔（R_cav）的独立块体。
 * 数学保证：沿块体规范方向 dir = normalize(ix, iy, iz) 将球内顶点精准投射至球面，
 * 绝不越出自身包围盒，且仅朝向球心的面赋予解析球面法线与 aCavity = 1。
 */
function appendCarvedCubie(b: MeshBuilder, ix: -1 | 0 | 1, iy: -1 | 0 | 1, iz: -1 | 0 | 1): void {
  const [x0, x1] = axisSpan(ix);
  const [y0, y1] = axisSpan(iy);
  const [z0, z1] = axisSpan(iz);

  const cx = (x0 + x1) * 0.5;
  const cy = (y0 + y1) * 0.5;
  const cz = (z0 + z1) * 0.5;
  const hx = (x1 - x0) * 0.5;
  const hy = (y1 - y0) * 0.5;
  const hz = (z1 - z0) * 0.5;

  const rCorner = 0.028;
  const bx = hx - rCorner;
  const by = hy - rCorner;
  const bz = hz - rCorner;

  const dirLen = Math.hypot(ix, iy, iz);
  const dx = ix / dirLen;
  const dy = iy / dirLen;
  const dz = iz / dirLen;

  const rCavSq = CAVITY_RADIUS * CAVITY_RADIUS;
  const S = FACE_GRID_STOPS;
  const N = S.length;

  for (const face of BOX_FACES) {
    const fnDotDir = face.n[0] * dx + face.n[1] * dy + face.n[2] * dz;
    const isCavityCandidate = fnDotDir < -1e-4;
    const baseVertex = b.pos.length / 3;

    for (let iv = 0; iv < N; iv++) {
      const sv = S[iv];
      for (let iu = 0; iu < N; iu++) {
        const su = S[iu];

        // 原始盒面局部坐标（相对于块中心）
        const lx = (face.n[0] + face.u[0] * su + face.v[0] * sv) * hx;
        const ly = (face.n[1] + face.u[1] * su + face.v[1] * sv) * hy;
        const lz = (face.n[2] + face.u[2] * su + face.v[2] * sv) * hz;

        // 投影到圆角盒表面（解析 SDF 等值面）
        const kx = Math.max(-bx, Math.min(bx, lx));
        const ky = Math.max(-by, Math.min(by, ly));
        const kz = Math.max(-bz, Math.min(bz, lz));
        let nx = lx - kx;
        let ny = ly - ky;
        let nz = lz - kz;
        const nLen = Math.hypot(nx, ny, nz) || 1;
        nx /= nLen;
        ny /= nLen;
        nz /= nLen;

        let px = cx + kx + nx * rCorner;
        let py = cy + ky + ny * rCorner;
        let pz = cz + kz + nz * rCorner;
        let cavFlag = 0.0;

        // 精确球面空腔布尔挖空：沿块体规范外向向量 dir 投射到 |p| = R_cav
        const lenSq = px * px + py * py + pz * pz;
        if (lenSq < rCavSq) {
          const dotD = px * dx + py * dy + pz * dz;
          const c = lenSq - rCavSq;
          const disc = Math.max(0, dotD * dotD - c);
          const t = -dotD + Math.sqrt(disc);
          px += t * dx;
          py += t * dy;
          pz += t * dz;

          if (isCavityCandidate) {
            // 凹球面壁外法线指向球心（与原点朝向的三角面绕序严格一致）
            const invR = 1 / (Math.hypot(px, py, pz) || 1);
            nx = -px * invR;
            ny = -py * invR;
            nz = -pz * invR;
            cavFlag = 1.0;
          }
        }

        b.pos.push(px, py, pz);
        b.norm.push(nx, ny, nz);
        b.extra.push(cavFlag);
      }
    }

    for (let iv = 0; iv < N - 1; iv++) {
      for (let iu = 0; iu < N - 1; iu++) {
        const a = baseVertex + iv * N + iu;
        const bIdx = a + 1;
        const c = a + N;
        const d = c + 1;
        b.idx.push(a, bIdx, d, a, d, c);
      }
    }
  }
}

/**
 * 生成带不等 Florian 圆角的 2D 轮廓点（逆时针，u/v 方向位于 [min, max]）。
 * rCorners = [rTR(+u,+v), rTL(-u,+v), rBL(-u,-v), rBR(+u,-v)]
 */
function sampleFlorianContour(
  u0: number,
  u1: number,
  v0: number,
  v1: number,
  rCorners: [number, number, number, number],
  arcSteps = 5,
): Array<[number, number, number, number]> {
  const pts: Array<[number, number, number, number]> = [];
  const defs: Array<{ cx: number; cy: number; r: number; a0: number; a1: number }> = [
    { cx: u1 - rCorners[0], cy: v1 - rCorners[0], r: rCorners[0], a0: 0, a1: Math.PI * 0.5 },
    { cx: u0 + rCorners[1], cy: v1 - rCorners[1], r: rCorners[1], a0: Math.PI * 0.5, a1: Math.PI },
    { cx: u0 + rCorners[2], cy: v0 + rCorners[2], r: rCorners[2], a0: Math.PI, a1: Math.PI * 1.5 },
    { cx: u1 - rCorners[3], cy: v0 + rCorners[3], r: rCorners[3], a0: Math.PI * 1.5, a1: Math.PI * 2.0 },
  ];

  for (const d of defs) {
    for (let s = 0; s <= arcSteps; s++) {
      const ang = d.a0 + ((d.a1 - d.a0) * s) / arcSteps;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      pts.push([d.cx + ca * d.r, d.cy + sa * d.r, ca, sa]);
    }
  }
  return pts;
}

type OuterFaceSpec = {
  faceIdx: number;
  n: [number, number, number];
  u: [number, number, number];
  v: [number, number, number];
  matchAxis: 0 | 1 | 2;
  matchVal: -1 | 1;
};

// 与 FACE_COLORS 索引一致（u × v = n）
const OUTER_FACES: OuterFaceSpec[] = [
  { faceIdx: 0, n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1], matchAxis: 1, matchVal: 1 },  // +Y 白
  { faceIdx: 1, n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], matchAxis: 1, matchVal: -1 }, // -Y 黄
  { faceIdx: 2, n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], matchAxis: 2, matchVal: 1 },   // +Z 绿
  { faceIdx: 3, n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0], matchAxis: 2, matchVal: -1 },// -Z 蓝
  { faceIdx: 4, n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0], matchAxis: 0, matchVal: 1 },  // +X 红
  { faceIdx: 5, n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], matchAxis: 0, matchVal: -1 }, // -X 橙
];

/**
 * 为块体在指定外露面追加一片真实的 3D 外露卡盖贴片（Exposed Cap）：
 * - 底部紧贴块体表面（h = 0.968），顶部齐平魔方外轮廓（h = 1.000）带 0.0025 微拱顶光泽过渡；
 * - 四周带 0.018 斜切倒角边，与相邻贴片间留出均匀 3D 物理细缝 + Florian 中心窗；
 * - 仅构建可见的前面与倒角裙边，零背面冗余与零 Z-fighting。
 */
function appendExposedCap(
  b: MeshBuilder,
  spec: OuterFaceSpec,
  ix: -1 | 0 | 1,
  iy: -1 | 0 | 1,
  iz: -1 | 0 | 1,
): void {
  const coord: [number, number, number] = [ix, iy, iz];
  const cu = (coord[0] * spec.u[0] + coord[1] * spec.u[1] + coord[2] * spec.u[2]) as -1 | 0 | 1;
  const cv = (coord[0] * spec.v[0] + coord[1] * spec.v[1] + coord[2] * spec.v[2]) as -1 | 0 | 1;

  // 在面内计算贴片精确边界：靠近内部块缝退让 0.015，靠近魔方大外棱退让 0.016（不与邻面贴片打架）
  function tileSpan(c: -1 | 0 | 1): [number, number] {
    const [a0, a1] = axisSpan(c);
    const insetLo = c === -1 ? 0.016 : 0.014;
    const insetHi = c === 1 ? 0.016 : 0.014;
    return [a0 + insetLo, a1 - insetHi];
  }

  const [u0, u1] = tileSpan(cu);
  const [v0, v1] = tileSpan(cv);

  // Florian 圆角分配：靠近中心块四角的内角用大圆角 rBig，其余用干脆小圆角 rSmall
  const rBig = 0.106;
  const rSmall = 0.048;
  let rTR = rSmall;
  let rTL = rSmall;
  let rBL = rSmall;
  let rBR = rSmall;

  if (cu === 0 && cv === 0) {
    rTR = rTL = rBL = rBR = rBig;
  } else if (cu === 0) {
    if (cv > 0) { rBL = rBR = rBig; } else { rTL = rTR = rBig; }
  } else if (cv === 0) {
    if (cu > 0) { rTL = rBL = rBig; } else { rTR = rBR = rBig; }
  } else {
    if (cu > 0 && cv > 0) rBL = rBig;
    else if (cu < 0 && cv > 0) rBR = rBig;
    else if (cu > 0 && cv < 0) rTL = rBig;
    else rTR = rBig;
  }

  const outerRing = sampleFlorianContour(u0, u1, v0, v1, [rTR, rTL, rBL, rBR], 4);
  const bevelIn = 0.018;
  const innerRing = sampleFlorianContour(
    u0 + bevelIn,
    u1 - bevelIn,
    v0 + bevelIn,
    v1 - bevelIn,
    [
      Math.max(0.02, rTR - bevelIn),
      Math.max(0.02, rTL - bevelIn),
      Math.max(0.02, rBL - bevelIn),
      Math.max(0.02, rBR - bevelIn),
    ],
    4,
  );

  const M = outerRing.length;
  const [cr, cg, cb] = FACE_COLORS[spec.faceIdx];
  const [nx, ny, nz] = spec.n;
  const [ux, uy, uz] = spec.u;
  const [vx, vy, vz] = spec.v;

  const hBase = 0.966; // 略微咬入块体表面 0.002，彻底杜绝接缝漏光
  const hTop = 1.000;
  const hCrown = 1.0035; // 极轻微拱顶，让大面在光照下有自然的亚克力柔光渐变

  const toWorld = (u: number, v: number, h: number): [number, number, number] => [
    nx * h + ux * u + vx * v,
    ny * h + uy * u + vy * v,
    nz * h + uz * u + vz * v,
  ];

  // 1) 贴片四周斜切倒角裙边（独立顶点保证倒角法线锐利清晰）
  const skirtBase = b.pos.length / 3;
  const bevelSlope = 0.62; // 外法线水平分量
  const bevelUp = Math.sqrt(1 - bevelSlope * bevelSlope);

  for (let i = 0; i < M; i++) {
    const [ou, ov, dux, dvy] = outerRing[i];
    const [iu, iv] = innerRing[i];
    const bnx = nx * bevelUp + (ux * dux + vx * dvy) * bevelSlope;
    const bny = ny * bevelUp + (uy * dux + vy * dvy) * bevelSlope;
    const bnz = nz * bevelUp + (uz * dux + vz * dvy) * bevelSlope;

    const pOut = toWorld(ou, ov, hBase);
    const pIn = toWorld(iu, iv, hTop);

    b.pos.push(pOut[0], pOut[1], pOut[2]);
    b.norm.push(bnx, bny, bnz);
    b.extra.push(1.0);
    b.col!.push(cr, cg, cb);
    b.faceNorm!.push(nx, ny, nz);

    b.pos.push(pIn[0], pIn[1], pIn[2]);
    b.norm.push(bnx, bny, bnz);
    b.extra.push(0.75);
    b.col!.push(cr, cg, cb);
    b.faceNorm!.push(nx, ny, nz);
  }

  for (let i = 0; i < M; i++) {
    const j = (i + 1) % M;
    const o0 = skirtBase + i * 2;
    const i0 = o0 + 1;
    const o1 = skirtBase + j * 2;
    const i1 = o1 + 1;
    b.idx.push(o0, o1, i1, o0, i1, i0);
  }

  // 2) 贴片光滑顶面（中心微拱 + 边缘柔顺过渡）
  const topBase = b.pos.length / 3;
  const uMid = (u0 + u1) * 0.5;
  const vMid = (v0 + v1) * 0.5;
  const pCenter = toWorld(uMid, vMid, hCrown);

  b.pos.push(pCenter[0], pCenter[1], pCenter[2]);
  b.norm.push(nx, ny, nz);
  b.extra.push(0.0);
  b.col!.push(cr, cg, cb);
  b.faceNorm!.push(nx, ny, nz);

  const domeTilt = 0.045;
  for (let i = 0; i < M; i++) {
    const [iu, iv, dux, dvy] = innerRing[i];
    const p = toWorld(iu, iv, hTop);
    const tnx = nx + (ux * dux + vx * dvy) * domeTilt;
    const tny = ny + (uy * dux + vy * dvy) * domeTilt;
    const tnz = nz + (uz * dux + vz * dvy) * domeTilt;
    const tl = Math.hypot(tnx, tny, tnz) || 1;
    b.pos.push(p[0], p[1], p[2]);
    b.norm.push(tnx / tl, tny / tl, tnz / tl);
    b.extra.push(0.28);
    b.col!.push(cr, cg, cb);
    b.faceNorm!.push(nx, ny, nz);
  }

  for (let i = 0; i < M; i++) {
    const j = (i + 1) % M;
    b.idx.push(topBase, topBase + 1 + i, topBase + 1 + j);
  }
}

/** 追加简单圆柱/圆台到 6 轴构建器（沿 axis 轴，span = [h0, h1]） */
function appendAxisCylinder(
  b: MeshBuilder,
  axis: 0 | 1 | 2,
  h0: number,
  h1: number,
  r0: number,
  r1: number,
  segs: number,
  col: readonly [number, number, number],
  metal: number,
  capEnds: boolean,
): void {
  const ax = new Vector3(axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0);
  const t1 = axis === 0 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  const t2 = new Vector3().crossVectors(ax, t1).normalize();

  const dh = h1 - h0;
  const dr = r0 - r1;
  const slopeLen = Math.hypot(dh, dr) || 1;
  const nRad = dh / slopeLen;
  const nAx = dr / slopeLen;

  const base = b.pos.length / 3;
  for (let i = 0; i <= segs; i++) {
    const ang = (i / segs) * Math.PI * 2;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const rx = t1.x * ca + t2.x * sa;
    const ry = t1.y * ca + t2.y * sa;
    const rz = t1.z * ca + t2.z * sa;

    const nx = rx * nRad + ax.x * nAx;
    const ny = ry * nRad + ax.y * nAx;
    const nz = rz * nRad + ax.z * nAx;

    b.pos.push(ax.x * h0 + rx * r0, ax.y * h0 + ry * r0, ax.z * h0 + rz * r0);
    b.norm.push(nx, ny, nz);
    b.extra.push(metal);
    b.col!.push(col[0], col[1], col[2]);

    b.pos.push(ax.x * h1 + rx * r1, ax.y * h1 + ry * r1, ax.z * h1 + rz * r1);
    b.norm.push(nx, ny, nz);
    b.extra.push(metal);
    b.col!.push(col[0], col[1], col[2]);
  }

  for (let i = 0; i < segs; i++) {
    const a = base + i * 2;
    const b0 = a + 1;
    const c = a + 2;
    const d = a + 3;
    b.idx.push(a, c, d, a, d, b0);
  }

  if (capEnds) {
    for (const end of [
      { h: h0, r: r0, sign: -1 },
      { h: h1, r: r1, sign: 1 },
    ]) {
      const cIdx = b.pos.length / 3;
      b.pos.push(ax.x * end.h, ax.y * end.h, ax.z * end.h);
      b.norm.push(ax.x * end.sign, ax.y * end.sign, ax.z * end.sign);
      b.extra.push(metal);
      b.col!.push(col[0], col[1], col[2]);

      for (let i = 0; i < segs; i++) {
        const ang = (i / segs) * Math.PI * 2;
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        b.pos.push(
          ax.x * end.h + (t1.x * ca + t2.x * sa) * end.r,
          ax.y * end.h + (t1.y * ca + t2.y * sa) * end.r,
          ax.z * end.h + (t1.z * ca + t2.z * sa) * end.r,
        );
        b.norm.push(ax.x * end.sign, ax.y * end.sign, ax.z * end.sign);
        b.extra.push(metal);
        b.col!.push(col[0], col[1], col[2]);
      }
      for (let i = 0; i < segs; i++) {
        const j = (i + 1) % segs;
        if (end.sign > 0) b.idx.push(cIdx, cIdx + 1 + i, cIdx + 1 + j);
        else b.idx.push(cIdx, cIdx + 1 + j, cIdx + 1 + i);
      }
    }
  }
}

/** 追加中心多面钛银球毂 */
function appendCoreHub(b: MeshBuilder, radius: number, col: readonly [number, number, number]): void {
  const latSteps = 10;
  const lonSteps = 16;
  const base = b.pos.length / 3;
  for (let lat = 0; lat <= latSteps; lat++) {
    const phi = (lat / latSteps) * Math.PI;
    const sp = Math.sin(phi);
    const cp = Math.cos(phi);
    for (let lon = 0; lon <= lonSteps; lon++) {
      const theta = (lon / lonSteps) * Math.PI * 2;
      const nx = sp * Math.cos(theta);
      const ny = cp;
      const nz = sp * Math.sin(theta);
      b.pos.push(nx * radius, ny * radius, nz * radius);
      b.norm.push(nx, ny, nz);
      b.extra.push(1.0);
      b.col!.push(col[0], col[1], col[2]);
    }
  }
  const stride = lonSteps + 1;
  for (let lat = 0; lat < latSteps; lat++) {
    for (let lon = 0; lon < lonSteps; lon++) {
      const a = base + lat * stride + lon;
      const b0 = a + 1;
      const c = a + stride;
      const d = c + 1;
      b.idx.push(a, d, c, a, b0, d);
    }
  }
}

/** 构建真实 6 轴十字轴芯（中心钛银球毂 + 6 根轴杆直插中心块 + 弹簧环 + 面色调松帽） */
function buildSixAxisCoreGeo(): BufferGeometry {
  const b = createBuilder(true);
  const hubCol: readonly [number, number, number] = [0.76, 0.84, 0.94];
  const shaftCol: readonly [number, number, number] = [0.60, 0.69, 0.80];
  const collarCol: readonly [number, number, number] = [0.86, 0.92, 0.98];

  // 1) 中心球毂
  appendCoreHub(b, 0.165, hubCol);

  // 2) 3 根贯通轴杆（延伸至 ±0.665，精准插接在 6 个中心块内凹球底，绝不悬空）
  appendAxisCylinder(b, 0, -0.665, 0.665, 0.046, 0.046, 14, shaftCol, 1.0, false);
  appendAxisCylinder(b, 1, -0.665, 0.665, 0.046, 0.046, 14, shaftCol, 1.0, false);
  appendAxisCylinder(b, 2, -0.665, 0.665, 0.046, 0.046, 14, shaftCol, 1.0, false);

  // 3) 6 组机械弹簧环 + 对应面色微染调松帽（紧贴球面空腔壁 0.50..0.64）
  const axisCaps: Array<{ axis: 0 | 1 | 2; sign: -1 | 1; faceIdx: number }> = [
    { axis: 1, sign: 1, faceIdx: 0 },  // +Y 白
    { axis: 1, sign: -1, faceIdx: 1 }, // -Y 黄
    { axis: 2, sign: 1, faceIdx: 2 },  // +Z 绿
    { axis: 2, sign: -1, faceIdx: 3 }, // -Z 蓝
    { axis: 0, sign: 1, faceIdx: 4 },  // +X 红
    { axis: 0, sign: -1, faceIdx: 5 }, // -X 橙
  ];

  for (const ac of axisCaps) {
    const s = ac.sign;
    // 弹簧定位金属环（0.34..0.42）
    const c0 = s > 0 ? 0.34 : -0.42;
    const c1 = s > 0 ? 0.42 : -0.34;
    appendAxisCylinder(b, ac.axis, c0, c1, 0.088, 0.088, 16, collarCol, 1.0, true);

    // 阶梯轴端调松帽（0.47..0.62，与中心块球腔内壁严丝合缝衔接）
    const fc = FACE_COLORS[ac.faceIdx];
    const tint: readonly [number, number, number] = [
      fc[0] * 0.58 + 0.38,
      fc[1] * 0.58 + 0.38,
      fc[2] * 0.58 + 0.38,
    ];
    const m0 = s > 0 ? 0.47 : -0.625;
    const m1 = s > 0 ? 0.625 : -0.47;
    const rNear = s > 0 ? 0.112 : 0.132;
    const rFar = s > 0 ? 0.132 : 0.112;
    appendAxisCylinder(b, ac.axis, m0, m1, rNear, rFar, 18, tint, 0.35, true);
  }

  return toGeometry(b, "aMetal");
}

/** 一次性构建全部 4 分区几何体 + 6 轴核心几何体 */
export function buildStartCubeGeometries(): StartCubeGeometries {
  const keys: ChunkKey[] = ["ur", "uOnly", "rOnly", "rest"];
  const shellBuilders: Record<ChunkKey, MeshBuilder> = {
    ur: createBuilder(false),
    uOnly: createBuilder(false),
    rOnly: createBuilder(false),
    rest: createBuilder(false),
  };
  const capBuilders: Record<ChunkKey, MeshBuilder> = {
    ur: createBuilder(true, true),
    uOnly: createBuilder(true, true),
    rOnly: createBuilder(true, true),
    rest: createBuilder(true, true),
  };

  const coords: Array<-1 | 0 | 1> = [-1, 0, 1];
  for (const ix of coords) {
    for (const iy of coords) {
      for (const iz of coords) {
        if (ix === 0 && iy === 0 && iz === 0) continue;

        const key: ChunkKey =
          iy === 1 && ix === 1 ? "ur" : iy === 1 ? "uOnly" : ix === 1 ? "rOnly" : "rest";

        appendCarvedCubie(shellBuilders[key], ix, iy, iz);

        const c = [ix, iy, iz];
        for (const spec of OUTER_FACES) {
          if (c[spec.matchAxis] === spec.matchVal) {
            appendExposedCap(capBuilders[key], spec, ix, iy, iz);
          }
        }
      }
    }
  }

  const chunks = {} as Record<ChunkKey, CubeChunkGeos>;
  for (const k of keys) {
    chunks[k] = {
      shell: toGeometry(shellBuilders[k], "aCavity"),
      caps: toGeometry(capBuilders[k], "aEdge"),
    };
  }

  return {
    chunks,
    core: buildSixAxisCoreGeo(),
  };
}
