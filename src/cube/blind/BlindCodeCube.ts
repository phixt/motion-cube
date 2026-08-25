/**
 * BlindCodeCube.ts — 盲拧彳亍法编码立方体 3D 展示（说明页用）
 *
 * 数据：data/blind-code-map.json（黄顶红前，54 贴纸位 → {block, letter, buffer, center}）。
 * 视觉：参考 reference/chichu.html —— 单三阶立方体 + 6 面 canvas 字母纹理（3×3 网格：
 * 角/棱贴纸位画编码字母，✕=缓冲块（棱 UF+角 UFR），中心格留空）。文字按「从该面外侧看」
 * 正立（与建库网格方向一致，纹理 UV 直接贴合）。
 * 交互：参考 RenderCubeHost orbit —— 左键拖转（yaw-=dx*0.0064；pitch clamp ±1.33）、
 * 滚轮缩放（dist*±0.075 clamp [5.2,18]）、自动缓慢自转（空闲 2.6s 后））、双击重置视角。
 *
 * 构造：new BlindCodeCube({ container }) → 自动挂载并启动 rAF；dispose() 完整清理
 * （停 rAF + renderer.dispose + forceContextLoss + canvas.remove——真机残留教训）。
 * 仅依赖 three（项目传递依赖），无额外依赖。
 */
import * as THREE from "three";
import blindMap from "../../../data/blind-code-map.json";

type BlindCell = {
  face: string;
  row: number;
  col: number;
  block: string;
  stickerOnBlock: string;
  letter: string;
  buffer: boolean;
  center: boolean;
};

// 黄顶红前 6 面底色（与 chichu.html 同色系）
const FACE_COLOR: Record<string, string> = {
  U: "#fbc02d", // 黄
  D: "#ffffff", // 白
  F: "#d32f2f", // 红
  B: "#ff9800", // 橙
  R: "#03a9f4", // 蓝
  L: "#8bc34a", // 绿
};

export type BlindCodeCubeOptions = {
  autoSpin?: boolean;
  idleSpinDelayMs?: number;
};

export class BlindCodeCube {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private cube: THREE.Mesh;
  private rafId: number | null = null;
  private disposed = false;

  // orbit 状态
  private yaw = 0.55;
  private pitch = 0.38;
  private dist = 6.8;

  // 交互状态
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private lastT = 0;
  private idle = 0;

  private opts: Required<BlindCodeCubeOptions>;

  constructor(container: HTMLElement, options?: BlindCodeCubeOptions) {
    this.opts = {
      autoSpin: true,
      idleSpinDelayMs: 2600,
      ...options,
    };
    this.container = container;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a2e);

    const w = container.clientWidth || 480;
    const h = container.clientHeight || 320;
    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 1000);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(this.renderer.domElement);

    // 立方体 + 6 面字母纹理
    this.cube = this.buildCube();
    this.scene.add(this.cube);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(2, 2, 2)),
      new THREE.LineBasicMaterial({ color: 0x000000 })
    );
    this.scene.add(edges);

    // 灯光（材质为 MeshBasicMaterial 不受光；仅环境光保持参考页面氛围）
    this.scene.add(new THREE.AmbientLight(0xffffff, 1));

    this.attachEvents();

    const loop = (t: number) => {
      if (this.disposed) return;
      const dt = this.lastT ? Math.min((t - this.lastT) / 1000, 0.05) : 0;
      this.lastT = t;
      if (this.opts.autoSpin && !this.dragging) {
        this.idle += dt;
        if (this.idle > this.opts.idleSpinDelayMs / 1000) this.yaw += dt * 0.25;
      }
      this.updateCamera();
      this.renderer.render(this.scene, this.camera);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  private buildCube(): THREE.Mesh {
    const cells = blindMap.cells as BlindCell[];
    const materials: THREE.MeshBasicMaterial[] = [];
    // Box 材质顺序：+x,-x,+y,-y,+z,-z → R,L,U,D,F,B
    const order = ["R", "L", "U", "D", "F", "B"];
    for (const face of order) {
      const grid: string[][] = [["", "", ""], ["", "", ""], ["", "", ""]];
      for (const c of cells) {
        if (c.face !== face) continue;
        if (c.center) grid[c.row][c.col] = "";
        else if (c.buffer) grid[c.row][c.col] = "✕";
        else grid[c.row][c.col] = c.letter;
      }
      materials.push(new THREE.MeshBasicMaterial({ map: makeFaceTexture(FACE_COLOR[face], grid) }));
    }
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), materials);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private updateCamera() {
    const cp = Math.cos(this.pitch);
    this.camera.position.set(
      this.dist * cp * Math.sin(this.yaw),
      this.dist * Math.sin(this.pitch),
      this.dist * cp * Math.cos(this.yaw)
    );
    this.camera.lookAt(0, 0, 0);
  }

  private attachEvents() {
    const el = this.renderer.domElement;
    el.style.cursor = this.dragging ? "grabbing" : "grab";
    el.style.touchAction = "none";

    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.idle = 0;
      el.setPointerCapture(e.pointerId);
      el.style.cursor = "grabbing";
    };
    const move = (e: PointerEvent) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.yaw -= dx * 0.0064;
      this.pitch = Math.max(-1.33, Math.min(1.33, this.pitch + dy * 0.0064));
      this.idle = 0;
    };
    const up = () => {
      this.dragging = false;
      el.style.cursor = "grab";
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);

    // 滚轮缩放（passive:false 才能 preventDefault）
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const sign = e.deltaY > 0 ? 1 : -1;
      this.dist = Math.max(5.2, Math.min(18, this.dist * (1 + sign * 0.075)));
      this.idle = 0;
    };
    el.addEventListener("wheel", wheel, { passive: false });

    // 双击重置视角（参考 chichu.html dblclick）
    const db = () => {
      this.yaw = 0.55;
      this.pitch = 0.38;
      this.dist = 6.8;
    };
    el.addEventListener("dblclick", db);
  }

  /** 完整清理（真机残留教训：canvas.remove + forceContextLoss + 停 rAF） */
  dispose() {
    this.disposed = true;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}

function makeFaceTexture(bg: string, grid: string[][]): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 512, 512);

  // 网格线
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 4;
  for (let i = 1; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 170, 0);
    ctx.lineTo(i * 170, 512);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * 170);
    ctx.lineTo(512, i * 170);
    ctx.stroke();
  }

  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const text = grid[row][col];
      const x = col * 170 + 85;
      const y = row * 170 + 85;
      if (text === "✕") {
        // 缓冲块：画叉（黄描边醒目）
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.moveTo(x - 40, y - 40);
        ctx.lineTo(x + 40, y + 40);
        ctx.moveTo(x + 40, y - 40);
        ctx.lineTo(x - 40, y + 40);
        ctx.stroke();
      } else if (text) {
        ctx.font = "bold 76px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#000000";
        ctx.fillText(text, x, y);
      }
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}