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
const RULER_LENGTH = 5; // 标尺长度（块边长）
const RULER_WIDTH = 0.35; // 标尺带宽度（块边长）
const RULER_RADIUS = 1.6; // 旋转指示圆半径（块边长）

export type HandCalibViewKind = "top" | "left";
export type RulerState = { enabled: boolean; angle: number; centerU: number; centerV: number };
export type RulerOptions = { enabled: boolean; angle: number };

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
  private ruler: RulerState = { enabled: true, angle: 0, centerU: 0, centerV: -1.25 };
  private rulerChangeHandler: ((angle: number) => void) | null = null;
  private dragging: "move" | "rotate" | null = null;
  private dragGrabU = 0;
  private dragGrabV = 0;
  private ctrlActive = false;

  constructor(
    container: HTMLElement,
    cfg: HandRigConfig,
    private readonly view: HandCalibViewKind = "top",
  ) {
    this.wrapper = container;
    this.cfg = cfg;
    // 初始标尺位置：视图平面 (u,v) = (0, -1.25)（下方）
    this.ruler.centerV = -1.25;

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
      "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:hidden;";
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
  /** 标尺显示与角度（带宽度、任意角度；角度与手部数值一同固化） */
  setRuler(opts: RulerOptions): void {
    this.ruler.enabled = opts.enabled;
    this.ruler.angle = ((opts.angle % 360) + 360) % 360;
    this.drawRuler();
  }

  /** 移动标尺中心（视图平面 u/v，块边长；连续无极，二维自由拖拽） */
  moveRuler(u: number, v: number): void {
    const box = this.contentBox();
    const EDGE = CUBE_UNIT_WORLD;
    const clamp = (val: number, min: number, max: number) => Math.min(max, Math.max(min, val));
    if (this.view === "left") {
      this.ruler.centerU = clamp(u, box.min.z / EDGE, box.max.z / EDGE);
      this.ruler.centerV = clamp(v, box.min.y / EDGE, box.max.y / EDGE);
    } else {
      this.ruler.centerU = clamp(u, box.min.x / EDGE, box.max.x / EDGE);
      this.ruler.centerV = clamp(v, box.min.z / EDGE, box.max.z / EDGE);
    }
    this.drawRuler();
  }

  /** 旋转标尺到指定角度（度，0=水平/90=竖直；任意角度） */
  rotateRuler(angle: number): void {
    this.ruler.angle = ((angle % 360) + 360) % 360;
    this.drawRuler();
    this.rulerChangeHandler?.(this.ruler.angle);
  }

  getRuler(): RulerState {
    return { ...this.ruler };
  }

  /** 标尺角度变化回调（页面同步数值栏） */
  setRulerChangeHandler(fn: ((angle: number) => void) | null): void {
    this.rulerChangeHandler = fn;
  }

  /** 指针 → 视图平面坐标（u=屏幕横向，v=屏幕纵向；块边长） */
  private screenToPlane(sx: number, sy: number): { u: number; v: number } {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndcX = (sx / rect.width) * 2 - 1;
    const ndcY = 1 - (sy / rect.height) * 2;
    const w = new Vector3(ndcX, ndcY, 0).unproject(this.camera);
    const EDGE = CUBE_UNIT_WORLD;
    if (this.view === "left") return { u: w.z / EDGE, v: w.y / EDGE };
    return { u: w.x / EDGE, v: w.z / EDGE };
  }

  /** 标尺中心屏幕位置 */
  private rulerCenterScreen(): { x: number; y: number } {
    const EDGE = CUBE_UNIT_WORLD;
    if (this.view === "left") {
      return this.project(0, this.ruler.centerV * EDGE, this.ruler.centerU * EDGE);
    }
    return this.project(this.ruler.centerU * EDGE, 0, this.ruler.centerV * EDGE);
  }

  /** 指针是否靠近标尺（标尺局部坐标 ± 边距，块边长） */
  private pointerNearRuler(sx: number, sy: number): boolean {
    const pxPerUnit = this.renderer.domElement.clientWidth / (2 * this.camera.right);
    const center = this.rulerCenterScreen();
    const dx = sx - center.x;
    const dy = sy - center.y;
    const rad = (this.ruler.angle * Math.PI) / 180;
    const localX = (dx * Math.cos(rad) + dy * Math.sin(rad)) / pxPerUnit;
    const localY = (-dx * Math.sin(rad) + dy * Math.cos(rad)) / pxPerUnit;
    return (
      Math.abs(localX) < RULER_LENGTH / 2 + 1 &&
      Math.abs(localY) < RULER_WIDTH / 2 + 0.8
    );
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
    // 统一缩放：halfV 覆盖纵向内容，halfH = halfV * aspect 保证横纵 px/单位一致（不拉伸）
    if (this.view === "left") {
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

    // ---- 标尺：带宽度的真实尺子（任意角度、0..L 刻度、Ctrl 旋转） ----
    if (!this.ruler.enabled) return;

    // 每块边长对应的屏幕像素（世界单位 → 块边长 需乘 CUBE_UNIT_WORLD）
    const pxPerUnit =
      (this.renderer.domElement.clientWidth / (2 * this.camera.right)) * CUBE_UNIT_WORLD;
    const L = RULER_LENGTH;
    const W = RULER_WIDTH;
    const center = this.rulerCenterScreen();
    const g = document.createElementNS(svgNS, "g");
    g.setAttribute("class", "calib-ruler");
    g.setAttribute("transform", `translate(${center.x} ${center.y}) rotate(${this.ruler.angle})`);
    g.style.cursor = this.ctrlActive ? "grab" : "move";
    g.style.touchAction = "none";
    g.style.pointerEvents = "auto";

    // 透明命中条（加宽拖拽区）
    const hit = document.createElementNS(svgNS, "rect");
    hit.setAttribute("x", String((-L / 2 - 1) * pxPerUnit));
    hit.setAttribute("y", String((-W / 2 - 0.8) * pxPerUnit));
    hit.setAttribute("width", String((L + 2) * pxPerUnit));
    hit.setAttribute("height", String((W + 1.6) * pxPerUnit));
    hit.setAttribute("fill", "transparent");
    hit.setAttribute("pointer-events", "all");
    g.appendChild(hit);
    // 尺身带
    const band = document.createElementNS(svgNS, "rect");
    band.setAttribute("x", String((-L / 2) * pxPerUnit));
    band.setAttribute("y", String((-W / 2) * pxPerUnit));
    band.setAttribute("width", String(L * pxPerUnit));
    band.setAttribute("height", String(W * pxPerUnit));
    band.setAttribute("fill", RULER_COLOR);
    band.setAttribute("fill-opacity", "0.25");
    band.setAttribute("stroke", RULER_COLOR);
    band.setAttribute("stroke-width", "1");
    band.setAttribute("stroke-opacity", "0.6");
    g.appendChild(band);
    // 刻度：0..L，0.1 小格 / 0.5 中格 / 整数大格 + 数字（数字在带上方）
    for (let k = 0; k <= Math.floor(L * 10); k++) {
      const s = k / 10;
      const x = (s - L / 2) * pxPerUnit;
      const major = Math.abs(s - Math.round(s)) < 1e-6;
      const half = Math.abs(s - (Math.round(s) + 0.5)) < 1e-6;
      const len = major ? 12 : half ? 8 : 3;
      const tl = document.createElementNS(svgNS, "line");
      tl.setAttribute("x1", String(x));
      tl.setAttribute("y1", String(-W / 2 * pxPerUnit - len));
      tl.setAttribute("x2", String(x));
      tl.setAttribute("y2", String((-W / 2) * pxPerUnit));
      tl.setAttribute("stroke", RULER_COLOR);
      tl.setAttribute("stroke-width", major ? "1.4" : "0.7");
      tl.setAttribute("opacity", "0.7");
      g.appendChild(tl);
      if (major) {
        const t = document.createElementNS(svgNS, "text");
        t.setAttribute("x", String(x));
        t.setAttribute("y", String(-W * pxPerUnit));
        t.setAttribute("text-anchor", "middle");
        t.setAttribute("fill", LABEL_COLOR);
        t.setAttribute("font-size", "11");
        t.setAttribute("font-weight", "600");
        t.setAttribute("opacity", "0.8");
        t.setAttribute("font-family", "ui-monospace, Consolas, monospace");
        t.textContent = String(Math.round(s));
        g.appendChild(t);
      }
    }
    this.overlay.appendChild(g);

    // 手势：普通拖拽移动（二维无极）｜Ctrl 旋转（弧线双向箭头指示）
    const rect = this.renderer.domElement.getBoundingClientRect();
    const onMove = (e: PointerEvent): void => {
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      if (this.dragging === "rotate") {
        const c = this.rulerCenterScreen();
        this.rotateRuler((Math.atan2(sy - c.y, sx - c.x) * 180) / Math.PI);
      } else if (this.dragging === "move") {
        const p = this.screenToPlane(sx, sy);
        this.moveRuler(p.u - this.dragGrabU, p.v - this.dragGrabV);
      } else if (e.ctrlKey) {
        const near = this.pointerNearRuler(sx, sy);
        if (near !== this.ctrlActive) {
          this.ctrlActive = near;
          this.drawRuler();
        }
      }
    };
    const onUp = (): void => {
      this.dragging = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    g.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      if (e.ctrlKey) {
        this.dragging = "rotate";
        const c = this.rulerCenterScreen();
        this.rotateRuler((Math.atan2(sy - c.y, sx - c.x) * 180) / Math.PI);
      } else {
        this.dragging = "move";
        const p = this.screenToPlane(sx, sy);
        this.dragGrabU = p.u - this.ruler.centerU;
        this.dragGrabV = p.v - this.ruler.centerV;
      }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    });
    // 悬停（非拖拽）：Ctrl 接近标尺时显示旋转指示
    g.addEventListener("pointermove", (e) => {
      if (this.dragging) return;
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const near = e.ctrlKey && this.pointerNearRuler(sx, sy);
      if (near !== this.ctrlActive) {
        this.ctrlActive = near;
        this.drawRuler();
      }
    });

    // Ctrl 悬停旋转指示：固定半径圆 + 0..angle 弧线 + 双向箭头
    if (this.ctrlActive) {
      const R = RULER_RADIUS * pxPerUnit;
      const ind = document.createElementNS(svgNS, "g");
      ind.setAttribute("class", "calib-ruler-rotate");
      const defs = document.createElementNS(svgNS, "defs");
      const marker = document.createElementNS(svgNS, "marker");
      marker.setAttribute("id", "ruler-rotate-arrow");
      marker.setAttribute("viewBox", "0 0 10 10");
      marker.setAttribute("refX", "5");
      marker.setAttribute("refY", "5");
      marker.setAttribute("markerWidth", "6");
      marker.setAttribute("markerHeight", "6");
      marker.setAttribute("orient", "auto");
      const arrow = document.createElementNS(svgNS, "path");
      arrow.setAttribute("d", "M 0 1 L 9 5 L 0 9 z");
      arrow.setAttribute("fill", RULER_COLOR);
      marker.appendChild(arrow);
      defs.appendChild(marker);
      ind.appendChild(defs);
      const circle = document.createElementNS(svgNS, "circle");
      circle.setAttribute("cx", String(center.x));
      circle.setAttribute("cy", String(center.y));
      circle.setAttribute("r", String(R));
      circle.setAttribute("fill", "none");
      circle.setAttribute("stroke", GRID_COLOR);
      circle.setAttribute("stroke-width", "1");
      circle.setAttribute("stroke-dasharray", "4 4");
      circle.setAttribute("opacity", "0.6");
      ind.appendChild(circle);
      const rad = (this.ruler.angle * Math.PI) / 180;
      if (Math.abs(rad) > 1e-3) {
        const x2 = center.x + R * Math.cos(rad);
        const y2 = center.y + R * Math.sin(rad);
        const large = Math.abs(rad) > Math.PI ? 1 : 0;
        const arc = document.createElementNS(svgNS, "path");
        arc.setAttribute(
          "d",
          `M ${center.x + R} ${center.y} A ${R} ${R} 0 ${large} 1 ${x2} ${y2}`,
        );
        arc.setAttribute("fill", "none");
        arc.setAttribute("stroke", RULER_COLOR);
        arc.setAttribute("stroke-width", "1.4");
        arc.setAttribute("marker-start", "url(#ruler-rotate-arrow)");
        arc.setAttribute("marker-end", "url(#ruler-rotate-arrow)");
        ind.appendChild(arc);
      }
      this.overlay.appendChild(ind);
    }
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
