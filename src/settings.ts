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

/** 首页视差强度：0=关闭 1=弱 2=中 3=强 */
export type ParallaxIntensity = 0 | 1 | 2 | 3;

/** 强度 → 位移乘数（不要直接用 0/1/2/3，避免“关→弱”跳跃过大） */
export const PARALLAX_SCALE = [0, 0.35, 0.7, 1] as const;

export const DEFAULT_PARALLAX_INTENSITY: ParallaxIntensity = 2;

export function normalizeParallaxIntensity(value: unknown): ParallaxIntensity {
  const n = Number(value);
  return n === 0 || n === 1 || n === 2 || n === 3
    ? (n as ParallaxIntensity)
    : DEFAULT_PARALLAX_INTENSITY;
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
};

export const DEFAULT_SETTINGS: AppSettings = {
  moveCooldownMs: 120,
  locale: DEFAULT_LOCALE,
  baseFace: "D",
  sixColorBase: true,
  rulerEnabled: true,
  parallaxIntensity: DEFAULT_PARALLAX_INTENSITY,
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
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: AppSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}
