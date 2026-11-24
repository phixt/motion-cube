/**
 * handMesh.ts — low-poly 饱满无缝手部网格生成器（0.4.x 造型精修）。
 * - 着色：无光照 MeshBasicMaterial + 焊接平滑法线（按 shape.facetJitter 可在平滑与刻面间微调）
 *   + 三点柔光（Half-Lambert 主光 + 掌侧暖补光 + 轮廓微提亮 + 暗部微暖肤色），
 *   消除逐三角棋盘噪点，使相邻部件在交界处自然融合、接缝不显眼；
 * - 手指/拇指：饱满超椭圆放样（严格 X 镜像对称采样，奇偶 facets 均对称）+ 椭球关节无缝衔接
 *   + 多环半球圆润指尖 + 贴背弧面指甲；
 * - 手掌：7 站圆润有机轮廓（腕缘微收倒角、掌中饱满、指根弧线自然顺滑、无方肩硬切）；
 * - 大鱼际：肌腹与拇指根共挂单轴 thenarPivot（沿掌侧纵轴向掌心下沉 0°–90°），
 *   0° 舒展与掌齐平、90° 放松自然下沉且俯视五指完整可见；移除静态虎口斜桥。
 *
 * ⚠ 兼容面冻结：
 * - 对外输出 HandMeshResult 保留 {root, fingers, thumbRoot, thumbDof}（新增 thenarPivot/thumbAnchor）；
 * - 坐标系不变：数据单位 × handScale，+Z 指尖 / +Y 指背 / +X 拇指侧（右手，sideSign 镜像）。
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
import type { FingerName, HandRig, Transform } from "./HandRig";
import type { HandRigConfig, HandShapeParams } from "./handRigStore";

/** 肤色/标记/描边 */
export const SKIN = 0xe6cfb6;
export const PAD = 0x4ade80;
export const BACK = 0xf59e0b;
export const OUTLINE = 0x2b2b33;
/** 指甲色（柔和暖象牙，比肤色略浅） */
export const NAIL = 0xf4e3cc;
/** 标记球 / 接触点中心到段表面的径向间隙（数据单位） */
export const MARK_GAP = 0.05;
/** 指腹（绿）/指背（橙）标记球半径（数据单位） */
export const MARK_RADIUS = 0.04;

/** 三点柔光光向（局部空间，所有部件共用保证交界处色彩连续） */
const KEY_LIGHT = new Vector3(0.38, 0.78, 0.49).normalize();
const FILL_LIGHT = new Vector3(-0.42, -0.58, 0.56).normalize();
const RIM_LIGHT = new Vector3(-0.28, 0.32, -0.9).normalize();

export type SegmentNode = { joint: Group; len: number; radius: number; thickness: number };
export type FingerNodes = { root: Group; joints: Group[]; segments: SegmentNode[] };

export type HandMeshResult = {
  root: Group;
  fingers: Record<FingerName, FingerNodes>;
  /** 大鱼际单轴下沉枢轴（绕局部 Z 轴向掌心下沉 0°–90°；大鱼际网格与 thumbAnchor 共挂其下） */
  thenarPivot: Group;
  /** 拇指根锚点（挂在 thenarPivot 内随大鱼际沿圆弧下沉，并反旋对齐手掌参考系保持 CMC 轴向直观） */
  thumbAnchor: Group;
  thumbRoot: Group;
  thumbDof: Group;
};

/** 大鱼际下沉角到自然对掌自转的比例：90° 放松下沉 → 约 75° 自然自转；0° 舒展 → 0° 与掌齐平 */
export const THENAR_AUTO_ROLL_RATIO = 75 / 90;

export function thenarAutoRollDeg(foldDeg: number): number {
  return foldDeg * THENAR_AUTO_ROLL_RATIO;
}

/** 计算大鱼际单轴枢轴在手掌局部空间中的坐标（由掌宽推导，左右手严格 X 镜像） */
export function thenarPivotLocalOrigin(cfg: HandRigConfig, sideSign: number): [number, number, number] {
  const H = cfg.handScale;
  const halfW = (cfg.palm.width / 2) * H;
  return [sideSign * halfW * 0.86, 0.03 * H, 0];
}

/**
 * 统一驱动大鱼际单轴下沉与拇指 CMC 节点（HandRigView / HandCalibView / HandOrbitView / HandLabPage 共用）。
 * - thenarPivot.rotation.z = -sideSign * fold：大鱼际肌腹与拇指根沿单轴向掌心 (-Y) 下沉；
 * - thumbAnchor.rotation.z = +sideSign * fold：保持 thumbDof 展收/抬离始终在手掌解剖参考系下生效；
 * - thumbDof.rotation.z 叠加 thenarAutoRollDeg(fold) + rotation，实现放松态约 75° 自然自转、舒展态自动转平。
 */
export function applyThumbPoseNodes(
  nodes: Pick<HandMeshResult, "thenarPivot" | "thumbAnchor" | "thumbRoot" | "thumbDof">,
  sideSign: number,
  cmc: { abduction: number; elevation: number; rotation: number; thenarFold?: number },
  defaultFold: number,
  thumbBase?: Transform,
): void {
  const rawFold = cmc.thenarFold ?? defaultFold;
  const fold = Math.min(90, Math.max(0, Number.isFinite(rawFold) ? rawFold : defaultFold));
  const foldRad = (fold * Math.PI) / 180;
  nodes.thenarPivot.rotation.set(0, 0, -sideSign * foldRad);
  nodes.thumbAnchor.rotation.set(0, 0, sideSign * foldRad);
  if (thumbBase) {
    nodes.thumbRoot.position.set(thumbBase.position.x, thumbBase.position.y, thumbBase.position.z);
    nodes.thumbRoot.quaternion.set(
      thumbBase.quaternion.x,
      thumbBase.quaternion.y,
      thumbBase.quaternion.z,
      thumbBase.quaternion.w,
    );
  } else {
    nodes.thumbRoot.position.set(0, 0, 0);
    nodes.thumbRoot.quaternion.set(0, 0, 0, 1);
  }
  const totalRoll = thenarAutoRollDeg(fold) + cmc.rotation;
  nodes.thumbDof.rotation.set(
    (-cmc.elevation * Math.PI) / 180,
    (cmc.abduction * sideSign * Math.PI) / 180,
    (-totalRoll * sideSign * Math.PI) / 180,
  );
}

