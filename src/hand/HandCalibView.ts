/**
 * 手部标定视图（docs/todo.md：手部标定页）。
 * 独立 three.js 场景：正交相机「俯视 XZ 平面」（top）或「左视 YZ 平面」（left，右手拇指侧）；
 * 手掌平铺、四指伸直（几何默认 bend 180），拇指应用自然外翻（CMC 默认展收/对掌）。
 * 1 数据单位 = 1 块边长；根组按 CUBE_UNIT_WORLD 缩放 → 场景中 1 块边长 = CUBE_UNIT_WORLD。
 * 标尺为叠加在画布上的 SVG：网格每 1 块边长一格，宽/长两条轴线带刻度数字。
 * 相机固定（测量工具，不旋转），仅随容器尺寸自适应；参数变化调用 setConfig 重建。
 */
import {
  Box3,
  Group,
  OrthographicCamera,
  Scene,
  Vector3,
  WebGLRenderer,
  type Material,
  type Object3D,
} from "three";
import { createRigFromConfig, type HandRigConfig } from "./handRigStore";
import { buildHandGeometry } from "./handGeometry";
import { CUBE_UNIT_WORLD } from "./HandRigView";

// 标尺范围（单位：块边长；场景坐标 = 块边长 × EDGE）
const W_RULE = { xMin: -4, xMax: 4, z: -1.25 }; // 宽向轴线（掌宽方向），置于腕部下方
const L_RULE = { zMin: -1.4, zMax: 4.6, x: 1.55 }; // 长向轴线（手指方向），置于手侧
// 左视图标尺范围（贴合手部轮廓，避免长轴把手指挤小）
const L_RULE_LEFT = { yMin: -1.4, yMax: 1.4, zMin: -1.4, zMax: 2.6 };
const RULER_COLOR = "#8fa3b8";
const GRID_COLOR = "#66707f";
const LABEL_COLOR = "#9aa0aa";

export type HandCalibViewKind = "top" | "left";
export type RulerAxis = "horizontal" | "vertical";
export type RulerState = { enabled: boolean; axis: RulerAxis; offset: number };
export type RulerOptions = { enabled: boolean; axis: RulerAxis };

export class HandCalibView {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: OrthographicCamera;
  private readonly rootGroup = new Group();
  private readonly overlay: SVGSVGElement;
  private readonly wrapper: HTMLElement;
  private cfg: HandRigConfig;
  private readonly disposables: { obj: Object3D }[] = [];
  private readonly resizeObserver: ResizeObserver;
  private handBox: Box3 | null = null;
  private ruler: RulerState = { enabled: true, axis: "vertical", offset: 1.55 };

  constructor(
    container: HTMLElement,
    cfg: HandRigConfig,
    private readonly view: HandCalibViewKind = "top",
  ) {
    this.wrapper = container;
    this.cfg = cfg;
    // 初始标尺位置：俯视图竖直=右侧（x=1.55），左视图=左侧（-1.25）
    this.ruler.offset = view === "left" ? -1.25 : 1.55;

    // preserveDrawingBuffer：静态测量视图按需渲染，保留缓冲便于像素级 QA/截图
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    container.appendChild(this.renderer.domElement);

    this.camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    if (view === "left") {
      // 左视图：从 +X（右手拇指侧）看向 -X，屏幕上方 = 世界 +Y（指背）
      this.camera.position.set(10, 0, 0);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(0, 0, 0);
    } else {
      // 俯视图：从 +Y 看向下方，屏幕上方 = 世界 +Z（指尖方向）
      this.camera.position.set(0, 10, 0);
      this.camera.up.set(0, 0, 1);
      this.camera.lookAt(0, 0, 0);
    }

    this.rootGroup.scale.setScalar(CUBE_UNIT_WORLD);
    this.scene.add(this.rootGroup);

    this.overlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.overlay.style.cssText =
      "position:absolute;inset:0;pointer-events:none;overflow:hidden;";
    container.appendChild(this.overlay);

    this.resizeObserver = new ResizeObserver(() => this.fit());
    this.resizeObserver.observe(container);

    this.fit();
    this.setConfig(cfg);
  }

