/**
 * i18n 桥接：把 motion-cube 的业务文案并入 WinUIonWeb 的注入式 i18n。
 * - locale 映射：motion-cube en → WinUIonWeb en-US
 * - 保留现有回退语义：en 目录为空时业务文案回退 zh-CN
 * - 响应式：localeRef 驱动，切换语言时所有 Vue 组件自动重渲染；
 *   同时同步 src/i18n 模块级目录（非 Vue 代码 t() 立即生效）
 */
import { reactive, ref } from "vue";
import { createI18n, type I18n, type I18nValues, type Locale } from "../vendor/winui-on-web/components/i18n/index";
import { en as mcEn } from "../i18n/locales/en";
import { zhCN as mcZhCN } from "../i18n/locales/zh-CN";
import { getLocale, setLocale, type Locale as MotionCubeLocale } from "../i18n";

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

const EXTRA: Record<Locale, Record<string, string>> = {
  "zh-CN": mcZhCN,
  // en 目录为空：先并入 zh-CN 保持 motion-cube 现有回退行为
  "en-US": { ...mcZhCN, ...mcEn },
};

/** 当前语言（响应式；App 右上角下拉框绑定此 ref） */
export const localeRef = ref<MotionCubeLocale>(getLocale());

/** 切换语言：更新响应式 i18n（Vue 组件）+ src/i18n 模块级目录（非 Vue 代码） */
export function setMotionCubeLocale(locale: MotionCubeLocale): void {
  localeRef.value = locale;
  setLocale(locale);
}

const instances: Record<MotionCubeLocale, I18n> = {
  "zh-CN": createI18n("zh-CN", EXTRA),
  en: createI18n("en-US", EXTRA),
};

export function createMotionCubeI18n(locale: MotionCubeLocale = getLocale()): I18n {
  localeRef.value = locale;
  // t 每次调用读取 localeRef：渲染期被追踪，切语言自动重渲染
  const t = (key: string, values?: I18nValues): string => instances[localeRef.value].t(key, values);
  return reactive({
    get locale(): Locale {
      return MC_TO_WINUI[localeRef.value];
    },
    t,
  }) as unknown as I18n;
}

export { i18nKey, useI18n, type I18n, type I18nValues } from "../vendor/winui-on-web/components/i18n/index";
