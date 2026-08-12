/**
 * WinUI 壳的主题/材质状态：应用在 <html> 上的 class 与 localStorage 持久化。
 * 主题选择器（html.theme-light / html.theme-dark / 媒体查询）由 theme.css 提供；
 * 材质选择器（html.material-mica / html.material-acrylic）由壳的 global css 提供。
 */
export type ThemeMode = "system" | "light" | "dark";
export type MaterialMode = "mica" | "acrylic";
export type UiScale = 1 | 1.25 | 1.5 | 1.75 | 2;

export const THEME_MODES: readonly ThemeMode[] = ["system", "light", "dark"];
export const MATERIAL_MODES: readonly MaterialMode[] = ["mica", "acrylic"];
export const UI_SCALES: readonly UiScale[] = [1, 1.25, 1.5, 1.75, 2];

const THEME_KEY = "motion-cube.theme";
const MATERIAL_KEY = "motion-cube.material";
const UI_SCALE_KEY = "motion-cube.uiScale";
export const DEFAULT_UI_SCALE: UiScale = 1.5;

const readStored = <T extends string>(key: string, fallback: T, allowed: readonly T[]): T => {
  try {
    const v = localStorage.getItem(key);
    return (allowed as readonly string[]).includes(v ?? "") ? (v as T) : fallback;
  } catch {
    return fallback;
  }
};

export function loadTheme(): ThemeMode {
  return readStored(THEME_KEY, "system", THEME_MODES);
}

export function loadMaterial(): MaterialMode {
  return readStored(MATERIAL_KEY, "mica", MATERIAL_MODES);
}

export function loadUiScale(): UiScale {
  try {
    const v = Number(localStorage.getItem(UI_SCALE_KEY));
    return (UI_SCALES as readonly number[]).includes(v) ? (v as UiScale) : DEFAULT_UI_SCALE;
  } catch {
    return DEFAULT_UI_SCALE;
  }
}

export function applyTheme(mode: ThemeMode): void {
  const html = document.documentElement;
  html.classList.remove("theme-light", "theme-dark");
  if (mode === "light") html.classList.add("theme-light");
  else if (mode === "dark") html.classList.add("theme-dark");
}

export function applyMaterial(mode: MaterialMode): void {
  const html = document.documentElement;
  html.classList.remove("material-mica", "material-acrylic");
  html.classList.add(`material-${mode}`);
}

/** 高 DPI 适配：全局缩放（文本/图标/布局/3D 画布统一放大，默认 1.5x） */
export function applyUiScale(scale: UiScale): void {
  document.documentElement.style.zoom = String(scale);
}

export function cycle<T>(modes: readonly T[], current: T): T {
  return modes[(modes.indexOf(current) + 1) % modes.length];
}