  setConfig(cfg: HandRigConfig): void {
    this.cfg = cfg;
    this.rebuild();
    this.render();
  }

  /** 标尺显示与方向（可拖拽移动、十等分刻度；方向切换不持久化，由页面按钮/Shift 控制） */
  setRuler(opts: RulerOptions): void {
    this.switchAxis(opts.axis);
    this.ruler.enabled = opts.enabled;
    this.drawRuler();
  }

  /** 拖拽移动标尺（连续无极；offset 为固定坐标，单位 = 块边长） */
  moveRuler(offset: number): void {
    const box = this.contentBox();
    const EDGE = CUBE_UNIT_WORLD;
    let min: number;
    let max: number;
    if (this.view === "left") {
      if (this.ruler.axis === "horizontal") {
        min = box.min.y / EDGE;
        max = box.max.y / EDGE;
      } else {
        min = box.min.z / EDGE;
        max = box.max.z / EDGE;
      }
    } else if (this.ruler.axis === "horizontal") {
      min = box.min.z / EDGE;
      max = box.max.z / EDGE;
    } else {
      min = box.min.x / EDGE;
      max = box.max.x / EDGE;
    }
    this.ruler.offset = Math.min(max + 0.5, Math.max(min - 0.5, offset));
    this.drawRuler();
  }

  /** 方向切换：保持标尺屏幕中心位置不变（原地旋转 90°），不重置到默认位置 */
  private switchAxis(newAxis: RulerAxis): void {
    if (newAxis === this.ruler.axis) return;
    const oldAxis = this.ruler.axis;
    const { min, max } = this.rulerRangeFor(oldAxis);
    const center = this.pointAt(oldAxis, (min + max) / 2);
    // pointAt 返回画布布局坐标，screenToNormal 按视口坐标归一，需乘缩放比
    const zoom =
      this.renderer.domElement.getBoundingClientRect().width /
      this.renderer.domElement.clientWidth;
    this.ruler.axis = newAxis;
    this.ruler.offset = this.screenToNormal(center.x * zoom, center.y * zoom, newAxis);
  }

  /** 标尺上某刻度 t（沿标尺方向）的屏幕位置（块边长坐标投影） */
  private pointAt(axis: RulerAxis, t: number): { x: number; y: number } {
    const EDGE = CUBE_UNIT_WORLD;
    if (this.view === "left") {
      return axis === "horizontal"
        ? this.project(0, this.ruler.offset * EDGE, t * EDGE)
        : this.project(0, t * EDGE, this.ruler.offset * EDGE);
    }
    return axis === "horizontal"
      ? this.project(t * EDGE, 0, this.ruler.offset * EDGE)
      : this.project(this.ruler.offset * EDGE, 0, t * EDGE);
  }

  /** 屏幕坐标 → 标尺法向坐标（块边长）；用容器 rect 尺寸归一，兼容全局 zoom */
  private screenToNormal(sx: number, sy: number, axis: RulerAxis): number {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndcX = (sx / rect.width) * 2 - 1;
    const ndcY = 1 - (sy / rect.height) * 2;
    const v = new Vector3(ndcX, ndcY, 0).unproject(this.camera);
    const EDGE = CUBE_UNIT_WORLD;
    if (this.view === "left") return (axis === "horizontal" ? v.y : v.z) / EDGE;
    return (axis === "horizontal" ? v.z : v.x) / EDGE;
  }

  getRuler(): RulerState {
    return { ...this.ruler };
  }

  /** 标尺刻度范围（沿标尺方向，整数起点/终点，块边长） */
  private rulerRangeFor(axis: RulerAxis): { min: number; max: number } {
    if (this.view === "left") {
      return axis === "horizontal" ? { min: -1, max: 3 } : { min: -1, max: 1 };
    }
    return axis === "horizontal" ? { min: -2, max: 2 } : { min: -1, max: 4 };
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.rebuild();
    this.renderer.dispose();
    try {
      this.renderer.forceContextLoss?.();
    } catch {
      // 某些 WebGL 实现无此方法，忽略
    }
    this.overlay.remove();
    this.renderer.domElement.remove();
  }

