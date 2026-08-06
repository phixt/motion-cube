import { t } from "../i18n";
import { navigate, type Route } from "../router";
import "../styles/pages.css";

/** 开始页：整体居中，无顶部导航（避免与操作按钮重复） */
export function renderStartPage(root: HTMLElement): void {
  root.innerHTML = "";
  const page = document.createElement("div");
  page.className = "page start-page";
  page.innerHTML = `
    <h1>${t("start.title")}</h1>
    <p class="page-sub">${t("start.sub")}</p>
    <div class="start-actions">
      <button data-route="game" class="primary">${t("start.play")}</button>
      <button data-route="library">${t("start.library")}</button>
      <button data-route="editor">${t("start.editor")}</button>
      <button data-route="hand">${t("start.hand")}</button>
      <button data-route="keymap">${t("start.keymap")}</button>
      <button data-route="help">${t("start.help")}</button>
    </div>
  `;
  page.querySelectorAll<HTMLElement>("[data-route]").forEach((b) => {
    b.addEventListener("click", () => navigate(b.dataset.route as Route));
  });
  root.appendChild(page);
}
