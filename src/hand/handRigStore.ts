/**
 * 手部模型标定存储（docs/todo.md：手部标定页）。
 * HandRigConfig 包含全部可调几何参数：各指段长/粗细、手掌、指根布局、整体放大系数。
 * 「固化」= 保存到 localStorage，编辑器 / 游戏在构造 HandRigView 时读取同一配置。
 * 默认值 = createDefaultRig（人体测量数据校准）+ 目测迭代的渲染参数（2026-08-06）。
 *
 * ⚠ 兼容面冻结（low-poly 重构 0.4.0，feat/hand-lowpoly）：
 * - 本文件的对外契约不可破坏：store 键 `motion-cube.handRig`、normalizeHandRigConfig
 *   对 v1/v2/v3 旧档的迁移回退、createRigFromConfig 输出 HandRig 骨架。
 * - v3→v4：新增 shape 造型参数组（low-poly 刻面/隆起/横弓/指蹼等，见 HandShapeParams），
 *   旧档缺省回 DEFAULT_SHAPE，无破坏性迁移。
 * - 几何实现（handGeometry.ts 圆柱方案）被 handMesh.ts 截面放样方案替代，
 *   旧实现暂留供 #/hand-lab A/B 对照，合并前清理。
 */
import {
  createDefaultRig,
  DEFAULT_THUMB_CMC,
  FINGER_ORDER,
  type FingerName,
  type HandRig,
  type HandType,
} from "./HandRig";

export type SegmentCalib = { length: number; width: number };

/**
 * low-poly 造型参数组（v4 新增，先粗后细——阶段1 只开全局粗粒度，细分参数后置）。
 * 全部为无量纲比例或数据单位（1 = 块边长），几何构建（handMesh.ts）消费。
 */
export type HandShapeParams = {
  /** 指段截面边数（low-poly 刻面；掌体自动取 max(facets*2, 12) 更圆整） */
  facets: number;
  /** 关节球隆起：关节处低 poly 球半径 = 段半宽 × 此系数（MCP 最大，向指尖递减） */
  knuckleBulge: number;
  /** 段腰收窄：段中部宽 = 段宽 × 此系数 */
  shaftTaper: number;
  /** 指尖收口：末段端部宽 = 段宽 × 此系数 */
  tipTaper: number;
  /** 指腹侧扁平度 0（圆）–1（平）：腹侧超椭圆指数随之升高 */
  padFlat: number;
  /** 掌指横弓：掌指缘中部（中指根）向背侧弓起量（数据单位），指根随动 */
  arch: number;
  /** 掌梯形度：腕宽 = 掌宽 × 此系数 */
  palmTaper: number;
  /** 掌心纵凹：掌中段向背侧让出量（数据单位，掌侧凹） */
  palmCup: number;
  /** 指蹼量 0–1：指根间菱形填充块大小 */
  web: number;
  /** 逐面明度抖动 0–0.15：刻面低 poly 观感（顶点色伪受光） */
  facetJitter: number;
};

export const DEFAULT_SHAPE: HandShapeParams = {
  facets: 6,
  knuckleBulge: 1.18,
  shaftTaper: 0.92,
  tipTaper: 0.6,
  padFlat: 0.35,
  arch: 0.06,
  palmTaper: 0.84,
  palmCup: 0.03,
  web: 0.5,
  facetJitter: 0.05,
};

export type HandRigConfig = {
  version: 4;
  /** 整体放大系数：数据单位 → 渲染倍数（1.33 单位小指 → ≈2.1 块边长） */
  handScale: number;
  /** 指根间距：四指根 X 的乘数（默认 1） */
  fingerSpacing: number;
  /** 手掌盒体（数据单位）；前表面落在 mcpZ，手指/拇指从掌前缘伸出 */
  palm: { width: number; height: number; length: number; mcpZ: number };
  /** 四指根相对手掌中心（右手 +X 为拇指侧；左手渲染时 X 取反） */
  bases: Record<"index" | "middle" | "ring" | "pinky", { x: number; y: number }>;
  /** 拇指根锚点相对手掌中心（数据单位；掌根/腕侧，x 渲染时按手型取反） */
  thumbCorner: { x: number; y: number; z: number };
  /** 大鱼际（thenar eminence）凸块：椭球尺寸与位置（相对手掌中心，数据单位） */
  thenar: { width: number; height: number; length: number; x: number; y: number; z: number };
  /** 拇指 CMC 自然外翻（度）：掌平面展收 / 抬离掌面 / 对掌自转（默认值语义见 DEFAULT_THUMB_CMC） */
  thumbCmc: { abduction: number; elevation: number; rotation: number };
  /** 标尺角度（度，0=水平，90=竖直；标定视图可 Ctrl+拖拽旋转，与其他数值一同固化） */
  rulerAngle: number;
  /** 各指段（拇指 2 段，其余 3 段）：长度 / 粗细（数据单位，1 = 块边长） */
  fingers: Record<FingerName, SegmentCalib[]>;
  /** low-poly 造型参数组（v4；v1–v3 旧档缺省回 DEFAULT_SHAPE） */
  shape: HandShapeParams;
};

