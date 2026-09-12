/**
 * handMesh.ts — low-poly 手部网格生成器（0.4.0 重构，feat/hand-lowpoly）。
 * 替代 handGeometry.ts 的「圆柱段 + 圆角盒 + 椭球」方案：
 * - 手指/拇指：超椭圆截面（腹侧扁 / 背侧圆）沿线段放样 + 关节低 poly 球（弯折不裂缝）；
 * - 手掌：梯形平面放样（腕窄掌宽）+ 厚度梯度 + 掌指横弓 + 掌心纵凹；
 * - 大鱼际：低面数刻面椭球（沿用配置 thenar）；指蹼：指根间菱形填充；
 * - 着色：无光照 MeshBasicMaterial + 逐面顶点色伪受光 + 明度抖动；双口径并存——
 *   cubing 渲染器直写 sRGB（淡米偏白，用户选定）/ 标定页线性编码（2026-09-12 真机
 *   二次实证：线性编码在编辑器过暗如枯木，反向回退直写口径）。
 *
 * ⚠ 兼容面（feat/hand-lowpoly 立项，见 handRigStore.ts 头注）：
 * - 对外输出与旧 buildHandGeometry 同构：HandMeshResult{root, fingers, thumbRoot, thumbDof}，
 *   FingerNodes.segments 仍是接触点锚点（len/radius 语义不变，新增 thickness 供腹背侧
 *   接触偏移贴合新剖面）；
 * - 坐标系不变：数据单位 × handScale，+Z 指尖 / +Y 指背 / +X 拇指侧（右手，sideSign 镜像）；
 * - 旧 handGeometry.ts 圆柱方案已删除（2026-09 合并清理），#/hand-lab 保留单视图调试页。
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { FingerName, HandRig } from "./HandRig";
import type { HandRigConfig, HandShapeParams } from "./handRigStore";

/** 肤色/标记/描边（沿用旧圆柱方案数值，此处独立声明） */
export const SKIN = 0xe4d4bd;
export const PAD = 0x4ade80;
export const BACK = 0xf59e0b;
export const OUTLINE = 0x2b2b33;
/** 指甲色（较肤色更浅的暖米，偏白口径一致） */
export const NAIL = 0xf0dcbd;
/** 标记球 / 接触点中心到段表面的径向间隙（数据单位） */
export const MARK_GAP = 0.05;
/** 指腹（绿）/指背（橙）标记球半径（数据单位） */
export const MARK_RADIUS = 0.04;
/** 伪受光光向（几何本地空间）：背侧偏上略前最亮，掌侧次之 */
const FAKE_LIGHT = new Vector3(0.45, 0.8, 0.4).normalize();

export type SegmentNode = { joint: Group; len: number; radius: number; thickness: number };
export type FingerNodes = { root: Group; joints: Group[]; segments: SegmentNode[] };

export type HandMeshResult = {
  root: Group;
  fingers: Record<FingerName, FingerNodes>;
  thumbRoot: Group;
  thumbDof: Group;
};

export type BuildHandMeshOptions = {
  /** 腹/背标记球（编辑器开启；标定测量视图关闭） */
  withMarks?: boolean;
  /** true = cubing 渲染器（顶点色直写 sRGB 数值=淡米偏白）；false = 标准 sRGB 输出
   *  （真机实证 2026-09-12：两口径即两观感，用户选定编辑器用直写淡米色） */
  linearOutput?: boolean;
  /** 网格描边（左视图轮廓） */
  withOutline?: boolean;
  /** 造型参数覆盖（#/hand-lab A/B 调参用；缺省取 cfg.shape） */
  shape?: Partial<HandShapeParams>;
};

type Vec3 = [number, number, number];

type AddOutline = (mesh: Mesh) => void;

/** 段表面到接触点的径向偏移：腹/背用厚度、拇指/小指侧用宽度（贴合超椭圆剖面） */
export function meshSurfaceOffset(seg: SegmentNode, dir: "x" | "y", H: number): number {
  return (dir === "x" ? seg.radius : seg.thickness) + MARK_GAP * H;
}

/** 确定性伪随机（逐面明度抖动；固定种子保证重建不闪烁） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** sRGB hex → 顶点色分量：cubing 直写 sRGB 数值（淡米偏白）/ sRGB 输出走 ColorManagement */
function baseRGB(hex: number, linearOutput: boolean): Vec3 {
  if (linearOutput) {
    return [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255];
  }
  const c = new Color(hex);
  return [c.r, c.g, c.b];
}

/**
 * 非索引化 + 面法线（硬边）+ 逐面顶点色：伪受光（面法线 × 固定光向）+ 明度抖动。
 */
