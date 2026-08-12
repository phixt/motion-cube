/**
 * 手部标定视图（docs/todo.md：手部标定页）。
 * 独立 three.js 场景：正交相机「俯视 XZ 平面」（top）或「左视 YZ 平面」（left，左手拇指侧）；
 * 手掌平铺、四指伸直（几何默认 bend 180），拇指应用自然外翻（CMC 默认展收/对掌）。
 * 1 数据单位 = 1 块边长；根组按 CUBE_UNIT_WORLD 缩放 → 场景中 1 块边长 = CUBE_UNIT_WORLD。
 * 标尺为叠加在画布上的 SVG：网格每 1 块边长一格，宽/长两条轴线带刻度数字。
 * 相机固定（测量工具，不旋转），仅随容器尺寸自适应；参数变化调用 setConfig 重建。
 */
import {
  Box3,
  Group,
  Mesh,
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
const RULER_COLOR = "#8fa3b8";
const GRID_COLOR = "#66707f";
const LABEL_COLOR = "#9aa0aa";

export type HandCalibViewKind = "top" | "left";

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

  constructor(
    container: HTMLElement,
    cfg: HandRigConfig,
    private readonly view: HandCalibViewKind = "top",
  ) {
    this.wrapper = container;
    this.cfg = cfg;

    // preserveDrawingBuffer：静态测量视图按需渲染，保留缓冲便于像素级 QA/截图
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    container.appendChild(this.renderer.domElement);

    this.camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    if (view === "left") {
      // 左视图：从 +X（左手拇指侧）看向 -X，屏幕上方 = 世界 +Y（指背）
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
    if (this.view === "left") {
      // 屏幕横向 = 世界 Z（指尖方向），屏幕纵向 = 世界 Y（指背方向）
      const zSpan = Math.max(Math.abs(all.min.z - center.z), Math.abs(all.max.z - center.z));
      const ySpan = Math.max(Math.abs(all.min.y - center.y), Math.abs(all.max.y - center.y));
      const vy = ySpan + margin;
      const hx = Math.max(zSpan + margin, vy * aspect);
      this.camera.left = -hx;
      this.camera.right = hx;
      this.camera.top = vy;
      this.camera.bottom = -vy;
      this.camera.position.set(10, center.y, center.z);
      this.camera.lookAt(0, center.y, center.z);
    } else {
      const zSpan = Math.max(Math.abs(all.min.z - center.z), Math.abs(all.max.z - center.z));
      const xSpan = Math.max(Math.abs(all.min.x - center.x), Math.abs(all.max.x - center.x));
      const vy = zSpan + margin;
      const hx = Math.max(xSpan + margin, vy * aspect);
      this.camera.left = -hx;
      this.camera.right = hx;
      this.camera.top = vy;
      this.camera.bottom = -vy;
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
    const rig = createRigFromConfig(this.cfg, "left");
    const built = buildHandGeometry(this.cfg, rig, 1, false);
    // 拇指应用自然外翻（CMC 默认展收/对掌），手指保持伸直（测量用途）
    const cmc = rig.fingers.thumb.joints[0];
    built.thumbDof.rotation.z = degToRad(cmc.abduction ?? 0);
    built.thumbDof.rotation.y = degToRad(cmc.rotation ?? 0);
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
    const line = (x1: number, y1: number, x2: number, y2: number, color: string, width: number, opacity: number) => {
      const l = document.createElementNS(svgNS, "line");
      l.setAttribute("x1", String(x1));
      l.setAttribute("y1", String(y1));
      l.setAttribute("x2", String(x2));
      l.setAttribute("y2", String(y2));
      l.setAttribute("stroke", color);
      l.setAttribute("stroke-width", String(width));
      l.setAttribute("opacity", String(opacity));
      this.overlay.appendChild(l);
    };
    const text = (x: number, y: number, s: string, anchor = "middle") => {
      const t = document.createElementNS(svgNS, "text");
      t.setAttribute("x", String(x));
      t.setAttribute("y", String(y));
      t.setAttribute("text-anchor", anchor);
      t.setAttribute("fill", LABEL_COLOR);
      t.setAttribute("font-size", "10");
      t.setAttribute("font-family", "ui-monospace, Consolas, monospace");
      t.textContent = s;
      this.overlay.appendChild(t);
    };

    const EDGE = CUBE_UNIT_WORLD; // 1 块边长（场景单位）
    const box = this.contentBox();
    if (this.view === "left") {
      // 左视图标尺：YZ 网格 + 高（Y）轴 + 长（Z）轴
      const gyMin = Math.ceil(box.min.y / EDGE);
      const gyMax = Math.floor(box.max.y / EDGE);
      for (let gy = gyMin; gy <= gyMax; gy++) {
        const a = this.project(0, gy * EDGE, box.min.z);
        const b = this.project(0, gy * EDGE, box.max.z);
        line(a.x, a.y, b.x, b.y, GRID_COLOR, 0.5, 0.12);
      }
      const gzMin = Math.ceil(box.min.z / EDGE);
      const gzMax = Math.floor(box.max.z / EDGE);
      for (let gz = gzMin; gz <= gzMax; gz++) {
        const a = this.project(0, box.min.y, gz * EDGE);
        const b = this.project(0, box.max.y, gz * EDGE);
        line(a.x, a.y, b.x, b.y, GRID_COLOR, 0.5, 0.12);
      }
      // 高轴（沿 Y，z = -1.25）
      {
        const a = this.project(0, -1.4 * EDGE, -1.25 * EDGE);
        const b = this.project(0, 2.6 * EDGE, -1.25 * EDGE);
        line(a.x, a.y, b.x, b.y, RULER_COLOR, 1.2, 0.85);
        for (let t = -1; t <= 2.5; t += 0.5) {
          const p = this.project(0, t * EDGE, -1.25 * EDGE);
          const major = Math.abs(t % 1) < 1e-6;
          const len = major ? 8 : 4;
          line(p.x - len / 2, p.y, p.x + len / 2, p.y, RULER_COLOR, major ? 1.2 : 0.8, 0.85);
          if (major && Math.abs(t) >= 0.5) text(p.x + 5, p.y + 3, String(t), "start");
        }
        text(a.x + 8, a.y - 6, "高 (块边长)", "start");
      }
      // 长轴（沿 Z，y = -1.25）
      {
        const a = this.project(0, -1.25 * EDGE, L_RULE.zMin * EDGE);
        const b = this.project(0, -1.25 * EDGE, L_RULE.zMax * EDGE);
        line(a.x, a.y, b.x, b.y, RULER_COLOR, 1.2, 0.85);
        for (let t = L_RULE.zMin; t <= L_RULE.zMax; t += 0.5) {
          const p = this.project(0, -1.25 * EDGE, t * EDGE);
          const major = Math.abs(t % 1) < 1e-6;
          const len = major ? 8 : 4;
          line(p.x, p.y - len / 2, p.x, p.y + len / 2, RULER_COLOR, major ? 1.2 : 0.8, 0.85);
          if (major && Math.abs(t) >= 0.5) text(p.x, p.y + 14, String(t));
        }
        text(a.x + 8, a.y - 6, "长 (块边长)", "start");
      }
    } else {
      // 俯视图标尺：XZ 网格 + 宽（X）轴 + 长（Z）轴
      const gxMin = Math.ceil(box.min.x / EDGE);
      const gxMax = Math.floor(box.max.x / EDGE);
      for (let gx = gxMin; gx <= gxMax; gx++) {
        const a = this.project(gx * EDGE, 0, box.min.z);
        const b = this.project(gx * EDGE, 0, box.max.z);
        line(a.x, a.y, b.x, b.y, GRID_COLOR, 0.5, 0.12);
      }
      const gzMin = Math.ceil(box.min.z / EDGE);
      const gzMax = Math.floor(box.max.z / EDGE);
      for (let gz = gzMin; gz <= gzMax; gz++) {
        const a = this.project(box.min.x, 0, gz * EDGE);
        const b = this.project(box.max.x, 0, gz * EDGE);
        line(a.x, a.y, b.x, b.y, GRID_COLOR, 0.5, 0.12);
      }

      // 宽向轴线（沿 X，z = W_RULE.z）
      {
        const a = this.project(W_RULE.xMin * EDGE, 0, W_RULE.z * EDGE);
        const b = this.project(W_RULE.xMax * EDGE, 0, W_RULE.z * EDGE);
        line(a.x, a.y, b.x, b.y, RULER_COLOR, 1.2, 0.85);
        for (let t = W_RULE.xMin; t <= W_RULE.xMax; t += 0.5) {
          const p = this.project(t * EDGE, 0, W_RULE.z * EDGE);
          const major = Math.abs(t % 1) < 1e-6;
          const len = major ? 8 : 4;
          line(p.x, p.y - len / 2, p.x, p.y + len / 2, RULER_COLOR, major ? 1.2 : 0.8, 0.85);
          if (major && Math.abs(t) >= 0.5) text(p.x, p.y + 14, String(t));
        }
        text(a.x + 8, a.y - 6, "宽 (块边长)", "start");
      }

      // 长向轴线（沿 Z，x = L_RULE.x）
      {
        const a = this.project(L_RULE.x * EDGE, 0, L_RULE.zMin * EDGE);
        const b = this.project(L_RULE.x * EDGE, 0, L_RULE.zMax * EDGE);
        line(a.x, a.y, b.x, b.y, RULER_COLOR, 1.2, 0.85);
        for (let t = L_RULE.zMin; t <= L_RULE.zMax; t += 0.5) {
          const p = this.project(L_RULE.x * EDGE, 0, t * EDGE);
          const major = Math.abs(t % 1) < 1e-6;
          const len = major ? 8 : 4;
          line(p.x - len / 2, p.y, p.x + len / 2, p.y, RULER_COLOR, major ? 1.2 : 0.8, 0.85);
          if (major && Math.abs(t) >= 0.5) text(p.x + 5, p.y + 3, String(t), "start");
        }
        text(a.x + 8, a.y - 6, "长 (块边长)", "start");
      }
    }
  }
}

const degToRad = (d: number) => (d * Math.PI) / 180;

function disposeObject(obj: Object3D): void {
  const materials = new Set<Material>();
  obj.traverse((node) => {
    const mesh = node as Mesh;
    if (mesh.isMesh) {
      mesh.geometry?.dispose();
      const m = mesh.material as Material | Material[] | undefined;
      if (Array.isArray(m)) m.forEach((x) => materials.add(x));
      else if (m) materials.add(m);
    }
  });
  materials.forEach((m) => m.dispose());
}
