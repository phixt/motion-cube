/**
 * RenderCubeHost.ts — R1 阶段 1 渲染宿主：Scene + PerspectiveCamera + WebGLRenderer +
 * 自驱 rAF 循环 + B1 拖转交互（reference/rubik-anime-lab.html ui.js，忠实复制语义）。
 *
 * 职责：
 *   - 自建渲染环境（替代 cubing TwistyPlayer 的 vantages/experimental 链路的渲染侧）；
 *   - 每帧 step(RenderCube) 推进动画 + renderer.render；
 *   - 鼠标/触摸拖转：pointerdown 拾片（pending）→ 位移足量判轴（useB）进入 layer 拖转
 *     （drag.angle 实时视觉）→ endPointer 用「角度+速度惯性」取整到四分位、吸附动画
 *     dragMove(from,to,dur,mi)（q==0 净零不提交）；未命中/修饰键/非左键 = orbit 转视角；
 *   - 滚轮缩放 dist∈[5.2,18]（reference: clamp(dist*(1±0.075))）；autoSpin 空闲 2.6s 自转。
 *
 * 相机对齐目标（todo 阶段1 余项：cubing 默认 cameraLatitude=20/longitude=30/distance=6.5）：
 *   initial="cubing" → yaw=30°(=0.524 rad)、pitch=20°(=0.349 rad)、dist=6.5；
 *   视线焦点 lookAt(0,-0.1,0)（reference TARGET=[0,-0.30,0] 的 /3 世界尺度，魔方略居上）。
 *   eye = dist*(cos(pitch)*sin(yaw), sin(pitch), cos(pitch)*cos(yaw))。
 *
 * pick/planeHit 世界单位说明：RenderCube.root.scale=1/3，Raycaster 自动处理 transform，
 * 命中点/世界法线均为世界坐标；拖转平面（拾取面向外表面）世界位 = sign*0.5。
 *
 * RenderCube 需要的能力（已实现）：isAnimating、setLayerVisual(axis,layers,theta)、
 * dragMove(axis,layers,from,to,dur,mi)、debugMeshHits()（mesh.userData={piece,sticker}）。
 */

import {
  Color,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Ray,
} from "three";
import { MOVE_NAMES, MOVES } from "../solver/engine.ts";
import { RenderCube, CUBE_WORLD_SCALE } from "./RenderCube.ts";

/** 右手三元组：axis→面内两轴（reference L1350 AX） */
const AX: number[][] = [
  [1, 2],
  [2, 0],
  [0, 1],
];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const cross = (a: number[], b: number[]): number[] => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const hypot = (a: number, b: number) => Math.hypot(a, b);
const sub = (a: number[], b: number[]): number[] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

const FOV = (42 * Math.PI) / 180; // reference L1558；px90 的 tan(21°) 即 tan(FOV/2)
const deg = (d: number) => (d * Math.PI) / 180;
const TAN_HALF = Math.tan(FOV / 2);
/** 拖拽外表面平面（世界坐标）：规范面中心在 1.5，/3 → 0.5 */
const FACE_PLANE = 1.5 * CUBE_WORLD_SCALE;

/** 由 engine 表反查（轴, 层集, 四分位）→ move 名；q==0 或未映射 → null（净零） */
export function moveFor(axis: number, layers: number[], quarter: number): string | null {
  const q = ((quarter % 4) + 4) % 4;
  if (q === 0) return null;
  const ls = [...new Set(layers)].sort((a, b) => a - b).join(",");
  for (const name of MOVE_NAMES) {
    const m = MOVES[name];
    if (m.axis !== axis) continue;
    if ([...new Set(m.layers)].sort((a, b) => a - b).join(",") !== ls) continue;
    if (m.amount !== q) continue;
    return name;
  }
  return null;
}

export type PickHit = {
  /** 被拾贴纸外表面法线主轴 0/1/2 与朝向 ±1（世界法线） */
  axis: number;
  sign: 1 | -1;
  normal: number[];
  /** 被拾块在各轴的规范层坐标（±1/0），旋转层 = cell[旋转轴] */
  cell: number[];
  point: Vector3;
  uAxis: number;
  vAxis: number;
  piece: number;
};

type Drag = {
  axis: number;
  layers: number[];
  sign: 1 | -1;
  tAxis: number;
  tSign: number;
  sdir: [number, number];
  px90: number;
  angle: number;
};

type Ptr = {
  id: number | null;
  mode: "pending" | "layer" | "orbit" | null;
  pick: PickHit | null;
  start3: number[] | null;
  drag: Drag | null;
  lastAng: number;
  vel: number;
  lastT: number;
  downX: number;
  downY: number;
  lastX: number;
  lastY: number;
};

