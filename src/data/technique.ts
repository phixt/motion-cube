/**
 * 手法库模型。
 * 与公式强关联（formulaId）但可单独编辑；关键帧为稀疏控制点，系统按 1/60s 补帧。
 */
import { FINGER_ORDER, type Contact, type FingerName, type Pose, type Side } from "../hand/HandRig";
import { DEFAULT_FRAME_RATE, sortKeyframes, validateKeyframes } from "../timeline/Timeline";
import { parseMoves } from "../notation/alg";

export type Easing = "linear" | "easeIn" | "easeOut" | "easeInOut";

export type TechniqueKeyframe = {
  /** 帧号（60fps 基准） */
  frame: number;
  /** 主手（编辑器手型选择器所选手）姿态 */
  pose: Pose;
  /**
   * 对侧手姿态（0.4.0 十八轮双手独立编辑）：缺省 = 镜像跟随主手（mirrorPose(pose)）；
   * 存在 = 对侧手独立轨道（可与其他关键帧的跟随态混插值）。旧档无此字段 = 跟随。
   */
  mirror?: Pose;
  easing?: Easing;
};

export type StepMapping = {
  /** 公式 alg 的第几步（0-based；空拍步无对应公式动作） */
  stepIndex: number;
  startFrame: number;
  endFrame: number;
  /** 空拍（pause）：魔方不动作、手部动画继续；缺省 = move */
  kind?: "move" | "pause";
};

/** 接触轨道：精确起止帧（params.md contact.lifetime），与关键帧姿态分离，可中途接触/释放 */
export type ContactTrack = {
  startFrame: number;
  endFrame: number;
  contact: Contact;
};

export type Technique = {
  id: string;
  name: string;
  /** 关联公式 id（必填；一个公式可绑定多个手法，手法不能单独存在） */
  formulaId: string;
  frameRate: number;
  /** 稀疏控制点，按 frame 升序 */
  keyframes: TechniqueKeyframe[];
  stepMapping: StepMapping[];
  /** 接触轨道（精确起止帧） */
  contactTracks: ContactTrack[];
  /** 自定义正放起始态（alg；缺省 = 公式逆序状态） */
  startState?: string;
  /** 自定义倒放起始态（alg；缺省 = 还原态） */
  reverseStart?: string;
};

export class TechniqueError extends Error {}

export function validateTechnique(t: Technique): void {
  if (!t.id || !t.name.trim()) throw new TechniqueError("id/name 不能为空");
  if (!t.formulaId) throw new TechniqueError("手法必须关联一个公式（formulaId 不能为空）");
  if (t.startState !== undefined && t.startState !== "" && !parseMoves(t.startState).ok) {
    throw new TechniqueError("startState 不是合法记法");
  }
  if (t.reverseStart !== undefined && t.reverseStart !== "" && !parseMoves(t.reverseStart).ok) {
    throw new TechniqueError("reverseStart 不是合法记法");
  }
  if (!Number.isFinite(t.frameRate) || t.frameRate <= 0) throw new TechniqueError(`frameRate 必须 > 0：${t.frameRate}`);
  const kfErr = validateKeyframes(t.keyframes);
  if (kfErr) throw new TechniqueError(kfErr);
  for (const m of t.stepMapping) {
    if (!Number.isInteger(m.stepIndex) || m.stepIndex < 0) throw new TechniqueError(`stepIndex 必须为非负整数：${m.stepIndex}`);
    if (!Number.isInteger(m.startFrame) || m.startFrame < 0) throw new TechniqueError(`startFrame 非法：${m.startFrame}`);
    if (!Number.isInteger(m.endFrame) || m.endFrame < m.startFrame) {
      throw new TechniqueError(`stepMapping 区间非法：${m.startFrame}–${m.endFrame}`);
    }
    if (m.kind !== undefined && m.kind !== "move" && m.kind !== "pause") {
      throw new TechniqueError(`stepMapping kind 非法：${m.kind}`);
    }
  }
  for (const c of t.contactTracks) {
    if (!Number.isInteger(c.startFrame) || c.startFrame < 0) {
      throw new TechniqueError(`接触轨道 startFrame 非法：${c.startFrame}`);
    }
    if (!Number.isInteger(c.endFrame) || c.endFrame < c.startFrame) {
      throw new TechniqueError(`接触轨道区间非法：${c.startFrame}–${c.endFrame}`);
    }
    if (!c.contact) throw new TechniqueError("接触轨道缺少 contact");
  }
}

