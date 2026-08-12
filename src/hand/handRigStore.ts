/**
 * 手部模型标定存储（docs/todo.md：手部标定页）。
 * HandRigConfig 包含全部可调几何参数：各指段长/粗细、手掌、指根布局、整体放大系数。
 * 「固化」= 保存到 localStorage，编辑器 / 游戏在构造 HandRigView 时读取同一配置。
 * 默认值 = createDefaultRig（人体测量数据校准）+ 目测迭代的渲染参数（2026-08-06）。
 */
import { createDefaultRig, FINGER_ORDER, type FingerName, type HandRig, type HandType } from "./HandRig";

export type SegmentCalib = { length: number; width: number };

export type HandRigConfig = {
  version: 2;
  /** 整体放大系数：数据单位 → 渲染倍数（1.33 单位小指 → ≈2.1 块边长） */
  handScale: number;
  /** 指根间距：四指根 X 的乘数（默认 1） */
  fingerSpacing: number;
  /** 手掌盒体（数据单位）；前表面落在 mcpZ，手指/拇指从掌前缘伸出 */
  palm: { width: number; height: number; length: number; mcpZ: number };
  /** 四指根相对手掌中心（左手 +X 为拇指侧；右手渲染时 X 取反） */
  bases: Record<"index" | "middle" | "ring" | "pinky", { x: number; y: number }>;
  /** 拇指根锚点相对手掌中心（数据单位；掌根/腕侧，x 渲染时按手型取反） */
  thumbCorner: { x: number; y: number; z: number };
  /** 大鱼际（thenar eminence）凸块：椭球尺寸与位置（相对手掌中心，数据单位） */
  thenar: { width: number; height: number; length: number; x: number; y: number; z: number };
  /** 各指段（拇指 2 段，其余 3 段）：长度 / 粗细（数据单位，1 = 块边长） */
  fingers: Record<FingerName, SegmentCalib[]>;
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
  version: 2,
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
  // 大鱼际：拇指根处椭球凸块，略微超出掌缘形成"根部隆起"
  thenar: { width: 0.62, height: 0.38, length: 0.9, x: 0.5, y: -0.02, z: -0.42 },
  fingers: defaultFingers(),
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
  const version = obj.version === 2 ? 2 : obj.version === 1 ? 1 : 0;
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
  // version 1（拇指根仍在掌前缘角落的旧语义）→ 迁移到掌根锚点 + 大鱼际默认值
  const legacy = version === 1;
  return {
    version: 2,
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
    fingers,
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

/** 按标定配置构建手骨架（关节表/默认 bend 取 createDefaultRig） */
export function createRigFromConfig(cfg: HandRigConfig, handType: HandType = "left"): HandRig {
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
  return { ...base, fingers };
}
