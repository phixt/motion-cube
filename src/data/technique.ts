/**
 * 手法库模型（docs/start.md、docs/params.md）。
 * 与公式强关联（formulaId）但可单独编辑；关键帧为稀疏控制点，系统按 1/60s 补帧。
 */
import type { Pose } from "../hand/HandRig";
import { DEFAULT_FRAME_RATE, sortKeyframes, validateKeyframes } from "../timeline/Timeline";

export type Easing = "linear" | "easeIn" | "easeOut" | "easeInOut";

export type TechniqueKeyframe = {
  /** 帧号（60fps 基准） */
  frame: number;
  pose: Pose;
  easing?: Easing;
};

export type StepMapping = {
  /** 公式 alg 的第几步（0-based） */
  stepIndex: number;
  startFrame: number;
  endFrame: number;
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
};

export class TechniqueError extends Error {}

export function validateTechnique(t: Technique): void {
  if (!t.id || !t.name.trim()) throw new TechniqueError("id/name 不能为空");
  if (!t.formulaId) throw new TechniqueError("手法必须关联一个公式（formulaId 不能为空）");
  if (!Number.isFinite(t.frameRate) || t.frameRate <= 0) throw new TechniqueError(`frameRate 必须 > 0：${t.frameRate}`);
  const kfErr = validateKeyframes(t.keyframes);
  if (kfErr) throw new TechniqueError(kfErr);
  for (const m of t.stepMapping) {
    if (!Number.isInteger(m.stepIndex) || m.stepIndex < 0) throw new TechniqueError(`stepIndex 必须为非负整数：${m.stepIndex}`);
    if (!Number.isInteger(m.startFrame) || m.startFrame < 0) throw new TechniqueError(`startFrame 非法：${m.startFrame}`);
    if (!Number.isInteger(m.endFrame) || m.endFrame < m.startFrame) {
      throw new TechniqueError(`stepMapping 区间非法：${m.startFrame}–${m.endFrame}`);
    }
  }
}

export type NewTechnique = {
  id?: string;
  name: string;
  formulaId: string;
  frameRate?: number;
  keyframes?: TechniqueKeyframe[];
  stepMapping?: StepMapping[];
};

export function createTechnique(input: NewTechnique): Technique {
  const t: Technique = {
    id: input.id ?? crypto.randomUUID(),
    name: input.name.trim(),
    formulaId: input.formulaId,
    frameRate: input.frameRate ?? DEFAULT_FRAME_RATE,
    keyframes: sortKeyframes(input.keyframes ?? []),
    stepMapping: [...(input.stepMapping ?? [])],
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

export function deserializeTechnique(text: string): Technique {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new TechniqueError("JSON 解析失败");
  }
  const obj = raw as Record<string, unknown> | null;
  if (!obj || typeof obj !== "object") throw new TechniqueError("结构非法");
  const keyframes = Array.isArray(obj.keyframes)
    ? (obj.keyframes as TechniqueKeyframe[])
    : [];
  const stepMapping = Array.isArray(obj.stepMapping) ? (obj.stepMapping as StepMapping[]) : [];
  const t: Technique = {
    id: typeof obj.id === "string" ? obj.id : crypto.randomUUID(),
    name: typeof obj.name === "string" ? obj.name : "",
    formulaId: typeof obj.formulaId === "string" ? obj.formulaId : "",
    frameRate: typeof obj.frameRate === "number" ? obj.frameRate : DEFAULT_FRAME_RATE,
    keyframes: sortKeyframes(keyframes),
    stepMapping,
  };
  validateTechnique(t);
  return t;
}
