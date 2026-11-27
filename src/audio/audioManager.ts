/**
 * 全局音频管理器（参考 Nmoku AudioManager / AudioHubScreen，统一 A Major / F#m9 折光玻璃声景）：
 * - 三路正交静音：全局静音（M 键）+ 音乐独立开关（bgmMuted）+ 音效独立开关（sfxMuted）；
 * - 双轨 BGM：StartPage 播 `bgm_start`，其余工作区页面共享 `bgm_workspace`（工作区内切页绝不重播/中断）；
 * - 支持「随页面切换 / 锁定当前曲目」切页策略、音乐中心点击直选试听、进度拖动跳转与一键恢复场景曲；
 * - 切轨平滑 0.40s 淡入 / 0.45s 淡出并记忆断点；仅在淡入淡出期间运行 rAF，稳态零 CPU 开销；
 * - 自动适配浏览器自动播放策略（首次 pointerdown / keydown 手势平滑 0.4s 淡入解锁）与切后台自动暂停；
 * - 极简 3 SFX（solved / scramble / save），魔方常规转动与时间线拖动严格保持静音。
 */
import { watch, type WatchStopHandle } from "vue";
import {
  audioMutedRef,
  bgmMutedRef,
  bgmScopeRef,
  bgmVolumeRef,
  sfxMutedRef,
  sfxVolumeRef,
} from "../settings";

export type BgmTrackId = "start" | "workspace";
export type SfxId = "solved" | "scramble" | "save";

export type BgmTrackMeta = {
  id: BgmTrackId;
  fileBase: string;
  titleKey: string;
  descKey: string;
  badgeKey: string;
};

export const BGM_CATALOG: readonly BgmTrackMeta[] = [
  {
    id: "start",
    fileBase: "bgm_start",
    titleKey: "audio.track.startTitle",
    descKey: "audio.track.startDesc",
    badgeKey: "audio.track.startBadge",
  },
  {
    id: "workspace",
    fileBase: "bgm_workspace",
    titleKey: "audio.track.workspaceTitle",
    descKey: "audio.track.workspaceDesc",
    badgeKey: "audio.track.workspaceBadge",
  },
] as const;

export type BgmPlaybackStatus = {
  trackId: BgmTrackId | null;
  playing: boolean;
  currentSec: number;
  durationSec: number;
  isManualPreview: boolean;
  effectiveMuted: boolean;
};

const FADE_IN_SEC = 0.4;
const FADE_OUT_SEC = 0.45;

type TrackState = {
  id: BgmTrackId;
  audio: HTMLAudioElement;
  linVol: number;
  targetVol: number;
  resumeSec: number;
};

let initialized = false;
let unlocked = false;
let activeTrackId: BgmTrackId | null = null;
let lastSceneRoute: unknown = "start";
let manualPreview = false;
let bgmTracks: Record<BgmTrackId, TrackState> | null = null;
let sfxPool: Record<SfxId, HTMLAudioElement> | null = null;
let fadeRaf = 0;
let lastFadeTs = 0;
let stopWatchers: WatchStopHandle[] = [];
let gestureCleanup: (() => void) | null = null;
let visibilityHandler: (() => void) | null = null;

function pickAudioExt(): "ogg" | "mp3" {
  if (typeof Audio === "undefined") return "ogg";
  try {
    const probe = new Audio();
    const canOgg = probe.canPlayType('audio/ogg; codecs="vorbis"');
    if (canOgg === "probably" || canOgg === "maybe") return "ogg";
  } catch {
    /* ignore */
  }
  return "mp3";
}

function assetUrl(baseName: string, ext: "ogg" | "mp3"): string {
  const base = import.meta.env.BASE_URL || "/";
  const prefix = base.endsWith("/") ? base : `${base}/`;
  return `${prefix}audio/${baseName}.${ext}`;
}

export function audioAssetPath(fileName: string): string {
  const base = import.meta.env.BASE_URL || "/";
  const prefix = base.endsWith("/") ? base : `${base}/`;
  return `${prefix}audio/${fileName}`;
}

