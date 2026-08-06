import { navBar } from "../ui/nav";

export function renderEditorPage(root: HTMLElement): void {
  root.innerHTML = "";
  const page = document.createElement("div");
  page.className = "page";
  page.innerHTML = `
    <h1>动画编辑器</h1>
    <p class="page-sub">待实现（路线见 docs/todo.md）</p>
    <ul>
      <li>稀疏关键帧 → 60fps 补帧（Timeline 数据层已就绪）</li>
      <li>手指/手掌 3D 模型与魔方同场景渲染</li>
      <li>坐标高度、吸附、起终自动路径、函数路径</li>
    </ul>
  `;
  page.prepend(navBar("editor"));
  root.appendChild(page);
}