  private fit(): void {
    const w = this.wrapper.clientWidth || 640;
    const h = this.wrapper.clientHeight || 480;
    // 必须 updateStyle=true：高分屏（dpr>1）下若 canvas 保持缓冲区原始尺寸，
    // 会被容器 overflow:hidden 裁掉左上部分，居中的手看起来落在右下角
    this.renderer.setSize(w, h, true);
    const aspect = w / h;
    // 镜头中心对准「手」的包围盒中心（手始终居中）；视野覆盖 手 ∪ 标尺 + 边距
    const all = this.contentBox();
    const hand = this.handBox;
    const center = hand && !hand.isEmpty() ? hand.getCenter(new Vector3()) : all.getCenter(new Vector3());
    const margin = 0.45 * CUBE_UNIT_WORLD; // 约半格边距
    // 统一缩放：halfV 覆盖纵向内容，halfH = halfV * aspect 保证横纵 px/单位一致（不拉伸），
    // 同时 halfV >= 横向内容/aspect 确保横向也完整覆盖（窄窗口时纵向留白而非变形）
    if (this.view === "left") {
      // 屏幕横向 = 世界 Z（指尖方向），屏幕纵向 = 世界 Y（指背方向）
      const zHalf = (all.max.z - all.min.z) / 2 + margin;
      const yHalf = (all.max.y - all.min.y) / 2 + margin;
      const halfV = Math.max(yHalf, zHalf / aspect);
      const halfH = halfV * aspect;
      this.camera.left = -halfH;
      this.camera.right = halfH;
      this.camera.top = halfV;
      this.camera.bottom = -halfV;
      this.camera.position.set(10, center.y, center.z);
      this.camera.lookAt(0, center.y, center.z);
    } else {
      const zHalf = (all.max.z - all.min.z) / 2 + margin;
      const xHalf = (all.max.x - all.min.x) / 2 + margin;
      const halfV = Math.max(zHalf, xHalf / aspect);
      const halfH = halfV * aspect;
      this.camera.left = -halfH;
      this.camera.right = halfH;
      this.camera.top = halfV;
      this.camera.bottom = -halfV;
      this.camera.position.set(center.x, 10, center.z);
      this.camera.lookAt(center.x, 0, center.z);
    }
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.drawRuler();
    this.render();
  }