export type BuildHandMeshOptions = {
  /** 腹/背标记球（编辑器开启；标定测量视图关闭） */
  withMarks?: boolean;
  /** true = cubing 渲染器（顶点色直写 sRGB 数值=淡米暖肤）；false = 标准 sRGB 输出 */
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

/** 确定性伪随机（仅在高 facetJitter 刻面模式微调明度） */
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

/** sRGB hex → 顶点色分量 */
function baseRGB(hex: number, linearOutput: boolean): Vec3 {
  if (linearOutput) {
    return [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255];
  }
  const c = new Color(hex);
  return [c.r, c.g, c.b];
}

/**
 * 平滑焊接法线 + 三点柔光着色：
 * 1) 按空间位置焊接顶点累计面积加权面法线，得到饱满平滑的曲面法线；
 * 2) 按 shape.facetJitter（默认 0.03）混合极轻微的刻面质感，不再用随机逐三角噪点破坏连续感；
 * 3) 统一 Half-Lambert 主光 + 掌侧补光 + 轮廓微提亮 + 暗部暖肤偏移，消除多部件拼接色差。
 */
function shadeGeometry(
  geo: BufferGeometry,
  hex: number,
  linearOutput: boolean,
  jitter: number,
  rng: () => number,
): BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.getAttribute("position");
  const count = pos.count;
  const faceNormals = new Float32Array(count * 3);
  const smoothMap = new Map<string, [number, number, number]>();
  const keys = new Array<string>(count);

  const keyOf = (x: number, y: number, z: number): string =>
    `${Math.round(x * 2000)},${Math.round(y * 2000)},${Math.round(z * 2000)}`;

  for (let t = 0; t + 2 < count; t += 3) {
    const ax = pos.getX(t), ay = pos.getY(t), az = pos.getZ(t);
    const bx = pos.getX(t + 1), by = pos.getY(t + 1), bz = pos.getZ(t + 1);
    const cx = pos.getX(t + 2), cy = pos.getY(t + 2), cz = pos.getZ(t + 2);
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz) || 1;
    const ux = nx / len, uy = ny / len, uz = nz / len;
    for (let k = 0; k < 3; k++) {
      const idx = t + k;
      faceNormals[idx * 3] = ux;
      faceNormals[idx * 3 + 1] = uy;
      faceNormals[idx * 3 + 2] = uz;
      const key = keyOf(pos.getX(idx), pos.getY(idx), pos.getZ(idx));
      keys[idx] = key;
      const acc = smoothMap.get(key);
      if (acc) {
        acc[0] += nx;
        acc[1] += ny;
        acc[2] += nz;
      } else {
        smoothMap.set(key, [nx, ny, nz]);
      }
    }
  }

  for (const acc of smoothMap.values()) {
    const len = Math.hypot(acc[0], acc[1], acc[2]) || 1;
    acc[0] /= len;
    acc[1] /= len;
    acc[2] /= len;
  }

  // jitter ∈ [0, 0.15]：默认 0.03 下约 90% 平滑法线（低模饱满且接缝隐形），调大则逐步显露低模刻面
  const flatMix = Math.min(0.65, Math.max(0, jitter) * 3.2);
  const extraJit = Math.max(0, jitter - 0.05) * 0.45;
  const base = baseRGB(hex, linearOutput);
  const normals = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const n = new Vector3();

  for (let t = 0; t + 2 < count; t += 3) {
    const triJit = extraJit > 0 ? 1 + (rng() - 0.5) * 2 * extraJit : 1;
    for (let k = 0; k < 3; k++) {
      const idx = t + k;
      const sn = smoothMap.get(keys[idx]) ?? [0, 1, 0];
      const fx = faceNormals[idx * 3];
      const fy = faceNormals[idx * 3 + 1];
      const fz = faceNormals[idx * 3 + 2];
      n.set(
        sn[0] * (1 - flatMix) + fx * flatMix,
        sn[1] * (1 - flatMix) + fy * flatMix,
        sn[2] * (1 - flatMix) + fz * flatMix,
      );
      if (n.lengthSq() > 1e-12) n.normalize();
      else n.set(fx, fy, fz);

      normals[idx * 3] = n.x;
      normals[idx * 3 + 1] = n.y;
      normals[idx * 3 + 2] = n.z;

      // 三点柔光：Half-Lambert 包裹照明确保暗面与编辑器直写模式都有清晰立体曲率
      const key = Math.pow(n.dot(KEY_LIGHT) * 0.5 + 0.5, 0.9);
      const fill = n.dot(FILL_LIGHT) * 0.5 + 0.5;
      const rim = Math.max(0, n.dot(RIM_LIGHT));
      const shade = linearOutput
        ? 0.74 + 0.2 * key + 0.055 * fill + 0.02 * rim
        : 0.66 + 0.255 * key + 0.075 * fill + 0.028 * rim;
      // 暗面微暖次表面感（避免发灰发青）
      const warm = (1 - key) * (linearOutput ? 0.036 : 0.05);
      const o = idx * 3;
      colors[o] = Math.min(1, Math.max(0.01, base[0] * (shade + warm * 0.45) * triJit));
      colors[o + 1] = Math.min(1, Math.max(0.01, base[1] * (shade - warm * 0.08) * triJit));
      colors[o + 2] = Math.min(1, Math.max(0.01, base[2] * (shade - warm * 0.65) * triJit));
    }
  }

  g.setAttribute("normal", new BufferAttribute(normals, 3));
  g.setAttribute("color", new BufferAttribute(colors, 3));
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