function defaultFingers(): Record<FingerName, SegmentCalib[]> {
  const rig = createDefaultRig();
  const out = {} as Record<FingerName, SegmentCalib[]>;
  for (const name of FINGER_ORDER) {
    out[name] = rig.fingers[name].segments.map((s) => ({ length: s.length, width: s.width }));
  }
  return out;
}

export const DEFAULT_HAND_CONFIG: HandRigConfig = {
  version: 4,
  handScale: 2.1 / 1.33,
  fingerSpacing: 1,
  palm: { width: 1.35, height: 0.45, length: 1.55, mcpZ: 0.4 },
  bases: {
    index: { x: 0.52, y: 0.1 },
    middle: { x: 0.17, y: 0.12 },
    ring: { x: -0.17, y: 0.1 },
    pinky: { x: -0.52, y: 0.06 },
  },
  // 拇指根锚在掌根/腕侧（不再从掌前缘角落伸出）：z 取手掌中后部、x 靠拇指侧边、y 略偏指腹
  thumbCorner: { x: 0.55, y: -0.05, z: -0.45 },
  // 大鱼际：拇指根处椭球凸块，尺寸覆盖掌根拇指侧并与圆角手掌融合
  thenar: { width: 0.9, height: 0.42, length: 1.05, x: 0.48, y: -0.03, z: -0.45 },
  thumbCmc: { ...DEFAULT_THUMB_CMC },
  rulerAngle: 0,
  fingers: defaultFingers(),
  shape: { ...DEFAULT_SHAPE },
};

const STORE_KEY = "motion-cube.handRig";

const clampNum = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return Math.min(max, Math.max(min, n));
};