  private rebuild(): void {
    for (const d of this.disposables) disposeObject(d.obj);
    this.disposables.length = 0;
    for (const child of [...this.rootGroup.children]) {
      this.rootGroup.remove(child);
    }
    const rig = createRigFromConfig(this.cfg, "right");
    const built = buildHandGeometry(this.cfg, rig, 1, false, false, this.view === "left");
    // 拇指应用自然外翻（CMC 默认展收/对掌），手指保持伸直（测量用途）
    const cmc = rig.fingers.thumb.joints[0];
    built.thumbDof.rotation.z = degToRad(cmc.abduction ?? 0);
    built.thumbDof.rotation.y = degToRad((cmc.rotation ?? 0) * 1); // 标定用右手（sideSign=1）
    this.rootGroup.add(built.root);
    this.scene.updateMatrixWorld(true);
    this.handBox = new Box3().setFromObject(built.root);
    this.disposables.push({ obj: built.root });
    this.fit();
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /** 世界坐标 → 画布像素（正交相机，线性映射） */
  private project(x: number, y: number, z: number): { x: number; y: number } {
    this.camera.updateMatrixWorld();
    const v = new Vector3(x, y, z).project(this.camera);
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;
    return { x: ((v.x + 1) / 2) * w, y: (1 - (v.y + 1) / 2) * h };
  }

  /** 内容包围盒：手 ∪ 标尺（标尺锚定手掌根原点） */
  private contentBox(): Box3 {
    const EDGE = CUBE_UNIT_WORLD;
    if (this.view === "left") {
      const ruler = new Box3(
        new Vector3(0, L_RULE_LEFT.yMin * EDGE, L_RULE_LEFT.zMin * EDGE),
        new Vector3(0, L_RULE_LEFT.yMax * EDGE, L_RULE_LEFT.zMax * EDGE),
      );
      if (!this.handBox || this.handBox.isEmpty()) return ruler;
      return this.handBox.clone().union(ruler);
    }
    const ruler = new Box3(
      new Vector3(W_RULE.xMin * EDGE, 0, Math.min(W_RULE.z * EDGE, L_RULE.zMin * EDGE)),
      new Vector3(W_RULE.xMax * EDGE, 0, L_RULE.zMax * EDGE),
    );
    if (!this.handBox || this.handBox.isEmpty()) return ruler;
    return this.handBox.clone().union(ruler);
  }

  private drawRuler(): void {
    this.overlay.replaceChildren();
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;
    if (w === 0 || h === 0) return;

    const svgNS = "http://www.w3.org/2000/svg";
    const line = (parent: Element, x1: number, y1: number, x2: number, y2: number, color: string, width: number, opacity: number) => {
      const l = document.createElementNS(svgNS, "line");
      l.setAttribute("x1", String(x1));
      l.setAttribute("y1", String(y1));
      l.setAttribute("x2", String(x2));
      l.setAttribute("y2", String(y2));
      l.setAttribute("stroke", color);
      l.setAttribute("stroke-width", String(width));
      l.setAttribute("opacity", String(opacity));
      parent.appendChild(l);
    };
    const text = (parent: Element, x: number, y: number, s: string, anchor = "middle") => {
      const t = document.createElementNS(svgNS, "text");
      t.setAttribute("x", String(x));
      t.setAttribute("y", String(y));
      t.setAttribute("text-anchor", anchor);
      t.setAttribute("fill", LABEL_COLOR);
      t.setAttribute("font-size", "13");
      t.setAttribute("font-weight", "600");
      t.setAttribute("opacity", "0.7");
      t.setAttribute("font-family", "ui-monospace, Consolas, monospace");
      t.textContent = s;
      parent.appendChild(t);
    };

    const EDGE = CUBE_UNIT_WORLD; // 1 块边长（场景单位）
    const box = this.contentBox();

    // ---- 网格：静态背景，独立于标尺 ----
    if (this.view === "left") {
      for (let gy = Math.ceil(box.min.y / EDGE); gy <= Math.floor(box.max.y / EDGE); gy++) {
        const a = this.project(0, gy * EDGE, box.min.z);
        const b = this.project(0, gy * EDGE, box.max.z);
        line(this.overlay, a.x, a.y, b.x, b.y, GRID_COLOR, 0.5, 0.18);
      }
      for (let gz = Math.ceil(box.min.z / EDGE); gz <= Math.floor(box.max.z / EDGE); gz++) {
        const a = this.project(0, box.min.y, gz * EDGE);
        const b = this.project(0, box.max.y, gz * EDGE);
        line(this.overlay, a.x, a.y, b.x, b.y, GRID_COLOR, 0.5, 0.18);
      }
    } else {
      for (let gx = Math.ceil(box.min.x / EDGE); gx <= Math.floor(box.max.x / EDGE); gx++) {
        const a = this.project(gx * EDGE, 0, box.min.z);
        const b = this.project(gx * EDGE, 0, box.max.z);
        line(this.overlay, a.x, a.y, b.x, b.y, GRID_COLOR, 0.5, 0.18);
      }
      for (let gz = Math.ceil(box.min.z / EDGE); gz <= Math.floor(box.max.z / EDGE); gz++) {
        const a = this.project(box.min.x, 0, gz * EDGE);
        const b = this.project(box.max.x, 0, gz * EDGE);
        line(this.overlay, a.x, a.y, b.x, b.y, GRID_COLOR, 0.5, 0.18);
      }
    }

    // ---- 标尺：可拖拽的独立标尺条（大格 1 块边长 + 十等分小格） ----
    if (!this.ruler.enabled) return;

    const { min, max } = this.rulerRangeFor(this.ruler.axis);
    const horizontal = this.ruler.axis === "horizontal"; // 屏幕方向
    const g = document.createElementNS(svgNS, "g");
    g.setAttribute("class", "calib-ruler");
    g.style.cursor = "move";
    g.style.touchAction = "none";
    g.style.pointerEvents = "auto";

    const pointAt = (t: number): { x: number; y: number } =>
      this.pointAt(this.ruler.axis, t);

    const a = pointAt(min);
    const b = pointAt(max);
    // 透明命中条：加宽可拖拽区域（点击标尺附近即可拖动）
    const hit = document.createElementNS(svgNS, "line");
    hit.setAttribute("x1", String(a.x));
    hit.setAttribute("y1", String(a.y));
    hit.setAttribute("x2", String(b.x));
    hit.setAttribute("y2", String(b.y));
    hit.setAttribute("stroke", "transparent");
    hit.setAttribute("stroke-width", "16");
    hit.setAttribute("pointer-events", "stroke");
    g.appendChild(hit);
    line(g, a.x, a.y, b.x, b.y, RULER_COLOR, 1.4, 0.7);
    // 十等分刻度：0.1 小格 / 0.5 中格 / 1.0 大格 + 数字
    // 十等分：按整数 k/10 遍历，避免 0.1 步进浮点漂移
    for (let k = Math.ceil(min * 10); k <= Math.floor(max * 10) + 1e-9; k++) {
      const t = k / 10;
      const major = Math.abs(t - Math.round(t)) < 1e-6;
      const half = Math.abs(t - (Math.round(t) + 0.5)) < 1e-6;
      const len = major ? 14 : half ? 9 : 4;
      const p = pointAt(t);
      if (horizontal) line(g, p.x, p.y - len / 2, p.x, p.y + len / 2, RULER_COLOR, major ? 1.4 : 0.7, 0.55);
      else line(g, p.x - len / 2, p.y, p.x + len / 2, p.y, RULER_COLOR, major ? 1.4 : 0.7, 0.55);
      if (major) {
        if (horizontal) text(g, p.x + 5, p.y + 18, String(Math.round(t)), "start");
        else text(g, p.x + 7, p.y + 4, String(Math.round(t)), "start");
      }
    }
    // 拖拽手柄（端点圆点）
    const grip = document.createElementNS(svgNS, "circle");
    grip.setAttribute("cx", String(b.x));
    grip.setAttribute("cy", String(b.y));
    grip.setAttribute("r", "5");
    grip.setAttribute("fill", RULER_COLOR);
    grip.setAttribute("opacity", "0.8");
    g.appendChild(grip);
    this.overlay.appendChild(g);

    // 拖拽：window 级监听（避免 headless 下 setPointerCapture 不可靠），
    // 按指针位置连续移动标尺固定坐标（offset，块边长；无极不吸附）；
    // 记录抓取偏移，拖动不跳变
    let dragging = false;
    const rect = this.renderer.domElement.getBoundingClientRect();
    let grabDelta = 0;
    const onMove = (e: PointerEvent): void => {
      if (!dragging) return;
      this.moveRuler(
        this.screenToNormal(e.clientX - rect.left, e.clientY - rect.top, this.ruler.axis) - grabDelta,
      );
    };
    const onUp = (): void => {
      dragging = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    g.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      dragging = true;
      grabDelta =
        this.screenToNormal(e.clientX - rect.left, e.clientY - rect.top, this.ruler.axis) -
        this.ruler.offset;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    });
  }
}

function disposeObject(obj: Object3D): void {
  const materials = new Set<Material>();
  obj.traverse((node) => {
    const drawable = node as unknown as {
      isMesh?: boolean;
      isLineSegments?: boolean;
      geometry?: { dispose(): void };
      material?: Material | Material[];
    };
    if (drawable.isMesh || drawable.isLineSegments) {
      drawable.geometry?.dispose();
      const m = drawable.material;
      if (Array.isArray(m)) m.forEach((x) => materials.add(x));
      else if (m) materials.add(m);
    }
  });
  materials.forEach((m) => m.dispose());
}

const degToRad = (d: number) => (d * Math.PI) / 180;
