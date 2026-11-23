/**
 * RenderCube.ts — R1 阶段 1 自建 three.js 渲染（替换 TwistyPlayer 内部的候选后端）。
 *
 * 结构：
 *   root Group（scale=1/3，挂进宿主 three 场景后世界坐标即 cubing 尺度）
 *     └─ 26 块 BlockView.Group（含黑色块体 BoxGeometry 半宽 0.98 + 至多 3 张贴纸
 *          PlaneGeometry 半宽 0.95 @ dir*1.5，法向朝外）
 *
 * 块变换由逻辑姿态驱动（src/cube/render/pose.ts 的 PoseState：块中心规范尺度
 * {±1/0}³、rot 3x3 单位矩阵；贴纸面中心 = 块 + 法线*1.5）。动画 = C1 队列语义：
 * anim { mi, axis, layers, from, to, t, dur }；step(dt) 用 easeOut(x)=1-(1-x)^3
 * 在 [from,to] 间插值；到 dur 时 commit（applyMovePose 同步逻辑姿态与 54 贴纸 state，
 * 压历史栈）。可中断：新 move 直接丢弃当前动画、几何 snap 回 committed 姿态再开新动画。
 *
 * 2026-11-23 Step 3 B 线修复（docs/audit/render.md F6/F7/F8/F11）：
 *   - F6：新增 setMovesInstant(moves) 从 basePose 物理推进块姿态与贴纸态，
 *     避免 setState 重涂后再播造成贴纸态二次施加；
 *   - F7：setSpeed() 按比例换算 anim.t（保持进度 t/dur 连续），不再瞬移或倒退；
 *   - F8：step(dt) 返回是否发生视觉变化 + onVisualChange 回调，支撑宿主按需脏渲染与
 *     onMoveDone 同帧零空档队列驱动；
 *   - F11：支持 baseSetupAlg（六色底整块旋转朝向），构造/reset/setMovesInstant 均保留底色朝向。
 */

import {
  BoxGeometry,
  Color,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type Object3D,
} from "three";
import { CUBIES, MOVES, parseAlg, stickerIndex, type State, type Vec3 } from "../solver/engine.ts";
import { applyAlgPose, applyMovePose, axisAngleMat, IDENT3, m3Apply, type PoseState } from "./pose.ts";

/** cubing 3x3 官方配色（面序 U/R/F/D/L/B） */
export const FACE_COLORS: number[] = [0xffffff, 0xff9900, 0x00ff00, 0xffff00, 0xff0000, 0x2266ff];
/** root scale：规范坐标 → cubing 世界（块中心 ±1 → ±1/3） */
export const CUBE_WORLD_SCALE = 1 / 3;

const easeOut = (x: number) => 1 - (1 - x) ** 3;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** C1 playDur：300/speed ms 夹 [70, 900] */
const playDur = (speed: number) => clamp(300 / Math.max(0.05, speed), 70, 900);

type BlockView = {
  group: Group;
  stickers: { dir: Vec3; face: number; mesh: Mesh; faceMaterial: MeshBasicMaterial; stateMaterial: MeshBasicMaterial }[];
};

export type RenderCubeOptions = {
  /** 独立挂载时置 true（内部 rAF 驱动）；宿主循环驱动时置 false（每帧 step(dt)） */
  internalRaf?: boolean;
  /** tempoScale 语义：1 = 1x，越大越快 */
  speed?: number;
  /** 基础整块旋转朝向（如六色底 baseFaceSetupAlg(baseFace)）；构造与 reset() 时施加 */
  baseSetupAlg?: string;
  onMoveDone?: (mi: string) => void;
  onStateChange?: (state: Uint8Array) => void;
  /** 视觉发生改变时通知宿主标脏（按需渲染用） */
  onVisualChange?: () => void;
};

type Anim = {
  /** 动画到点要提交的动作；null = 净零（不提交、不压栈，几何直接回 committed） */
  mi: string | null;
  axis: number;
  layers: number[];
  /** 动画起始视觉角（拖转吸附从当前角起）与结束目标角 */
  from: number;
  to: number;
  t: number;
  dur: number;
};

export class RenderCube {
  readonly root = new Group();
  private blocks: BlockView[] = [];
  private bodyGeo!: BoxGeometry;
  private stickerGeo!: PlaneGeometry;
  private bodyMaterial!: MeshBasicMaterial;
  private faceMaterials: MeshBasicMaterial[] = []; // 6 个 home 面色（物理模型）
  private baseSetupAlg: string;
  private poseState!: PoseState;
  private history: PoseState[] = [];
  private anim: Anim | null = null;
  private speed: number;
  private internalRaf: boolean;
  private rafId = 0;
  private lastT = 0;
  private disposed = false;
  private onMoveDone?: (mi: string) => void;
  private onStateChange?: (state: Uint8Array) => void;
  private onVisualChange?: () => void;

