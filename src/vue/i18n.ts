/**
 * i18n 桥接：把 motion-cube 的业务文案并入 WinUIonWeb 的注入式 i18n。
 * - locale 映射：motion-cube en → WinUIonWeb en-US
 * - 保留现有回退语义：en 目录为空时业务文案回退 zh-CN
 */
import { createI18n, type I18n, type I18nValues, type Locale } from "../vendor/winui-on-web/components/i18n/index";
import { en as mcEn } from "../i18n/locales/en";
import { zhCN as mcZhCN } from "../i18n/locales/zh-CN";
import { getLocale, type Locale as MotionCubeLocale } from "../i18n";

declare module "vue" {
  interface ComponentCustomProperties {
    $t: (key: string, values?: I18nValues) => string;
  }
}

/** motion-cube locale → WinUIonWeb locale */
const MC_TO_WINUI: Record<MotionCubeLocale, Locale> = {
  "zh-CN": "zh-CN",
  en: "en-US",
};

export function createMotionCubeI18n(locale: MotionCubeLocale = getLocale()): I18n {
  return createI18n(MC_TO_WINUI[locale], {
    "zh-CN": mcZhCN,
    // en 目录为空：先并入 zh-CN 保持 motion-cube 现有回退行为
    "en-US": { ...mcZhCN, ...mcEn },
  });
}

export { i18nKey, useI18n, type I18n, type I18nValues } from "../vendor/winui-on-web/components/i18n/index";