export function routeToBgmTrack(routeName: unknown): BgmTrackId {
  return routeName === "start" ? "start" : "workspace";
}

function isBgmEffectivelyMuted(): boolean {
  return audioMutedRef.value || bgmMutedRef.value || bgmVolumeRef.value <= 0.001;
}

function effectiveBgmMaster(): number {
  if (audioMutedRef.value || bgmMutedRef.value) return 0;
  if (typeof document !== "undefined" && document.hidden) return 0;
  return bgmVolumeRef.value;
}

function stopFadeLoop(): void {
  if (fadeRaf) {
    cancelAnimationFrame(fadeRaf);
    fadeRaf = 0;
  }
}

function applyVolumesAndScheduleFade(): void {
  if (!bgmTracks) return;
  const master = effectiveBgmMaster();
  let needsFade = false;

  for (const st of Object.values(bgmTracks)) {
    const want = unlocked && st.id === activeTrackId && master > 0 ? 1 : 0;
    st.targetVol = want;

    if (want > 0 && st.audio.paused) {
      if (st.resumeSec > 0.05 && Number.isFinite(st.audio.duration)) {
        st.audio.currentTime = Math.min(st.resumeSec, Math.max(0, st.audio.duration - 0.5));
      }
      st.audio.volume = Math.max(0, Math.min(1, st.linVol * master));
      const p = st.audio.play();
      if (p && typeof p.catch === "function") {
        p.catch(() => {
          unlocked = false;
          armUnlockGesture();
        });
      }
    }

    if (Math.abs(st.linVol - st.targetVol) > 0.001) {
      needsFade = true;
    } else {
      st.linVol = st.targetVol;
      st.audio.volume = Math.max(0, Math.min(1, st.linVol * master));
      if (st.targetVol <= 0 && !st.audio.paused) {
        st.resumeSec = st.audio.currentTime;
        st.audio.pause();
      }
    }
  }

  if (needsFade && !fadeRaf) {
    lastFadeTs = performance.now();
    fadeRaf = requestAnimationFrame(fadeTick);
  }
}

function fadeTick(now: number): void {
  fadeRaf = 0;
  if (!bgmTracks) return;
  const dt = Math.min(0.1, Math.max(0.001, (now - lastFadeTs) / 1000));
  lastFadeTs = now;

  const master = effectiveBgmMaster();
  let stillFading = false;

  for (const st of Object.values(bgmTracks)) {
    if (Math.abs(st.linVol - st.targetVol) > 0.001) {
      const rate = 1 / (st.targetVol > st.linVol ? FADE_IN_SEC : FADE_OUT_SEC);
      if (st.targetVol > st.linVol) {
        st.linVol = Math.min(st.targetVol, st.linVol + rate * dt);
      } else {
        st.linVol = Math.max(st.targetVol, st.linVol - rate * dt);
      }
      if (st.targetVol <= 0 && st.linVol < 0.002) st.linVol = 0;
    }

    st.audio.volume = Math.max(0, Math.min(1, st.linVol * master));

    if (st.targetVol <= 0 && st.linVol <= 0) {
      if (!st.audio.paused) {
        st.resumeSec = st.audio.currentTime;
        st.audio.pause();
      }
    } else if (Math.abs(st.linVol - st.targetVol) > 0.001) {
      stillFading = true;
    }
  }

  if (stillFading) {
    fadeRaf = requestAnimationFrame(fadeTick);
  }
}

function disarmUnlockGesture(): void {
  gestureCleanup?.();
  gestureCleanup = null;
}

function armUnlockGesture(): void {
  if (gestureCleanup || typeof window === "undefined") return;
  const onGesture = () => {
    disarmUnlockGesture();
    if (!initialized) return;
    unlocked = true;
    applyVolumesAndScheduleFade();
  };
  window.addEventListener("pointerdown", onGesture, { capture: true, passive: true });
  window.addEventListener("keydown", onGesture, { capture: true, passive: true });
  gestureCleanup = () => {
    window.removeEventListener("pointerdown", onGesture, true);
    window.removeEventListener("keydown", onGesture, true);
  };
}