export type NewTechnique = {
  id?: string;
  name: string;
  formulaId: string;
  frameRate?: number;
  keyframes?: TechniqueKeyframe[];
  stepMapping?: StepMapping[];
  contactTracks?: ContactTrack[];
  startState?: string;
  reverseStart?: string;
};

export function createTechnique(input: NewTechnique): Technique {
  const t: Technique = {
    id: input.id ?? crypto.randomUUID(),
    name: input.name.trim(),
    formulaId: input.formulaId,
    frameRate: input.frameRate ?? DEFAULT_FRAME_RATE,
    keyframes: sortKeyframes(input.keyframes ?? []),
    stepMapping: [...(input.stepMapping ?? [])],
    contactTracks: [...(input.contactTracks ?? [])],
    ...(input.startState ? { startState: input.startState } : {}),
    ...(input.reverseStart ? { reverseStart: input.reverseStart } : {}),
  };
  validateTechnique(t);
  return t;
}

/** 插入关键帧（按帧号排序去重；同帧覆盖） */
export function upsertKeyframe(t: Technique, keyframe: TechniqueKeyframe): Technique {
  const others = t.keyframes.filter((k) => k.frame !== keyframe.frame);
  const keyframes = sortKeyframes([...others, keyframe]);
  const next: Technique = { ...t, keyframes };
  validateTechnique(next);
  return next;
}

export function removeKeyframe(t: Technique, frame: number): Technique {
  return { ...t, keyframes: t.keyframes.filter((k) => k.frame !== frame) };
}

export function serializeTechnique(t: Technique): string {
  return JSON.stringify(t, null, 2);
}

// ---------- 导入深度校验（防恶意/损坏 JSON 在渲染/插值时崩溃） ----------

const SIDES: readonly Side[] = ["pad", "back", "thumbSide", "pinkySide"];
const EASINGS: readonly Easing[] = ["linear", "easeIn", "easeOut", "easeInOut"];

const isFiniteNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function parseVec3(v: unknown, name: string): { x: number; y: number; z: number } {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object") throw new TechniqueError(`关键帧姿态非法：${name} 必须为对象`);
  const { x, y, z } = o;
  if (!isFiniteNum(x) || !isFiniteNum(y) || !isFiniteNum(z)) {
    throw new TechniqueError(`关键帧姿态非法：${name} 含非数字分量`);
  }
  return { x, y, z };
}

function parseQuat(v: unknown, name: string): { w: number; x: number; y: number; z: number } {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object") throw new TechniqueError(`关键帧姿态非法：${name} 必须为对象`);
  const { w, x, y, z } = o;
  if (!isFiniteNum(w) || !isFiniteNum(x) || !isFiniteNum(y) || !isFiniteNum(z)) {
    throw new TechniqueError(`关键帧姿态非法：${name} 含非数字分量`);
  }
  return { w, x, y, z };
}

function parseTransform(v: unknown, name: string): Pose["palm"]["transform"] {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object") throw new TechniqueError(`关键帧姿态非法：${name} 必须为对象`);
  return {
    position: parseVec3(o.position, `${name}.position`),
    quaternion: parseQuat(o.quaternion, `${name}.quaternion`),
  };
}

