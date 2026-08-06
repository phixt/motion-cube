import { navigate, type Route } from "../router";

const NAV: { route: Route; label: string }[] = [
  { route: "start", label: "开始" },
  { route: "game", label: "游戏" },
  { route: "editor", label: "动画编辑" },
  { route: "keymap", label: "按键设置" },
  { route: "help", label: "说明" },
];

export function navBar(current: Route): HTMLElement {
  const nav = document.createElement("nav");
  nav.className = "nav-bar";
  for (const item of NAV) {
    const a = document.createElement("button");
    a.className = "nav-link" + (item.route === current ? " active" : "");
    a.textContent = item.label;
    a.addEventListener("click", () => navigate(item.route));
    nav.appendChild(a);
  }
  return nav;
}
