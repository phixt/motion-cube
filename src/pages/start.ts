import { navigate, type Route } from "../router";
import { navBar } from "../ui/nav";

export function renderStartPage(root: HTMLElement): void {
  root.innerHTML = "";
  const page = document.createElement("div");
  page.className = "page";
  page.innerHTML = `
    <h1>Motion Cube</h1>
    <p class="page-sub">魔方动作播放 / 编辑 / 查看 · 手法动画编辑器</p>
    <div class="start-actions">
      <button data-route="game" class="primary">进入游戏</button>
      <button data-route="editor">动画编辑器</button>
      <button data-route="keymap">按键设置</button>
      <button data-route="help">说明</button>
    </div>
  `;
  page.querySelectorAll<HTMLElement>("[data-route]").forEach((b) => {
    b.addEventListener("click", () => navigate(b.dataset.route as Route));
  });
  page.prepend(navBar("start"));
  root.appendChild(page);
}