function parseContacts(v: unknown): Contact[] {
  if (!Array.isArray(v)) throw new TechniqueError("关键帧姿态非法：contacts 必须为数组");
  return v.map((c, i) => {
    const o = c as Record<string, unknown> | null;
    if (!o || typeof o !== "object") throw new TechniqueError(`关键帧姿态非法：contacts[${i}] 必须为对象`);
    const { finger, segmentIndex, side, t, target } = o;
    if (typeof finger !== "string" || !(FINGER_ORDER as readonly string[]).includes(finger)) {
      throw new TechniqueError(`关键帧姿态非法：contacts[${i}].finger 非法：${String(finger)}`);
    }
    if (!Number.isInteger(segmentIndex) || (segmentIndex as number) < 0) {
      throw new TechniqueError(`关键帧姿态非法：contacts[${i}].segmentIndex 必须为非负整数`);
    }
    if (typeof side !== "string" || !(SIDES as readonly string[]).includes(side)) {
      throw new TechniqueError(`关键帧姿态非法：contacts[${i}].side 非法：${String(side)}`);
    }
    if (!isFiniteNum(t) || (t as number) < 0 || (t as number) > 1) {
      throw new TechniqueError(`关键帧姿态非法：contacts[${i}].t 必须在 0–1 之间`);
    }
    if (typeof target !== "string") throw new TechniqueError(`关键帧姿态非法：contacts[${i}].target 必须为字符串`);
    return { finger: finger as FingerName, segmentIndex: segmentIndex as number, side: side as Side, t: t as number, target };
  });
}

/** 深度校验并规范化一个关键帧姿态；结构非法抛 TechniqueError */
export function parsePose(v: unknown): Pose {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object") throw new TechniqueError("关键帧姿态非法：pose 必须为对象");
  const palm = o.palm as Record<string, unknown> | null;
  if (!palm || typeof palm !== "object") throw new TechniqueError("关键帧姿态非法：palm 必须为对象");
  const bends = o.bends as Record<string, unknown> | null;
  if (!bends || typeof bends !== "object") throw new TechniqueError("关键帧姿态非法：bends 必须为对象");
  const bendsOut = {} as Pose["bends"];
  for (const name of FINGER_ORDER) {
    const arr = bends[name];
    if (!Array.isArray(arr) || arr.length === 0 || arr.length > 8 || !arr.every(isFiniteNum)) {
      throw new TechniqueError(`关键帧姿态非法：bends.${name} 必须为有限数字数组`);
    }
    bendsOut[name] = [...arr] as Pose["bends"][typeof name];
  }
  const thumbCMC = o.thumbCMC as Record<string, unknown> | null;
  if (!thumbCMC || typeof thumbCMC !== "object") {
    throw new TechniqueError("关键帧姿态非法：thumbCMC 必须为对象");
  }
  if (!isFiniteNum(thumbCMC.abduction) || !isFiniteNum(thumbCMC.rotation)) {
    throw new TechniqueError("关键帧姿态非法：thumbCMC.abduction/rotation 必须为数字");
  }
  return {
    palm: {
      transform: parseTransform(palm.transform, "palm.transform"),
      thumbBase: parseTransform(palm.thumbBase, "palm.thumbBase"),
    },
    bends: bendsOut,
    // elevation（抬离掌面）为 v3 新增字段：旧数据缺省按 0（平贴掌面）处理
    thumbCMC: {
      abduction: thumbCMC.abduction,
      elevation: isFiniteNum(thumbCMC.elevation) ? thumbCMC.elevation : 0,
      rotation: thumbCMC.rotation,
    },
    contacts: parseContacts(o.contacts),
  };
}

/** 深度校验并规范化一个关键帧条目；结构非法抛 TechniqueError */
function parseKeyframe(v: unknown): TechniqueKeyframe {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object") throw new TechniqueError("关键帧条目非法：必须为对象");
  const { frame, pose, mirror, easing } = o;
  if (!Number.isInteger(frame) || (frame as number) < 0) {
    throw new TechniqueError(`关键帧帧号非法：${String(frame)}`);
  }
  if (pose === undefined) throw new TechniqueError(`关键帧 ${String(frame)} 缺少 pose`);
  if (easing !== undefined && !(EASINGS as readonly string[]).includes(easing as string)) {
    throw new TechniqueError(`关键帧 ${String(frame)} 缓动非法：${String(easing)}`);
  }
  return {
    frame: frame as number,
    pose: parsePose(pose),
    ...(mirror !== undefined ? { mirror: parsePose(mirror) } : {}),
    easing: easing as Easing | undefined,
  };
}

