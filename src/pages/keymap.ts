import { t } from "../i18n";
import "../styles/pages.css";
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
import { el } from "../ui/dom";

const SPECIAL_LABEL_KEYS: Record<SpecialAction, string> = {
  undo: "keymap.special.undo",
  reset: "keymap.special.reset",
  "toggle-play": "keymap.special.play",
};

export function renderKeymapPage(root: HTMLElement): void {
  root.innerHTML = "";
  let cfg: KeymapConfig = structuredClone(loadKeymap());
  const settings: AppSettings = loadSettings();
  let capturing: string | null = null;

  const page = el("div", "", "page");
  page.prepend(navBar("keymap"));

  const title = el("h1", t("keymap.title"));
  const status = el("span", "", "save-status");
  const conflictBox = el("div", "", "conflict-box");
  conflictBox.hidden = true;

  const table = el("table", "", "keymap-table");
  const thead = el("thead");
  thead.innerHTML = `<tr><th>${t("keymap.action")}</th><th>${t("keymap.binding")}</th><th></th></tr>`;
  const tbody = el("tbody");
  table.append(thead, tbody);

  function persist() {
    saveKeymap(cfg);
    status.textContent = t("keymap.saved");
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
    sep.innerHTML = `<td colspan='3'>${t("keymap.special")}</td>`;
    tbody.appendChild(sep);
    for (const [action, b] of Object.entries(cfg.specials)) {
      tbody.appendChild(actionRow(action, b, true));
    }
    const conflicts = findConflicts(cfg);
    if (conflicts.length > 0) {
      conflictBox.hidden = false;
      conflictBox.textContent =
        t("keymap.conflictPrefix") +
        conflicts
          .map(
            (c) =>
              `${c.actions.join(` ${t("keymap.conflictAnd")} `)} ${t("keymap.conflictShare")} ${prettyBinding(c.binding)}`,
          )
          .join("；");
    } else {
      conflictBox.hidden = true;
    }
  }

  function actionRow(action: string, b: KeyBinding, isSpecial: boolean): HTMLTableRowElement {
    const tr = el("tr");
    tr.dataset.action = action;
    const tdAction = el("td", isSpecial ? t(SPECIAL_LABEL_KEYS[action as SpecialAction]) : action);
    const tdBind = el("td");
    const span = el("span", prettyBinding(b), "binding");
    const tdBtn = el("td");
    const btn = el("button", t("keymap.modify"), "rebind");
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
    if (bindCell) bindCell.textContent = t("keymap.captureHint");
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
  const cooldownLabel = el("span", t("keymap.cooldown", { ms: settings.moveCooldownMs }), "cooldown-label");
  const slider = el("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = "500";
  slider.step = "10";
  slider.value = String(settings.moveCooldownMs);
  slider.addEventListener("input", () => {
    settings.moveCooldownMs = Number(slider.value);
    saveSettings(settings);
    cooldownLabel.textContent = t("keymap.cooldown", { ms: settings.moveCooldownMs });
  });
  const settingsBox = el("div", "", "settings-box");
  settingsBox.append(cooldownLabel, slider);

  const resetBtn = el("button", t("keymap.reset"), "reset-btn");
  resetBtn.addEventListener("click", () => {
    cfg = structuredClone(DEFAULT_KEYMAP);
    persist();
    refresh();
  });

  const note = el("p", t("keymap.note"), "page-note");
  const scopeNote = el("p", t("keymap.scopeNote"), "page-note");

  page.append(title, status, conflictBox, table, settingsBox, resetBtn, note, scopeNote);
  root.appendChild(page);
  refresh();
}
