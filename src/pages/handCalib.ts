/**
 * 手部模型标定页（docs/todo.md：手部标定页）。
 * 平铺手掌 + 块边长标尺（正交视图，单位 = 魔方块边长）。
 * 所有几何参数（各指段长/粗细、手掌、布局、整体放大）实时预览，
 * 「固化保存」写入 localStorage，编辑器 / 游戏构造 HandRigView 时自动读取。
 */
import { FINGER_ORDER, type FingerName } from "../hand/HandRig";
import { HandCalibView } from "../hand/HandCalibView";
import {
  DEFAULT_HAND_CONFIG,
  loadHandRigConfig,
  saveHandRigConfig,
  type HandRigConfig,
} from "../hand/handRigStore";
import { t } from "../i18n";
import "../styles/pages.css";
import "../styles/hand.css";
import { el } from "../ui/dom";
import { navBar } from "../ui/nav";

const FINGER_LABELS: Record<FingerName, string> = {
  thumb: t("hand.fingerThumb"),
  index: t("hand.fingerIndex"),
  middle: t("hand.fingerMiddle"),
  ring: t("hand.fingerRing"),
  pinky: t("hand.fingerPinky"),
};

const FINGER_SEGMENTS: Record<FingerName, number> = {
  thumb: 2,
  index: 3,
  middle: 3,
  ring: 3,
  pinky: 3,
};

