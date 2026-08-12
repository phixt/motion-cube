/**
 * 层 D' 时间线工具（docs/params.md）：帧率 60fps、帧↔秒换算、
 * 关键帧校验/排序/插值区间、姿态插值（补帧）。
 */
import type { Pose } from "../hand/HandRig";

export const DEFAULT_FRAME_RATE = 60;

/**
 * 关键帧帧号上限（60fps 基准下 10 分钟）：时间线/预览表按帧生成 DOM 与采样行，
 * 无上限时误输入或恶意导入超大帧号（如 1e8）会导致页面渲染卡死。
 */
export const MAX_KEYFRAME_FRAME = 36_000;

export function frameToSecond(frame: number, frameRate: number = DEFAULT_FRAME_RATE): number {
  return frame / frameRate;
}

export function secondToFrame(seconds: number, frameRate: number = DEFAULT_FRAME_RATE): number {
  return Math.round(seconds * frameRate);
}

/** 关键帧按 frame 升序排序（不修改原数组） */
export function sortKeyframes<T extends { frame: number }>(keyframes: readonly T[]): T[] {
  return [...keyframes].sort((a, b) => a.frame - b.frame);
}

/** 校验：帧号非负整数、不超过上限、升序、无重复；通过返回 null */
export function validateKeyframes<T extends { frame: number }>(keyframes: readonly T[]): string | null {
  let prev = -1;
  for (const k of keyframes) {
    if (!Number.isInteger(k.frame) || k.frame < 0) return `帧号非法：${k.frame}`;
    if (k.frame > MAX_KEYFRAME_FRAME) {
      return `帧号超出上限（${MAX_KEYFRAME_FRAME}）：${k.frame}`;
    }
    if (k.frame <= prev) return `关键帧未按帧号升序（重复或倒序：${k.frame}）`;
    prev = k.frame;
  }
  return null;
}

/** 求 time 所在的关键帧区间 [a, b] 与段内进度 local∈[0,1]；不足两个关键帧返回 null */
export function keyframeSegment<T extends { frame: number }>(
  sorted: readonly T[],
  time: number,
): { a: T; b: T; local: number } | null {
  if (sorted.length < 2) return null;
  if (time <= sorted[0].frame) return { a: sorted[0], b: sorted[0], local: 0 };
  const last = sorted[sorted.length - 1];
  if (time >= last.frame) return { a: last, b: last, local: 0 };
  for (let i = 0; i < sorted.length - 1; i++) {
    if (time >= sorted[i].frame && time <= sorted[i + 1].frame) {
      const span = sorted[i + 1].frame - sorted[i].frame;
      return { a: sorted[i], b: sorted[i + 1], local: span === 0 ? 0 : (time - sorted[i].frame) / span };
    }
  }
  return null;
}

// ---------- 缓动与姿态插值 ----------

export type EasingFn = "linear" | "easeIn" | "easeOut" | "easeInOut";

export function applyEasing(easing: EasingFn | undefined, t: number): number {
  const x = Math.min(1, Math.max(0, t));
  switch (easing) {
    case "easeIn":
      return x * x;
    case "easeOut":
      return 1 - (1 - x) * (1 - x);
    case "easeInOut":
      return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
    default:
      return x;
  }
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpVec3(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, t: number) {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
}

/** 四元数 nlerp（占位近似，后续按需换 slerp；调用方保证输入为单位四元数） */
function nlerpQuat(
  a: { w: number; x: number; y: number; z: number },
  b: { w: number; x: number; y: number; z: number },
  t: number,
) {
  const q = {
    w: lerp(a.w, b.w, t),
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    z: lerp(a.z, b.z, t),
  };
  const len = Math.hypot(q.w, q.x, q.y, q.z) || 1;
  return { w: q.w / len, x: q.x / len, y: q.y / len, z: q.z / len };
}

/**
 * 姿态线性插值（补帧）：位置/四元数/各关节 bend/拇指 CMC 自由度。
 * 接触为离散量，取 t<0.5 时 a、否则 b（接触的精确起止见 params.md contact.lifetime）。
 */
export function interpolatePose(a: Pose, b: Pose, t: number): Pose {
  const u = Math.min(1, Math.max(0, t));
  const bends = {} as Pose["bends"];
  for (const key of Object.keys(a.bends) as (keyof Pose["bends"])[]) {
    const arrA = a.bends[key];
    const arrB = b.bends[key];
    bends[key] = arrA.map((v, i) => lerp(v, arrB[i] ?? v, u));
  }
  return {
    palm: {
      transform: {
        position: lerpVec3(a.palm.transform.position, b.palm.transform.position, u),
        quaternion: nlerpQuat(a.palm.transform.quaternion, b.palm.transform.quaternion, u),
      },
      thumbBase: {
        position: lerpVec3(a.palm.thumbBase.position, b.palm.thumbBase.position, u),
        quaternion: nlerpQuat(a.palm.thumbBase.quaternion, b.palm.thumbBase.quaternion, u),
      },
    },
    bends,
    thumbCMC: {
      abduction: lerp(a.thumbCMC.abduction, b.thumbCMC.abduction, u),
      rotation: lerp(a.thumbCMC.rotation, b.thumbCMC.rotation, u),
    },
    contacts: u < 0.5 ? a.contacts : b.contacts,
  };
}
