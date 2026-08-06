import { t } from "../i18n";
import "../styles/pages.css";
import { navBar } from "../ui/nav";

export function renderHelpPage(root: HTMLElement): void {
  root.innerHTML = "";
  const page = document.createElement("div");
  page.className = "page";
  page.innerHTML = `
    <h1>${t("help.title")}</h1>
    <h2>${t("help.project")}</h2>
    <p>${t("help.projectDesc")}</p>
    <h2>${t("help.gameOps")}</h2>
    <ul>
      <li>${t("help.opDrag")}</li>
      <li>${t("help.opKeys")}</li>
      <li>${t("help.opFormula")}</li>
      <li>${t("help.opSpeed")}</li>
    </ul>
    <h2>${t("help.editorOps")}</h2>
    <p class="page-note">${t("help.editorPlaceholder")}</p>
  `;
  page.prepend(navBar("help"));
  root.appendChild(page);
}