/** 初始化全局音频系统（在 App.vue onMounted 中调用一次） */
export function initAudio(initialRouteName?: unknown): void {
  if (initialized || typeof Audio === "undefined") return;
  initialized = true;

  const ext = pickAudioExt();
  const makeBgm = (id: BgmTrackId, fileBase: string): TrackState => {
    const audio = new Audio(assetUrl(fileBase, ext));
    audio.loop = true;
    audio.preload = "metadata";
    audio.volume = 0;
    return { id, audio, linVol: 0, targetVol: 0, resumeSec: 0 };
  };

  bgmTracks = {
    start: makeBgm("start", "bgm_start"),
    workspace: makeBgm("workspace", "bgm_workspace"),
  };

  const makeSfx = (fileBase: string): HTMLAudioElement => {
    const a = new Audio(assetUrl(fileBase, ext));
    a.preload = "auto";
    return a;
  };

  sfxPool = {
    solved: makeSfx("sfx_solved"),
    scramble: makeSfx("sfx_scramble"),
    save: makeSfx("sfx_save"),
  };

  lastSceneRoute = initialRouteName && initialRouteName !== "audio" ? initialRouteName : "start";
  activeTrackId = routeToBgmTrack(lastSceneRoute);
  manualPreview = false;

  // 监听静音、独立音乐开关、音量、切页策略变化
  stopWatchers = [
    watch([audioMutedRef, bgmMutedRef, bgmVolumeRef], () => {
      if (!bgmTracks) return;
      const master = effectiveBgmMaster();
      if (master > 0 && !unlocked) {
        unlocked = true;
        disarmUnlockGesture();
      }
      applyVolumesAndScheduleFade();
    }),
    watch(bgmScopeRef, (scope) => {
      if (scope === "scene" && !manualPreview) {
        const sceneTrack = routeToBgmTrack(lastSceneRoute);
        if (activeTrackId !== sceneTrack) {
          activeTrackId = sceneTrack;
          applyVolumesAndScheduleFade();
        }
      }
    }),
  ];

  visibilityHandler = () => {
    if (!initialized) return;
    applyVolumesAndScheduleFade();
  };
  document.addEventListener("visibilitychange", visibilityHandler);

  unlocked = true;
  applyVolumesAndScheduleFade();
}

/** 路由变化时切换目标 BGM 轨（进入 #/audio 保持原曲不断线；lock 模式全站锁曲不打断） */
export function setAudioRoute(routeName: unknown): void {
  if (routeName === "audio") return;
  lastSceneRoute = routeName ?? "start";
  if (bgmScopeRef.value === "lock") return;
  manualPreview = false;
  const nextTrack = routeToBgmTrack(routeName);
  if (activeTrackId === nextTrack) return;
  activeTrackId = nextTrack;
  if (!initialized) return;
  applyVolumesAndScheduleFade();
}

/** 音乐浏览页直选曲目试听（交叉淡化、从头起播；若当前未静音则立即生效） */
export function previewBgmTrack(trackId: BgmTrackId): void {
  if (!initialized || !bgmTracks) return;
  manualPreview = true;
  unlocked = true;
  disarmUnlockGesture();

  const target = bgmTracks[trackId];
  if (activeTrackId === trackId) {
    // 点击当前正在播的曲目：若已暂停则续播，否则保持顺畅播放
    if (target.audio.paused && effectiveBgmMaster() > 0) {
      applyVolumesAndScheduleFade();
    }
    return;
  }

  target.resumeSec = 0;
  try {
    target.audio.currentTime = 0;
  } catch {
    /* ignore before metadata */
  }
  activeTrackId = trackId;
  applyVolumesAndScheduleFade();
}

