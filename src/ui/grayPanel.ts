/**
 * 标灰面板：预设按钮 + 伪 3D 视图（实心等轴测主体 U/F/R，L/B/D 向各自方向半透明外投影）。
 * 视图跟随魔方实时状态（读 mesh 世界位置，底面与真实魔方一致）；
 * 支持鼠标拖拽换面与 X/Y/Z 整面翻转（仅焦点在视图上时），点击/拖选标灰。
 */
import {
  FACES,
  graySet,
  stickerWorldPos,
  type Face,
  type GrayKind,
  type GrayPreset,
  type GrayState,
  type StickerId,
} from "../cube/stickering";
import { t } from "../i18n";
import { el } from "./dom";

const NS = "http://www.w3.org/2000/svg";

const FACE_COLORS: Record<Face, string> = {
  U: "#f8f8f8",
  D: "#ffd24d",
  L: "#ff9d4d",
  R: "#e05555",
  F: "#5fbf6e",
  B: "#4a6fd4",
};
const GRAY_MUTABLE = "#8f959e";
const GRAY_IMMUTABLE = "#565c66";
const BODY_BG = "#16161c";
const PROJECT_OUT = 2.0;
const DRAG_FLIP_PX = 44;
const ISO_S = 26;

type V3 = { x: number; y: number; z: number };
type Mat3 = number[]; // 3x3 行主序

const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function applyMat(m: Mat3, v: V3): V3 {
  return {
    x: m[0] * v.x + m[1] * v.y + m[2] * v.z,
    y: m[3] * v.x + m[4] * v.y + m[5] * v.z,
    z: m[6] * v.x + m[7] * v.y + m[8] * v.z,
  };
}

function mulMat(a: Mat3, b: Mat3): Mat3 {
  const r: Mat3 = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    }
  }
  return r;
}

function rotX(s: number): Mat3 {
  return [1, 0, 0, 0, 0, -s, 0, s, 0];
}
function rotY(s: number): Mat3 {
  return [0, 0, s, 0, 1, 0, -s, 0, 0];
}
function rotZ(s: number): Mat3 {
  return [0, -s, 0, s, 0, 0, 0, 0, 1];
}

function iso(p: V3): { x: number; y: number } {
  return {
    x: (p.x - p.z) * 0.866 * ISO_S,
    y: (p.x + p.z) * 0.5 * ISO_S - p.y * ISO_S,
  };
}

const VIEW_NORMALS: Record<Face, V3> = {
  U: { x: 0, y: 1, z: 0 },
  D: { x: 0, y: -1, z: 0 },
  L: { x: -1, y: 0, z: 0 },
  R: { x: 1, y: 0, z: 0 },
  F: { x: 0, y: 0, z: 1 },
  B: { x: 0, y: 0, z: -1 },
};

const TANGENTS: Record<Face, [V3, V3]> = {
  U: [{ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }],
  D: [{ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }],
  F: [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }],
  B: [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }],
  R: [{ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }],
  L: [{ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }],
};

/** 视图方向 → 可见面（U/F/R 为主体，L/B/D 投影） */
function viewFaceOf(v: V3): Face {
  const ax = Math.abs(v.x);
  const ay = Math.abs(v.y);
  const az = Math.abs(v.z);
  if (ay >= ax && ay >= az) return v.y > 0 ? "U" : "D";
  if (ax >= ay && ax >= az) return v.x > 0 ? "R" : "L";
  return v.z > 0 ? "F" : "B";
}

/** 视图空间中某面（方向）的实心背景四边形（略外扩以覆盖棱边缝隙） */
function faceBackgroundPolygon(face: Face): V3[] {
  const n = VIEW_NORMALS[face];
  const [t1, t2] = TANGENTS[face];
  const c = { x: n.x * 1.5, y: n.y * 1.5, z: n.z * 1.5 };
  const k = 1.62;
  const corners: V3[] = [];
  for (const [a, b] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    corners.push({
      x: c.x + (t1.x * a + t2.x * b) * k,
      y: c.y + (t1.y * a + t2.y * b) * k,
      z: c.z + (t1.z * a + t2.z * b) * k,
    });
  }
  return corners;
}