/**
 * 超椭圆截面环（起点 θ = π/2 落在指背 +Y 中线）：
 * 对任意奇偶 facets（含默认 15）均严格满足 x 轴镜像对称，且逆时针绕向保持外法线朝外。
 */
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
    const th = Math.PI / 2 + (k * 2 * Math.PI) / facets;
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

/** 环间放样（环内点数一致，θ 逆时针，外法线朝外） */
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
 * 指蹼柔和双凹透镜棱柱（带圆润前唇倒角）：
 * 背侧 U 谷下凹 + 掌侧 ∩ 上凹；前缘两段柔和收薄，消除生硬直角前缘。
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
  const half = Math.max(Math.abs(xR - xL) / 2, 1e-4);
  const bell = (x: number): number => {
    const t = Math.max(-1, Math.min(1, (x - cx) / half));
    return Math.sqrt(1 - t * t);
  };
  const yMid = (yTop + yBot) / 2;
  const xs: number[] = [];
  for (let k = 0; k <= segs; k++) xs.push(xL + ((xR - xL) * k) / segs);
  const mk = (z: number, lipPinch: number): { top: Vec3[]; bot: Vec3[] } => ({
    top: xs.map((x) => {
      const y = yTop - dipT * bell(x);
      return [x, yMid + (y - yMid) * lipPinch, z] as Vec3;
    }),
    bot: xs.map((x) => {
      const y = yBot + dipB * bell(x);
      return [x, yMid + (y - yMid) * lipPinch, z] as Vec3;
    }),
  });

  const zLip = z0 + (z1 - z0) * 0.72;
  const slices = [mk(z0, 1), mk(zLip, 0.92), mk(z1, 0.56)];
  const topPos: number[] = [];
  const botPos: number[] = [];
  for (let s = 0; s < slices.length - 1; s++) {
    const A = slices[s];
    const B = slices[s + 1];
    for (let k = 0; k < xs.length - 1; k++) {
      topPos.push(...A.top[k], ...B.top[k], ...B.top[k + 1]);
      topPos.push(...A.top[k], ...B.top[k + 1], ...A.top[k + 1]);
      botPos.push(...A.bot[k], ...A.bot[k + 1], ...B.bot[k + 1]);
      botPos.push(...A.bot[k], ...B.bot[k + 1], ...B.bot[k]);
    }
  }
  const B = slices[slices.length - 1];
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

/** 掌指横弓：中部（中指 x≈0）向背侧柔和弓起，边缘归零 */
function archBell(xn: number): number {
  const t = Math.max(-1, Math.min(1, xn));
  return Math.cos((t * Math.PI) / 2) ** 2;
}

/**
 * 自然解剖指根 Z 弧线（以数据单位 xData ∈ [-halfW, +halfW] 为输入，+X 为拇指/食指侧）：
 * 中指根略靠前、小指根自然微退，消除「木梳式一刀齐」生硬感；左右手共用 xData 故严格镜像对称。
 */
function knuckleArcOffset(xData: number, halfWData: number): number {
  const u = Math.max(-1, Math.min(1, xData / Math.max(halfWData, 0.2)));
  // 中指附近 (u≈0.2) 峰值 +0.028，食指 (u≈0.77) ≈ -0.004，无名指 (u≈-0.25) ≈ 0.005，小指 (u≈-0.77) ≈ -0.055
  const d = u - 0.18;
  return 0.028 - 0.088 * d * d;
}

/** 贴合指背曲面的弧形薄指甲片（替代生硬浮块） */
function buildCurvedNail(
  wHalf: number,
  tHalf: number,
  len: number,
  tipF: number,
  H: number,
): BufferGeometry {
  const cols = 6;
  const rows = 4;
  const zStart = len * 0.5;
  const zEnd = len * 0.9;
  const thick = 0.014 * H;
  const halfAng = 0.62; // 指背弧面半角
  const grid = (rOffset: number): Vec3[][] => {
    const out: Vec3[][] = [];
    for (let r = 0; r <= rows; r++) {
      const v = r / rows;
      const z = zStart + (zEnd - zStart) * v;
      // 随指尖微收，末端略圆弧下俯
      const taper = 1 - (1 - tipF) * (0.45 + 0.5 * v);
      const drop = v * v * 0.12 * tHalf;
      const row: Vec3[] = [];
      for (let c = 0; c <= cols; c++) {
        const u = (c / cols) * 2 - 1; // -1..1
        // 指甲前后缘略收成圆润杏仁形
        const shapeW = Math.sqrt(Math.max(0.18, 1 - (2 * v - 1) ** 2 * 0.32));
        const ang = u * halfAng * shapeW;
        const rx = wHalf * taper * 0.96 + rOffset;
        const ry = tHalf * taper * 0.96 + rOffset;
        row.push([Math.sin(ang) * rx, Math.cos(ang) * ry - drop, z]);
      }
      out.push(row);
    }
    return out;
  };
  const top = grid(thick);
  const bot = grid(-0.004 * H);
  const pos: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // 顶面（法线 +Y）
      pos.push(...top[r][c], ...top[r + 1][c], ...top[r + 1][c + 1]);
      pos.push(...top[r][c], ...top[r + 1][c + 1], ...top[r][c + 1]);
      // 底面（法线 -Y）
      pos.push(...bot[r][c], ...bot[r + 1][c + 1], ...bot[r + 1][c]);
      pos.push(...bot[r][c], ...bot[r][c + 1], ...bot[r + 1][c + 1]);
    }
  }
  // 前缘封边
  for (let c = 0; c < cols; c++) {
    pos.push(...top[rows][c], ...bot[rows][c], ...bot[rows][c + 1]);
    pos.push(...top[rows][c], ...bot[rows][c + 1], ...top[rows][c + 1]);
  }
  return positionsToGeometry(pos);
}

