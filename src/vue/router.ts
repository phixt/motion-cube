/**
 * 应用正式路由（vue-router，hash history）：7 个页面当前全部走 LegacyPage 宿主，
 * 逐页迁移完成后替换为对应页面组件。
 */
import { createRouter, createWebHashHistory } from "vue-router";
import type { Route } from "../router";
import GamePage from "./pages/GamePage.vue";
import HelpPage from "./pages/HelpPage.vue";
import KeymapPage from "./pages/KeymapPage.vue";
import StartPage from "./pages/StartPage.vue";
import LegacyPage from "./LegacyPage.vue";

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
    // 以下页面尚未迁移，经 LegacyPage 宿主渲染旧实现
    { path: "/library", name: "library", component: LegacyPage, props: { route: "library" } },
    { path: "/editor", name: "editor", component: LegacyPage, props: { route: "editor" } },
    { path: "/hand", name: "hand", component: LegacyPage, props: { route: "hand" } },
    { path: "/:pathMatch(.*)*", redirect: "/start" },
  ],
});

export default router;
