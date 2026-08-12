/** 用户设置持久化（localStorage）：按键配置 + 通用设置 */
import { DEFAULT_KEYMAP, deserializeKeymap, type KeymapConfig } from "./input/keymap";
import { DEFAULT_LOCALE, isLocale, type Locale } from "./i18n";
import { FACES, type Face } from "./cube/stickering";

const KEYMAP_KEY = "motion-cube.keymap";
const EDITOR_KEYMAP_KEY = "motion-cube.editorKeymap";
const SETTINGS_KEY = "motion-cube.settings";

export type AppSettings = {
  /** 连击冷却（ms）：快速按键时的动画频率限制，0 = 关闭 */
  moveCooldownMs: number;
  /** 界面语言（i18n 预留） */
  locale: Locale;
  /** 全局底色（预设标灰按此适配；六色底） */
  baseFace: Face;
  /** 标尺默认显示 */
  rulerEnabled: boolean;
};

export const DEFAULT_SETTINGS: AppSettings = {
  moveCooldownMs: 120,
  locale: DEFAULT_LOCALE,
  baseFace: "D",
  rulerEnabled: true,
};

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
export function loadEditorKeymap(): KeymapConfig {
  try {
    const raw = localStorage.getItem(EDITOR_KEYMAP_KEY);
    if (!raw) return DEFAULT_KEYMAP;
    return deserializeKeymap(raw) ?? DEFAULT_KEYMAP;
  } catch {
    return DEFAULT_KEYMAP;
  }
}

export function saveEditorKeymap(cfg: KeymapConfig): void {
  localStorage.setItem(EDITOR_KEYMAP_KEY, JSON.stringify(cfg));
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
      rulerEnabled:
        typeof obj?.rulerEnabled === "boolean"
          ? obj.rulerEnabled
          : DEFAULT_SETTINGS.rulerEnabled,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: AppSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}
