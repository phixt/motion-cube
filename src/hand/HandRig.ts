/**
 * 层 E 数据模型：手/手指骨架定义与姿态快照（docs/params.md）。
 * 关键特例：拇指 2 段、关节表 CMC/MCP/IP；CMC 位于手掌基底，
 * 含屈伸 + 展收 + 对掌旋转自由度（thumb.baseDOF）。
 */

export type HandType = "left" | "right";

export const FINGER_ORDER = ["thumb", "index", "middle", "ring", "pinky"] as const;
export type FingerName = (typeof FINGER_ORDER)[number];

/** 接触侧：腹 / 背 / 靠拇指侧 / 靠小指侧（对食指而言"靠小指侧"= 靠中指侧） */
export type Side = "pad" | "back" | "thumbSide" | "pinkySide";

export type JointName = "CMC" | "MCP" | "PIP" | "DIP" | "IP";

/** 关节定义：bend 为指腹侧夹角（伸直 180°，自然 ≈135°，极限 ≈90°） */
export type JointDef = {
  name: JointName;
  bend: number;
  /** 屈伸范围（默认 90–180） */
  range?: { min: number; max: number };
  /** 展收（度）——目前仅拇指 CMC 使用 */
  abduction?: number;
  /** 对掌旋转（度）——目前仅拇指 CMC 使用 */
  rotation?: number;
};

export type SegmentDef = {
  /** 长度（魔方单位，1 = 一个块边长） */
  length: number;
  /** 粗细（魔方单位） */
  width: number;
};

export type FingerDef = {
  name: FingerName;
  /** 拇指 2 段（近/远节），其余 3 段（近/中/远节） */
  segments: SegmentDef[];
  /** 拇指 [CMC, MCP, IP]，其余 [MCP, PIP, DIP] */
  joints: JointDef[];
};

/** 手骨架定义：所有 pose 共用的几何与关节约束 */
export type HandRig = {
  handType: HandType;
  fingers: Record<FingerName, FingerDef>;
};

export type Transform = {
  position: { x: number; y: number; z: number };
  /** 四元数 (w, x, y, z) */
  quaternion: { w: number; x: number; y: number; z: number };
};

/** 接触点：手指某侧某段上的位置 + 魔方目标元素 */
export type Contact = {
  finger: FingerName;
  segmentIndex: number;
  side: Side;
  /** 段内位置 0–1（0=段根，1=指尖）；"近指尖 1/3" ≈ 0.67，计量起点可配 */
  t: number;
  /** 魔方元素名，如 "UL 边"、"ULB"、"B 面"（随转动自动更新，见 params.md） */
  target: string;
};

export type Pose = {
  palm: {
    transform: Transform;
    /** 拇指根相对手掌的位姿（拇指基底自由度所在） */
    thumbBase: Transform;
  };
  /** 各指关节 bend（顺序与 rig.fingers[name].joints 一致） */
  bends: Record<FingerName, number[]>;
  /** 拇指 CMC 的额外自由度（展收/对掌旋转） */
  thumbCMC: { abduction: number; rotation: number };
  contacts: Contact[];
};

export const DEFAULT_BEND_RANGE = { min: 90, max: 180 };

export function identityTransform(): Transform {
  return { position: { x: 0, y: 0, z: 0 }, quaternion: { w: 1, x: 0, y: 0, z: 0 } };
}

export function clampBend(joint: JointDef, value: number): number {
  const r = joint.range ?? DEFAULT_BEND_RANGE;
  return Math.min(r.max, Math.max(r.min, value));
}

function standardFinger(name: FingerName, lengths: number[], widths: number[]): FingerDef {
  return {
    name,
    segments: lengths.map((length, i) => ({ length, width: widths[i] ?? widths[widths.length - 1] })),
    joints: [
      { name: "MCP", bend: 168 },
      { name: "PIP", bend: 135 },
      { name: "DIP", bend: 150 },
    ],
  };
}

/** 默认手骨架（长度按真实比例折算为魔方单位；拇指为特例） */
export function createDefaultRig(handType: HandType = "left"): HandRig {
  return {
    handType,
    fingers: {
      thumb: {
        name: "thumb",
        segments: [
          { length: 0.6, width: 0.32 },
          { length: 0.46, width: 0.27 },
        ],
        joints: [
          { name: "CMC", bend: 160, range: { min: 60, max: 180 }, abduction: 0, rotation: 0 },
          { name: "MCP", bend: 160 },
          { name: "IP", bend: 165 },
        ],
      },
      index: standardFinger("index", [0.72, 0.56, 0.46], [0.26, 0.23, 0.2]),
      middle: standardFinger("middle", [0.78, 0.6, 0.48], [0.27, 0.24, 0.21]),
      ring: standardFinger("ring", [0.72, 0.56, 0.46], [0.26, 0.23, 0.2]),
      pinky: standardFinger("pinky", [0.55, 0.42, 0.36], [0.23, 0.2, 0.18]),
    },
  };
}

/** 按骨架默认值生成初始姿态（bends 取各关节定义值，接触为空） */
export function createDefaultPose(rig: HandRig): Pose {
  const bends = {} as Record<FingerName, number[]>;
  for (const name of FINGER_ORDER) {
    bends[name] = rig.fingers[name].joints.map((j) => j.bend);
  }
  return {
    palm: { transform: identityTransform(), thumbBase: identityTransform() },
    bends,
    thumbCMC: {
      abduction: rig.fingers.thumb.joints[0].abduction ?? 0,
      rotation: rig.fingers.thumb.joints[0].rotation ?? 0,
    },
    contacts: [],
  };
}

/**
 * 编辑器默认手位：手掌置于魔方前方（+Z），绕 Y 转 180° 使手指指向魔方。
 * 用于新建手法/添加关键帧的默认姿态，避免默认位姿（原点）把手埋在魔方里。
 */
export function defaultHandPose(handType: HandType = "left"): Pose {
  const pose = createDefaultPose(createDefaultRig(handType));
  // 手掌置于魔方左前方稍远处（左手：拇指侧朝魔方，四指伸向前表面），
  // 拉开距离避免遮挡魔方主体；放大后中指全长 ≈ 4.3 块，伸直时指尖离前表面约 1.5 块
  pose.palm.transform.position = { x: -3.0, y: 0.5, z: 9.0 };
  pose.palm.transform.quaternion = { w: 0, x: 0, y: 1, z: 0 }; // rotY 180°
  return pose;
}
