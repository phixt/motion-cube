/**
 * 应用正式路由（vue-router，hash history）：7 个页面当前全部走 LegacyPage 宿主，
 * 逐页迁移后已全部替换为对应页面组件（library/editor/hand 为 Vue 壳 + 旧逻辑复用）。
 */
import { createRouter, createWebHashHistory } from "vue-router";
import type { Route } from "../router";
import EditorPage from "./pages/EditorPage.vue";
import GamePage from "./pages/GamePage.vue";
import HandCalibPage from "./pages/HandCalibPage.vue";
import HelpPage from "./pages/HelpPage.vue";
import KeymapPage from "./pages/KeymapPage.vue";
import LibraryPage from "./pages/LibraryPage.vue";
import StartPage from "./pages/StartPage.vue";

export const APP_ROUTES: { name: Route; titleKey: string; icon: string }[] = [
  { name: "start", titleKey: "nav.back", icon: "\uE80F" },
  { name: "game", titleKey: "nav.game", icon: "\uE768" },
  { name: "library", titleKey: "nav.library", icon: "\uE8A5" },
  { name: "editor", titleKey: "nav.editor", icon: "\uE70F" },
  { name: "hand", titleKey: "nav.hand", icon: "\uE7EF" },
  { name: "keymap", titleKey: "nav.keymap", icon: "\uE713" },
  { name: "help", titleKey: "nav.help", icon: "\uE897" },
];

const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes: [
    { path: "/", redirect: "/start" },
    { path: "/start", name: "start", component: StartPage },
    { path: "/game", name: "game", component: GamePage },
    { path: "/keymap", name: "keymap", component: KeymapPage },
    { path: "/help", name: "help", component: HelpPage },
    { path: "/library", name: "library", component: LibraryPage },
    { path: "/editor", name: "editor", component: EditorPage },
    { path: "/hand", name: "hand", component: HandCalibPage },
    { path: "/:pathMatch(.*)*", redirect: "/start" },
  ],
});

export default router;
