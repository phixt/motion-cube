/**
 * 手部外部注入 API（docs/hand-api-spec.md）：DEV 构建在编辑器页挂载
 * window.motionCubeHand，供外部脚本（DevTools 控制台 / Tauri webview.eval /
 * 用户脚本）直接驱动手部姿态与播放。只调用 HandRigView 公开接口，姿态数据
 * 一律过 technique.parsePose 深度校验，不触碰几何/数据内部。
 * B 期（WebSocket 帧流、生产 opt-in）暂缓。
 */
import { parsePose } from "../data/technique";
import { DEFAULT_FRAME_RATE, MAX_KEYFRAME_FRAME } from "../timeline/Timeline";
import { mirrorPose, type HandType, type Pose } from "./HandRig";
import type { HandRigView } from "./HandRigView";

/** 外部 API 播放帧率上限（防恶意高帧率压垮定时器） */
export const MAX_API_FPS = 240;
/** 外部 API 单次帧序列长度上限 */
export const MAX_API_FRAMES = MAX_KEYFRAME_FRAME + 1;

export type HandApiPlayOptions = { fps?: number; loop?: boolean };

export type HandApiResult = { ok: boolean; error?: string };
export type HandApiState = HandApiResult & {
  handType: HandType;
  visible: boolean;
  playing: boolean;
  pose: Pose | null;
};
export type MotionCubeHand = {
  setPose(json: unknown): HandApiResult;
  playFrames(
    frames: { frame: number; pose: unknown }[],
    opts?: HandApiPlayOptions,
  ): HandApiResult;
  stop(): HandApiResult;
  clear(): HandApiResult;
  setHandType(t: HandType): HandApiResult;
  setVisible(b: boolean): HandApiResult;
  getState(): HandApiState;
};

declare global {
  interface Window {
    motionCubeHand?: MotionCubeHand;
  }
}

/** 外部驱动所有权（P1-1）：true 表示姿态由注入 API 接管，编辑器预览/重绘不得覆盖。
 * 由 setPose / playFrames 成功接管时置位，stop / clear / 编辑器用户交互（releaseExternalDrive）归还。 */
export const externalDrive = { active: false };

/** 归还外部驱动所有权：编辑器侧在用户交互（播放/暂停、拖动播放头、改关键帧、切手型）时调用 */
export function releaseExternalDrive(): void {
  externalDrive.active = false;
}

let handView: HandRigView | null = null;
/** 镜像手（双手显示）：API 驱动主手时以 mirrorPose 同步驱动对侧 */
let mirrorView: HandRigView | null = null;
let playTimer: number | null = null;
// HandRigView 未暴露显隐 getter（公开签名受规格约束不可改），API 侧记录 setVisible 最近值
let lastVisible = true;
// setHandType 最近值（getState 用）
let lastHandType: HandType = "left";

/** 主手 + 镜像手统一驱动（镜像手取 x 镜像姿态） */
function driveBoth(pose: Pose | null): void {
  handView?.setPose(pose);
  mirrorView?.setPose(pose ? mirrorPose(pose) : null);
}

const err = (error: string): HandApiResult => ({ ok: false, error });
const ok = (): HandApiResult => ({ ok: true });

/** 定时器句柄只在模块级；unregisterHandApi 必须清理，防切页后定时器仍驱动已卸载视图 */
function stopPlayTimer(): void {
  if (playTimer !== null) {
    window.clearInterval(playTimer);
    playTimer = null;
  }
}

