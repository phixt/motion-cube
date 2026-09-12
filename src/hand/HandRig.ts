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
  /** 掌平面展收（度，向拇指侧张开）——目前仅拇指 CMC使用 */
  abduction?: number;
  /** 抬离掌面（度，向指背侧抬起）——目前仅拇指 CMC 使用 */
  elevation?: number;
  /** 对掌自转（度，绕拇指自身长轴，指腹转向掌/指侧）——目前仅拇指 CMC 使用 */
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
  /**
   * 拇指 CMC 三自由度（解剖语义，见 DEFAULT_THUMB_CMC）：
   * abduction 掌平面展收 / elevation 抬离掌面 / rotation 对掌自转
   */
  thumbCMC: { abduction: number; elevation: number; rotation: number };
  contacts: Contact[];
}

export const oppositeHandType = (t: HandType): HandType => (t === "right" ? "left" : "right");

/**
 * 跨掌面中线（世界 x=0）镜像姿态：右手姿态 ↔ 左手姿态（双手显示用）。
 * 位置 x 取反；四元数按 x 镜像（存储序 w,x,y,z 中 y/z 分量取反——M·R·M，
 * M=diag(−1,1,1)）；bends 关节弯屈对称照搬；contacts 解剖侧语义随对侧手型
 * 的 sideSign 自动成立；CMC 展收/对掌取反（抬离不变）。
 */
export function mirrorPose(pose: Pose): Pose {
  const mirrorT = (t: Transform): Transform => ({
    position: { x: -t.position.x, y: t.position.y, z: t.position.z },
    quaternion: {
      w: t.quaternion.w,
      x: t.quaternion.x,
      y: -t.quaternion.y,
      z: -t.quaternion.z,
    },
  });
  return {
    ...pose,
    palm: {
      transform: mirrorT(pose.palm.transform),
      thumbBase: mirrorT(pose.palm.thumbBase),
    },
    thumbCMC: {
      ...pose.thumbCMC,
      abduction: -pose.thumbCMC.abduction,
      rotation: -pose.thumbCMC.rotation,
    },
  };
}

export const DEFAULT_BEND_RANGE = { min: 90, max: 180 };

/**
 * 拇指 CMC 默认角（度）。
 * 0.4.0 七轮扶正：展收/抬离归零 + 对掌扭转 45→15——45° 扭转让拇指弯屈方向偏出指
 * 平面，是「下撇不平行」观感的主因（轴本身与四指平行，被扭转的杆身读作斜杆）；
 * 对掌需求由姿态数据（thumbCMC.rotation）与标定滑块表达。
 * 渲染分解：rotation.x = -elevation，rotation.y = ±abduction，rotation.z = ∓rotation（按手型镜像）。
 */
export const DEFAULT_THUMB_CMC = { abduction: 0, elevation: 0, rotation: 15 };

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

/**
 * 默认手骨架（指节长度/粗细按开源人体测量数据折算为魔方单位；拇指为特例）。
 *
 * 数据来源（2026-08-06 校准，见 docs/params.md §手部比例）：
 * - 各指总长比（以中指为 1）：acbjournal 2024（51 名 18–30 岁青年，指节之和 mm）
 *   thumb 49.5 / index 63.9 / middle 70.7 / ring 65.5 / little 53.3
 *   → 0.700 / 0.904 / 1.000 / 0.926 / 0.754
 * - 指节长度占比（JSSM 久坐男性，指骨长度 %）：thumb 近/远 57.3/42.7；
 *   index 49.5/28.8/21.7；middle 48.5/31.8/19.6；ring 46.8/31.2/22.0；little 47.0/27.9/25.1
 * - 指粗比（儿童 3–10 岁指径 mm，thumb 16 / index,middle 15 / ring 14 / little 13）：
 *   相对小指 1.23 / 1.15 / 1.15 / 1.08 / 1.00；指节 taper 取 JSSM 体积比折算并略保守化
 * - 锚点：小指总长保持 1.33（对应 HAND_SCALE = 2.1/1.33，小指 ≈ 2.1 块边长；
 *   2026-08-06 目测回调：3.1 渲染后整体过大，中指 4.1 块超出魔方面）
 */
export function createDefaultRig(handType: HandType = "right"): HandRig {
  return {
    handType,
    fingers: {
      thumb: {
        name: "thumb",
        segments: [
          { length: 0.71, width: 0.28 },
          { length: 0.53, width: 0.21 },
        ],
        joints: [
          // 默认自然微曲（0.4.0 六轮定版 170/165/168——175/170/170 过直如枝，160/160/165
          // 基关节即 20° 弯+45° 扭转呈钩状下坠；CMC 外翻角取 DEFAULT_THUMB_CMC 0/0/45）
          { name: "CMC", bend: 170, range: { min: 60, max: 180 }, ...DEFAULT_THUMB_CMC },
          { name: "MCP", bend: 165 },
          { name: "IP", bend: 168 },
        ],
      },
      index: standardFinger("index", [0.79, 0.46, 0.35], [0.26, 0.21, 0.16]),
      middle: standardFinger("middle", [0.86, 0.56, 0.35], [0.27, 0.21, 0.16]),
      ring: standardFinger("ring", [0.76, 0.51, 0.36], [0.25, 0.22, 0.16]),
      pinky: standardFinger("pinky", [0.63, 0.37, 0.33], [0.23, 0.19, 0.14]),
    },
  };
}

/** 按骨架默认值生成初始姿态（bends 取各关节定义值，接触为空） */
export function createDefaultPose(rig: HandRig): Pose {
  const bends = {} as Record<FingerName, number[]>;
  for (const name of FINGER_ORDER) {
    bends[name] = rig.fingers[name].joints.map((j) => j.bend);
  }
  const cmc = rig.fingers.thumb.joints[0];
  return {
    palm: { transform: identityTransform(), thumbBase: identityTransform() },
    bends,
    thumbCMC: {
      abduction: cmc.abduction ?? 0,
      elevation: cmc.elevation ?? 0,
      rotation: cmc.rotation ?? 0,
    },
    contacts: [],
  };
}

/**
 * 编辑器默认手位：手掌置于魔方前方（+Z），绕 Y 转 180° 使手指指向魔方。
 * 用于新建手法/添加关键帧的默认姿态，避免默认位姿（原点）把手埋在魔方里。
 */
export function defaultHandPose(handType: HandType = "right"): Pose {
  const pose = createDefaultPose(createDefaultRig(handType));
  // 用户指定基准（十八轮定版）：双手分立魔方左右两侧、掌心贴左右面、拇指朝上——
  // 右手贴右面（掌心 −x / 拇指 +y / 四指向后 −z）。handScale 1.85 下掌半厚 0.42，
  // 掌心位 ±1.95 时掌面 ≈ ±1.53 恰贴面（手往两侧靠）。左手为 x 镜像。
  if (handType === "left") {
    pose.palm.transform.position = { x: -1.95, y: 0, z: 0 };
    pose.palm.transform.quaternion = { w: 0, x: 0.7071, y: -0.7071, z: 0 };
  } else {
    pose.palm.transform.position = { x: 1.95, y: 0, z: 0 };
    pose.palm.transform.quaternion = { w: 0, x: 0.7071, y: 0.7071, z: 0 };
  }
  return pose;
}
