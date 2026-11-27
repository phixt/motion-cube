/** 用户设置持久化（localStorage）：按键配置 + 通用设置 */
import { ref } from "vue";
import {
  DEFAULT_EDITOR_ACTIONS,
  DEFAULT_KEYMAP,
  deserializeEditorActions,
  deserializeKeymap,
  type EditorKeymapConfig,
  type KeymapConfig,
} from "./input/keymap";
import { DEFAULT_LOCALE, isLocale, type Locale } from "./i18n";
import { FACES, type Face } from "./cube/stickering";

const KEYMAP_KEY = "motion-cube.keymap";
const EDITOR_ACTIONS_KEY = "motion-cube.editorActions";
const SETTINGS_KEY = "motion-cube.settings";
const PARALLAX_KEY = "motion-cube.parallax";
const AUDIO_KEY = "motion-cube.audio";

/** 首页视差强度：0=关闭 1=弱 2=中 3=强 */
export type ParallaxIntensity = 0 | 1 | 2 | 3;

/** 强度 → 位移乘数（不要直接用 0/1/2/3，避免“关→弱”跳跃过大） */
export const PARALLAX_SCALE = [0, 0.35, 0.7, 1] as const;

export const DEFAULT_PARALLAX_INTENSITY: ParallaxIntensity = 2;
export const DEFAULT_BGM_VOLUME = 0.35;
export const DEFAULT_SFX_VOLUME = 0.65;

export function normalizeParallaxIntensity(value: unknown): ParallaxIntensity {
  const n = Number(value);
  return n === 0 || n === 1 || n === 2 || n === 3
    ? (n as ParallaxIntensity)
    : DEFAULT_PARALLAX_INTENSITY;
}

export function normalizeVolume(value: unknown, fallback: number): number {
  const n = Number(value);
  if (typeof value !== "number" && typeof value !== "string") return fallback;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, Math.round(n * 100) / 100));
}

export type AppSettings = {
  /** 连击冷却（ms）：快速按键时的动画频率限制，0 = 关闭 */
  moveCooldownMs: number;
  /** 界面语言（i18n 预留） */
  locale: Locale;
  /** 全局底色（预设标灰按此适配；六色底） */
  baseFace: Face;
  /** 六色底双模式开关：开 = 求解/起始朝向跟随设置底；关 = 固定 D 底 */
  sixColorBase: boolean;
  /** 标尺默认显示 */
  rulerEnabled: boolean;
  /** 首页视差强度 */
  parallaxIntensity: ParallaxIntensity;
  /** 全局音频静音 */
  audioMuted: boolean;
  /** BGM 音量（0..1，默认 0.35 轻背景） */
  bgmVolume: number;
  /** SFX 音量（0..1，默认 0.65） */
  sfxVolume: number;
};

export const DEFAULT_SETTINGS: AppSettings = {
  moveCooldownMs: 120,
  locale: DEFAULT_LOCALE,
  baseFace: "D",
  sixColorBase: true,
  rulerEnabled: true,
  parallaxIntensity: DEFAULT_PARALLAX_INTENSITY,
  audioMuted: false,
  bgmVolume: DEFAULT_BGM_VOLUME,
  sfxVolume: DEFAULT_SFX_VOLUME,
};

/** 视差强度响应式来源（模块级单一来源，App 标题栏与 useParallax 共用） */
export const parallaxIntensityRef = ref<ParallaxIntensity>(
  normalizeParallaxIntensity(
    (() => {
      try {
        return localStorage.getItem(PARALLAX_KEY);
      } catch {
        return undefined;
      }
    })() ?? DEFAULT_PARALLAX_INTENSITY,
  ),
);

export function saveParallaxIntensity(v: ParallaxIntensity): void {
  parallaxIntensityRef.value = v;
  try {
    localStorage.setItem(PARALLAX_KEY, String(v));
  } catch {
    /* ignore */
  }
}

export function loadKeymap(): KeymapConfig {
  try {
    const raw = localStorage.getItem(KEYMAP_KEY);
    if (!raw) return DEFAULT_KEYMAP;
    return deserializeKeymap(raw) ?? DEFAULT_KEYMAP;
  } catch {
    return DEFAULT_KEYMAP;
  }
}

export function saveKeymap(cfg: KeymapConfig): void {
  localStorage.setItem(KEYMAP_KEY, JSON.stringify(cfg));
}

/** 编辑器快捷键独立配置（默认与游戏一致：公式键 + 特殊键语义相同） */
/** 编辑器功能键（播放/显隐/步进等，与游戏公式键分离） */
export function loadEditorActionKeys(): EditorKeymapConfig {
  try {
    const raw = localStorage.getItem(EDITOR_ACTIONS_KEY);
    if (!raw) return structuredClone(DEFAULT_EDITOR_ACTIONS);
    return deserializeEditorActions(raw) ?? structuredClone(DEFAULT_EDITOR_ACTIONS);
  } catch {
    return structuredClone(DEFAULT_EDITOR_ACTIONS);
  }
}