function facetize(
  geo: BufferGeometry,
  hex: number,
  linearOutput: boolean,
  jitter: number,
  rng: () => number,
): BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.computeVertexNormals();
  const pos = g.getAttribute("position");
  const nrm = g.getAttribute("normal");
  const col = new Float32Array(pos.count * 3);
  const base = baseRGB(hex, linearOutput);
  const n = new Vector3();
  for (let t = 0; t < pos.count; t += 3) {
    n.set(nrm.getX(t), nrm.getY(t), nrm.getZ(t));
    const shade = 0.9 + 0.1 * Math.max(0, n.dot(FAKE_LIGHT)); // 自发光口径：弱化刻面观感
    const jit = 1 + (rng() - 0.5) * 2 * jitter;
    for (let k = 0; k < 3; k++) {
      const o = (t + k) * 3;
      col[o] = Math.min(1, base[0] * shade * jit);
      col[o + 1] = Math.min(1, base[1] * shade * jit);
      col[o + 2] = Math.min(1, base[2] * shade * jit);
    }
  }
  g.setAttribute("color", new BufferAttribute(col, 3));
  return g;
}

function tintedMesh(geo: BufferGeometry, part: string): Mesh {
  const m = new Mesh(geo, new MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
  m.userData.part = part;
  return m;
}

function mergeGeometries(geos: BufferGeometry[]): BufferGeometry {
  if (geos.length === 1) return geos[0];
  let total = 0;
  for (const g of geos) total += g.getAttribute("position").count;
  const arr = new Float32Array(total * 3);
  let off = 0;
  for (const g of geos) {
    arr.set(g.getAttribute("position").array as Float32Array, off);
    off += g.getAttribute("position").count * 3;
  }
  const out = new BufferGeometry();
  out.setAttribute("position", new BufferAttribute(arr, 3));
  return out;
}

/** 超椭圆截面环：x∈±a（宽）；腹侧(-y)半径 bPad / 背侧(+y)半径 bBack 可独立
 * （关节环指面单独微凹成折痕、背侧不凹）；nPad/nBack 各自指数越大越扁 */
function ringPoints(
  facets: number,
  a: number,
  bPad: number,
  bBack: number,
  nPad: number,
  nBack: number,
  yOff: number,
  z: number,
): Vec3[] {
  const pts: Vec3[] = [];
  for (let k = 0; k < facets; k++) {
    const th = (k * 2 * Math.PI) / facets; // 顶点在 ±x：平坦面朝 ±y（指腹/指背）
    const c = Math.cos(th);
    const s = Math.sin(th);
    const n = s < 0 ? nPad : nBack;
    const b = s < 0 ? bPad : bBack;
    pts.push([
      Math.sign(c) * Math.abs(c) ** (2 / n) * a,
      Math.sign(s) * Math.abs(s) ** (2 / n) * b + yOff,
      z,
    ]);
  }
  return pts;
}

function positionsToGeometry(pos: number[]): BufferGeometry {
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  return geo;
}

/** 扇形封口：apex 在环 +z 外侧时 forward（外法线 +z），反之 -z */
function fanGeometry(ring: Vec3[], apex: Vec3, forward: boolean): BufferGeometry {
  const F = ring.length;
  const pos: number[] = [];
  for (let k = 0; k < F; k++) {
    const k2 = (k + 1) % F;
    const tri = forward ? [ring[k], ring[k2], apex] : [ring[k2], ring[k], apex];
    for (const v of tri) pos.push(v[0], v[1], v[2]);
  }
  return positionsToGeometry(pos);
}

function ringCentroid(ring: Vec3[]): Vec3 {
  const c: Vec3 = [0, 0, 0];
  for (const p of ring) {
    c[0] += p[0] / ring.length;
    c[1] += p[1] / ring.length;
    c[2] += p[2] / ring.length;
  }
  return c;
}

/**
 * 环间放样（环内点数一致，θ 逆时针）：quad(R0k, R0k+1, R1k+1, R1k) 外法线朝外；
 * capStart/capEnd 端面扇形封口。
 */
function loftGeometry(rings: Vec3[][], capStart: boolean, capEnd: boolean): BufferGeometry {
  const F = rings[0].length;
  const pos: number[] = [];
  for (let r = 0; r < rings.length - 1; r++) {
    const R0 = rings[r];
    const R1 = rings[r + 1];
    for (let k = 0; k < F; k++) {
      const k2 = (k + 1) % F;
      pos.push(...R0[k], ...R0[k2], ...R1[k2]);
      pos.push(...R0[k], ...R1[k2], ...R1[k]);
    }
  }
  const parts = [positionsToGeometry(pos)];
  if (capStart) parts.push(fanGeometry(rings[0], ringCentroid(rings[0]), false));
  if (capEnd) parts.push(fanGeometry(rings[rings.length - 1], ringCentroid(rings[rings.length - 1]), true));
  return mergeGeometries(parts);
}

/**
 * 指蹼双凹透镜棱柱（0.4.0 十二轮）：XY 截面为透镜形——背侧 U 谷下凹 + 掌侧 ∩ 上凹，
 * 指背/指面两面都是内凹面（此前 U 谷棱柱仅背侧有凹面）；沿 Z 从 z0（没入掌面）到 z1，
 * 前帽随形。端头由指根关节球遮盖。
 */
function webLensGeometry(
  xL: number,
  xR: number,
  yTop: number,
  yBot: number,
  dipT: number,
  dipB: number,
  z0: number,
  z1: number,
  segs: number,
): BufferGeometry {
  const cx = (xL + xR) / 2;
  const half = (xR - xL) / 2;
  const bell = (x: number): number => {
    const t = Math.max(-1, Math.min(1, (x - cx) / half));
    return Math.sqrt(1 - t * t); // 圆弧逼近：中心 1、两端 0
  };
  const topY = (x: number): number => yTop - dipT * bell(x);
  const botY = (x: number): number => yBot + dipB * bell(x);
  const xs: number[] = [];
  for (let k = 0; k <= segs; k++) xs.push(xL + ((xR - xL) * k) / segs);
  const mk = (z: number): { top: Vec3[]; bot: Vec3[] } => ({
    top: xs.map((x) => [x, topY(x), z] as Vec3),
    bot: xs.map((x) => [x, botY(x), z] as Vec3),
  });
  const A = mk(z0);
  const B = mk(z1);
  const topPos: number[] = [];
  const botPos: number[] = [];
  for (let k = 0; k < xs.length - 1; k++) {
    // 顶面谷条带（法线 +Y）
    topPos.push(...A.top[k], ...B.top[k], ...B.top[k + 1]);
    topPos.push(...A.top[k], ...B.top[k + 1], ...A.top[k + 1]);
    // 底面谷条带（法线 -Y，反绕）
    botPos.push(...A.bot[k], ...A.bot[k + 1], ...B.bot[k + 1]);
    botPos.push(...A.bot[k], ...B.bot[k + 1], ...B.bot[k]);
  }
  // 前帽（z1，法线 +Z）：轮廓 = 底线左→右（∩ 上凹）+ 顶线右→左（U 下凹）+ 闭合，CCW
  const cap: number[] = [];
  const outline: Vec3[] = [
    ...B.bot.map((p) => [p[0], p[1], z1] as Vec3),
    ...B.top.slice().reverse().map((p) => [p[0], p[1], z1] as Vec3),
  ];
  const c: Vec3 = [0, 0, z1];
  for (const p of outline) {
    c[0] += p[0] / outline.length;
    c[1] += p[1] / outline.length;
  }
  for (let k = 0; k < outline.length; k++) {
    const k2 = (k + 1) % outline.length;
    cap.push(...c, ...outline[k], ...outline[k2]);
  }
  return mergeGeometries([
    positionsToGeometry(topPos),
    positionsToGeometry(botPos),
    positionsToGeometry(cap),
  ]);
}

/** 掌指横弓 / 指根随动：中部（中指 x≈0）向背侧弓起（掌心凹），边缘归零 */
function archBell(xn: number): number {
  const t = Math.max(-1, Math.min(1, xn));
  return Math.cos((t * Math.PI) / 2) ** 2;
}

/**
 * 构建单指链：root → joints[0](关节球+段0放样) → joints[1](…) → …；
 * 关节球兜住弯折缝隙 + 关节隆起解剖形态；末段收口 + 前伸圆头。
 */
function buildFingerChain(
  rig: HandRig,
  name: FingerName,
  H: number,
  shape: HandShapeParams,
  opts: Required<Pick<BuildHandMeshOptions, "withMarks" | "linearOutput" | "withOutline">>,
  addOutline: AddOutline,
  rng: () => number,
): FingerNodes {
  const def = rig.fingers[name];
  const F = shape.facets;
  // 剖面（0.4.0 九轮）：指面微凸（n 略大于 2），指背更平滑、凸更小（n 更大趋平）
  const nPad = 2 + shape.padFlat * 0.35;
  const nBack = 2.3 + shape.padFlat * 0.5;
  const root = new Group();
  const joints: Group[] = [];
  const segments: SegmentNode[] = [];
  let cursor: Group = root;
  const lastSegIndex = def.segments.length - 1;
  for (let j = 0; j < def.joints.length; j++) {
    const joint = new Group();
    cursor.add(joint);
    joints.push(joint);
    const seg = def.segments[j];
    if (!seg) break; // 末梢关节（拇指 IP）：无后续段，不放关节球——指尖与四指统一为收口圆头
    const wHalf = (seg.width / 2) * H;
    // 关节球：弯折兜底 + 隆起（MCP 最大，向指尖递减）；
    // 十四轮弱化：系数组 0.98/1.0/0.96→0.93/0.95/0.92（默认 bulge 1.1 下球径
    // 1.02/1.05/1.01 半宽，仍 ≥ 段宽保弯折兜底；系数在代码侧，旧存档立即生效）
    const bulge = shape.knuckleBulge * (j === 0 ? 0.93 : j === 1 ? 0.95 : 0.92);
    const ballMesh = tintedMesh(
      facetize(new SphereGeometry(wHalf * bulge, Math.max(F, 8), 4), SKIN, opts.linearOutput, shape.facetJitter, rng),
      `${name}-joint${j}`,
    );
    joint.add(ballMesh);
    addOutline(ballMesh);
    const len = seg.length * H;
    const tHalf = wHalf * 0.94;
    const isLast = j === lastSegIndex;
    // 近圆锥（0.4.0 十轮）：段内连续收分、末环半径=下一段宽（跨段连续无分界）；
    // 关节环指面独立微凹成折痕（背侧不凹）；根球系数下调——指根不凸出掌面
    const nextW = isLast ? 0 : def.segments[j + 1].width;
    const endF = isLast ? shape.tipTaper : nextW / seg.width;
    const lf = (p: number, q: number, k: number): number => p + (q - p) * k;
    const back = 0.24 * wHalf;
    const rings: Vec3[][] = [
      ringPoints(F, wHalf * 0.9, tHalf * 0.9 * 0.86, tHalf * 0.9, nPad, nBack, 0, -back),
      ringPoints(F, wHalf, tHalf * 0.86, tHalf, nPad, nBack, 0, 0), // 关节环：指面折痕微凹
    ];
    let geo: BufferGeometry;
    if (isLast) {
      // 指尖：锥形收分两环 + 前伸圆头扇帽（合并单几何保证法线连续）
      rings.push(ringPoints(F, wHalf * lf(1, endF, 0.5), tHalf * lf(1, endF, 0.5), tHalf * lf(1, endF, 0.5), nPad, nBack, 0, len * 0.45));
      rings.push(
        ringPoints(F, wHalf * lf(endF, endF * 1.08, 0.6), tHalf * lf(endF, endF * 1.08, 0.6), tHalf * lf(endF, endF * 1.08, 0.6), nPad, nBack, 0, len * 0.82),
      );
      rings.push(ringPoints(F, wHalf * endF, tHalf * endF, tHalf * endF, nPad, nBack, 0, len));
      const tipRing = rings[rings.length - 1];
      const apex: Vec3 = [0, 0, len + len * 0.12];
      geo = mergeGeometries([loftGeometry(rings, false, false), fanGeometry(tipRing, apex, true)]);
    } else {
      const midF = lf(1, endF, 0.5) * lf(1, shape.shaftTaper, 0.6);
      rings.push(ringPoints(F, wHalf * midF, tHalf * midF, tHalf * midF, nPad, nBack, 0, len * 0.45));
      rings.push(ringPoints(F, wHalf * lf(1, endF, 0.85), tHalf * lf(1, endF, 0.85), tHalf * lf(1, endF, 0.85), nPad, nBack, 0, len * 0.8));
      rings.push(ringPoints(F, wHalf * endF, tHalf * endF, tHalf * endF, nPad, nBack, 0, len));
      geo = loftGeometry(rings, false, false);
    }
    const mesh = tintedMesh(facetize(geo, SKIN, opts.linearOutput, shape.facetJitter, rng), `${name}-seg${j}`);
    joint.add(mesh);
    addOutline(mesh);
    if (isLast) {
      // 指甲（0.4.0 九轮）：末节背侧浅色圆角片，随指尖收口微俯
      const nail = tintedMesh(
        facetize(
          new RoundedBoxGeometry(wHalf * shape.tipTaper * 1.35, 0.035 * H, len * 0.36, 2, 0.014 * H),
          NAIL,
          opts.linearOutput,
          0,
          rng,
        ),
        `${name}-nail`,
      );
      nail.position.set(0, tHalf * 0.62 + 0.01 * H, len * 0.78);
      nail.rotation.x = 0.14;
      joint.add(nail);
    }
    if (opts.withMarks) {
      // 腹/背标记球：偏移贴合剖面厚度 + 间隙
      const off = tHalf * shape.shaftTaper + MARK_GAP * H;
      const padMesh = tintedMesh(
        facetize(new SphereGeometry(MARK_RADIUS * H, 8, 6), PAD, opts.linearOutput, 0, rng),
        `${name}-mark-pad`,
      );
      padMesh.position.set(0, -off, len / 2);
      joint.add(padMesh);
      const backMesh = tintedMesh(
        facetize(new SphereGeometry(MARK_RADIUS * H, 8, 6), BACK, opts.linearOutput, 0, rng),
        `${name}-mark-back`,
      );
      backMesh.position.set(0, off, len / 2);
      joint.add(backMesh);
    }
    segments.push({ joint, len, radius: wHalf, thickness: tHalf * shape.shaftTaper });
    const next = new Group();
    next.position.z = len;
    joint.add(next);
    cursor = next;
  }
  return { root, joints, segments };
}

/**
 * 大鱼际：肌腹式纵脊（真机验收二轮重构——替换原椭球）。
 * 从掌根延伸至近掌指缘（thenar.length 控制前伸比例），贴掌侧壁外突（thenar.width
 * =外突量、thenar.height=竖向鼓起），肌腹中段最鼓、两端收束；拇指根锚在其上
 * （thumbCorner 默认即脊前段），与四指平行伸出。thenar.x/z 字段保留但几何不再消费。
 */
function buildThenarRidge(
  cfg: HandRigConfig,
  shape: HandShapeParams,
  H: number,
  sideSign: number,
  thumbWHalf: number,
  linearOutput: boolean,
  addOutline: AddOutline,
  rng: () => number,
): Mesh {
  const F = Math.max(shape.facets, 8);
  const len = cfg.palm.length * H;
  const mcpZ = cfg.palm.mcpZ * H;
  const halfW = (cfg.palm.width / 2) * H;
  const zHeel = mcpZ - len + 0.02 * H; // 掌根（略内收避免与掌跟面共面 z-fighting）
  // 前缘适配后退的拇指根（0.4.0 七轮）+ 末环与拇指根截面对齐（九轮）：脊末端直接
  // 采用拇指根段的截面尺寸与圆心，经漏斗渐变汇入——接缝处无台阶
  const tcX = cfg.thumbCorner.x * H * sideSign;
  const tcY = cfg.thumbCorner.y * H;
  const zCap = cfg.thumbCorner.z * H + 0.18 * H;
  const zFront = Math.min(
    zHeel + len * Math.min(cfg.thenar.length, 1.05) * 0.92,
    zCap,
  );
  const aMax = cfg.thenar.width * H * 0.45; // 外突半径（横冠军径）
  const b = cfg.thenar.height * H * 0.55; // 竖向半径
  const yC = -0.05 * H + cfg.thenar.y * H; // 略偏掌侧 + 配置竖向微调
  const wallAt = (t: number): number => halfW * (shape.palmTaper + (1 - shape.palmTaper) * t);
  const bellyAt = (t: number): number => Math.sin(Math.PI * t) ** 0.8; // 肌腹：两端收、中段最鼓
  type RingSpec = { cx: number; cy: number; a: number; b: number; z: number };
  const spec = (t: number): RingSpec => {
    const a = aMax * (0.3 + 0.7 * bellyAt(t));
    return { cx: sideSign * (wallAt(t) + a * 0.55), cy: yC, a, b, z: zHeel + (zFront - zHeel) * t };
  };
  // 拇指根目标截面：与拇指根段体同尺寸同圆心
  const target: RingSpec = { cx: tcX, cy: tcY, a: thumbWHalf * 1.12, b: thumbWHalf * 0.98, z: zFront };
  const toward = (s: RingSpec, k: number): RingSpec => ({
    cx: s.cx + (target.cx - s.cx) * k,
    cy: s.cy + (target.cy - s.cy) * k,
    a: s.a + (target.a - s.a) * k,
    b: s.b + (target.b - s.b) * k,
    z: s.z + (target.z - s.z) * k,
  });
  const stations: RingSpec[] = [
    spec(0),
    spec(0.25),
    spec(0.5),
    spec(0.72),
    toward(spec(0.72), 0.3),
    toward(spec(0.72), 0.55),
    toward(spec(0.72), 0.8),
    toward(spec(0.72), 1),
  ];
  const rings: Vec3[][] = stations.map((st) =>
    ringPoints(F, st.a, st.b, st.b, 2.3, 2.3, st.cy, st.z).map(
      (p) => [p[0] + st.cx, p[1], p[2]] as Vec3,
    ),
  );
  const mesh = tintedMesh(
    facetize(loftGeometry(rings, true, true), SKIN, linearOutput, shape.facetJitter, rng),
    "thenar",
  );
  addOutline(mesh);
  return mesh;
}

/** 手掌：梯形平面放样（腕→掌指缘）+ 厚度梯度 + 横弓 + 掌心纵凹 */
function buildPalm(
  cfg: HandRigConfig,
  shape: HandShapeParams,
  H: number,
  linearOutput: boolean,
  addOutline: AddOutline,
  rng: () => number,
): Mesh {
  const F = Math.max(shape.facets * 2, 12);
  const halfW = (cfg.palm.width / 2) * H;
  const halfT = (cfg.palm.height / 2) * H;
  const len = cfg.palm.length * H;
  const mcpZ = cfg.palm.mcpZ * H;
  const nShape = 2.85; // 近椭圆角矩形（截面整体化）
  // 前环逐点横弓：中部向背侧（+y）弓起，掌心凹
  const frontArch = (xData: number): number => shape.arch * H * archBell(xData / (cfg.palm.width / 2));
  // 纵向 4 站环（腕→掌中→近缘→掌指缘）：宽/厚/掌心凹连续插值，曲线顺滑
  const station = (t: number): Vec3[] => {
    const a = halfW * (shape.palmTaper + (1 - shape.palmTaper) * t);
    const b = halfT * (1 - 0.04 * t * t); // 厚度微薄（前缘保持包住指根）
    const cup = shape.palmCup * H * (t * (1 - t) * 4); // 掌心凹：中部峰值、两端归零
    return ringPoints(F, a, b, b, nShape, nShape, cup, mcpZ - len * (1 - t));
  };
  const rings: Vec3[][] = [
    station(0),
    station(0.55),
    station(0.82),
    station(1).map((p) => [p[0], p[1] + frontArch(p[0] / H), p[2]] as Vec3),
  ];
  const mesh = tintedMesh(facetize(loftGeometry(rings, true, true), SKIN, linearOutput, shape.facetJitter, rng), "palm");
  addOutline(mesh);
  return mesh;
}

/** 四指根下压（十四轮，×段半宽向掌内压入）：露出掌面的截面即指根清晰超椭圆
 * （与掌面截面对齐），MCP 球前凸 1.08→0.72 半宽（凸起减半）。0.3 是弯曲封闭
 * 下限——压入后球在面处截线半径须仍 ≈ 指壁（sqrt(R²−d²)≈w），更深则弯折开裂 */
const ROOT_EMBED = 0.3;

/** (y,z) 平面环（指根间填充棱用，截面 ⊥ 指行 x）：θ 增向自 +z 转向 +y
 * （自 +x 端看逆时针，与 loftGeometry「θ 逆时针外法线朝外」约定一致，
 * 放样方向 +x）——截面为圆角三角感 superellipse（n<2 顶点朝 +z）= 三棱柱读法 */
function ringYZ(
  F: number,
  cx: number,
  cy: number,
  zBase: number,
  ry: number,
  rz: number,
  n: number,
): Vec3[] {
  const pts: Vec3[] = [];
  for (let i = 0; i < F; i++) {
    const th = (i / F) * Math.PI * 2;
    const c = Math.cos(th);
    const s = Math.sin(th);
    pts.push([
      cx,
      cy + ry * Math.sign(c) * Math.abs(c) ** (2 / n),
      zBase + rz * Math.sign(s) * Math.abs(s) ** (2 / n),
    ]);
  }
  return pts;
}

/**
 * 指根间填充棱（0.4.0 十五轮）：相邻指根窝之间的细化三棱柱——截面为 (y,z) 平面
 * 顶点朝 +z 的圆角三角（n=1.5），沿指行方向 x 放样 7 站；脊线在两窝之间浅凹
 * （关节的凹陷），端环没入相邻根窝锥面与关节球，掌面侧 V 缺口由此填平。
 * x0<x1 由调用方保证（镜像手取 min/max）。
 */
function buildKnuckleFiller(
  x0: number,
  x1: number,
  cy: number,
  mcpZ: number,
  H: number,
  shape: HandShapeParams,
  linearOutput: boolean,
  addOutline: AddOutline,
  rng: () => number,
): Mesh {
  const F = Math.max(shape.facets, 10);
  const mid = (x0 + x1) / 2;
  const half = Math.abs(x1 - x0) / 2;
  const crestMid = 0.022 * H; // 两窝之间：浅凹谷底
  const crestEnd = 0.045 * H; // 没入根窝端：衔接窝锥面
  const stations = 7;
  const rings: Vec3[][] = [];
  for (let i = 0; i < stations; i++) {
    const t = i / (stations - 1);
    const x = x0 + (x1 - x0) * t;
    const u = Math.abs(x - mid) / half;
    const crest = crestMid + (crestEnd - crestMid) * u * u;
    rings.push(ringYZ(F, x, cy - 0.02 * H, mcpZ - 0.004 * H, 0.045 * H, crest, 1.5));
  }
  const mesh = tintedMesh(
    facetize(loftGeometry(rings, false, false), SKIN, linearOutput, shape.facetJitter, rng),
    "knuckle-filler",
  );
  addOutline(mesh);
  return mesh;
}

/**
 * 指根掌侧肌凸（0.4.0 十五轮）：每指根窝下方（掌缘方向）的浅盘状肌肉隆起——
 * 类大鱼际但更弱（弧度小，露出掌面 ~0.016H）；扁椭球罩在掌前缘面上，下半没入
 * 掌体，上缘与根窝锥面相融，相邻肌凸之间留浅谷。
 */
function buildPalmarPad(
  cx: number,
  cy: number,
  mcpZ: number,
  wHalf: number,
  H: number,
  shape: HandShapeParams,
  linearOutput: boolean,
  addOutline: AddOutline,
  rng: () => number,
): Mesh {
  const F = Math.max(shape.facets * 2, 16);
  const geo = new SphereGeometry(1, F, Math.max(4, Math.round(F / 3)));
  geo.scale(1.05 * wHalf, 0.075 * H, 0.028 * H);
  geo.translate(cx, cy - 0.12 * H, mcpZ - 0.012 * H);
  const mesh = tintedMesh(
    facetize(geo, SKIN, linearOutput, shape.facetJitter, rng),
    "palmar-pad",
  );
  addOutline(mesh);
  return mesh;
}

/**
 * 指根领圈（0.4.0 十三轮引入，十四轮改造）：掌前缘面上的指根窝倒角。
 * 十四轮起四指根整体压入掌面（ROOT_EMBED），MCP 球大部没入掌内——领圈角色从
 * 「抱球」变为「根窝」：面缘宽足印（近椭圆）逐站收细，**末环与指根截面同式同值**
 * （同超椭圆指数/指面折痕比例，×0.985 沉入指内）——领圈与指壁截面对齐无缝。
 * 挂在掌侧（root 子节点，不随指弯）——球心即弯转轴、球面旋转不变，压入深度
 * 保持球在面处截线半径 ≈ 指壁，弯曲时依旧封闭；外侧受 rxMax（掌壁+裕量）钳制。
 */
function buildKnuckleCollar(
  cx: number,
  cy: number,
  mcpZ: number,
  wHalf: number,
  rxMax: number,
  shape: HandShapeParams,
  linearOutput: boolean,
  addOutline: AddOutline,
  rng: () => number,
): Mesh {
  const F = Math.max(shape.facets, 8);
  const tHalf = wHalf * 0.94; // 与 buildFingerChain 同式
  const nPad = 2 + shape.padFlat * 0.35;
  const nBack = 2.3 + shape.padFlat * 0.5;
  const rx = Math.max(Math.min(wHalf * 1.22, rxMax), 0.05 * wHalf);
  // 站环插值：rim（面缘足印）→ fing（指根截面同式，沉入 0.985）
  const rim = { a: rx, bPad: rx * 0.94, bBack: rx * 0.94, nP: 2.3, nB: 2.3 };
  const fing = {
    a: wHalf * 0.985,
    bPad: tHalf * 0.86 * 0.985, // 指面折痕比例与指根环一致
    bBack: tHalf * 0.985,
    nP: nPad,
    nB: nBack,
  };
  const stations: Array<[number, number]> = [
    [0, 0],
    [0.18, 0.35],
    [0.32, 0.7],
    [0.46, 1],
  ];
  const rings: Vec3[][] = stations.map(([dz, k]) => {
    const lerp = (p: number, q: number): number => p + (q - p) * k;
    return ringPoints(
      F,
      lerp(rim.a, fing.a),
      lerp(rim.bPad, fing.bPad),
      lerp(rim.bBack, fing.bBack),
      lerp(rim.nP, fing.nP),
      lerp(rim.nB, fing.nB),
      cy,
      mcpZ + dz * wHalf,
    ).map((p) => [p[0] + cx, p[1], p[2]] as Vec3);
  });
  const mesh = tintedMesh(
    facetize(loftGeometry(rings, false, false), SKIN, linearOutput, shape.facetJitter, rng),
    "knuckle-collar",
  );
  addOutline(mesh);
  return mesh;
}

/** 主入口：构建整手 low-poly 网格（坐标系与旧 buildHandGeometry 完全一致） */
export function buildHandMesh(
  cfg: HandRigConfig,
  rig: HandRig,
  sideSign: number,
  options: BuildHandMeshOptions = {},
): HandMeshResult {
  const opts: Required<Pick<BuildHandMeshOptions, "withMarks" | "linearOutput" | "withOutline">> = {
    withMarks: options.withMarks ?? true,
    linearOutput: options.linearOutput ?? false,
    withOutline: options.withOutline ?? false,
  };
  const shape: HandShapeParams = { ...cfg.shape, ...options.shape };
  const H = cfg.handScale;
  const rng = mulberry32(20260911);
  const outlineMat = opts.withOutline ? new LineBasicMaterial({ color: OUTLINE, toneMapped: false }) : null;
  const addOutline: AddOutline = (mesh) => {
    if (!outlineMat) return;
    mesh.add(new LineSegments(new EdgesGeometry(mesh.geometry, 14), outlineMat));
  };
  const root = new Group();

  // 手掌（绝对 z：腕 → mcpZ）
  root.add(buildPalm(cfg, shape, H, opts.linearOutput, addOutline, rng));

  // 大鱼际：肌腹式纵脊（拇指根锚在其上）
  root.add(
    buildThenarRidge(
      cfg,
      shape,
      H,
      sideSign,
      (cfg.fingers.thumb[0].width / 2) * H,
      opts.linearOutput,
      addOutline,
      rng,
    ),
  );

  // 指蹼（0.4.0 十一轮定版）：内凹 U 谷棱柱——谷线顶低于指根球顶，只凹不凸；
  // 后撤缩窄（z 至 mcpZ+0.14、弧半径收 0.5），y 随横弓
  const FOUR = ["index", "middle", "ring", "pinky"] as const;
  const grad = [0.8, 1, 0.7];
  const mcpZ = cfg.palm.mcpZ * H;
  for (let i = 0; i < 3; i++) {
    const a = cfg.bases[FOUR[i]];
    const b = cfg.bases[FOUR[i + 1]];
    const xa = a.x * cfg.fingerSpacing * H * sideSign;
    const xb = b.x * cfg.fingerSpacing * H * sideSign;
    const cxData = ((a.x + b.x) / 2) * cfg.fingerSpacing;
    const yRoot =
      Math.min(a.y, b.y) * H + shape.arch * H * archBell(cxData / (cfg.palm.width / 2));
    const xL = Math.min(xa, xb);
    const xR = Math.max(xa, xb);
    const web = tintedMesh(
      facetize(
        webLensGeometry(
          xL,
          xR,
          yRoot + 0.02 * H, // 背缘（低于指根球顶）
          yRoot - 0.14 * H, // 掌缘
          0.045 * H * grad[i], // 背侧凹深（中缝最深）
          0.035 * H,        // 掌侧凹深
          mcpZ - 0.01 * H,
          mcpZ + 0.14 * H,
          6,
        ),
        SKIN,
        opts.linearOutput,
        0,
        rng,
      ),
      `web-${i}`,
    );
    root.add(web);
    addOutline(web);
  }

  // 指根领圈（十四轮根窝倒角；十五轮加邻指钳制 0.46×窝距——窝间留出谷位，
  // 由填充棱衔接）：外侧受掌壁+0.03H 裕量钳制
  const halfW = (cfg.palm.width / 2) * H;
  const roots = FOUR.map((name) => {
    const base = cfg.bases[name];
    const xData = base.x * cfg.fingerSpacing;
    return {
      name,
      cx: xData * H * sideSign,
      cy: base.y * H + shape.arch * H * archBell(xData / (cfg.palm.width / 2)),
      wHalf: (rig.fingers[name].segments[0].width / 2) * H,
    };
  });
  roots.forEach((r, i) => {
    const wallLimit = halfW - Math.abs(r.cx) + 0.03 * H;
    const gapL = i > 0 ? Math.abs(r.cx - roots[i - 1].cx) : Infinity;
    const gapR = i < roots.length - 1 ? Math.abs(r.cx - roots[i + 1].cx) : Infinity;
    const rxMax = Math.min(wallLimit, 0.46 * Math.min(gapL, gapR));
    root.add(
      buildKnuckleCollar(r.cx, r.cy, mcpZ, r.wHalf, rxMax, shape, opts.linearOutput, addOutline, rng),
    );
  });

  // 指根间填充棱（十五轮）：掌面侧相邻根窝之间的细化三棱柱，脊线浅凹=关节的凹陷
  for (let i = 0; i < 3; i++) {
    const a = cfg.bases[FOUR[i]];
    const b = cfg.bases[FOUR[i + 1]];
    const xL = Math.min(a.x, b.x) * cfg.fingerSpacing * H * sideSign;
    const xR = Math.max(a.x, b.x) * cfg.fingerSpacing * H * sideSign;
    const cxData = ((a.x + b.x) / 2) * cfg.fingerSpacing;
    const cy = Math.min(a.y, b.y) * H + shape.arch * H * archBell(cxData / (cfg.palm.width / 2));
    root.add(buildKnuckleFiller(xL, xR, cy, mcpZ, H, shape, opts.linearOutput, addOutline, rng));
  }

  // 指根掌侧肌凸（十五轮）：每指窝下方浅盘状隆起（类大鱼际，弧度小）
  for (const r of roots) {
    root.add(buildPalmarPad(r.cx, r.cy, mcpZ, r.wHalf, H, shape, opts.linearOutput, addOutline, rng));
  }

  // 四指根：布局 × 指距，y 随横弓（archBell 期望数据单位输入）；
  // 十四轮：根位沿 −z 压入掌面 ROOT_EMBED×半宽（截面对齐 + MCP 球前凸减半）
  const fingers = {} as Record<FingerName, FingerNodes>;
  for (const name of FOUR) {
    const base = cfg.bases[name];
    const nodes = buildFingerChain(rig, name, H, shape, opts, addOutline, rng);
    const xData = base.x * cfg.fingerSpacing;
    const wHalf0 = (rig.fingers[name].segments[0].width / 2) * H;
    nodes.root.position.set(
      xData * H * sideSign,
      base.y * H + shape.arch * H * archBell(xData / (cfg.palm.width / 2)),
      cfg.palm.mcpZ * H - ROOT_EMBED * wHalf0,
    );
    root.add(nodes.root);
    fingers[name] = nodes;
  }

  // 拇指：thumbRoot(thumbBase) → thumbDof(CMC 三轴) → 拇指链（语义同旧版）
  const thumbRoot = new Group();
  const thumbDof = new Group();
  thumbRoot.add(thumbDof);
  const tc = cfg.thumbCorner;
  thumbRoot.position.set(tc.x * H * sideSign, tc.y * H, tc.z * H);
  const thumbNodes = buildFingerChain(rig, "thumb", H, shape, opts, addOutline, rng);
  thumbDof.add(thumbNodes.root);
  root.add(thumbRoot);
  fingers.thumb = thumbNodes;

  return { root, fingers, thumbRoot, thumbDof };
}