export function renderHandCalibPage(root: HTMLElement): () => void {
  root.innerHTML = "";
  const page = el("div", "", "page");
  page.prepend(navBar("hand"));

  const title = el("h1", t("hand.title"));
  const status = el("span", "", "save-status");
  status.id = "hand-status";
  page.append(title, status);

  // ---- 布局：左预览（含标尺）｜右参数 ----
  const layout = el("div", "", "hand-calib");
  const previewWrap = el("div", "", "hand-preview-wrap");
  const preview = el("div", "", "hand-preview");
  preview.id = "hand-calib-view";
  const unitNote = el("p", t("hand.rulerUnit"), "hand-unit-note");
  const viewHint = el("p", t("hand.viewHint"), "page-note");
  previewWrap.append(preview, unitNote, viewHint);

  const controls = el("div", "", "hand-controls");
  layout.append(previewWrap, controls);
  page.appendChild(layout);
  root.appendChild(page);

  let cfg: HandRigConfig = loadHandRigConfig();
  const calib = new HandCalibView(preview, cfg);
  (globalThis as { __motionCubeHandCalib?: unknown }).__motionCubeHandCalib = { calib };

  // ---- 手指段参数（长度 / 粗细）----
  const fingerSection = el("div", "", "hand-section");
  fingerSection.appendChild(el("h3", t("hand.fingers")));
  const table = el("table", "", "hand-rig-table");
  const thead = el("tr");
  thead.appendChild(el("th", ""));
  for (const name of FINGER_ORDER) {
    const th = el("th", FINGER_LABELS[name]);
    thead.appendChild(th);
  }
  table.appendChild(thead);

  const segRows = el("tr");
  segRows.appendChild(el("td", t("hand.len"), "hand-rig-rowhead"));
  for (const name of FINGER_ORDER) {
    const td = el("td");
    for (let s = 0; s < FINGER_SEGMENTS[name]; s++) {
      td.appendChild(numInput(`len-${name}-${s}`, () => cfg.fingers[name][s].length, (v) => (cfg.fingers[name][s].length = v)));
    }
    segRows.appendChild(td);
  }
  table.appendChild(segRows);

  const widthRows = el("tr");
  widthRows.appendChild(el("td", t("hand.width"), "hand-rig-rowhead"));
  for (const name of FINGER_ORDER) {
    const td = el("td");
    for (let s = 0; s < FINGER_SEGMENTS[name]; s++) {
      td.appendChild(numInput(`width-${name}-${s}`, () => cfg.fingers[name][s].width, (v) => (cfg.fingers[name][s].width = v)));
    }
    widthRows.appendChild(td);
  }
  table.appendChild(widthRows);

  const segHeader = el("tr");
  segHeader.appendChild(el("td", ""));
  for (const name of FINGER_ORDER) {
    const td = el("td");
    const max = FINGER_SEGMENTS[name];
    const span = el("span", "", "hand-seg-label");
    span.textContent = Array.from({ length: max }, (_, i) => t("hand.seg", { n: i + 1 })).join("  ");
    td.appendChild(span);
    segHeader.appendChild(td);
  }
  table.prepend(segHeader);
  fingerSection.appendChild(table);

  // ---- 手掌 ----
  const palmSection = el("div", "", "hand-section");
  palmSection.appendChild(el("h3", t("hand.palm")));
  const palmRow = el("div", "", "hand-inline");
  palmRow.append(
    inlineNum(t("hand.palmWidth"), "palm-width", () => cfg.palm.width, (v) => (cfg.palm.width = v)),
    inlineNum(t("hand.palmHeight"), "palm-height", () => cfg.palm.height, (v) => (cfg.palm.height = v)),
    inlineNum(t("hand.palmLength"), "palm-length", () => cfg.palm.length, (v) => (cfg.palm.length = v)),
  );
  palmSection.appendChild(palmRow);

  // ---- 布局 ----
  const layoutSection = el("div", "", "hand-section");
  layoutSection.appendChild(el("h3", t("hand.layout")));
  const layoutRow = el("div", "", "hand-inline");
  layoutRow.append(
    inlineNum(t("hand.fingerSpacing"), "layout-spacing", () => cfg.fingerSpacing, (v) => (cfg.fingerSpacing = v), 0.3),
    inlineNum(`${t("hand.thumbCorner")} X`, "thumb-x", () => cfg.thumbCorner.x, (v) => (cfg.thumbCorner.x = v), -2),
    inlineNum(`${t("hand.thumbCorner")} Y`, "thumb-y", () => cfg.thumbCorner.y, (v) => (cfg.thumbCorner.y = v), -1),
    inlineNum(`${t("hand.thumbCorner")} Z`, "thumb-z", () => cfg.thumbCorner.z, (v) => (cfg.thumbCorner.z = v), -2),
  );
  layoutSection.appendChild(layoutRow);

  // ---- 整体 ----
  const scaleSection = el("div", "", "hand-section");
  scaleSection.appendChild(el("h3", t("hand.scale")));
  const scaleRow = el("div", "", "hand-inline");
  const scaleReadout = el("span", "", "hand-scale-readout");
  scaleReadout.id = "hand-scale-readout";
  scaleRow.append(
    inlineNum("", "hand-scale", () => cfg.handScale, (v) => (cfg.handScale = v), 0.3),
    scaleReadout,
  );
  scaleSection.appendChild(scaleRow);

  // ---- 操作 ----
  const actions = el("div", "", "hand-actions");
  const btnSave = el("button", t("hand.save"), "primary") as HTMLButtonElement;
  btnSave.id = "hand-save";
  const btnReset = el("button", t("hand.reset"), "") as HTMLButtonElement;
  btnReset.id = "hand-reset";
  actions.append(btnSave, btnReset);

  controls.append(fingerSection, palmSection, layoutSection, scaleSection, actions);

  // ---- 逻辑 ----
  function setStatus(s: string) {
    status.textContent = s;
  }

  function refresh() {
    calib.setConfig(cfg);
    const pinkyLen = cfg.fingers.pinky.reduce((s, seg) => s + seg.length, 0);
    scaleReadout.textContent = t("hand.scaleNote", { n: (pinkyLen * cfg.handScale).toFixed(2) });
  }

  function numInput(
    id: string,
    get: () => number,
    set: (v: number) => void,
  ): HTMLInputElement {
    const input = el("input") as HTMLInputElement;
    input.id = id;
    input.type = "number";
    input.step = "0.01";
    input.min = "0.01";
    input.value = get().toFixed(2);
    input.addEventListener("input", () => {
      const v = Number(input.value);
      if (Number.isFinite(v) && v >= 0) {
        set(v);
        refresh();
      }
    });
    return input;
  }

  function inlineNum(
    label: string,
    id: string,
    get: () => number,
    set: (v: number) => void,
    min = 0.01,
  ): HTMLElement {
    const wrap = el("label", label, "hand-inline-item");
    const input = numInput(id, get, set);
    input.min = String(min);
    wrap.appendChild(input);
    return wrap;
  }

  function syncInputs() {
    for (const name of FINGER_ORDER) {
      for (let s = 0; s < FINGER_SEGMENTS[name]; s++) {
        const len = document.getElementById(`len-${name}-${s}`) as HTMLInputElement | null;
        const wid = document.getElementById(`width-${name}-${s}`) as HTMLInputElement | null;
        if (len) len.value = cfg.fingers[name][s].length.toFixed(2);
        if (wid) wid.value = cfg.fingers[name][s].width.toFixed(2);
      }
    }
    const map: [string, () => number][] = [
      ["palm-width", () => cfg.palm.width],
      ["palm-height", () => cfg.palm.height],
      ["palm-length", () => cfg.palm.length],
      ["layout-spacing", () => cfg.fingerSpacing],
      ["thumb-x", () => cfg.thumbCorner.x],
      ["thumb-y", () => cfg.thumbCorner.y],
      ["thumb-z", () => cfg.thumbCorner.z],
      ["hand-scale", () => cfg.handScale],
    ];
    for (const [id, get] of map) {
      const input = document.getElementById(id) as HTMLInputElement | null;
      if (input) input.value = get().toFixed(2);
    }
  }

  btnSave.addEventListener("click", () => {
    saveHandRigConfig(cfg);
    setStatus(t("hand.saved"));
  });

  btnReset.addEventListener("click", () => {
    cfg = structuredClone(DEFAULT_HAND_CONFIG);
    syncInputs();
    refresh();
    setStatus(t("hand.resetOk"));
  });

  refresh();
  return () => {
    calib.dispose();
  };
}
