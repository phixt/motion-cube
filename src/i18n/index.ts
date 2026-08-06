/** 轻量 i18n：文案集中管理，支持参数化与未来多语言切换。 */
import { en } from "./locales/en";
import { zhCN } from "./locales/zh-CN";

export type Locale = "zh-CN" | "en";
export const LOCALES: Locale[] = ["zh-CN", "en"];
export const DEFAULT_LOCALE: Locale = "zh-CN";

const catalogs: Record<Locale, Record<string, string>> = {
  "zh-CN": zhCN,
  en,
};

let current: Locale = DEFAULT_LOCALE;

export function setLocale(locale: Locale): void {
  current = locale;
}

export function getLocale(): Locale {
  return current;
}

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as string[]).includes(v);
}

/** 取文案；缺失时回退到 zh-CN，再缺失时返回 key 本身。支持 {param} 占位。 */
export function t(key: string, params?: Record<string, string | number>): string {
  const catalog = catalogs[current] ?? zhCN;
  let s = catalog[key] ?? zhCN[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}