function stickerPolygonView(v: V3, face: Face): V3[] {
  const n = VIEW_NORMALS[face];
  const [t1, t2] = TANGENTS[face];
  const offset = face === "U" || face === "F" || face === "R" ? 0 : PROJECT_OUT;
  const base = { x: v.x + n.x * offset, y: v.y + n.y * offset, z: v.z + n.z * offset };
  const corners: V3[] = [];
  for (const [a, b] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    corners.push({
      x: base.x + (t1.x * a + t2.x * b) * 0.5,
      y: base.y + (t1.y * a + t2.y * b) * 0.5,
      z: base.z + (t1.z * a + t2.z * b) * 0.5,
    });
  }
  return corners;
}

export type GrayPanelApi = {
  refresh: () => void;
};

export function renderGrayPanel(
  root: HTMLElement,
  opts: {
    getState: () => GrayState;
    setState: (s: GrayState) => void;
    getBase: () => Face;
    /** 当前涂灰类型：mutable（可变）/ immutable（不可变）；编辑器阶段可切换 */
    getKind: () => GrayKind;
    applyPreset: (p: GrayPreset | "clear") => void;
    getPositions: () => Map<StickerId, { x: number; y: number; z: number }>;
  },
): GrayPanelApi {
  root.innerHTML = "";

  const title = el("div", t("gray.title"), "gray-title");
  const presets = el("div", "", "gray-presets");
  const presetDefs: { p: GrayPreset | "clear"; key: string }[] = [
    { p: "cross", key: "gray.preset.cross" },
    { p: "roux-left", key: "gray.preset.roux-left" },
    { p: "roux-right", key: "gray.preset.roux-right" },
    { p: "clear", key: "gray.clear" },
  ];
  for (const d of presetDefs) {
    const b = el("button", t(d.key)) as HTMLButtonElement;
    b.className = "gray-preset";
    b.dataset.preset = d.p;
    b.addEventListener("click", () => opts.applyPreset(d.p));
    presets.appendChild(b);
  }

  const svg = document.createElementNS(NS, "svg");
  svg.classList.add("gray-net");
  svg.tabIndex = 0;

  const bodyBgs = new Map<Face, SVGPolygonElement>();
  const cells = new Map<StickerId, SVGPolygonElement>();

  // 主体背景（先建，随后画在最下层）
  for (const face of ["U", "F", "R"] as Face[]) {
    const poly = document.createElementNS(NS, "polygon");
    poly.classList.add("gray-body");
    bodyBgs.set(face, poly);
    svg.appendChild(poly);
  }
  // 54 个小面
  for (const face of FACES) {
    for (let i = 0; i < 9; i++) {
      const id = `${face}${i}` as StickerId;
      const poly = document.createElementNS(NS, "polygon");
      poly.dataset.sticker = id;
      poly.classList.add("gray-cell");
      cells.set(id, poly);
      svg.appendChild(poly);
    }
  }

  // 魔方外换面滑环：可见环 + 加宽命中带 + 四个方向点（换面与涂灰完全分离）
  const ring = document.createElementNS(NS, "ellipse");
  ring.classList.add("gray-ring");
  ring.setAttribute("fill", "none");
  ring.style.stroke = "var(--accent-base, #8ab4f8)";
  ring.setAttribute("stroke-width", "3");
  ring.setAttribute("opacity", "0.75");
  ring.setAttribute("pointer-events", "none");

  const ringHit = document.createElementNS(NS, "ellipse");
  ringHit.classList.add("gray-ring-hit");
  ringHit.setAttribute("fill", "none");
  ringHit.setAttribute("stroke", "transparent");
  ringHit.setAttribute("stroke-width", "30");
  ringHit.setAttribute("pointer-events", "stroke");
  ringHit.style.cursor = "grab";

  const handles: SVGCircleElement[] = [];
  for (const dir of ["n", "e", "s", "w"] as const) {
    const h = document.createElementNS(NS, "circle");
    h.classList.add("gray-handle");
    h.dataset.dir = dir;
    h.setAttribute("r", "7");
    h.style.fill = "var(--accent-base, #8ab4f8)";
    h.style.stroke = "var(--text-primary, #ffffff)";
    h.setAttribute("stroke-width", "1.5");
    h.style.cursor = "pointer";
    handles.push(h);
  }
  // 层级：命中带最底，可见环居中，方向点最上（保证点方向点可命中）
  svg.appendChild(ringHit);
  svg.appendChild(ring);
  for (const h of handles) svg.appendChild(h);

  let viewRot: Mat3 = [...IDENTITY];

  function flipView(axis: "x" | "y" | "z", sign: 1 | -1): void {
    const m = axis === "x" ? rotX(sign) : axis === "y" ? rotY(sign) : rotZ(sign);
    viewRot = mulMat(m, viewRot);
    refresh();
  }

  function refresh(): void {
    const state = opts.getState();
    const gray = graySet(state);
    const positions = opts.getPositions();
    // 视图位置：viewRot × 实时位置（未就绪时退回初始位置）
    const viewPos = new Map<StickerId, { v: V3; face: Face }>();
    for (const id of cells.keys()) {
      const live = positions.get(id);
      const p = live ?? stickerWorldPos(id);
      const v = applyMat(viewRot, p);
      viewPos.set(id, { v, face: viewFaceOf(v) });
    }

    // 主体背景（实心，覆盖棱边缝隙）
    for (const [face, poly] of bodyBgs) {
      const pts = faceBackgroundPolygon(face)
        .map((c) => iso(c))
        .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
        .join(" ");
      poly.setAttribute("points", pts);
      poly.setAttribute("fill", BODY_BG);
    }

    // 小面：隐藏面（投影）先画，主体后画
    for (const face of ["U", "F", "R", "D", "L", "B"] as Face[]) {
      for (let i = 0; i < 9; i++) {
        const id = `${face}${i}` as StickerId;
        const entry = viewPos.get(id);
        const poly = cells.get(id)!;
        if (!entry) continue;
        const polyFace = entry.face;
        const pts = stickerPolygonView(entry.v, polyFace)
          .map((c) => iso(c))
          .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
          .join(" ");
        poly.setAttribute("points", pts);
        // 不可变格用深灰填充区分（去掉黑色描边，与 3D 覆盖层 immutable 同色）
        poly.setAttribute(
          "fill",
          gray.has(id)
            ? state.immutable.includes(id)
              ? GRAY_IMMUTABLE
              : GRAY_MUTABLE
            : FACE_COLORS[id[0] as Face],
        );
        poly.setAttribute("opacity", polyFace === "U" || polyFace === "F" || polyFace === "R" ? "1" : "0.55");
      }
    }

    // 视图尺寸：统计全部多边形（含外投影网格）
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const collect2D = (pts: { x: number; y: number }[]) =>
      pts.forEach((p) => {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      });
    for (const poly of svg.querySelectorAll<SVGPolygonElement>("polygon")) {
      const pts = poly.getAttribute("points");
      if (!pts) continue;
      collect2D(
        pts.split(" ").map((s) => {
          const [x, y] = s.split(",").map(Number);
          return { x, y };
        }),
      );
    }
    const pad = 52; // 容纳魔方外换面滑环
    svg.setAttribute("viewBox", `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`);

    // 滑环：绕魔方投影外扩 30 单位居中，随 viewBox 更新
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const rx = (maxX - minX) / 2 + 30;
    const ry = (maxY - minY) / 2 + 30;
    for (const el of [ring, ringHit]) {
      el.setAttribute("cx", cx.toFixed(1));
      el.setAttribute("cy", cy.toFixed(1));
      el.setAttribute("rx", rx.toFixed(1));
      el.setAttribute("ry", ry.toFixed(1));
    }
    const handleOffsets: Record<string, [number, number]> = {
      n: [0, -1],
      s: [0, 1],
      e: [1, 0],
      w: [-1, 0],
    };
    for (const h of handles) {
      const [sx, sy] = handleOffsets[h.dataset.dir ?? ""] ?? [0, 0];
      h.setAttribute("cx", (cx + sx * rx).toFixed(1));
      h.setAttribute("cy", (cy + sy * ry).toFixed(1));
    }
  }

  // 交互：换面与涂灰完全分离——
  // - 小面上按下即涂灰（拖动连续涂，快速松开=切换该小面）；换面只走魔方外滑环；
  // - 滑环上拖拽换面（水平↔绕 Y、垂直↔绕 X，44px 一步）；点方向点一步翻转；
  // - 键盘 X/Y/Z 换面（焦点在视图上时生效）。
  const cellOf = (target: EventTarget | null): HTMLElement | null =>
    target instanceof Element ? target.closest<HTMLElement>("[data-sticker]") : null;
  const ringOf = (target: EventTarget | null): Element | null =>
    target instanceof Element
      ? target.closest<Element>(".gray-ring, .gray-ring-hit, .gray-handle")
      : null;
  const applyCell = (cell: HTMLElement) => {
    const id = cell.dataset.sticker as StickerId;
    const state = opts.getState();
    const has = graySet(state).has(id);
    const mutable = state.mutable.filter((s) => s !== id);
    const immutable = state.immutable.filter((s) => s !== id);
    opts.setState(
      has
        ? { mutable, immutable }
        : opts.getKind() === "immutable"
          ? { mutable, immutable: [...immutable, id] }
          : { mutable: [...mutable, id], immutable },
    );
  };

  const HANDLE_CLICK_PX = 8;
  let painting = false;
  let paintingOn = false;
  let dragging = false;
  let downHandle: string | null = null;
  let downX = 0;
  let downY = 0;
  let dragX = 0;
  let dragY = 0;
  let lastX = 0;
  let lastY = 0;

  const flipHandle = (dir: string): void => {
    if (dir === "n") flipView("x", -1);
    else if (dir === "s") flipView("x", 1);
    else if (dir === "e") flipView("y", -1);
    else if (dir === "w") flipView("y", 1);
  };

  svg.addEventListener("pointerdown", (e) => {
    svg.focus();
    if (ringOf(e.target)) {
      // 滑环：换面拖拽 / 点方向点一步翻转
      dragging = true;
      painting = false;
      downHandle =
        (e.target as Element).closest<Element>(".gray-handle")?.getAttribute("data-dir") ?? null;
      downX = e.clientX;
      downY = e.clientY;
      dragX = 0;
      dragY = 0;
      lastX = e.clientX;
      lastY = e.clientY;
      return;
    }
    const cell = cellOf(e.target);
    if (!cell) return;
    e.preventDefault();
    painting = true;
    dragging = false;
    downHandle = null;
    paintingOn = !graySet(opts.getState()).has(cell.dataset.sticker as StickerId);
    applyCell(cell);
  });

  svg.addEventListener("pointermove", (e) => {
    if (dragging) {
      if (!(e.buttons & 1)) return;
      dragX += e.clientX - lastX;
      dragY += e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      if (Math.abs(dragX) >= DRAG_FLIP_PX) {
        flipView("y", dragX > 0 ? -1 : 1);
        dragX = 0;
      }
      if (Math.abs(dragY) >= DRAG_FLIP_PX) {
        flipView("x", dragY > 0 ? 1 : -1);
        dragY = 0;
      }
      return;
    }
    if (painting && (e.buttons & 1)) {
      const cell = cellOf(e.target);
      if (!cell) return;
      const id = cell.dataset.sticker as StickerId;
      if (graySet(opts.getState()).has(id) !== paintingOn) applyCell(cell);
    }
  });

  const endGesture = (): void => {
    if (dragging && downHandle && Math.abs(lastX - downX) + Math.abs(lastY - downY) < HANDLE_CLICK_PX) {
      flipHandle(downHandle);
    }
    painting = false;
    dragging = false;
    downHandle = null;
  };
  svg.addEventListener("pointerup", endGesture);
  svg.addEventListener("pointercancel", endGesture);
  window.addEventListener("pointerup", endGesture);
  svg.addEventListener("pointerleave", endGesture);
  svg.addEventListener("keydown", (e) => {
    if (document.activeElement !== svg) return;
    const key = e.key.toLowerCase();
    const sign = e.shiftKey ? -1 : 1;
    if (key === "x" || key === "y" || key === "z") {
      e.preventDefault();
      e.stopPropagation();
      flipView(key as "x" | "y" | "z", sign);
    }
  });

  const note = el("p", t("gray.note"), "page-note");
  root.append(title, presets, svg, note);
  refresh();
  return { refresh };
}