export type RenderCubeHostOptions = {
  container?: HTMLElement;
  canvas?: HTMLCanvasElement;
  renderCube?: RenderCube;
  /** 初始相机：'cubing'（对齐 cubing 默认 lat20/lon30/dist6.5）或显式 {yaw,pitch,dist}；缺省='cubing' */
  camera?: "cubing" | { yaw: number; pitch: number; dist: number };
  backgroundColor?: number; // 缺省 0x0b0e18（reference --bg）
  /** 自动自转：空闲 2.6s 后缓慢绕 y（reference autoSpin idle>2600 → yaw += dt*0.000085） */
  autoSpin?: boolean;
  /** 是否可拾片（默认=无动画在播；外部还可叠"队列空/非 busy"） */
  canPick?: () => boolean;
  /** 触摸/拖拽进行中回调（供外部暂停播放条等）；true=开始 false=结束 */
  onInteractionChange?: (on: boolean) => void;
  /** 手动拖转完成回调（含 quarter/q/mi；mi=null 表示净零未提交） */
  onManualMove?: (ev: { axis: number; layer: number; q: number; mi: string | null }) => void;
  onStateChange?: (state: Uint8Array) => void;
};

export class RenderCubeHost {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly renderCube: RenderCube;
  readonly renderer: WebGLRenderer;
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private raycaster = new Raycaster();
  private yaw: number;
  private pitch: number;
  private dist: number;
  private autoSpin: boolean;
  private idle = 0;
  private rafId = 0;
  private lastT = 0;
  private disposed = false;
  private ro: ResizeObserver | null = null;
  private ptr: Ptr = { id: null, mode: null, pick: null, start3: null, drag: null, lastAng: 0, vel: 0, lastT: 0, downX: 0, downY: 0, lastX: 0, lastY: 0 };
  /** 拖转进行中的视觉态（reference app.drag） */
  private drag: { axis: number; layers: number[]; angle: number } | null = null;
  private onInteractionChange?: (on: boolean) => void;
  private onManualMove?: (ev: { axis: number; layer: number; q: number; mi: string | null }) => void;

  constructor(options: RenderCubeHostOptions = {}) {
    this.container = options.container ?? document.body;
    this.renderCube = options.renderCube ?? new RenderCube({ onStateChange: options.onStateChange });
    this.renderer = new WebGLRenderer({ canvas: options.canvas, antialias: true });
    this.canvas = this.renderer.domElement;
    this.renderer.setClearColor(new Color(options.backgroundColor ?? 0x0b0e18));
    this.camera = new PerspectiveCamera(42, 1, 0.1, 100);
    this.camera.up.set(0, 1, 0);
    if (options.camera && typeof options.camera === "object") {
      this.yaw = options.camera.yaw;
      this.pitch = options.camera.pitch;
      this.dist = options.camera.dist;
    } else {
      // cubing 默认：latitude=20(a+b) longitude=30 distance=6.5
      this.yaw = deg(30);
      this.pitch = deg(20);
      this.dist = 6.5;
    }
    this.autoSpin = options.autoSpin ?? false;
    this.onInteractionChange = options.onInteractionChange;
    this.onManualMove = options.onManualMove;
    this.optionsCanPick = options.canPick ?? null;
    this.renderCube.mount(this.scene);
    this.canvas.style.display = "block";
    this.canvas.style.touchAction = "none";
    this.canvas.style.cursor = "grab";
    this.container.appendChild(this.canvas);
    this.bindEvents();
    this.bindResize();
    this.updateCamera();
    this.start();
  }