/**
 * 构建单指链：
 * - 饱满视觉宽度曲线（避免铅笔锥指；拇指同步丰满以配平加粗后的四指）；
 * - 椭球关节球与段首环精确共形，直姿隐形、弯折不裂缝；
 * - 末节采用 3 环半球穹顶圆润指尖 + 柔和指腹肉垫 + 贴背弧形指甲。
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
  // 指腹微凸、指背平滑柔和
  const nPad = 2.05 + shape.padFlat * 0.25;
  const nBack = 2.25 + shape.padFlat * 0.35;
  const root = new Group();
  const joints: Group[] = [];
  const segments: SegmentNode[] = [];
  let cursor: Group = root;
  const lastSegIndex = def.segments.length - 1;

  // 饱满视觉段宽：缓和跨段急剧缩细（消除锥子指），拇指微增粗与四指配平
  const baseW = def.segments[0].width;
  const girthBoost = name === "thumb" ? 1.15 : 1.05;
  const effWidth = (idx: number): number =>
    (def.segments[idx].width * 0.58 + baseW * 0.42) * girthBoost;

  // 拇指特例：3 关节 [CMC, MCP, IP] 对应 2 段 [近节, 远节]（segOffset=1）
  const segOffset = Math.max(0, def.joints.length - def.segments.length);
  for (let j = 0; j < def.joints.length; j++) {
    const joint = new Group();
    cursor.add(joint);
    joints.push(joint);
    const segIdx = j - segOffset;
    if (segIdx < 0) {
      cursor = joint;
      continue;
    }
    const seg = def.segments[segIdx];
    if (!seg) break;

    const visW = effWidth(segIdx);
    const wHalf = (visW / 2) * H;
    const tHalf = wHalf * 0.93;
    const len = seg.length * H;
    const isLast = segIdx === lastSegIndex;

    // 椭球关节：与段截面 (wHalf, tHalf) 精确共形；MCP 根关节背侧微收避免凸高于掌背，
    // 弯曲兜底不露缝，伸直时在平滑法线下几乎无接缝
    const bulgeX = 0.99 + (shape.knuckleBulge - 1) * (segIdx === 0 ? 0.16 : 0.28);
    const bulgeY = segIdx === 0
      ? 0.975 + (shape.knuckleBulge - 1) * 0.14
      : 0.992 + (shape.knuckleBulge - 1) * 0.24;
    const ballGeo = new SphereGeometry(1, Math.max(F, 12), 8);
    ballGeo.scale(wHalf * bulgeX, tHalf * bulgeY, wHalf * (bulgeX * 0.98));
    const ballMesh = tintedMesh(
      shadeGeometry(ballGeo, SKIN, opts.linearOutput, shape.facetJitter, rng),
      `${name}-joint${segIdx}`,
    );
    joint.add(ballMesh);
    addOutline(ballMesh);

    const nextW = isLast ? visW : effWidth(segIdx + 1);
    // 末节柔和收口：保留饱满指尖宽度，不再削成尖铅笔
    const tipF = 0.72 + 0.28 * Math.min(1, Math.max(0.3, shape.tipTaper));
    const endF = isLast ? tipF : nextW / visW;
    const lf = (p: number, q: number, k: number): number => p + (q - p) * k;

    // 段首微沉入关节球，截面与关节球齐平，消除环状台阶
    const back = 0.22 * wHalf;
    const rings: Vec3[][] = [
      ringPoints(F, wHalf * 0.95, tHalf * 0.94, tHalf * 0.95, nPad, nBack, 0, -back),
      ringPoints(F, wHalf, tHalf * 0.96, tHalf, nPad, nBack, 0, 0),
    ];

    let geo: BufferGeometry;
    if (isLast) {
      // 末节：指腹饱满肉垫 + 3 环半球穹顶圆润指尖
      const midW = lf(1, endF, 0.42);
      const padFull = 1.04; // 指腹略丰满
      rings.push(
        ringPoints(F, wHalf * midW, tHalf * midW * padFull, tHalf * midW, nPad, nBack, -0.015 * tHalf, len * 0.44),
      );
      const shZ = len * 0.76;
      rings.push(
        ringPoints(F, wHalf * endF, tHalf * endF * padFull, tHalf * endF * 0.98, nPad, nBack, -0.01 * tHalf, shZ),
      );
      const domeLen = Math.min(len * 0.3, wHalf * endF * 0.95);
      for (const deg of [28, 54, 76]) {
        const phi = (deg * Math.PI) / 180;
        const c = Math.cos(phi);
        const s = Math.sin(phi);
        rings.push(
          ringPoints(
            F,
            wHalf * endF * c,
            tHalf * endF * c,
            tHalf * endF * c,
            2.05,
            2.1,
            -0.008 * tHalf * c,
            shZ + domeLen * s,
          ),
        );
      }
      const tipRing = rings[rings.length - 1];
      const apex: Vec3 = [0, 0, shZ + domeLen];
      geo = mergeGeometries([loftGeometry(rings, false, false), fanGeometry(tipRing, apex, true)]);
    } else {
      // 中/近节：柔和饱满段身（减弱腰部凹陷感，末端与下一节无缝齐平）
      const shaftK = lf(1, shape.shaftTaper, 0.35);
      const midF = lf(1, endF, 0.48) * shaftK;
      rings.push(
        ringPoints(F, wHalf * midF, tHalf * midF * 1.02, tHalf * midF, nPad, nBack, 0, len * 0.48),
      );
      rings.push(
        ringPoints(F, wHalf * lf(1, endF, 0.84), tHalf * lf(1, endF, 0.84), tHalf * lf(1, endF, 0.84), nPad, nBack, 0, len * 0.82),
      );
      rings.push(ringPoints(F, wHalf * endF, tHalf * endF * 0.96, tHalf * endF, nPad, nBack, 0, len));
      geo = loftGeometry(rings, false, false);
    }

    const mesh = tintedMesh(
      shadeGeometry(geo, SKIN, opts.linearOutput, shape.facetJitter, rng),
      `${name}-seg${segIdx}`,
    );
    joint.add(mesh);
    addOutline(mesh);

    if (isLast) {
      const nail = tintedMesh(
        shadeGeometry(buildCurvedNail(wHalf, tHalf, len, endF, H), NAIL, opts.linearOutput, 0, rng),
        `${name}-nail`,
      );
      joint.add(nail);
    }

    if (opts.withMarks) {
      const off = tHalf * lf(1, shape.shaftTaper, 0.35) + MARK_GAP * H;
      const padMesh = tintedMesh(
        shadeGeometry(new SphereGeometry(MARK_RADIUS * H, 8, 6), PAD, opts.linearOutput, 0, rng),
        `${name}-mark-pad`,
      );
      padMesh.position.set(0, -off, len / 2);
      joint.add(padMesh);
      const backMesh = tintedMesh(
        shadeGeometry(new SphereGeometry(MARK_RADIUS * H, 8, 6), BACK, opts.linearOutput, 0, rng),
        `${name}-mark-back`,
      );
      backMesh.position.set(0, off, len / 2);
      joint.add(backMesh);
    }

    segments.push({ joint, len, radius: wHalf, thickness: tHalf * lf(1, shape.shaftTaper, 0.35) });
    const next = new Group();
    next.position.z = len;
    joint.add(next);
    cursor = next;
  }
  return { root, joints, segments };
}

/**
 * 大鱼际肌腹（构建在 thenarPivot 局部坐标系内）：
 * 内缘包裹枢轴原点 (0,0) 深埋入掌缘，确保 thenarFold ∈ [0°, 90°] 全行程平滑折叠不露缝；
 * 前段精准汇入 thumbAnchor 局部位置，与拇指根刚性随动（已移除静态虎口斜桥）。
 */
