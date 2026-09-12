/**
 * 手部外部注入 API（docs/hand-api-spec.md）：DEV 构建在编辑器页挂载
 * window.motionCubeHand，供外部脚本（DevTools 控制台 / Tauri webview.eval /
 * 用户脚本）直接驱动手部姿态与播放。只调用 HandRigView 公开接口，姿态数据
 * 一律过 technique.parsePose 深度校验，不触碰几何/数据内部。
 * B 期（WebSocket 帧流、生产 opt-in）暂缓。
 */
import { parsePose } from "../data/technique";
import { DEFAULT_FRAME_RATE } from "../timeline/Timeline";
import type { HandType, Pose } from "./HandRig";
import type { HandRigView } from "./HandRigView";

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

let handView: HandRigView | null = null;
let playTimer: number | null = null;
// HandRigView 未暴露显隐 getter（公开签名受规格约束不可改），API 侧记录 setVisible 最近值
let lastVisible = true;

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

function playFrames(
  frames: { frame: number; pose: unknown }[],
  opts?: HandApiPlayOptions,
): HandApiResult {
  if (!handView) return err("API 未挂载（需在编辑器页）");
  if (!Array.isArray(frames) || frames.length === 0) {
    return err("frames 必须为非空数组");
  }
  const fps = opts?.fps ?? DEFAULT_FRAME_RATE;
  if (!Number.isFinite(fps) || fps <= 0) return err(`fps 必须 > 0：${String(fps)}`);
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
  let idx = 0;
  let startAt = performance.now();
  handView.setPose(parsed[0].pose);
  playTimer = window.setInterval(() => {
    if (!handView) {
      stopPlayTimer();
      return;
    }
    // 帧号为绝对帧号：按已流逝时间换算目标帧，跨帧一次性追到最新（帧间隔可不均匀）
    const target = firstFrame + ((performance.now() - startAt) / 1000) * fps;
    if (target >= lastFrame) {
      if (!loop) {
        handView.setPose(parsed[parsed.length - 1].pose);
        stopPlayTimer();
        return;
      }
      startAt = performance.now();
      idx = 0;
    }
    while (idx + 1 < parsed.length && parsed[idx + 1].frame <= target) idx++;
    handView.setPose(parsed[idx].pose);
  }, 1000 / fps);
  return ok();
}

/** 挂载 window.motionCubeHand（仅 DEV）；生产 opt-in 留 B 期 */
export function registerHandApi(view: HandRigView): void {
  if (!import.meta.env.DEV) return;
  handView = view;
  lastVisible = true;
  window.motionCubeHand = {
    setPose(json: unknown): HandApiResult {
      if (!handView) return err("API 未挂载（需在编辑器页）");
      const { pose, error } = tryParsePose(json);
      if (!pose) return err(error ?? "姿态非法");
      handView.setPose(pose);
      return ok();
    },
    playFrames,
    stop(): HandApiResult {
      stopPlayTimer();
      return ok();
    },
    clear(): HandApiResult {
      if (!handView) return err("API 未挂载（需在编辑器页）");
      handView.setPose(null);
      return ok();
    },
    setHandType(t: HandType): HandApiResult {
      if (!handView) return err("API 未挂载（需在编辑器页）");
      if (t !== "left" && t !== "right") return err(`手型非法：${String(t)}`);
      handView.setHandType(t);
      return ok();
    },
    setVisible(b: boolean): HandApiResult {
      if (!handView) return err("API 未挂载（需在编辑器页）");
      if (typeof b !== "boolean") return err(`visible 必须为布尔：${String(b)}`);
      handView.setVisible(b);
      lastVisible = b;
      return ok();
    },
    getState(): HandApiState {
      return {
        ok: true,
        handType: handView?.type ?? "right",
        visible: lastVisible,
        playing: playTimer !== null,
        pose: handView?.currentPose() ?? null,
      };
    },
  };
}

/** 编辑器卸载时调用：停定时器、摘引用、删 window 挂载 */
export function unregisterHandApi(): void {
  stopPlayTimer();
  handView = null;
  delete window.motionCubeHand;
}
