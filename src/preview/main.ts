/**
 * WinUIonWeb 预览入口（阶段 3 壳的验证载体，不参与正式应用）。
 * 打开方式：npm run dev 后访问 /preview.html
 */
import { createApp } from "vue";
import App from "./App.vue";
import router from "./router";
import { createMotionCubeI18n, i18nKey } from "../vue/i18n";
import "../vendor/winui-on-web/styles/theme.css";
import "../vendor/winui-on-web/styles/animations.css";
import "../vue/styles/global.css";

const i18n = createMotionCubeI18n();

const app = createApp(App);
app.use(router);
app.provide(i18nKey, i18n);
app.config.globalProperties.$t = i18n.t;
app.mount("#app");