function buildThenarRidge(
  cfg: HandRigConfig,
  shape: HandShapeParams,
  H: number,
  sideSign: number,
  pivotX: number,
  pivotY: number,
  thumbWHalf: number,
  linearOutput: boolean,
  addOutline: AddOutline,
  rng: () => number,
): Mesh {
  const F = Math.max(shape.facets, 12);
  const len = cfg.palm.length * H;
  const mcpZ = cfg.palm.mcpZ * H;
  const halfW = (cfg.palm.width / 2) * H;
  // 腕端略向前收进，避免在腕缘转角处凸出形成台阶
  const zHeel = mcpZ - len + 0.18 * H;
  const localTcX = cfg.thumbCorner.x * H * sideSign - pivotX;
  const localTcY = cfg.thumbCorner.y * H - pivotY;
  const localTcZ = cfg.thumbCorner.z * H;
  const zCap = localTcZ + 0.14 * H;
  const zFront = Math.min(zHeel + len * Math.min(cfg.thenar.length, 1.05) * 0.88, zCap);

  const aMax = cfg.thenar.width * H * 0.48;
  const bMax = cfg.thenar.height * H * 0.48;
  const yC = 0.01 * H + cfg.thenar.y * H - pivotY;
  const pivotAbsX = Math.abs(pivotX);
  const wallLocalAt = (t: number): number =>
    halfW * (shape.palmTaper + (1 - shape.palmTaper) * t) - pivotAbsX;
  const bellyAt = (t: number): number => Math.sin(Math.PI * t) ** 0.78;

  type RingSpec = { cx: number; cy: number; a: number; b: number; z: number };
  const spec = (t: number): RingSpec => {
    const a = aMax * (0.4 + 0.6 * bellyAt(t));
    // 截面内缘深埋掌体、包裹枢轴 (0,0)，0°–90° 全行程圆润过渡且腕侧不鼓包
    return {
      cx: sideSign * (wallLocalAt(t) * 0.45 + a * 0.12),
      cy: yC,
      a,
      b: bMax * (0.68 + 0.32 * bellyAt(t)),
      z: zHeel + (zFront - zHeel) * t,
    };
  };
  const target: RingSpec = {
    cx: localTcX,
    cy: localTcY,
    a: thumbWHalf * 1.06,
    b: thumbWHalf * 0.95,
    z: zFront,
  };
  const toward = (s: RingSpec, k: number): RingSpec => ({
    cx: s.cx + (target.cx - s.cx) * k,
    cy: s.cy + (target.cy - s.cy) * k,
    a: s.a + (target.a - s.a) * k,
    b: s.b + (target.b - s.b) * k,
    z: s.z + (target.z - s.z) * k,
  });
  const s68 = spec(0.68);
  const stations: RingSpec[] = [
    { ...spec(0), cx: sideSign * (wallLocalAt(0) - aMax * 0.16), cy: yC * 0.6, a: aMax * 0.28, b: bMax * 0.44 },
    { ...spec(0.2), cx: sideSign * (wallLocalAt(0.2) * 0.35 + aMax * 0.04) },
    spec(0.46),
    s68,
    toward(s68, 0.35),
    toward(s68, 0.68),
    toward(s68, 1),
  ];
  const rings: Vec3[][] = stations.map((st) =>
    ringPoints(F, st.a, st.b, st.b * 0.96, 2.2, 2.2, st.cy, st.z).map(
      (p) => [p[0] + st.cx, p[1], p[2]] as Vec3,
    ),
  );
  const mesh = tintedMesh(
    shadeGeometry(loftGeometry(rings, true, true), SKIN, linearOutput, shape.facetJitter, rng),
    "thenar",
  );
  addOutline(mesh);
  return mesh;
}

