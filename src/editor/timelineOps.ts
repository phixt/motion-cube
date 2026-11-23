/**
 * 编辑器时间线与公式步序纯逻辑（无 Vue/DOM 依赖，可直接单测）。
 * 收口原 EditorPage.vue 散落的 3 套帧重映射、复杂记法展开与 O(n log n) 路径生成。
 */
import {
  TechniqueError,
  type StepMapping,
  type Technique,
  type TechniqueKeyframe,
} from "../data/technique";
import { FINGER_ORDER, type Pose } from "../hand/HandRig";
import { expandMoves, parseMoves, splitCompoundMove } from "../notation/alg";
import { interpolatePose, MAX_KEYFRAME_FRAME, sortKeyframes } from "../timeline/Timeline";

/** 每动作默认时长（秒）：1 拍 = 0.3s */
export const STEP_DEFAULT_SEC = 0.3;
/** 最短单步时长（秒）：时间线总长下限 */
export const MIN_STEP_SEC = 0.01;
/** 自动/正弦路径中间关键帧间隔（帧） */
export const AUTO_PATH_STEP = 15;

export type CollisionFormatter = (origA: number, origB: number, targetFrame: number) => string;

/**
 * 展开公式字符串为单步 move 列表（与 stepMapping 对齐）：
 * 先经 cubing/alg 展开交换子 [R, U] / 共轭 [R: U] / 分组重复 (R U)2，
 * 再过滤注释并拆分复合动作（如 "UD'" → ["U", "D'"]、"RwUw" → ["Rw", "Uw"]）。
 */
