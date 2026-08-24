/**
 * 3D 标灰覆盖层：把 54 个小面映射到 three.js 场景中的 sticker mesh，
 * 修改材质颜色实现标灰。mesh 随魔方转动移动 → 标灰绑定绝对坐标。
 * 两类灰：mutable（浅灰）/ immutable（深灰）。更新做 80ms 防抖。
 */
import { Vector3, type Mesh, type Object3D } from "three";
import { stickerIdFromWorld, type GrayState, type StickerId } from "./stickering";
import type { CubePlayer } from "./CubePlayer";

const GRAY_MUTABLE = 0x8f959e;
const GRAY_IMMUTABLE = 0x565c66;

type ColorLike = { r: number; g: number; b: number; getHex(): number; setHex(h: number): void };
type MaterialLike = { color?: ColorLike; clone(): MaterialLike };

export class GrayOverlay {
  private map = new Map<StickerId, Mesh[]>();
  private originalHex = new Map<Mesh, number>();
  private cloned = new Set<Mesh>();
  private ready = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: GrayState | null = null;
  private lastState: GrayState | null = null;
  private renderListener: (() => void) | null = null;
  private obj: Object3D | null = null;
  private readonly tmp = new Vector3();

  constructor(private readonly player: CubePlayer) {}

  async init(): Promise<void> {
    // cubing 每次调度渲染时可能重建材质/对象，在回调中重放标灰
    const obj = await this.player.onThreeScene(() => {
      if (!this.ready || this.map.size < 54) this.tryBuildMap();
      if (this.ready && this.lastState) this.doApply(this.lastState);
      this.renderListener?.();
    });
    this.obj = obj;
    this.tryBuildMap();
    this.ready = true;
    if (this.pending) {
      this.doApply(this.pending);
      this.pending = null;
      void this.requestRender();
    }
  }

  /** 初始窗口内重试构建映射，直到 54 个小面全部定位（对象变换就绪前可能不完整） */
  private tryBuildMap(): void {
    if (this.map.size >= 54 || !this.obj) return;
    this.map.clear();
    this.buildMap(this.obj);
  }

  private buildMap(obj: Object3D): void {
    obj.traverse((node) => {
      const mesh = node as Mesh;
      const mat = mesh.material as MaterialLike | MaterialLike[] | undefined;
      if (!mat || Array.isArray(mat)) return;
      const color = mat.color;
      if (!color) return;
      if (color.r === 0 && color.g === 0 && color.b === 0) return; // 黑色块体，跳过
      mesh.getWorldPosition(this.tmp);
      const ax = Math.abs(this.tmp.x);
      const ay = Math.abs(this.tmp.y);
      const az = Math.abs(this.tmp.z);
      const maxV = Math.max(ax, ay, az);
      // 真实尺度（面偏移 ±0.5/0.82、面内 ±0.33）→ 规范尺度（±1.5 / ±1）
      const canon = (v: number, isFaceAxis: boolean) =>
        isFaceAxis ? Math.sign(v) * 1.5 : Math.round(v * 3);
      const cx = canon(this.tmp.x, ax === maxV);
      const cy = canon(this.tmp.y, ay === maxV);
      const cz = canon(this.tmp.z, az === maxV);
      const id = stickerIdFromWorld(cx, cy, cz);
      if (!id) return;
      const list = this.map.get(id) ?? [];
      list.push(mesh);
      this.map.set(id, list);
    });
  }

  /** 防抖应用标灰（80ms 内合并连续请求） */
  requestApply(state: GrayState): void {
    this.pending = state;
    if (!this.ready) return;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.pending) {
        this.doApply(this.pending);
        this.pending = null;
        void this.requestRender();
      }
    }, 80);
  }

  /** 强制重绘一帧（应用标灰后调用；走 CubePlayer 抽象接口） */
  private async requestRender(): Promise<void> {
    await this.player.requestRender();
  }

  private doApply(state: GrayState): void {
    this.lastState = state;
    const mutableSet = new Set(state.mutable);
    const immutableSet = new Set(state.immutable);
    for (const [id, meshes] of this.map) {
      let hex: number | null = null;
      if (mutableSet.has(id)) hex = GRAY_MUTABLE;
      else if (immutableSet.has(id)) hex = GRAY_IMMUTABLE;
      for (const mesh of meshes) {
        this.ensureCloned(mesh);
        const mat = mesh.material as MaterialLike;
        const color = mat.color;
        if (!color) continue;
        if (hex === null) {
          color.setHex(this.originalHex.get(mesh) ?? color.getHex());
        } else {
          color.setHex(hex);
        }
      }
    }
  }

  private ensureCloned(mesh: Mesh): void {
    if (this.cloned.has(mesh)) return;
    const mat = mesh.material as MaterialLike;
    if (mat.color && typeof mat.clone === "function") {
      this.originalHex.set(mesh, mat.color.getHex());
      mesh.material = mat.clone() as Mesh["material"];
    }
    this.cloned.add(mesh);
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
    this.renderListener = null;
  }

  /** 每次 cubing 调度渲染时回调（用于伪 3D 视图跟随实时状态） */
  setRenderListener(cb: () => void): void {
    this.renderListener = cb;
  }

  /** 读取 54 个小面的实时世界位置（规范尺度，面偏移 ±1.5、面内 ±1） */
  currentPositions(): Map<StickerId, { x: number; y: number; z: number }> {
    const out = new Map<StickerId, { x: number; y: number; z: number }>();
    for (const [id, meshes] of this.map) {
      const mesh = meshes[0];
      if (!mesh) continue;
      mesh.getWorldPosition(this.tmp);
      const ax = Math.abs(this.tmp.x);
      const ay = Math.abs(this.tmp.y);
      const az = Math.abs(this.tmp.z);
      const maxV = Math.max(ax, ay, az);
      const canon = (v: number, isFaceAxis: boolean) =>
        isFaceAxis ? Math.sign(v) * 1.5 : Math.round(v * 3);
      out.set(id, {
        x: canon(this.tmp.x, ax === maxV),
        y: canon(this.tmp.y, ay === maxV),
        z: canon(this.tmp.z, az === maxV),
      });
    }
    return out;
  }
}