/**
 * 饱满有机手掌：
 * - 7 站连续放样：腕缘圆润倒角 → 掌中饱满 → 掌背（+Y）顺滑加厚并展宽背弓（nBack 2.45→3.25），
 *   使掌背与四指根（食/中/无名/小指）背侧齐平过渡、消除指根上凸台阶；
 * - 掌心（-Y）保持 halfT 厚度上限，确保默认贴面手位（x=±1.95）不穿透魔方。
 */
function buildPalm(
  cfg: HandRigConfig,
  shape: HandShapeParams,
  H: number,
  sideSign: number,
  frontFaceZ: (y: number) => number,
  linearOutput: boolean,
  addOutline: AddOutline,
  rng: () => number,
): Mesh {
  const F = Math.max(shape.facets * 2, 16);
  const halfWData = cfg.palm.width / 2;
  const halfW = halfWData * H;
  const halfT = (cfg.palm.height / 2) * H;
  const len = cfg.palm.length * H;
  const mcpZ = cfg.palm.mcpZ * H;

  const frontArch = (xData: number): number => shape.arch * H * archBell(xData / halfWData);

  // 非对称背/掌厚度曲线：padK（掌心 -Y）严控 ≤ 1.0；backK（掌背 +Y）向指根平稳增厚至 ~1.34×halfT，
  // 配合远端背侧更饱满的超椭圆指数 nBack，使四指根背侧顺滑融入掌背而非突兀凸起
  const specs: Array<{
    t: number;
    wK: number;
    padK: number;
    backK: number;
    nBack: number;
    archK: number;
    arcK: number;
  }> = [
    { t: 0.0, wK: shape.palmTaper * 0.88, padK: 0.78, backK: 0.88, nBack: 2.45, archK: 0.0, arcK: 0.0 },
    { t: 0.05, wK: shape.palmTaper * 0.98, padK: 0.95, backK: 1.08, nBack: 2.55, archK: 0.05, arcK: 0.0 },
    { t: 0.22, wK: shape.palmTaper + (1 - shape.palmTaper) * 0.34, padK: 1.0, backK: 1.18, nBack: 2.7, archK: 0.2, arcK: 0.0 },
    { t: 0.55, wK: shape.palmTaper + (1 - shape.palmTaper) * 0.8, padK: 1.0, backK: 1.28, nBack: 2.95, archK: 0.55, arcK: 0.15 },
    { t: 0.82, wK: 1.0, padK: 0.98, backK: 1.35, nBack: 3.2, archK: 0.88, arcK: 0.65 },
    { t: 0.94, wK: 0.99, padK: 0.94, backK: 1.34, nBack: 3.3, archK: 0.98, arcK: 0.92 },
    { t: 1.0, wK: 0.95, padK: 0.82, backK: 1.22, nBack: 3.15, archK: 1.0, arcK: 1.0 },
  ];

  const rings: Vec3[][] = specs.map((sp) => {
    const a = halfW * sp.wK;
    const bPad = halfT * sp.padK;
    const bBack = halfT * sp.backK;
    const cup = shape.palmCup * H * (sp.t * (1 - sp.t) * 4);
    const zBase = mcpZ - len * (1 - sp.t);
    const ring = ringPoints(F, a, bPad, bBack, 2.45, sp.nBack, cup, zBase);
    return ring.map((p) => {
      const xData = (p[0] / H) * sideSign;
      const y = p[1] + frontArch(p[0] / H) * sp.archK;
      const arcZ = knuckleArcOffset(xData, halfWData) * H * sp.arcK;
      let z = p[2] + arcZ;
      if (sp.t >= 0.94) {
        const slopeShift = frontFaceZ(y) - mcpZ;
        z += slopeShift * ((sp.t - 0.82) / 0.18);
      }
      return [p[0], y, z] as Vec3;
    });
  });

  // 腕端柔穹顶封口 + 指根前缘微凸封口
  const firstRing = rings[0];
  const lastRing = rings[rings.length - 1];
  const wristApex: Vec3 = [0, 0.01 * H, mcpZ - len - 0.04 * H];
  const frontC = ringCentroid(lastRing);
  const frontApex: Vec3 = [frontC[0], frontC[1], frontC[2] + 0.025 * H];
  const geo = mergeGeometries([
    loftGeometry(rings, false, false),
    fanGeometry(firstRing, wristApex, false),
    fanGeometry(lastRing, frontApex, true),
  ]);
  const mesh = tintedMesh(
    shadeGeometry(geo, SKIN, linearOutput, shape.facetJitter, rng),
    "palm",
  );
  addOutline(mesh);
  return mesh;
}

/** 四指根下压量（×段半宽向掌内压入），确保弯曲时关节球始终与掌面严密贴合 */
const ROOT_EMBED = 0.34;

/** 掌前缘柔和斜坡参数 */
const FRONT_RECLINE = 0.08;
const FRONT_SLOPE_SPAN = 0.275;
const FINGER_LINE = 0.05;

/** (y,z) 平面圆润截面环（指根间填充鞍用，截面 ⊥ x，放样方向 +x） */
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
 * 指根间柔和填充鞍：圆润椭圆截面（n=2.2，告别尖三角棱），沉入掌指交界无缝衔接。
 */
