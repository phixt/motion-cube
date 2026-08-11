import { createRouter, createWebHashHistory, type RouteRecordRaw } from "vue-router";
import PlaceholderPage from "./pages/PlaceholderPage.vue";

/** 与 motion-cube 现有 7 个路由对应（占位页），用于验证壳与导航。 */
export const PREVIEW_ROUTES: { name: string; titleKey: string; icon: string }[] = [
  { name: "start", titleKey: "nav.back", icon: "\uE80F" },
  { name: "game", titleKey: "nav.game", icon: "\uE768" },
  { name: "library", titleKey: "nav.library", icon: "\uE8A5" },
  { name: "editor", titleKey: "nav.editor", icon: "\uE70F" },
  { name: "hand", titleKey: "nav.hand", icon: "\uE7EF" },
  { name: "keymap", titleKey: "nav.keymap", icon: "\uE713" },
  { name: "help", titleKey: "nav.help", icon: "\uE897" },
];

const routes: RouteRecordRaw[] = PREVIEW_ROUTES.map((r) => ({
  path: `/${r.name}`,
  name: r.name,
  component: PlaceholderPage,
}));

export default createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes: [{ path: "/", redirect: "/start" }, ...routes, { path: "/:pathMatch(.*)*", redirect: "/start" }],
});