  private bindEvents(): void {
    const c = this.canvas;
    c.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    c.addEventListener("pointercancel", this.onPointerCancel);
    c.addEventListener("wheel", this.onWheel, { passive: false });
    c.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  private bindResize(): void {
    const apply = () => {
      const w = this.container.clientWidth || 1;
      const h = this.container.clientHeight || 1;
      this.renderer.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    };
    this.ro = new ResizeObserver(apply);
    this.ro.observe(this.container);
    apply();
  }

  private start(): void {
    this.lastT = performance.now();
    const loop = () => {
      if (this.disposed) return;
      const now = performance.now();
      const dt = Math.min(0.05, (now - this.lastT) / 1000);
      this.lastT = now;
      if (this.autoSpin) {
        if (!this.drag && !this.renderCube.isAnimating) {
          this.idle += dt * 1000;
          if (this.idle > 2600) {
            this.yaw += dt * 0.000085;
            this.updateCamera();
          }
        } else {
          this.idle = 0;
        }
      }
      this.renderCube.step(dt);
      this.renderer.render(this.scene, this.camera);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  private updateCamera(): void {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    this.camera.position.set(this.dist * cp * sy, this.dist * sp, this.dist * cp * cy);
    this.camera.lookAt(0, -0.1, 0);
  }

  /** 设置相机球坐标（yaw/pitch/dist，rad）；cubing 对齐换算由调用方做 */
  setCamera(yaw: number, pitch: number, dist: number): void {
    this.yaw = yaw;
    this.pitch = pitch;
    this.dist = dist;
    this.updateCamera();
  }

  setDistance(dist: number): void {
    this.dist = dist;
    this.updateCamera();
  }

  get cameraState(): { yaw: number; pitch: number; dist: number } {
    return { yaw: this.yaw, pitch: this.pitch, dist: this.dist };
  }

  /** 适配视口距离：reference fitDist（世界尺度 /3 后 clamp[2.53,5.67]，demo/fit 用） */
  fitDist(): number {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    const aspect = w / h;
    const ty = TAN_HALF;
    const needV = h < 620 ? 5.1 / 3 : 4.88 / 3;
    const needH = w < 620 ? 3.5 / 3 : 4.5 / 3;
    const d = Math.max(needV / ty, needH / (ty * aspect));
    return clamp(d, 7.6 / 3, 17 / 3);
  }

  private rayFrom(clientX: number, clientY: number): Ray {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const sx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const sy = -(((clientY - rect.top) / rect.height) * 2 - 1);
    this.raycaster.setFromCamera(new Vector2(sx, sy), this.camera);
    return this.raycaster.ray;
  }

  /** 拾片：最近命中 mesh（贴纸/块体），世界法线取主轴（reference pick L1657-1679 语义等价） */
  pick(clientX: number, clientY: number): PickHit | null {
    this.rayFrom(clientX, clientY);
    const hits = this.raycaster.intersectObjects(this.renderCube.debugMeshHits(), false);
    const hit = hits[0];
    if (!hit || !hit.face) return null;
    const localN = hit.face.normal;
    const worldN = new Vector3(localN.x, localN.y, localN.z).transformDirection(hit.object.matrixWorld);
    const n = [
      Math.round(worldN.x),
      Math.round(worldN.y),
      Math.round(worldN.z),
    ];
    const axis = n.findIndex((v) => v !== 0);
    const sign = (n[axis] > 0 ? 1 : -1) as 1 | -1;
    const b = AX[axis][0];
    const c = AX[axis][1];
    const piece = (hit.object.userData as { piece?: number }).piece ?? 0;
    const p = this.renderCube.committedPose.pieces[piece].pos;
    const cell = [0, 0, 0];
    cell[axis] = sign;
    cell[b] = p[b];
    cell[c] = p[c];
    return { axis, sign, normal: n, cell, point: hit.point.clone(), uAxis: b, vAxis: c, piece };
  }

  /** 射线与外表面平面（世界位 sign*FACE_PLANE）交点（reference planeHit L1681-1688） */
  private planeHit(x: number, y: number, h: PickHit): number[] | null {
    const ray = this.rayFrom(x, y);
    const dn = ray.direction.getComponent(h.axis);
    if (Math.abs(dn) < 1e-6) return null;
    const t = (h.sign * FACE_PLANE - ray.origin.getComponent(h.axis)) / dn;
    if (t <= 0) return null;
    return [ray.origin.x + ray.direction.x * t, ray.origin.y + ray.direction.y * t, ray.origin.z + ray.direction.z * t];
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.ptr.id = e.pointerId;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* Pointer Capture 不可用时忽略（move/up 仍由 window 兜底） */
    }
    this.ptr.downX = e.clientX;
    this.ptr.downY = e.clientY;
    this.ptr.lastX = e.clientX;
    this.ptr.lastY = e.clientY;
    this.ptr.lastT = performance.now();
    this.ptr.lastAng = 0;
    this.ptr.vel = 0;
    this.idle = 0;
    const canPick = this.drag == null && !this.renderCube.isAnimating && (this.optionsCanPick?.() ?? true);
    const usable = e.button !== 2 && !e.shiftKey && !e.ctrlKey && canPick;
    const hit = usable ? this.pick(e.clientX, e.clientY) : null;
    if (hit) {
      this.ptr.mode = "pending";
      this.ptr.pick = hit;
      this.ptr.start3 = [hit.point.x, hit.point.y, hit.point.z];
      this.canvas.classList.add("dragging");
    } else {
      this.ptr.mode = "orbit";
    }
    this.onInteractionChange?.(true);
  };
  private optionsCanPick: (() => boolean) | null = null;

  private onPointerMove = (e: PointerEvent): void => {
    if (this.ptr.id !== e.pointerId || !this.ptr.mode) return;
    this.idle = 0;
    const dx = e.clientX - this.ptr.downX;
    const dy = e.clientY - this.ptr.downY;
    if (this.ptr.mode === "orbit") {
      this.yaw -= (e.clientX - this.ptr.lastX) * 0.0064;
      this.pitch = clamp(this.pitch + (e.clientY - this.ptr.lastY) * 0.0064, -1.33, 1.33);
      this.updateCamera();
      this.ptr.lastX = e.clientX;
      this.ptr.lastY = e.clientY;
      return;
    }
    if (this.ptr.mode === "pending") {
      const p = this.planeHit(e.clientX, e.clientY, this.ptr.pick!);
      if (!p) return;
      const d = sub(p, this.ptr.start3!);
      const pb = this.ptr.pick!.uAxis;
      const pc = this.ptr.pick!.vAxis;
      if (Math.max(Math.abs(d[pb]), Math.abs(d[pc])) < 0.17) return;
      const useB = Math.abs(d[pb]) >= Math.abs(d[pc]);
      const tAxis = useB ? pb : pc;
      const tSign = ((useB ? d[pb] : d[pc]) >= 0 ? 1 : -1) as 1 | -1;
      const tv = [0, 0, 0];
      tv[tAxis] = tSign;
      const A = cross(this.ptr.pick!.normal, tv);
      const k = A.findIndex((v) => Math.abs(v) > 0.5);
      if (k < 0) return;
      const sl = hypot(dx, dy) || 1;
      const rect = this.renderer.domElement.getBoundingClientRect();
      const perWorld = rect.height / (2 * TAN_HALF * this.dist);
      const px90 = Math.max(58, perWorld * 1.55);
      this.ptr.mode = "layer";
      this.ptr.drag = {
        axis: k,
        layers: [this.ptr.pick!.cell[k]],
        sign: (A[k] > 0 ? 1 : -1) as 1 | -1,
        tAxis,
        angle: 0,
        tSign,
        sdir: [dx / sl, dy / sl],
        px90,
      };
      this.drag = { axis: k, layers: [this.ptr.pick!.cell[k]], angle: 0 };
      this.ptr.lastAng = 0;
      return;
    }
    if (this.ptr.mode === "layer" && this.ptr.drag) {
      const d0 = this.ptr.drag;
      const proj = (dx * d0.sdir[0] + dy * d0.sdir[1]) / d0.px90;
      const ang = clamp(d0.sign * proj * (Math.PI / 2), -1.05 * Math.PI, 1.05 * Math.PI);
      const now = performance.now();
      const dtm = Math.max(8, now - this.ptr.lastT);
      this.ptr.vel = ((ang - this.ptr.lastAng) / dtm) * 1000;
      this.ptr.lastAng = ang;
      this.ptr.lastT = now;
      this.drag!.angle = ang;
      this.renderCube.setLayerVisual(d0.axis, d0.layers, ang);
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.ptr.id !== e.pointerId) return;
    this.endPointer();
  };

  private onPointerCancel = (e: PointerEvent): void => {
    if (this.ptr.id !== e.pointerId) return;
    this.endPointer();
    this.onInteractionChange?.(false);
  };

  private endPointer(): void {
    const wasDrag = this.ptr.mode === "layer" && this.drag && this.ptr.drag;
    if (wasDrag) {
      const d0 = this.ptr.drag!;
      const ang = this.drag!.angle;
      const n = Math.round((ang + clamp(this.ptr.vel, -5, 5) * 0.042) / (Math.PI / 2));
      const nc = clamp(n, -2, 2);
      const q = ((nc % 4) + 4) % 4;
      const mi = q === 0 ? null : moveFor(d0.axis, d0.layers, q);
      const to = nc * (Math.PI / 2);
      const dur = clamp(Math.abs(to - ang) * 150, 70, 260);
      this.renderCube.dragMove(d0.axis, d0.layers, ang, to, dur, mi);
      this.drag = null;
      this.onManualMove?.({ axis: d0.axis, layer: d0.layers[0], q, mi });
    }
    this.ptr.id = null;
    this.ptr.mode = null;
    this.ptr.pick = null;
    this.ptr.start3 = null;
    this.ptr.drag = null;
    this.canvas.classList.remove("dragging");
    this.onInteractionChange?.(false);
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.dist = clamp(this.dist * (1 + (e.deltaY > 0 ? 1 : -1) * 0.075), 5.2, 18);
    this.updateCamera();
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.ro?.disconnect();
    const c = this.canvas;
    c.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    c.removeEventListener("pointercancel", this.onPointerCancel);
    c.removeEventListener("wheel", this.onWheel);
    this.renderCube.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
    c.remove(); // 关键：移除 canvas——否则 HMR/卸载后不透明黑底 canvas 残留在容器全屏（背景黑污染）
  }
}