function buildKnuckleFiller(
  x0: number,
  x1: number,
  cy: number,
  zAnchor: number,
  H: number,
  shape: HandShapeParams,
  linearOutput: boolean,
  addOutline: AddOutline,
  rng: () => number,
): Mesh {
  const F = Math.max(shape.facets, 10);
  const mid = (x0 + x1) / 2;
  const half = Math.max(Math.abs(x1 - x0) / 2, 1e-4);
  const crestMid = 0.018 * H;
  const crestEnd = 0.03 * H;
  const stations = 7;
  const rings: Vec3[][] = [];
  for (let i = 0; i < stations; i++) {
    const t = i / (stations - 1);
    const x = x0 + (x1 - x0) * t;
    const u = Math.abs(x - mid) / half;
    const crest = crestMid + (crestEnd - crestMid) * u * u;
    rings.push(ringYZ(F, x, cy - 0.015 * H, zAnchor, 0.044 * H, crest, 2.2));
  }
  const mesh = tintedMesh(
    shadeGeometry(loftGeometry(rings, true, true), SKIN, linearOutput, shape.facetJitter, rng),
    "knuckle-filler",
  );
  addOutline(mesh);
  return mesh;
}

/** 指根掌侧柔和肌凸：严格收束在掌缘之内，作为掌前缘的柔润肉垫，不产生外凸耳唇 */
function buildPalmarPad(
  cx: number,
  cy: number,
  zFace: number,
  wHalf: number,
  rxLimit: number,
  H: number,
  shape: HandShapeParams,
  linearOutput: boolean,
  addOutline: AddOutline,
  rng: () => number,
): Mesh {
  const F = Math.max(shape.facets * 2, 16);
  const geo = new SphereGeometry(1, F, Math.max(6, Math.round(F / 3)));
  const rx = Math.max(0.05 * H, Math.min(0.98 * wHalf, rxLimit));
  geo.scale(rx, 0.1 * H, 0.04 * H);
  geo.rotateX(Math.atan(FRONT_RECLINE / FRONT_SLOPE_SPAN));
  geo.translate(cx, cy - 0.125 * H, zFace - 0.042 * H);
  const mesh = tintedMesh(
    shadeGeometry(geo, SKIN, linearOutput, shape.facetJitter, rng),
    "palmar-pad",
  );
  addOutline(mesh);
  return mesh;
}

/**
 * 指根平滑过渡领圈：深埋于掌体前缘之内、切向汇入指根超椭圆截面，
 * 掌侧/背侧均与掌体平顺齐平，消除环状凸唇与外缘台阶。
 */
function buildKnuckleCollar(
  cx: number,
  cy: number,
  zRoot: number,
  wHalf: number,
  rxMax: number,
  shape: HandShapeParams,
  linearOutput: boolean,
  addOutline: AddOutline,
  rng: () => number,
): Mesh {
  const F = Math.max(shape.facets, 10);
  const tHalf = wHalf * 0.93;
  const nPad = 2.05 + shape.padFlat * 0.25;
  const nBack = 2.25 + shape.padFlat * 0.35;
  const rx = Math.max(Math.min(wHalf * 1.04, rxMax), 0.1 * wHalf);
  const rim = { a: rx, bPad: tHalf * 0.84, bBack: tHalf * 1.02, nP: 2.2, nB: 2.4 };
  const fing = {
    a: wHalf * 0.985,
    bPad: tHalf * 0.96 * 0.985,
    bBack: tHalf * 0.985,
    nP: nPad,
    nB: nBack,
  };
  const stations: Array<[number, number]> = [
    [-0.7, 0.0],
    [-0.25, 0.36],
    [0.05, 0.72],
    [0.26, 1.0],
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
      cy - (1 - k) * 0.08 * wHalf,
      zRoot + dz * wHalf,
    ).map((p) => [p[0] + cx, p[1], p[2]] as Vec3);
  });
  const mesh = tintedMesh(
    shadeGeometry(loftGeometry(rings, false, false), SKIN, linearOutput, shape.facetJitter, rng),
    "knuckle-collar",
  );
  addOutline(mesh);
  return mesh;
}