function tryParsePose(json: unknown): { pose?: Pose; error?: string } {
  try {
    return { pose: parsePose(json) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** 纯函数（verify-data 单测）：已流逝时间 → 目标帧。
 * loop 按跨度取模回绕（span===0 恒为始帧）；非 loop 夹到末帧（到达即停语义）。 */
export function frameAtElapsed(
  firstFrame: number,
  lastFrame: number,
  elapsedSec: number,
  fps: number,
  loop: boolean,
): number {
  const span = lastFrame - firstFrame;
  if (!(span > 0)) return firstFrame;
  const t = elapsedSec * fps;
  if (!loop) return firstFrame + Math.min(t, span);
  const wrapped = t % span;
  return firstFrame + (wrapped < 0 ? wrapped + span : wrapped);
}

/** 纯函数（verify-data 单测）：目标帧 → 帧下标。
 * 常规取「帧号 ≤ target 的最后一帧」；loop 时把周期末尾 1 帧时长（帧单位）保留给末帧——
 * 取模区间是 [first, last)，不这样处理末帧就永远轮不到（动画看起来是静止的）。 */
export function pickFrameIndex(frameNumbers: number[], target: number, loop: boolean): number {
  const n = frameNumbers.length;
  if (n === 0) return 0;
  const last = frameNumbers[n - 1];
  if (loop && target + 1 >= last) return n - 1;
  let i = 0;
  while (i + 1 < n && frameNumbers[i + 1] <= target) i++;
  return i;
}

function playFrames(
  frames: { frame: number; pose: unknown }[],
  opts?: HandApiPlayOptions,
): HandApiResult {
  if (!handView) return err("API 未挂载（需在编辑器页）");
  if (!Array.isArray(frames) || frames.length === 0) {
    return err("frames 必须为非空数组");
  }
  if (frames.length > MAX_API_FRAMES) {
    return err(`frames 数量超出上限（${MAX_API_FRAMES}）：${frames.length}`);
  }
  const fps = opts?.fps ?? DEFAULT_FRAME_RATE;
  if (!Number.isFinite(fps) || fps <= 0 || fps > MAX_API_FPS) {
    return err(`fps 必须在 (0, ${MAX_API_FPS}] 之间：${String(fps)}`);
  }
  // 先全量 parsePose 再开播：任一帧非法即整段拒绝，避免播到一半才失败
  const parsed: { frame: number; pose: Pose }[] = [];
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i] as { frame?: unknown; pose?: unknown } | null;
    if (!f || typeof f !== "object") return err(`frames[${i}] 必须为对象`);
    if (!Number.isFinite(f.frame)) return err(`frames[${i}].frame 必须为数字：${String(f.frame)}`);
    if (i > 0 && (f.frame as number) <= parsed[i - 1].frame) {
      return err(`frames[${i}].frame 必须严格升序：${String(f.frame)}`);
    }
    const { pose, error } = tryParsePose(f.pose);
    if (!pose) return err(`frames[${i}]: ${error}`);
    parsed.push({ frame: f.frame as number, pose });
  }
  const loop = opts?.loop === true;
  // 校验全部通过才接管定时器：非法调用不打断正在进行的播放
  stopPlayTimer();
  const firstFrame = parsed[0].frame;
  const lastFrame = parsed[parsed.length - 1].frame;
  const span = lastFrame - firstFrame;
  const frameNumbers = parsed.map((p) => p.frame);
  // 外部驱动接管（P1-1）：此后编辑器预览不得覆盖本 API 写的姿态
  externalDrive.active = true;
  driveBoth(parsed[0].pose);
  // 单帧片段（span===0）：没有动画可播，停在唯一姿态即可，不开定时器
  if (!(span > 0)) return ok();
  const startAt = performance.now();
  playTimer = window.setInterval(() => {
    if (!handView) {
      stopPlayTimer();
      return;
    }
    // 帧号为绝对帧号：按已流逝时间换算目标帧；loop 按跨度取模回绕（P1-2），非 loop 夹到末帧
    const target = frameAtElapsed(firstFrame, lastFrame, (performance.now() - startAt) / 1000, fps, loop);
    if (!loop && target >= lastFrame) {
      driveBoth(parsed[parsed.length - 1].pose);
      stopPlayTimer();
      return;
    }
    // 每 tick 重新定位：loop 回绕后下标必须能回退（旧实现只增不减 → 永久停末帧）；
    // 末帧在 loop 下占周期最后 1 帧（见 pickFrameIndex）
    driveBoth(parsed[pickFrameIndex(frameNumbers, target, loop)].pose);
  }, 1000 / fps);
  return ok();
}

/** 挂载 window.motionCubeHand（仅 DEV）；生产 opt-in 留 B 期。
 * mirror = 双手显示的对侧手实例：API 驱动主手时自动以镜像姿态同步驱动 */
export function registerHandApi(view: HandRigView, mirror?: HandRigView): void {
  if (!import.meta.env.DEV) return;
  handView = view;
  mirrorView = mirror ?? null;
  lastVisible = view.visible || (mirror?.visible ?? false);
  lastHandType = view.type;
  window.motionCubeHand = {
    setPose(json: unknown): HandApiResult {
      if (!handView) return err("API 未挂载（需在编辑器页）");
      const { pose, error } = tryParsePose(json);
      if (!pose) return err(error ?? "姿态非法");
      driveBoth(pose);
      // 接管成功才置位（非法调用不劫持编辑器控制权）
      externalDrive.active = true;
      return ok();
    },
    playFrames,
    stop(): HandApiResult {
      stopPlayTimer();
      externalDrive.active = false;
      return ok();
    },
    clear(): HandApiResult {
      if (!handView) return err("API 未挂载（需在编辑器页）");
      driveBoth(null);
      externalDrive.active = false;
      return ok();
    },
    setHandType(t: HandType): HandApiResult {
      if (!handView) return err("API 未挂载（需在编辑器页）");
      if (t !== "left" && t !== "right") return err(`手型非法：${String(t)}`);
      // 单手显示切换（十八轮双手固定左右实例）：left 只显左手 / right 只显右手；
      // 后续 setVisible(true) 恢复双手
      if (t === "left") {
        handView.setVisible(true);
        mirrorView?.setVisible(false);
      } else {
        handView.setVisible(false);
        mirrorView?.setVisible(true);
      }
      lastHandType = t;
      return ok();
    },
    setVisible(b: boolean): HandApiResult {
      if (!handView) return err("API 未挂载（需在编辑器页）");
      if (typeof b !== "boolean") return err(`visible 必须为布尔：${String(b)}`);
      handView.setVisible(b);
      mirrorView?.setVisible(b);
      lastVisible = b;
      return ok();
    },
    getState(): HandApiState {
      const visible = handView
        ? handView.visible || (mirrorView?.visible ?? false)
        : lastVisible;
      return {
        ok: true,
        handType: lastHandType,
        visible,
        playing: playTimer !== null,
        pose: handView?.currentPose() ?? null,
      };
    },
  };
}

/** 编辑器卸载时调用：停定时器、摘引用、删 window 挂载 */
export function unregisterHandApi(): void {
  stopPlayTimer();
  externalDrive.active = false;
  lastHandType = "left";
  lastVisible = true;
  handView = null;
  mirrorView = null;
  delete window.motionCubeHand;
}
