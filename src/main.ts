import { createApp } from "vue";
import { setLocale } from "./i18n";
import { loadSettings } from "./settings";
import App from "./vue/App.vue";
import router from "./vue/router";
import { createMotionCubeI18n, i18nKey } from "./vue/i18n";
import { applyMaterial, applyTheme, loadMaterial, loadTheme } from "./vue/theme";

// 全局基础样式（旧页面依赖）
import "./styles/base.css";
// WinUIonWeb 主题与图标字体
import "./vendor/winui-on-web/styles/theme.css";
import "./vendor/winui-on-web/styles/animations.css";
import "./vue/styles/global.css";

const settings = loadSettings();
setLocale(settings.locale);
applyTheme(loadTheme());
applyMaterial(loadMaterial());

const i18n = createMotionCubeI18n(settings.locale);

const app = createApp(App);
app.use(router);
app.provide(i18nKey, i18n);
app.config.globalProperties.$t = i18n.t;
app.mount("#app");
