/**
 * 应用正式路由（vue-router，hash history）：7 个页面当前全部走 LegacyPage 宿主，
 * 逐页迁移后已全部替换为对应页面组件（library/editor/hand 为 Vue 壳 + 旧逻辑复用）。
 */
import { createRouter, createWebHashHistory } from "vue-router";
import type { Route } from "../router";

// 路由级懒加载：页面（尤其 cubing/three 重的 game/editor/library/hand）独立分包，
// 首屏只加载壳（WinUI 组件），缓解 main chunk 过大
const pages = {
  StartPage: () => import("./pages/StartPage.vue"),
  GamePage: () => import("./pages/GamePage.vue"),
  KeymapPage: () => import("./pages/KeymapPage.vue"),
  HelpPage: () => import("./pages/HelpPage.vue"),
  LibraryPage: () => import("./pages/LibraryPage.vue"),
  EditorPage: () => import("./pages/EditorPage.vue"),
  HandCalibPage: () => import("./pages/HandCalibPage.vue"),
};

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
    { path: "/start", name: "start", component: pages.StartPage },
    { path: "/game", name: "game", component: pages.GamePage },
    { path: "/keymap", name: "keymap", component: pages.KeymapPage },
    { path: "/help", name: "help", component: pages.HelpPage },
    { path: "/library", name: "library", component: pages.LibraryPage },
    { path: "/editor", name: "editor", component: pages.EditorPage },
    { path: "/hand", name: "hand", component: pages.HandCalibPage },
    { path: "/:pathMatch(.*)*", redirect: "/start" },
  ],
});

export default router;