export function saveEditorActionKeys(cfg: EditorKeymapConfig): void {
  localStorage.setItem(EDITOR_ACTIONS_KEY, JSON.stringify(cfg));
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const obj = JSON.parse(raw) as Partial<AppSettings> | null;
    const ms = obj?.moveCooldownMs;
    const base = obj?.baseFace;
    return {
      moveCooldownMs:
        typeof ms === "number" && Number.isFinite(ms) && ms >= 0
          ? ms
          : DEFAULT_SETTINGS.moveCooldownMs,
      locale: isLocale(obj?.locale) ? obj.locale : DEFAULT_SETTINGS.locale,
      baseFace: (FACES as readonly string[]).includes(base ?? "")
        ? (base as Face)
        : DEFAULT_SETTINGS.baseFace,
      sixColorBase:
        typeof obj?.sixColorBase === "boolean"
          ? obj.sixColorBase
          : DEFAULT_SETTINGS.sixColorBase,
      rulerEnabled:
        typeof obj?.rulerEnabled === "boolean"
          ? obj.rulerEnabled
          : DEFAULT_SETTINGS.rulerEnabled,
      parallaxIntensity: normalizeParallaxIntensity(obj?.parallaxIntensity),
      audioMuted:
        typeof obj?.audioMuted === "boolean"
          ? obj.audioMuted
          : DEFAULT_SETTINGS.audioMuted,
      bgmVolume: normalizeVolume(obj?.bgmVolume, DEFAULT_SETTINGS.bgmVolume),
      sfxVolume: normalizeVolume(obj?.sfxVolume, DEFAULT_SETTINGS.sfxVolume),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: AppSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

// 音频响应式单一来源（独立 key 持久化，避免被 KeymapPage/App 的 saveSettings 覆盖）
export type BgmScopeMode = "scene" | "lock";

export type AudioSettings = {
  /** 全局静音（M 键 / 标题栏 / 音乐中心主开关） */
  muted: boolean;
  /** 背景音乐独立静音开关（与全局 M、音效开关正交） */
  bgmMuted: boolean;
  /** 提示音效独立静音开关（与全局 M、音乐开关正交） */
  sfxMuted: boolean;
  bgmVolume: number;
  sfxVolume: number;
  /** 切页音乐策略：scene = 随页面切换（开始页/工作区）；lock = 锁定当前曲目不打断 */
  bgmScope: BgmScopeMode;
};

export function loadAudioSettings(): AudioSettings {
  try {
    const raw = localStorage.getItem(AUDIO_KEY);
    if (raw) {
      const obj = JSON.parse(raw) as Partial<AudioSettings> | null;
      return {
        muted: typeof obj?.muted === "boolean" ? obj.muted : false,
        bgmMuted: typeof obj?.bgmMuted === "boolean" ? obj.bgmMuted : false,
        sfxMuted: typeof obj?.sfxMuted === "boolean" ? obj.sfxMuted : false,
        bgmVolume: normalizeVolume(obj?.bgmVolume, DEFAULT_BGM_VOLUME),
        sfxVolume: normalizeVolume(obj?.sfxVolume, DEFAULT_SFX_VOLUME),
        bgmScope: obj?.bgmScope === "lock" ? "lock" : "scene",
      };
    }
  } catch {
    /* ignore */
  }
  const legacy = loadSettings();
  return {
    muted: legacy.audioMuted,
    bgmMuted: false,
    sfxMuted: false,
    bgmVolume: legacy.bgmVolume,
    sfxVolume: legacy.sfxVolume,
    bgmScope: "scene",
  };
}

const initialAudio = loadAudioSettings();
export const audioMutedRef = ref<boolean>(initialAudio.muted);
export const bgmMutedRef = ref<boolean>(initialAudio.bgmMuted);
export const sfxMutedRef = ref<boolean>(initialAudio.sfxMuted);
export const bgmVolumeRef = ref<number>(initialAudio.bgmVolume);
export const sfxVolumeRef = ref<number>(initialAudio.sfxVolume);
export const bgmScopeRef = ref<BgmScopeMode>(initialAudio.bgmScope);

function persistAudioSettings(): void {
  try {
    localStorage.setItem(
      AUDIO_KEY,
      JSON.stringify({
        muted: audioMutedRef.value,
        bgmMuted: bgmMutedRef.value,
        sfxMuted: sfxMutedRef.value,
        bgmVolume: bgmVolumeRef.value,
        sfxVolume: sfxVolumeRef.value,
        bgmScope: bgmScopeRef.value,
      }),
    );
  } catch {
    /* ignore */
  }
}

export function setAudioMuted(muted: boolean): void {
  audioMutedRef.value = muted;
  persistAudioSettings();
}

export function toggleAudioMuted(): void {
  setAudioMuted(!audioMutedRef.value);
}

export function setBgmMuted(muted: boolean): void {
  bgmMutedRef.value = muted;
  persistAudioSettings();
}

export function toggleBgmMuted(): void {
  setBgmMuted(!bgmMutedRef.value);
}

export function setSfxMuted(muted: boolean): void {
  sfxMutedRef.value = muted;
  persistAudioSettings();
}

export function toggleSfxMuted(): void {
  setSfxMuted(!sfxMutedRef.value);
}

export function setBgmVolume(v: number): void {
  bgmVolumeRef.value = normalizeVolume(v, DEFAULT_BGM_VOLUME);
  persistAudioSettings();
}

export function setSfxVolume(v: number): void {
  sfxVolumeRef.value = normalizeVolume(v, DEFAULT_SFX_VOLUME);
  persistAudioSettings();
}

export function setBgmScope(scope: BgmScopeMode): void {
  bgmScopeRef.value = scope === "lock" ? "lock" : "scene";
  persistAudioSettings();
}