export function expandFormulaMoves(movesStr: string): string[] {
  const parsed = parseMoves(movesStr);
  if (!parsed.ok) return [];
  let expanded: string;
  try {
    expanded = expandMoves(parsed.normalized);
  } catch {
    expanded = parsed.normalized;
  }
  const tokens = expanded
    .replace(/\/\/[^\n]*/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((s) => s.replace(/[()]/g, ""))
    .filter(Boolean);
  return tokens.flatMap(splitCompoundMove);
}

/** 按公式步数生成等长动作区间：第 i 步占 [i*t, (i+1)*t]（超预算时按比例压缩） */
export function buildStepMappingFromMoves(
  moves: readonly string[],
  frameRate: number,
  frameBudget = MAX_KEYFRAME_FRAME,
): StepMapping[] {
  if (moves.length === 0) return [];
  let frames = Math.max(1, Math.round(STEP_DEFAULT_SEC * frameRate));
  if (frames * moves.length > frameBudget) {
    frames = Math.max(1, Math.floor(frameBudget / moves.length));
  }
  return moves.map((_, i) => ({
    stepIndex: i,
    startFrame: i * frames,
    endFrame: (i + 1) * frames,
  }));
}

/**
 * 关键帧帧号重映射（P0-9）：两个关键帧塌陷到同一帧时抛带帧号的诊断错误，
 * 绝不允许重复帧号进入时间线或手法库。
 */
export function remapKeyframes(
  keyframes: readonly TechniqueKeyframe[],
  remap: (frame: number) => number,
  formatCollision: CollisionFormatter,
): TechniqueKeyframe[] {
  const mapped = keyframes.map((k) => ({ ...k, frame: remap(k.frame) }));
  const firstAt = new Map<number, number>();
  mapped.forEach((k, i) => {
    const orig = keyframes[i].frame;
    const first = firstAt.get(k.frame);
    if (first !== undefined) throw new TechniqueError(formatCollision(first, orig, k.frame));
    firstAt.set(k.frame, orig);
  });
  return sortKeyframes(mapped);
}

/** 按原步骤内相对进度重映射帧号（步骤外按总时长等比缩放） */
function makeStepRemapper(
  oldSteps: readonly StepMapping[],
  newSteps: readonly StepMapping[],
  mapStepIndex: (oldIdx: number) => number,
): (frame: number) => number {
  const oldTotal = Math.max(oldSteps.length ? oldSteps[oldSteps.length - 1].endFrame : 1, 1);
  const newTotal = Math.max(newSteps.length ? newSteps[newSteps.length - 1].endFrame : 1, 1);
  return (frame: number): number => {
    const step = oldSteps.find((m) => frame >= m.startFrame && frame <= m.endFrame);
    if (!step || oldSteps.length === 0) {
      return Math.round((frame / oldTotal) * newTotal);
    }
    const ns = newSteps[mapStepIndex(step.stepIndex)];
    if (!ns) return Math.round((frame / oldTotal) * newTotal);
    const ratio = (frame - step.startFrame) / Math.max(step.endFrame - step.startFrame, 1);
    return Math.round(ns.startFrame + ratio * (ns.endFrame - ns.startFrame));
  };
}

/** 统一按 remapFn 重映射关键帧与接触轨道 */
function applyRemapToTechnique(
  t2: Technique,
  patch: Partial<Technique>,
  remap: (frame: number) => number,
  formatCollision: CollisionFormatter,
): Technique {
  return {
    ...t2,
    ...patch,
    keyframes: remapKeyframes(t2.keyframes, remap, formatCollision),
    contactTracks: t2.contactTracks.map((c) => ({
      ...c,
      startFrame: remap(c.startFrame),
      endFrame: remap(c.endFrame),
    })),
  };
}

/** 按秒等比重映射全部帧数据（切换 frameRate 时保持动作真实秒数不变） */
export function rescaleTechniqueFrames(
  t2: Technique,
  oldFr: number,
  newFr: number,
  formatCollision: CollisionFormatter,
): Technique {
  const remap = (frame: number): number => Math.round((frame / oldFr) * newFr);
  const stepMapping = t2.stepMapping.map((m) => ({
    ...m,
    startFrame: remap(m.startFrame),
    endFrame: remap(m.endFrame),
  }));
  return applyRemapToTechnique(t2, { frameRate: newFr, stepMapping }, remap, formatCollision);
}

/** 按每步目标时长重建 stepMapping，并等比例重映射关键帧/接触轨道 */
export function rebuildTechniqueWithDurations(
  t2: Technique,
  durationFor: (idx: number) => number,
  formatCollision: CollisionFormatter,
): Technique {
  let acc = 0;
  const stepMapping: StepMapping[] = t2.stepMapping.map((m, i) => {
    const startFrame = Math.round(acc * t2.frameRate);
    acc += durationFor(i);
    return {
      stepIndex: i,
      startFrame,
      endFrame: Math.round(acc * t2.frameRate),
      ...(m.kind ? { kind: m.kind } : {}),
    };
  });
  const remap = makeStepRemapper(t2.stepMapping, stepMapping, (oldIdx) => oldIdx);
  return applyRemapToTechnique(t2, { stepMapping }, remap, formatCollision);
}

/** 在指定步骤 idx 后插入空拍（pause），后续步骤平移，关键帧/接触轨道同步重映射 */
export function insertTechniquePauseAfter(
  t2: Technique,
  idx: number,
  pauseSec: number,
  formatCollision: CollisionFormatter,
): Technique {
  const old = t2.stepMapping;
  const dur = (m: StepMapping): number => (m.endFrame - m.startFrame) / t2.frameRate;
  const entries: { sec: number; kind: "move" | "pause" }[] = [];
  for (let i = 0; i <= idx && i < old.length; i++) {
    entries.push({ sec: dur(old[i]), kind: old[i].kind ?? "move" });
  }
  entries.push({ sec: pauseSec, kind: "pause" });
  for (let i = idx + 1; i < old.length; i++) {
    entries.push({ sec: dur(old[i]), kind: old[i].kind ?? "move" });
  }
  let acc = 0;
  const stepMapping: StepMapping[] = entries.map((e, i) => {
    const startFrame = Math.round(acc * t2.frameRate);
    acc += e.sec;
    return { stepIndex: i, startFrame, endFrame: Math.round(acc * t2.frameRate), kind: e.kind };
  });
  const remap = makeStepRemapper(old, stepMapping, (oldIdx) => oldIdx + (oldIdx > idx ? 1 : 0));
  return applyRemapToTechnique(t2, { stepMapping }, remap, formatCollision);
}

/** O(n log n) 批量合并关键帧（同帧覆盖，末一次排序） */
function mergeBatchKeyframes(
  existing: readonly TechniqueKeyframe[],
  additions: readonly TechniqueKeyframe[],
): TechniqueKeyframe[] {
  const byFrame = new Map<number, TechniqueKeyframe>();
  for (const k of existing) byFrame.set(k.frame, k);
  for (const k of additions) byFrame.set(k.frame, k);
  return sortKeyframes([...byFrame.values()]);
}

/** 起终自动路径（O(n log n)）：在首末关键帧之间按 step 生成线性/slerp 中间帧 */
export function buildAutoPathKeyframes(
  keyframes: readonly TechniqueKeyframe[],
  step = AUTO_PATH_STEP,
): TechniqueKeyframe[] | null {
  if (keyframes.length < 2 || step < 1) return null;
  const sorted = sortKeyframes(keyframes);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (last.frame - first.frame <= step) return null;
  const additions: TechniqueKeyframe[] = [];
  for (let f = first.frame + step; f < last.frame; f += step) {
    const u = (f - first.frame) / (last.frame - first.frame);
    additions.push({
      frame: f,
      left: interpolatePose(first.left, last.left, u),
      right: interpolatePose(first.right, last.right, u),
      easing: first.easing ?? "linear",
    });
  }
  return mergeBatchKeyframes(sorted, additions);
}

/** 正弦函数路径（O(n log n)）：位置/朝向线性/slerp，各指关节 bend 按 sin²(πt/2) 缓动 */
export function buildSinePathKeyframes(
  keyframes: readonly TechniqueKeyframe[],
  step = AUTO_PATH_STEP,
): TechniqueKeyframe[] | null {
  if (keyframes.length < 2 || step < 1) return null;
  const sorted = sortKeyframes(keyframes);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (last.frame - first.frame <= step) return null;
  const additions: TechniqueKeyframe[] = [];
  for (let f = first.frame + step; f < last.frame; f += step) {
    const u = (f - first.frame) / (last.frame - first.frame);
    const baseLeft = interpolatePose(first.left, last.left, u);
    const baseRight = interpolatePose(first.right, last.right, u);
    const e = Math.sin((Math.PI / 2) * u) ** 2;
    const bendsL = {} as Pose["bends"];
    const bendsR = {} as Pose["bends"];
    for (const name of FINGER_ORDER) {
      const aL = first.left.bends[name];
      const bL = last.left.bends[name];
      bendsL[name] = aL.map((v, i) => v + ((bL[i] ?? v) - v) * e);
      const aR = first.right.bends[name];
      const bR = last.right.bends[name];
      bendsR[name] = aR.map((v, i) => v + ((bR[i] ?? v) - v) * e);
    }
    additions.push({
      frame: f,
      left: { ...baseLeft, bends: bendsL },
      right: { ...baseRight, bends: bendsR },
      easing: first.easing ?? "linear",
    });
  }
  return mergeBatchKeyframes(sorted, additions);
}