/** 校验/规范化任意输入为合法配置；结构不合法返回 null（调用方回退默认） */
export function normalizeHandRigConfig(input: unknown): HandRigConfig | null {
  if (!input || typeof input !== "object") return null;
  const obj = input as Record<string, unknown>;
  // v1→v2：拇指根迁移到掌根锚点 + 大鱼际；v2→v3：新增 thumbCmc（缺省回默认，无破坏）；
  // v3→v4：新增 shape 造型参数组（缺省回 DEFAULT_SHAPE，无破坏）
  const version =
    obj.version === 4 || obj.version === 3 || obj.version === 2 || obj.version === 1
      ? obj.version
      : 0;
  if (version === 0 || typeof obj.fingers !== "object" || obj.fingers === null) return null;
  const f = obj.fingers as Record<string, unknown>;
  const fingers = {} as Record<FingerName, SegmentCalib[]>;
  for (const name of FINGER_ORDER) {
    const segs = f[name];
    if (!Array.isArray(segs)) return null;
    const want = name === "thumb" ? 2 : 3;
    if (segs.length !== want) return null;
    const out: SegmentCalib[] = [];
    for (const s of segs) {
      if (!s || typeof s !== "object") return null;
      const seg = s as Record<string, unknown>;
      out.push({
        length: clampNum(seg.length, 0.05, 5, DEFAULT_HAND_CONFIG.fingers[name][out.length].length),
        width: clampNum(seg.width, 0.02, 1.5, DEFAULT_HAND_CONFIG.fingers[name][out.length].width),
      });
    }
    fingers[name] = out;
  }
  const palm = (obj.palm ?? {}) as Record<string, unknown>;
  const bases = (obj.bases ?? {}) as Record<string, unknown>;
  const base = (n: string) => (bases[n] ?? {}) as Record<string, unknown>;
  const tc = (obj.thumbCorner ?? {}) as Record<string, unknown>;
  const th = (obj.thenar ?? {}) as Record<string, unknown>;
  const cmc = (obj.thumbCmc ?? {}) as Record<string, unknown>;
  const sh = (obj.shape ?? {}) as Record<string, unknown>;
  // version 1（拇指根仍在掌前缘角落的旧语义）→ 迁移到掌根锚点 + 大鱼际默认值
  const legacy = version === 1;
  return {
    version: 4,
    handScale: clampNum(obj.handScale, 0.3, 5, DEFAULT_HAND_CONFIG.handScale),
    fingerSpacing: clampNum(obj.fingerSpacing, 0.3, 2, DEFAULT_HAND_CONFIG.fingerSpacing),
    palm: {
      width: clampNum(palm.width, 0.2, 5, DEFAULT_HAND_CONFIG.palm.width),
      height: clampNum(palm.height, 0.05, 2, DEFAULT_HAND_CONFIG.palm.height),
      length: clampNum(palm.length, 0.2, 5, DEFAULT_HAND_CONFIG.palm.length),
      mcpZ: clampNum(palm.mcpZ, -2, 3, DEFAULT_HAND_CONFIG.palm.mcpZ),
    },
    bases: {
      index: { x: clampNum(base("index").x, -2, 2, 0.52), y: clampNum(base("index").y, -1, 1, 0.1) },
      middle: { x: clampNum(base("middle").x, -2, 2, 0.17), y: clampNum(base("middle").y, -1, 1, 0.12) },
      ring: { x: clampNum(base("ring").x, -2, 2, -0.17), y: clampNum(base("ring").y, -1, 1, 0.1) },
      pinky: { x: clampNum(base("pinky").x, -2, 2, -0.52), y: clampNum(base("pinky").y, -1, 1, 0.06) },
    },
    thumbCorner: legacy
      ? { ...DEFAULT_HAND_CONFIG.thumbCorner }
      : {
          x: clampNum(tc.x, -2, 2, DEFAULT_HAND_CONFIG.thumbCorner.x),
          y: clampNum(tc.y, -1, 1, DEFAULT_HAND_CONFIG.thumbCorner.y),
          z: clampNum(tc.z, -2, 3, DEFAULT_HAND_CONFIG.thumbCorner.z),
        },
    thenar: legacy
      ? { ...DEFAULT_HAND_CONFIG.thenar }
      : {
          width: clampNum(th.width, 0.1, 2, DEFAULT_HAND_CONFIG.thenar.width),
          height: clampNum(th.height, 0.05, 1, DEFAULT_HAND_CONFIG.thenar.height),
          length: clampNum(th.length, 0.1, 2, DEFAULT_HAND_CONFIG.thenar.length),
          x: clampNum(th.x, -2, 2, DEFAULT_HAND_CONFIG.thenar.x),
          y: clampNum(th.y, -1, 1, DEFAULT_HAND_CONFIG.thenar.y),
          z: clampNum(th.z, -2, 3, DEFAULT_HAND_CONFIG.thenar.z),
        },
    thumbCmc: {
      abduction: clampNum(cmc.abduction, -90, 90, DEFAULT_HAND_CONFIG.thumbCmc.abduction),
      elevation: clampNum(cmc.elevation, -45, 90, DEFAULT_HAND_CONFIG.thumbCmc.elevation),
      rotation: clampNum(cmc.rotation, -180, 180, DEFAULT_HAND_CONFIG.thumbCmc.rotation),
    },
    rulerAngle: clampNum(obj.rulerAngle, 0, 360, DEFAULT_HAND_CONFIG.rulerAngle),
    fingers,
    shape: {
      facets: Math.round(clampNum(sh.facets, 4, 16, DEFAULT_SHAPE.facets)),
      knuckleBulge: clampNum(sh.knuckleBulge, 1, 1.6, DEFAULT_SHAPE.knuckleBulge),
      shaftTaper: clampNum(sh.shaftTaper, 0.6, 1.05, DEFAULT_SHAPE.shaftTaper),
      tipTaper: clampNum(sh.tipTaper, 0.3, 0.95, DEFAULT_SHAPE.tipTaper),
      padFlat: clampNum(sh.padFlat, 0, 1, DEFAULT_SHAPE.padFlat),
      arch: clampNum(sh.arch, 0, 0.2, DEFAULT_SHAPE.arch),
      palmTaper: clampNum(sh.palmTaper, 0.5, 1, DEFAULT_SHAPE.palmTaper),
      palmCup: clampNum(sh.palmCup, 0, 0.12, DEFAULT_SHAPE.palmCup),
      web: clampNum(sh.web, 0, 1, DEFAULT_SHAPE.web),
      facetJitter: clampNum(sh.facetJitter, 0, 0.15, DEFAULT_SHAPE.facetJitter),
    },
  };
}

export function loadHandRigConfig(): HandRigConfig {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return DEFAULT_HAND_CONFIG;
    return normalizeHandRigConfig(JSON.parse(raw)) ?? DEFAULT_HAND_CONFIG;
  } catch {
    return DEFAULT_HAND_CONFIG;
  }
}

export function saveHandRigConfig(cfg: HandRigConfig): void {
  localStorage.setItem(STORE_KEY, JSON.stringify(cfg));
}

/** 按标定配置构建手骨架（关节表取 createDefaultRig；CMC 外翻角取配置 thumbCmc） */
export function createRigFromConfig(cfg: HandRigConfig, handType: HandType = "right"): HandRig {
  const base = createDefaultRig(handType);
  const fingers = { ...base.fingers } as HandRig["fingers"];
  for (const name of FINGER_ORDER) {
    const segs = cfg.fingers[name];
    if (!segs) continue;
    fingers[name] = {
      ...fingers[name],
      segments: fingers[name].segments.map((s, i) => ({
        length: segs[i]?.length ?? s.length,
        width: segs[i]?.width ?? s.width,
      })),
    };
  }
  fingers.thumb = {
    ...fingers.thumb,
    joints: fingers.thumb.joints.map((j, i) =>
      i === 0 ? { ...j, ...cfg.thumbCmc } : j,
    ),
  };
  return { ...base, fingers };
}