/** 音乐浏览页「恢复当前场景曲」 */
export function restoreSceneBgm(): void {
  manualPreview = false;
  const sceneTrack = routeToBgmTrack(lastSceneRoute);
  if (activeTrackId === sceneTrack) {
    if (initialized) applyVolumesAndScheduleFade();
    return;
  }
  activeTrackId = sceneTrack;
  if (!initialized) return;
  applyVolumesAndScheduleFade();
}

/** 音乐浏览页拖动进度条跳转 */
export function seekBgm(seconds: number): void {
  if (!bgmTracks || !activeTrackId) return;
  const st = bgmTracks[activeTrackId];
  const dur = st.audio.duration;
  if (!Number.isFinite(dur) || dur <= 0.1) return;
  const clamped = Math.max(0, Math.min(dur - 0.05, seconds));
  st.audio.currentTime = clamped;
  st.resumeSec = clamped;
}

/** 读取当前主在播 BGM 轨实时状态（供音乐浏览页进度条与曲目高亮刷新） */
export function getBgmPlaybackStatus(): BgmPlaybackStatus {
  if (!bgmTracks || !activeTrackId) {
    return {
      trackId: null,
      playing: false,
      currentSec: 0,
      durationSec: 0,
      isManualPreview: manualPreview,
      effectiveMuted: isBgmEffectivelyMuted(),
    };
  }
  const st = bgmTracks[activeTrackId];
  const dur = Number.isFinite(st.audio.duration) ? st.audio.duration : 0;
  const cur = Number.isFinite(st.audio.currentTime) ? st.audio.currentTime : st.resumeSec;
  return {
    trackId: activeTrackId,
    playing: !st.audio.paused && !isBgmEffectivelyMuted(),
    currentSec: cur,
    durationSec: dur,
    isManualPreview: manualPreview,
    effectiveMuted: isBgmEffectivelyMuted(),
  };
}

/** 触发极简 3 SFX（solved / scramble / save）；同时受全局静音 M 与音效独立开关约束 */
export function playSfx(id: SfxId): void {
  if (!initialized || !sfxPool || audioMutedRef.value || sfxMutedRef.value) return;
  const vol = sfxVolumeRef.value;
  if (vol <= 0.001) return;
  const a = sfxPool[id];
  if (!a) return;
  try {
    a.currentTime = 0;
    a.volume = Math.max(0, Math.min(1, vol));
    const p = a.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch {
    /* ignore */
  }
}

/** 卸载清理（App.vue onBeforeUnmount） */
export function disposeAudio(): void {
  if (!initialized) return;
  initialized = false;
  unlocked = false;
  manualPreview = false;
  stopFadeLoop();
  disarmUnlockGesture();
  if (visibilityHandler) {
    document.removeEventListener("visibilitychange", visibilityHandler);
    visibilityHandler = null;
  }
  for (const stop of stopWatchers) stop();
  stopWatchers = [];
  if (bgmTracks) {
    for (const st of Object.values(bgmTracks)) {
      st.audio.pause();
      st.audio.src = "";
    }
    bgmTracks = null;
  }
  if (sfxPool) {
    for (const a of Object.values(sfxPool)) {
      a.pause();
      a.src = "";
    }
    sfxPool = null;
  }
  activeTrackId = null;
}

/** 仅供调试/测试读取当前音频轨与解锁态 */
export function getAudioDebugState(): {
  initialized: boolean;
  unlocked: boolean;
  activeTrack: BgmTrackId | null;
  muted: boolean;
  bgmMuted: boolean;
  sfxMuted: boolean;
  bgmVolume: number;
  sfxVolume: number;
  bgmScope: string;
} {
  return {
    initialized,
    unlocked,
    activeTrack: activeTrackId,
    muted: audioMutedRef.value,
    bgmMuted: bgmMutedRef.value,
    sfxMuted: sfxMutedRef.value,
    bgmVolume: bgmVolumeRef.value,
    sfxVolume: sfxVolumeRef.value,
    bgmScope: bgmScopeRef.value,
  };
}
