import { prettyBinding } from "../input/keymap";
import { loadKeymap, loadSettings } from "../settings";
import { navBar } from "../ui/nav";

export function renderHelpPage(root: HTMLElement): void {
  root.innerHTML = "";
  const cfg = loadKeymap();
  const settings = loadSettings();
  const page = document.createElement("div");
  page.className = "page";
  page.innerHTML = `
    <h1>说明</h1>
    <h2>项目</h2>
    <p>Motion Cube：魔方动作播放 / 编辑 / 查看游戏。基底为 cubing.js 3D 魔方，
    核心是手法动画编辑器（手/手指参数模型见 docs/params.md）。</p>
    <h2>游戏页操作</h2>
    <ul>
      <li>拖拽魔方区域：旋转视角</li>
      <li>按键：按当前按键配置执行魔方动作（见下）</li>
      <li>公式输入框：标准记法（支持 M/E/S、r/u 双层、x/y/z、交换子），点“应用”</li>
      <li>速度滑块：动画播放速度</li>
    </ul>
    <h2>当前按键配置</h2>
    <div id="help-keymap"></div>
    <p>连击冷却：${settings.moveCooldownMs} ms</p>
  `;
  page.prepend(navBar("help"));
  const box = page.querySelector<HTMLElement>("#help-keymap")!;
  const ul = document.createElement("ul");
  for (const [action, b] of Object.entries(cfg.moves)) {
    const li = document.createElement("li");
    li.textContent = `${action} → ${prettyBinding(b)}`;
    ul.appendChild(li);
  }
  box.appendChild(ul);
  root.appendChild(page);
}