/** 深度校验并规范化 stepMapping；结构非法抛 TechniqueError */
function parseStepMapping(v: unknown): StepMapping[] {
  if (!Array.isArray(v)) throw new TechniqueError("stepMapping 必须为数组");
  return v.map((m, i) => {
    const o = m as Record<string, unknown> | null;
    if (!o || typeof o !== "object") throw new TechniqueError(`stepMapping[${i}] 必须为对象`);
    const { stepIndex, startFrame, endFrame, kind } = o;
    if (!Number.isInteger(stepIndex) || !Number.isInteger(startFrame) || !Number.isInteger(endFrame)) {
      throw new TechniqueError(`stepMapping[${i}] 的帧字段必须为整数`);
    }
    const sm: StepMapping = {
      stepIndex: stepIndex as number,
      startFrame: startFrame as number,
      endFrame: endFrame as number,
    };
    if (kind === "move" || kind === "pause") sm.kind = kind;
    return sm;
  });
}

/** 深度校验并规范化接触轨道（复用 parseContacts 的接触校验） */
function parseContactTracks(v: unknown): ContactTrack[] {
  if (!Array.isArray(v)) throw new TechniqueError("contactTracks 必须为数组");
  return v.map((c, i) => {
    const o = c as Record<string, unknown> | null;
    if (!o || typeof o !== "object") throw new TechniqueError(`contactTracks[${i}] 必须为对象`);
    const { startFrame, endFrame, contact } = o;
    if (
      !Number.isInteger(startFrame) ||
      !Number.isInteger(endFrame) ||
      (startFrame as number) < 0 ||
      (endFrame as number) < (startFrame as number)
    ) {
      throw new TechniqueError(`contactTracks[${i}] 帧区间非法：${String(startFrame)}–${String(endFrame)}`);
    }
    if (contact === undefined) throw new TechniqueError(`contactTracks[${i}] 缺少 contact`);
    return {
      startFrame: startFrame as number,
      endFrame: endFrame as number,
      contact: parseContacts([contact])[0],
    };
  });
}

export function deserializeTechnique(text: string): Technique {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new TechniqueError("JSON 解析失败");
  }
  const obj = raw as Record<string, unknown> | null;
  if (!obj || typeof obj !== "object") throw new TechniqueError("结构非法");
  let keyframes: TechniqueKeyframe[] = [];
  if (obj.keyframes !== undefined) {
    if (!Array.isArray(obj.keyframes)) throw new TechniqueError("keyframes 必须为数组");
    keyframes = (obj.keyframes as unknown[]).map(parseKeyframe);
  }
  const stepMapping = obj.stepMapping === undefined ? [] : parseStepMapping(obj.stepMapping);
  const contactTracks = obj.contactTracks === undefined ? [] : parseContactTracks(obj.contactTracks);
  const t: Technique = {
    id: typeof obj.id === "string" ? obj.id : crypto.randomUUID(),
    name: typeof obj.name === "string" ? obj.name : "",
    formulaId: typeof obj.formulaId === "string" ? obj.formulaId : "",
    frameRate: typeof obj.frameRate === "number" ? obj.frameRate : DEFAULT_FRAME_RATE,
    keyframes: sortKeyframes(keyframes),
    stepMapping,
    contactTracks,
    ...(typeof obj.startState === "string" && obj.startState ? { startState: obj.startState } : {}),
    ...(typeof obj.reverseStart === "string" && obj.reverseStart ? { reverseStart: obj.reverseStart } : {}),
  };
  validateTechnique(t);
  return t;
}