  constructor(options: RenderCubeOptions = {}) {
    this.speed = options.speed ?? 1;
    this.internalRaf = options.internalRaf ?? false;
    this.baseSetupAlg = options.baseSetupAlg?.trim() ?? "";
    this.onMoveDone = options.onMoveDone;
    this.onStateChange = options.onStateChange;
    this.onVisualChange = options.onVisualChange;
    this.poseState = this.createBasePose();
    this.history.push(this.clonePose(this.poseState));
    this.buildRoot();
    this.syncBlocks();
  }

  private static solvedPose(): PoseState {
    return {
      pieces: CUBIES.map((c) => ({ pos: c.pos.slice() as Vec3, rot: IDENT3.map((v) => v.slice() as Vec3) })),
      state: new Uint8Array(54).fill(0).map((_, i) => (i / 9) | 0),
    };
  }

  private createBasePose(): PoseState {
    const solved = RenderCube.solvedPose();
    return this.baseSetupAlg ? applyAlgPose(solved, this.baseSetupAlg) : solved;
  }

  private clonePose(p: PoseState): PoseState {
    return {
      pieces: p.pieces.map((pc) => ({ pos: pc.pos.slice() as Vec3, rot: pc.rot.map((v) => v.slice() as Vec3) })),
      state: p.state.slice() as State,
    };
  }

