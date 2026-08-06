import { navBar } from "../ui/nav";
import { t } from "../i18n";
import "../styles/pages.css";

export function renderEditorPage(root: HTMLElement): void {
  root.innerHTML = "";
  const page = document.createElement("div");
  page.className = "page";
  page.innerHTML = `
    <h1>${t("editor.title")}</h1>
    <p class="page-sub">${t("editor.pending")}</p>
    <ul>
      <li>${t("editor.f1")}</li>
      <li>${t("editor.f2")}</li>
      <li>${t("editor.f3")}</li>
    </ul>
  `;
  page.prepend(navBar("editor"));
  root.appendChild(page);
}
