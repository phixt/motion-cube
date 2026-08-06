/** 用户设置持久化（localStorage）：按键配置 + 通用设置 */
import { DEFAULT_KEYMAP, deserializeKeymap, type KeymapConfig } from "./input/keymap";

const KEYMAP_KEY = "motion-cube.keymap";
const SETTINGS_KEY = "motion-cube.settings";

export type AppSettings = {
  /** 连击冷却（ms）：快速按键时的动画频率限制，0 = 关闭 */
  moveCooldownMs: number;
};

export const DEFAULT_SETTINGS: AppSettings = { moveCooldownMs: 120 };

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

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const obj = JSON.parse(raw) as Partial<AppSettings> | null;
    const ms = obj?.moveCooldownMs;
    return {
      moveCooldownMs:
        typeof ms === "number" && Number.isFinite(ms) && ms >= 0
          ? ms
          : DEFAULT_SETTINGS.moveCooldownMs,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: AppSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}