  private buildRoot(): void {
    this.root.name = "RenderCube";
    this.root.scale.setScalar(CUBE_WORLD_SCALE);
    this.bodyGeo = new BoxGeometry(1.96, 1.96, 1.96); // 半宽 0.98（微缝）
    this.bodyMaterial = new MeshBasicMaterial({ color: 0x000000 });
    this.stickerGeo = new PlaneGeometry(1.9, 1.9); // 半宽 0.95
    this.faceMaterials = FACE_COLORS.map((c) => new MeshBasicMaterial({ color: new Color(c) }));

    for (let i = 0; i < CUBIES.length; i++) {
      const c = CUBIES[i];
      const g = new Group();
      g.name = `block-${i}`;
      const body = new Mesh(this.bodyGeo, this.bodyMaterial);
      body.userData = { piece: i };
      g.add(body);
      const stickers: BlockView["stickers"] = [];
      for (const s of c.stickers) {
        const faceMaterial = this.faceMaterials[s.face];
        const stateMaterial = new MeshBasicMaterial({ color: new Color(0x000000) });
        const mesh = new Mesh(this.stickerGeo, faceMaterial);
        const d = s.normal;
        mesh.position.set(d[0] * 1.5, d[1] * 1.5, d[2] * 1.5);
        mesh.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(d[0], d[1], d[2]));
        mesh.userData = { piece: i, sticker: stickers.length };
        stickers.push({ dir: s.normal, face: s.face, mesh, faceMaterial, stateMaterial });
        g.add(mesh);
      }
      g.position.set(c.pos[0], c.pos[1], c.pos[2]);
      this.blocks.push({ group: g, stickers });
      this.root.add(g);
    }
  }

  private restorePhysicalMaterials(): void {
    for (const b of this.blocks) {
      for (const st of b.stickers) {
        if (st.mesh.material !== st.faceMaterial) st.mesh.material = st.faceMaterial;
      }
    }
  }

  private emitVisualChange(): void {
    this.onVisualChange?.();
  }

  /** 注册视觉变更回调（供宿主 RenderCubeHost 标脏按需渲染） */
  setVisualChangeHandler(cb: (() => void) | undefined): void {
    this.onVisualChange = cb;
  }

  /** 更新基础底色旋转朝向并复位至新底色起点 */
  setBaseSetup(alg: string): void {
    this.baseSetupAlg = alg.trim();
    this.reset();
  }

  /** 挂进宿主场景；internalRaf 时启动自驱循环 */
  mount(scene: Object3D): this {
    scene.add(this.root);
    if (this.internalRaf) {
      this.lastT = performance.now();
      const loop = () => {
        if (this.disposed) return;
        const now = performance.now();
        this.step((now - this.lastT) / 1000);
        this.lastT = now;
        this.rafId = requestAnimationFrame(loop);
      };
      this.rafId = requestAnimationFrame(loop);
    }
    return this;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.root.removeFromParent();
    this.bodyGeo.dispose();
    this.stickerGeo.dispose();
    this.bodyMaterial.dispose();
    for (const m of this.faceMaterials) m.dispose();
    for (const b of this.blocks) for (const st of b.stickers) st.stateMaterial.dispose();
  }

  /** 宿主渲染循环每帧调用；dt 秒。返回本帧是否有视觉更新（供按需渲染判断） */
  step(dt: number): boolean {
    if (!this.anim) return false;
    this.anim.t += dt * 1000;
    const a = this.anim;
    const x = clamp(a.t / a.dur, 0, 1);
    const theta = easeOut(x) * (a.to - a.from) + a.from;
    if (theta !== 0) this.applyVisualRotation(a, theta);
    if (x >= 1) this.commit(a);
    return true;
  }

  private applyVisualRotation(a: { axis: number; layers: number[] }, theta: number): void {
    const Q = axisAngleMat(a.axis, theta);
    const q = quatFromMat(Q);
    for (let i = 0; i < this.poseState.pieces.length; i++) {
      const pc = this.poseState.pieces[i];
      if (!a.layers.includes(pc.pos[a.axis])) continue;
      const wp = m3Apply(Q, pc.pos);
      const g = this.blocks[i].group;
      g.position.set(wp[0], wp[1], wp[2]);
      g.quaternion.copy(q);
    }
  }

  private commit(a: Anim): void {
    this.anim = null;
    if (a.mi == null) {
      this.syncBlocks(); // 净零拖转：不提交、不改状态（视觉回 committed）
      return;
    }
    const before = this.clonePose(this.poseState);
    this.poseState = applyMovePose(this.poseState, a.mi);
    this.history.push(before);
    if (this.history.length > 256) this.history.shift();
    this.syncBlocks();
    this.onStateChange?.(this.poseState.state);
    this.onMoveDone?.(a.mi);
  }

  /** 播放一步（可中断：正在播的动画直接丢弃、几何 snap 回 committed） */
  playMove(mi: string): void {
    const m = MOVES[mi];
    if (!m) return;
    this.anim = null;
    this.syncBlocks();
    this.anim = {
      mi,
      axis: m.axis,
      layers: m.layers.slice(),
      from: 0,
      to: -((((m.amount % 4) + 4) % 4) * (Math.PI / 2)),
      t: 0,
      dur: playDur(this.speed),
    };
    this.emitVisualChange();
  }

  /**
   * 拖转吸附动画（B1 endPointer 语义）：from=当前拖拽角、to=目标四分角、
   * mi=要提交的动作（q==0 时传 null → 净零，动画到点回 committed、不提交不压栈）。
   */
  dragMove(axis: number, layers: number[], from: number, to: number, dur: number, mi: string | null): void {
    this.anim = null;
    this.syncBlocks();
    this.anim = { mi, axis, layers, from, to, t: 0, dur };
    this.emitVisualChange();
  }

  /** 拖拽实时视觉：无动画时把「参与层」按 theta 视觉旋转（不触碰逻辑姿态/历史） */
  setLayerVisual(axis: number, layers: number[], theta: number): void {
    if (this.anim || theta === 0) return;
    this.applyVisualRotation({ axis, layers }, theta);
    this.emitVisualChange();
  }

  /** 拾取清单：全部块体+贴纸 mesh（body userData={piece}；sticker userData={piece,sticker}） */
  debugMeshHits(): Object3D[] {
    const out: Object3D[] = [];
    for (const b of this.blocks) {
      for (const c of b.group.children) {
        if (c instanceof Mesh) out.push(c);
      }
    }
    return out;
  }

  /** 立即执行（无动画；用于应用/恢复最终态） */
  applyMoveNow(mi: string): void {
    const m = MOVES[mi];
    if (!m) return;
    if (this.anim) {
      this.anim = null;
      this.syncBlocks();
    }
    this.history.push(this.clonePose(this.poseState));
    if (this.history.length > 256) this.history.shift();
    this.poseState = applyMovePose(this.poseState, mi);
    this.syncBlocks();
    this.emitVisualChange();
    this.onStateChange?.(this.poseState.state);
    this.onMoveDone?.(mi);
  }

  /**
   * 整段公式瞬时直达末态（F6 修复：从 basePose 物理推进块姿态与贴纸，
   * 保持几何与 54 贴纸严格一致，并恢复物理 faceMaterial）。
   */
  setMovesInstant(moves: string | string[]): void {
    this.anim = null;
    const base = this.createBasePose();
    const seq = parseAlg(moves);
    this.history = [this.clonePose(base)];
    let cur = base;
    for (const name of seq) {
      if (!MOVES[name]) continue;
      cur = applyMovePose(cur, name);
      this.history.push(this.clonePose(cur));
      if (this.history.length > 256) this.history.shift();
    }
    // 栈顶为当前态的前一态，与 applyMoveNow/undo 约定保持一致
    if (this.history.length > 1) this.history.pop();
    this.poseState = cur;
    this.restorePhysicalMaterials();
    this.syncBlocks();
    this.emitVisualChange();
    this.onStateChange?.(this.poseState.state);
  }

  /** 完全复位：姿态+state 回基础朝向（basePose）、恢复物理材质、清历史栈 */
  reset(): void {
    this.anim = null;
    this.poseState = this.createBasePose();
    this.history = [this.clonePose(this.poseState)];
    this.restorePhysicalMaterials();
    this.syncBlocks();
    this.emitVisualChange();
    this.onStateChange?.(this.poseState.state);
  }

  /** 撤销最后一步（弹历史栈，无动画） */
  undo(): boolean {
    if (this.history.length <= 1) return false;
    this.anim = null;
    this.poseState = this.history.pop()!;
    this.syncBlocks();
    this.emitVisualChange();
    this.onStateChange?.(this.poseState.state);
    return true;
  }

  /** 外部 54 贴纸态同步（快照重涂）：几何保持 committed 姿态，贴纸重涂为槽位色 */
  setState(state: Uint8Array): void {
    if (this.anim) {
      this.anim = null;
      this.syncBlocks();
    }
    this.poseState = { ...this.poseState, state: state.slice() as State };
    for (let i = 0; i < this.blocks.length; i++) {
      const pc = this.poseState.pieces[i];
      for (const st of this.blocks[i].stickers) {
        const n = m3Apply(pc.rot, st.dir);
        const idx = stickerIndex(pc.pos, n);
        const color = FACE_COLORS[state[idx]] ?? 0x000000;
        st.stateMaterial.color.setHex(color);
        if (st.mesh.material !== st.stateMaterial) st.mesh.material = st.stateMaterial;
      }
    }
    this.emitVisualChange();
    this.onStateChange?.(this.poseState.state);
  }

  /** F7 修复：播放中改速按比例换算已耗时 t，保持进度 t/dur 连续，不瞬移不倒退 */
  setSpeed(speed: number): void {
    this.speed = speed;
    if (this.anim) {
      const progress = this.anim.dur > 0 ? clamp(this.anim.t / this.anim.dur, 0, 1) : 0;
      const nextDur = playDur(speed);
      this.anim.dur = nextDur;
      this.anim.t = progress * nextDur;
    }
  }

  setVisible(v: boolean): void {
    this.root.visible = v;
    this.emitVisualChange();
  }

  /** 调试：第 i 块第 j 张贴纸当前材质色 hex（不含 #）与 home 法线 dir */
  debugSticker(i: number, j: number): { dir: Vec3; hex: string } {
    const st = this.blocks[i].stickers[j];
    return {
      dir: st.dir,
      hex: (st.mesh.material as MeshBasicMaterial).color.getHexString(),
    };
  }

  /** 调试：当前动画进度 [0, 1]（无动画时返回 null） */
  debugAnimProgress(): number | null {
    if (!this.anim || this.anim.dur <= 0) return null;
    return clamp(this.anim.t / this.anim.dur, 0, 1);
  }

  /** 全块变换从 committed 姿态重设 */
  private syncBlocks(): void {
    for (let i = 0; i < this.poseState.pieces.length; i++) {
      const pc = this.poseState.pieces[i];
      const g = this.blocks[i].group;
      g.position.set(pc.pos[0], pc.pos[1], pc.pos[2]);
      g.quaternion.copy(quatFromMat(pc.rot));
    }
  }

  get committedPose(): PoseState {
    return this.poseState;
  }

  /** 当前是否有动画在播（拖转可拾取的判定之一） */
  get isAnimating(): boolean {
    return this.anim != null;
  }
}

/** 3x3 列主序矩阵 → three Quaternion */
function quatFromMat(M: Vec3[]): Quaternion {
  const m4 = new Matrix4();
  m4.elements = [
    M[0][0], M[1][0], M[2][0], 0,
    M[0][1], M[1][1], M[2][1], 0,
    M[0][2], M[1][2], M[2][2], 0,
    0, 0, 0, 1,
  ];
  return new Quaternion().setFromRotationMatrix(m4);
}
