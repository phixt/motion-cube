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
 * - 旧 handGeometry.ts 冻结不动，仅供 #/hand-lab A/B 对照。
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
import type { FingerName, HandRig } from "./HandRig";
import type { HandRigConfig, HandShapeParams } from "./handRigStore";

/** 肤色/标记/描边（与旧 handGeometry.ts 同值；旧文件冻结故此处独立声明） */
export const SKIN = 0xe4d4bd;
export const PAD = 0x4ade80;
export const BACK = 0xf59e0b;
export const OUTLINE = 0x2b2b33;
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
    const shade = 0.78 + 0.22 * Math.max(0, n.dot(FAKE_LIGHT));
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

/** 超椭圆截面环：x∈±a（宽）、y∈±b（厚，+yOff 整体抬升）；腹侧(-y)指数 nPad 越大越扁 */
function ringPoints(
  facets: number,
  a: number,
  b: number,
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
 * 指蹼 U 形谷棱柱（真机验收 2026-09-11：旧菱形填充呈怪凸起，改「拆解 V 逼近 U」）：
 * XY 截面 = U 谷线（两侧高、谷底低，θ π→2π 下半圆弧采样）+ 底边，沿 Z 从 z0（没入
 * 掌面）到 z1；谷面条带外法线朝谷口，前端帽外法线 +Z。端头由指根关节球遮盖。
 */
function webGussetGeometry(
  xL: number,
  xR: number,
  yTop: number,
  yBottom: number,
  R: number,
  z0: number,
  z1: number,
  arcSegs: number,
): BufferGeometry {
  const cx = (xL + xR) / 2;
  const arc = (th0: number, th1: number): Vec3[] => {
    const pts: Vec3[] = [];
    for (let k = 0; k <= arcSegs; k++) {
      const th = th0 + ((th1 - th0) * k) / arcSegs;
      pts.push([cx + R * Math.cos(th), yTop + R * Math.sin(th), 0]);
    }
    return pts;
  };
  const curveLR = arc(Math.PI, 2 * Math.PI); // 左→右经谷底
  const ring0 = curveLR.map((p) => [p[0], p[1], z0] as Vec3);
  const ring1 = curveLR.map((p) => [p[0], p[1], z1] as Vec3);
  // 谷面条带（法线朝谷口）
  const wall: number[] = [];
  for (let k = 0; k < ring0.length - 1; k++) {
    wall.push(...ring0[k], ...ring1[k], ...ring1[k + 1]);
    wall.push(...ring0[k], ...ring1[k + 1], ...ring0[k + 1]);
  }
  // 前帽：轮廓 = 底边左→右 + 谷线右→左（CCW），扇形三角化
  const cap: number[] = [];
  const outline: Vec3[] = [
    [xL, yBottom, z1],
    [xR, yBottom, z1],
    ...arc(2 * Math.PI, Math.PI).map((p) => [p[0], p[1], z1] as Vec3),
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
  return mergeGeometries([positionsToGeometry(wall), positionsToGeometry(cap)]);
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
  const nPad = 2 + shape.padFlat * 2.2;
  const nBack = 2.2;
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
    // 关节球：弯折兜底 + 隆起（MCP 最大，向指尖递减）
    const bulge = shape.knuckleBulge * (j === 0 ? 1 : j === 1 ? 0.92 : 0.85);
    const ballMesh = tintedMesh(
      facetize(new SphereGeometry(wHalf * bulge, Math.max(F, 6), 3), SKIN, opts.linearOutput, shape.facetJitter, rng),
      `${name}-joint${j}`,
    );
    joint.add(ballMesh);
    addOutline(ballMesh);
    const len = seg.length * H;
    const tHalf = wHalf * 0.94;
    const isLast = j === lastSegIndex;
    // 纵向站环加密（曲线顺滑）+ 段体后延过盈嵌入父关节球（弯折不裂缝、连接紧密）
    const back = 0.24 * wHalf;
    const rings: Vec3[][] = [
      ringPoints(F, wHalf * 0.9, tHalf * 0.9, nPad, nBack, 0, -back),
      ringPoints(F, wHalf * 0.98, tHalf * 0.98, nPad, nBack, 0, 0),
      ringPoints(F, wHalf * shape.shaftTaper, tHalf * shape.shaftTaper, nPad, nBack, 0, len * 0.4),
      ringPoints(F, wHalf * shape.shaftTaper, tHalf * shape.shaftTaper, nPad, nBack, 0, len * 0.75),
    ];
    let geo: BufferGeometry;
    if (isLast) {
      // 指尖：收口两环 + 前伸圆头扇帽（合并单几何保证法线连续）
      rings.push(
        ringPoints(F, wHalf * shape.tipTaper * 1.12, tHalf * shape.tipTaper * 1.12, nPad, nBack, 0, len * 0.88),
      );
      rings.push(ringPoints(F, wHalf * shape.tipTaper, tHalf * shape.tipTaper, nPad, nBack, 0, len));
      const tipRing = rings[rings.length - 1];
      const apex: Vec3 = [0, 0, len + len * 0.18];
      geo = mergeGeometries([loftGeometry(rings, false, false), fanGeometry(tipRing, apex, true)]);
    } else {
      rings.push(ringPoints(F, wHalf * 0.9, tHalf * 0.9, nPad, nBack, 0, len));
      geo = loftGeometry(rings, false, false);
    }
    const mesh = tintedMesh(facetize(geo, SKIN, opts.linearOutput, shape.facetJitter, rng), `${name}-seg${j}`);
    joint.add(mesh);
    addOutline(mesh);
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
  linearOutput: boolean,
  addOutline: AddOutline,
  rng: () => number,
): Mesh {
  const F = Math.max(shape.facets, 8);
  const len = cfg.palm.length * H;
  const mcpZ = cfg.palm.mcpZ * H;
  const halfW = (cfg.palm.width / 2) * H;
  const zHeel = mcpZ - len + 0.02 * H; // 掌根（略内收避免与掌跟面共面 z-fighting）
  // 前缘适配后退的拇指根（0.4.0 七轮）：脊前端不超过拇指根后方 0.18，避免在拇指根
  // 前方悬出一段「搁板」——削减大鱼际以贴合拇指根后移
  const zCap = cfg.thumbCorner.z * H + 0.18 * H;
  const zFront = Math.min(
    zHeel + len * Math.min(cfg.thenar.length, 1.05) * 0.92,
    zCap,
  );
  const aMax = cfg.thenar.width * H * 0.45; // 外突半径（横冠军径）
  const b = cfg.thenar.height * H * 0.55; // 竖向半径
  const yC = -0.05 * H + cfg.thenar.y * H; // 略偏掌侧 + 配置竖向微调
  const stations = [0, 0.2, 0.4, 0.6, 0.8, 1]; // 纵向 6 站环：肌腹曲线顺滑
  const rings: Vec3[][] = stations.map((t) => {
    const z = zHeel + (zFront - zHeel) * t;
    // 掌侧壁 x 随 palmTaper 渐宽（与掌体放样同口径）
    const wallX = halfW * (shape.palmTaper + (1 - shape.palmTaper) * t);
    const belly = Math.sin(Math.PI * t) ** 0.8; // 肌腹：两端收、中段最鼓
    const a = aMax * (0.3 + 0.7 * belly);
    return ringPoints(F, a, b, 2.4, 2.4, yC, z).map(
      (p) => [p[0] + sideSign * (wallX + a * 0.35), p[1], p[2]] as Vec3,
    );
  });
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
  const nShape = 3.1; // 近圆角矩形
  // 前环逐点横弓：中部向背侧（+y）弓起，掌心凹
  const frontArch = (xData: number): number => shape.arch * H * archBell(xData / (cfg.palm.width / 2));
  // 纵向 4 站环（腕→掌中→近缘→掌指缘）：宽/厚/掌心凹连续插值，曲线顺滑
  const station = (t: number): Vec3[] => {
    const a = halfW * (shape.palmTaper + (1 - shape.palmTaper) * t);
    const b = halfT * (1 - 0.1 * t * t); // 厚度向掌指缘渐薄
    const cup = shape.palmCup * H * (t * (1 - t) * 4); // 掌心凹：中部峰值、两端归零
    return ringPoints(F, a, b, nShape, nShape, cup, mcpZ - len * (1 - t));
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
  root.add(buildThenarRidge(cfg, shape, H, sideSign, opts.linearOutput, addOutline, rng));

  // 指蹼：相邻四指根间 U 形谷（谷底低、两侧高，端头没入指根关节球），y 随横弓
  const FOUR = ["index", "middle", "ring", "pinky"] as const;
  const grad = [0.8, 1, 0.7];
  const mcpZ = cfg.palm.mcpZ * H;
  for (let i = 0; i < 3; i++) {
    const a = cfg.bases[FOUR[i]];
    const b = cfg.bases[FOUR[i + 1]];
    const xa = a.x * cfg.fingerSpacing * H * sideSign;
    const xb = b.x * cfg.fingerSpacing * H * sideSign;
    const xL = Math.min(xa, xb);
    const xR = Math.max(xa, xb);
    const cxData = ((a.x + b.x) / 2) * cfg.fingerSpacing;
    const yRoot =
      Math.min(a.y, b.y) * H + shape.arch * H * archBell(cxData / (cfg.palm.width / 2));
    const R = ((xR - xL) / 2) * (0.3 + 0.6 * shape.web) * grad[i];
    const web = tintedMesh(
      facetize(
        webGussetGeometry(
          xL,
          xR,
          yRoot + 0.03 * H,
          yRoot - 0.25 * H,
          R,
          mcpZ - 0.01 * H,
          mcpZ + 0.2 * H,
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

  // 四指根：布局 × 指距，y 随横弓（archBell 期望数据单位输入）
  const fingers = {} as Record<FingerName, FingerNodes>;
  for (const name of FOUR) {
    const base = cfg.bases[name];
    const nodes = buildFingerChain(rig, name, H, shape, opts, addOutline, rng);
    const xData = base.x * cfg.fingerSpacing;
    nodes.root.position.set(
      xData * H * sideSign,
      base.y * H + shape.arch * H * archBell(xData / (cfg.palm.width / 2)),
      cfg.palm.mcpZ * H,
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
