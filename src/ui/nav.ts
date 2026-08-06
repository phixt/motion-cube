import { navigate, type Route } from "../router";
import { t } from "../i18n";
import "../styles/pages.css";

export function navBar(current: Route): HTMLElement {
  const items: { route: Route; label: string }[] = [
    { route: "start", label: t("nav.back") },
    { route: "game", label: t("nav.game") },
    { route: "library", label: t("nav.library") },
    { route: "editor", label: t("nav.editor") },
    { route: "hand", label: t("nav.hand") },
    { route: "keymap", label: t("nav.keymap") },
    { route: "help", label: t("nav.help") },
  ];
  const nav = document.createElement("nav");
  nav.className = "nav-bar";
  for (const item of items) {
    const a = document.createElement("button");
    a.className = "nav-link" + (item.route === current ? " active" : "");
    a.textContent = item.label;
    a.addEventListener("click", () => navigate(item.route));
    nav.appendChild(a);
  }
  return nav;
}