/** 主入口：构建整手 low-poly 饱满网格（坐标系与旧 buildHandMesh 完全一致） */
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
  const mcpZ = cfg.palm.mcpZ * H;
  const halfWData = cfg.palm.width / 2;
  const halfW = halfWData * H;

  const frontFaceZ = (y: number): number =>
    mcpZ -
    FRONT_RECLINE * H * Math.min(1, Math.max(0, (FINGER_LINE * H - y) / (FRONT_SLOPE_SPAN * H)));

  const rng = mulberry32(20260911);
  const outlineMat = opts.withOutline ? new LineBasicMaterial({ color: OUTLINE, toneMapped: false }) : null;
  const addOutline: AddOutline = (mesh) => {
    if (!outlineMat) return;
    mesh.add(new LineSegments(new EdgesGeometry(mesh.geometry, 18), outlineMat));
  };
  const root = new Group();

  // 1) 手掌
  root.add(buildPalm(cfg, shape, H, sideSign, frontFaceZ, opts.linearOutput, addOutline, rng));

  // 2) 大鱼际单轴枢轴（thenarPivot）：大鱼际肌腹与拇指根共挂其下，绕局部 Z 轴向掌心下沉 0°–90°
  const [pivotX, pivotY, pivotZ] = thenarPivotLocalOrigin(cfg, sideSign);
  const thenarPivot = new Group();
  thenarPivot.position.set(pivotX, pivotY, pivotZ);
  const thumbVisWHalf = (cfg.fingers.thumb[0].width * 1.15 * 0.5) * H;
  thenarPivot.add(
    buildThenarRidge(
      cfg,
      shape,
      H,
      sideSign,
      pivotX,
      pivotY,
      thumbVisWHalf,
      opts.linearOutput,
      addOutline,
      rng,
    ),
  );
  root.add(thenarPivot);

  // 3) 四指根解剖弧线位置
  const FOUR = ["index", "middle", "ring", "pinky"] as const;
  const roots = FOUR.map((name) => {
    const base = cfg.bases[name];
    const xData = base.x * cfg.fingerSpacing;
    const wHalf = (rig.fingers[name].segments[0].width * 1.05 * 0.5) * H;
    const zArc = mcpZ + knuckleArcOffset(xData, halfWData) * H;
    return {
      name,
      xData,
      cx: xData * H * sideSign,
      cy: base.y * H + shape.arch * H * archBell(xData / halfWData),
      zArc,
      wHalf,
    };
  });

  // 4) 指蹼（接入 shape.web ∈ [0, 1]，带圆润前唇）
  const grad = [0.8, 1, 0.7];
  const webK = Math.max(0, Math.min(1, Number.isFinite(shape.web) ? shape.web : 0.5));
  const webDipTBase = (0.052 - 0.03 * webK) * H;
  const webDipB = (0.038 - 0.018 * webK) * H;
  for (let i = 0; i < 3; i++) {
    const ra = roots[i];
    const rb = roots[i + 1];
    const cxData = (ra.xData + rb.xData) / 2;
    const yRoot = Math.min(cfg.bases[FOUR[i]].y, cfg.bases[FOUR[i + 1]].y) * H + shape.arch * H * archBell(cxData / halfWData);
    const zPair = Math.min(ra.zArc, rb.zArc);
    const webZ1 = zPair + (0.04 + 0.2 * webK) * H;
    const xL = Math.min(ra.cx, rb.cx);
    const xR = Math.max(ra.cx, rb.cx);
    const web = tintedMesh(
      shadeGeometry(
        webLensGeometry(
          xL,
          xR,
          yRoot + 0.025 * H,
          yRoot - 0.105 * H,
          webDipTBase * grad[i],
          webDipB,
          frontFaceZ(yRoot - 0.105 * H) - 0.045 * H + (zPair - mcpZ),
          webZ1,
          6,
        ),
        SKIN,
        opts.linearOutput,
        shape.facetJitter * 0.5,
        rng,
      ),
      `web-${i}`,
    );
    root.add(web);
    addOutline(web);
  }

  // 5) 指根平滑过渡领圈（外侧受掌壁严格约束，绝不探出掌轮廓）
  roots.forEach((r, i) => {
    const wallLimit = Math.max(0.06 * H, halfW * 0.96 - Math.abs(r.cx));
    const gapL = i > 0 ? Math.abs(r.cx - roots[i - 1].cx) : Infinity;
    const gapR = i < roots.length - 1 ? Math.abs(r.cx - roots[i + 1].cx) : Infinity;
    const rxMax = Math.min(wallLimit, 0.48 * Math.min(gapL, gapR));
    root.add(
      buildKnuckleCollar(r.cx, r.cy, r.zArc, r.wHalf, rxMax, shape, opts.linearOutput, addOutline, rng),
    );
  });

  // 6) 指根间柔和填充鞍（左右手先乘 sideSign 再取 min/max，保证绕向一致）
  for (let i = 0; i < 3; i++) {
    const ra = roots[i];
    const rb = roots[i + 1];
    const xL = Math.min(ra.cx, rb.cx);
    const xR = Math.max(ra.cx, rb.cx);
    const cxData = (ra.xData + rb.xData) / 2;
    const cy = Math.min(cfg.bases[FOUR[i]].y, cfg.bases[FOUR[i + 1]].y) * H + shape.arch * H * archBell(cxData / halfWData);
    const zPair = (ra.zArc + rb.zArc) * 0.5;
    const zAnchor = frontFaceZ(cy - 0.02 * H) + (zPair - mcpZ) - 0.032 * H;
    root.add(buildKnuckleFiller(xL, xR, cy, zAnchor, H, shape, opts.linearOutput, addOutline, rng));
  }

  // 7) 指根掌侧柔和肌凸（受掌宽限制，避免外侧突出）
  for (const r of roots) {
    const zFace = frontFaceZ(r.cy - 0.1 * H) + (r.zArc - mcpZ);
    const rxLimit = Math.max(0.06 * H, halfW * 0.93 - Math.abs(r.cx));
    root.add(
      buildPalmarPad(r.cx, r.cy, zFace, r.wHalf, rxLimit, H, shape, opts.linearOutput, addOutline, rng),
    );
  }

  // 8) 四指链
  const fingers = {} as Record<FingerName, FingerNodes>;
  for (const r of roots) {
    const nodes = buildFingerChain(rig, r.name, H, shape, opts, addOutline, rng);
    nodes.root.position.set(r.cx, r.cy, r.zArc - ROOT_EMBED * r.wHalf);
    root.add(nodes.root);
    fingers[r.name] = nodes;
  }

  // 9) 拇指链（挂在 thenarPivot → thumbAnchor 下随大鱼际单轴下沉）
  const thumbAnchor = new Group();
  const tc = cfg.thumbCorner;
  thumbAnchor.position.set(tc.x * H * sideSign - pivotX, tc.y * H - pivotY, tc.z * H - pivotZ);
  thenarPivot.add(thumbAnchor);

  const thumbRoot = new Group();
  const thumbDof = new Group();
  thumbRoot.add(thumbDof);
  const thumbNodes = buildFingerChain(rig, "thumb", H, shape, opts, addOutline, rng);
  thumbDof.add(thumbNodes.root);
  thumbAnchor.add(thumbRoot);
  fingers.thumb = thumbNodes;

  // 默认按配置 thenarFold 与 thumbCmc 置位，保证直接构造预览即呈目标自然形态
  applyThumbPoseNodes(
    { thenarPivot, thumbAnchor, thumbRoot, thumbDof },
    sideSign,
    cfg.thumbCmc,
    cfg.thenarFold,
  );

  return { root, fingers, thenarPivot, thumbAnchor, thumbRoot, thumbDof };
}
