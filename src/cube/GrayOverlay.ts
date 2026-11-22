/**
 * 3D 标灰覆盖层：把 54 个小面映射到 three.js 场景中的 sticker mesh，
 * 修改材质颜色实现标灰。mesh 随魔方转动移动 → 标灰绑定绝对坐标。
 * 两类灰：mutable（浅灰）/ immutable（深灰）。更新做 80ms 防抖。
 *
 * P1-5 性能约定：cubing 的 `onThreeScene` 回调对应每次 `render-scheduled`（动画期每帧触发），
 * 因此仅在 dirty（状态变更 / 映射刚建好）或 cubing 替换了贴纸材质时才重刷材质颜色；
 * 缓存 mutable/immutable Set，避免每帧分配。
 */
import { Vector3, type Mesh, type Object3D } from "three";
import { stickerIdFromWorld, type GrayState, type StickerId } from "./stickering";
import type { CubePlayer } from "./CubePlayer";

const GRAY_MUTABLE = 0x8f959e;
const GRAY_IMMUTABLE = 0x565c66;

type ColorLike = { r: number; g: number; b: number; getHex(): number; setHex(h: number): void };
type MaterialLike = { color?: ColorLike; clone(): MaterialLike };

export class GrayOverlay {
  private readonly player: CubePlayer;
  private map = new Map<StickerId, Mesh[]>();
  private originalHex = new Map<Mesh, number>();
  private clonedMat = new Map<Mesh, unknown>();
  private ready = false;
  private disposed = false;
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retryTimers: ReturnType<typeof setTimeout>[] = [];
  private pending: GrayState | null = null;
  private lastState: GrayState | null = null;
  private cachedMutable = new Set<StickerId>();
  private cachedImmutable = new Set<StickerId>();
  private renderListener: (() => void) | null = null;
  private obj: Object3D | null = null;
  private readonly tmp = new Vector3();

  constructor(player: CubePlayer) {
    this.player = player;
  }

  async init(): Promise<void> {
    if (this.disposed) return;
    // cubing 每次调度渲染（render-scheduled）都会回调：仅在材质被替换或 dirty 时重放标灰
    const obj = await this.player.onThreeScene(() => {
      if (this.disposed) return;
      const before = this.map.size;
      if (!this.ready || this.map.size < 54) this.tryBuildMap();
      if (this.map.size !== before) this.dirty = true;
      if (this.ready && this.lastState && (this.dirty || this.anyMaterialReplaced())) {
        this.doApply(this.lastState);
      }
      this.renderListener?.();
    });
    if (this.disposed) return;
    this.obj = obj;
    this.tryBuildMap();
    this.ready = true;
    if (this.map.size < 54) this.scheduleMapRetries();
    if (this.pending) {
      this.doApply(this.pending);
      this.pending = null;
      void this.requestRender();
    } else if (this.lastState) {
      this.doApply(this.lastState);
    }
  }

  /** 若初始帧映射不足 54 面，在初始窗口内做有限次重试（F14，dispose 时统一清理） */
  private scheduleMapRetries(): void {
    this.clearRetryTimers();
    this.retryTimers = [500, 2000, 5000].map((ms) =>
      setTimeout(() => {
        if (this.disposed || this.map.size >= 54) return;
        this.tryBuildMap();
        if (this.map.size >= 54 && this.lastState) {
          this.dirty = true;
          this.doApply(this.lastState);
          void this.requestRender();
        }
      }, ms),
    );
  }

  private clearRetryTimers(): void {
    for (const id of this.retryTimers) clearTimeout(id);
    this.retryTimers = [];
  }

  /** O(54) 引用对比：判断 cubing 是否在某次重建中替换了我们克隆过的贴纸材质 */
  private anyMaterialReplaced(): boolean {
    for (const meshes of this.map.values()) {
      for (const mesh of meshes) {
        if (this.clonedMat.get(mesh) !== mesh.material) return true;
      }
    }
    return false;
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
    if (this.disposed) return;
    this.pending = state;
    this.dirty = true;
    if (!this.ready) return;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.disposed && this.pending) {
        this.doApply(this.pending);
        this.pending = null;
        void this.requestRender();
      }
    }, 80);
  }

  /** 强制重绘一帧（应用标灰后调用；走 CubePlayer 抽象接口） */
  private async requestRender(): Promise<void> {
    if (this.disposed) return;
    await this.player.requestRender();
  }

  private doApply(state: GrayState): void {
    if (this.lastState !== state) {
      this.lastState = state;
      this.cachedMutable = new Set(state.mutable);
      this.cachedImmutable = new Set(state.immutable);
    }
    this.dirty = false;
    const mutableSet = this.cachedMutable;
    const immutableSet = this.cachedImmutable;
    const hasAnyGray = mutableSet.size > 0 || immutableSet.size > 0;
    // 无标灰且尚未克隆过材质时跳过遍历（游戏页默认无灰态零开销）
    if (!hasAnyGray && this.clonedMat.size === 0) return;

    for (const [id, meshes] of this.map) {
      let hex: number | null = null;
      if (mutableSet.has(id)) hex = GRAY_MUTABLE;
      else if (immutableSet.has(id)) hex = GRAY_IMMUTABLE;
      for (const mesh of meshes) {
        this.ensureCloned(mesh);
        const mat = mesh.material as MaterialLike;
        const color = mat.color;
        if (!color) continue;
        const targetHex = hex === null ? (this.originalHex.get(mesh) ?? color.getHex()) : hex;
        if (color.getHex() !== targetHex) color.setHex(targetHex);
      }
    }
  }

  private ensureCloned(mesh: Mesh): void {
    if (this.clonedMat.get(mesh) === mesh.material) return;
    const mat = mesh.material as MaterialLike;
    if (mat.color && typeof mat.clone === "function") {
      if (!this.originalHex.has(mesh)) this.originalHex.set(mesh, mat.color.getHex());
      const cloned = mat.clone() as Mesh["material"];
      mesh.material = cloned;
      this.clonedMat.set(mesh, cloned);
    } else {
      this.clonedMat.set(mesh, mesh.material);
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.clearRetryTimers();
    this.pending = null;
    this.lastState = null;
    this.renderListener = null;
    this.obj = null;
    this.map.clear();
    this.originalHex.clear();
    this.clonedMat.clear();
  }

  /** 每次 cubing 调度渲染时回调（用于伪 3D 视图跟随实时状态） */
  setRenderListener(cb: (() => void) | null): void {
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
