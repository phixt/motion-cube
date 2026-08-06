import {
  DEFAULT_KEYMAP,
  findConflicts,
  prettyBinding,
  type KeyBinding,
  type KeymapConfig,
  type SpecialAction,
} from "../input/keymap";
import { loadKeymap, loadSettings, saveKeymap, saveSettings, type AppSettings } from "../settings";
import { navBar } from "../ui/nav";

const SPECIAL_LABELS: Record<SpecialAction, string> = {
  undo: "撤销一步",
  reset: "重置",
  "toggle-play": "播放/暂停",
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = "", cls = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}

export function renderKeymapPage(root: HTMLElement): void {
  root.innerHTML = "";
  let cfg: KeymapConfig = structuredClone(loadKeymap());
  const settings: AppSettings = loadSettings();
  let capturing: string | null = null;

  const page = el("div", "", "page");
  page.prepend(navBar("keymap"));

  const title = el("h1", "按键设置");
  const status = el("span", "", "save-status");
  const conflictBox = el("div", "", "conflict-box");
  conflictBox.hidden = true;

  const table = el("table", "", "keymap-table");
  const thead = el("thead");
  thead.innerHTML = "<tr><th>动作</th><th>按键</th><th></th></tr>";
  const tbody = el("tbody");
  table.append(thead, tbody);

  function persist() {
    saveKeymap(cfg);
    status.textContent = "已保存";
    window.setTimeout(() => {
      status.textContent = "";
    }, 1200);
  }

  function refresh() {
    tbody.replaceChildren();
    for (const [action, b] of Object.entries(cfg.moves)) {
      tbody.appendChild(actionRow(action, b, false));
    }
    const sep = el("tr", "", "sep");
    sep.innerHTML = "<td colspan='3'>特殊动作</td>";
    tbody.appendChild(sep);
    for (const [action, b] of Object.entries(cfg.specials)) {
      tbody.appendChild(actionRow(action, b, true));
    }
    const conflicts = findConflicts(cfg);
    if (conflicts.length > 0) {
      conflictBox.hidden = false;
      conflictBox.textContent =
        "⚠ 按键冲突：" +
        conflicts
          .map((c) => `${c.actions.join(" 与 ")} 共用 ${prettyBinding(c.binding)}`)
          .join("；");
    } else {
      conflictBox.hidden = true;
    }
  }

  function actionRow(action: string, b: KeyBinding, isSpecial: boolean): HTMLTableRowElement {
    const tr = el("tr");
    tr.dataset.action = action;
    const tdAction = el("td", isSpecial ? SPECIAL_LABELS[action as SpecialAction] : action);
    const tdBind = el("td");
    const span = el("span", prettyBinding(b), "binding");
    const tdBtn = el("td");
    const btn = el("button", "修改", "rebind");
    btn.addEventListener("click", () => startCapture(tr, action, isSpecial));
    tdBind.appendChild(span);
    tdBtn.appendChild(btn);
    tr.append(tdAction, tdBind, tdBtn);
    return tr;
  }

  function startCapture(tr: HTMLTableRowElement, action: string, isSpecial: boolean) {
    cancelCapture();
    capturing = action;
    const bindCell = tr.querySelector<HTMLElement>(".binding");
    if (bindCell) bindCell.textContent = "按下新按键组合…（Esc 取消）";
    status.textContent = "";
    let spaceHeld = false;
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceHeld = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceHeld = true;
        e.preventDefault();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      capturing = null;
      if (e.code === "Escape") {
        refresh();
        return;
      }
      const nb: KeyBinding = { code: e.code, shift: e.shiftKey, space: spaceHeld };
      if (isSpecial) cfg.specials[action as SpecialAction] = nb;
      else cfg.moves[action] = nb;
      persist();
      refresh();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
  }

  function cancelCapture() {
    if (!capturing) return;
    capturing = null;
    refresh();
  }

  // 设置：连击冷却
  const cooldownLabel = el("span", `连击冷却：${settings.moveCooldownMs} ms`, "cooldown-label");
  const slider = el("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = "500";
  slider.step = "10";
  slider.value = String(settings.moveCooldownMs);
  slider.addEventListener("input", () => {
    settings.moveCooldownMs = Number(slider.value);
    saveSettings(settings);
    cooldownLabel.textContent = `连击冷却：${settings.moveCooldownMs} ms`;
  });
  const settingsBox = el("div", "", "settings-box");
  settingsBox.append(cooldownLabel, slider);

  const resetBtn = el("button", "恢复默认", "reset-btn");
  resetBtn.addEventListener("click", () => {
    cfg = structuredClone(DEFAULT_KEYMAP);
    persist();
    refresh();
  });

  const note = el(
    "p",
    "提示：Space 保留为“双层(wide)修饰键”，不能单独绑定；Shift 常作为反转修饰。连击冷却用于缓解快速按键导致的动画抽搐（体验问题 #1）。",
    "page-note",
  );

  page.append(title, status, conflictBox, table, settingsBox, resetBtn, note);
  root.appendChild(page);
  refresh();
}
