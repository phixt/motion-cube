import { TwistyPlayer } from "cubing/twisty";
import type { Object3D } from "three";
import { RenderCube } from "./render/RenderCube.ts";
import { RenderCubeHost, type RenderCubeHostOptions } from "./render/RenderCubeHost.ts";
import { applyAlg, MOVES, solvedState, type State } from "./solver/engine.ts";
import { baseFaceSetupAlg, type Face } from "./stickering";

/**
 * 层 A/C 封装：3D 魔方（3x3x3）的后端抽象。
 *
 * 两种后端（构造时 backend 选项选择，默认 'cubing' 保持现状）：
 *  - 'cubing'：基于 cubing.js TwistyPlayer（现有历史行为；键盘交互关闭内置输入，
 *    拖拽保留原生；场景惰性渲染带延迟重试踢帧）。
 *  - 'render'：R1 阶段1 自建后端（RenderCube + RenderCubeHost）——three 自建 26 块+
 *    贴纸、B1 拖转（拾面→判轴→连续角度→吸附提交）、相机对齐 cubing 默认
 *    （lat20/lon30/dist6.5）、自驱 rAF 渲染。
 *
 * 对外接口两轨等价（消费方只依赖接口，阶段 0 已收敛）：
 *  onThreeScene/requestRender/showCube/applyMove/setMoves/play/pause/reset/
 *  undoLastMove/setSpeed/setCamera。播放条语义（render 轨）：
 *    - play()：无条件从当前 _alg 序列头开始连播（等价 cubing 时间轴从头播放）；
 *      每步 playMove（可中断），poll 驱动
 *    - pause()：清「继续播放」标记（当前动画自然结束即停）
 *    - setMoves(moves)：直达末态（jumpToEnd 等价）：setState(applyAlg(solved, moves))
 *    - reset()：完全复位（solved 几何+state、历史清）
 *    - undoLastMove()：renderCube.undo()（弹历史，无动画）
 * 手动拖转只改 renderCube 历史与 state，不影响 _alg（同 cubing 拖转不进入 alg）。
 */
export type CubePlayerOptions = {
  cameraLatitude?: number;
  cameraLongitude?: number;
  cameraDistance?: number;
  /** 全局底色：游戏起始时旋转魔方使底色面朝下（cubing 后端经 setupAlg；render 后端暂忽略） */
  baseFace?: Face;
  /** 渲染后端：'cubing'（默认）| 'render'（R1 阶段1 自建） */
  backend?: "cubing" | "render";
  /** render 后端：手动拖转完成回调（轴/层/q/mi；mi=null 表示净零未提交） */
  onManualMove?: (ev: { axis: number; layer: number; q: number; mi: string | null }) => void;
  /** render 后端：54 贴纸 state 变化回调 */
  onStateChange?: (state: State) => void;
  /** render 后端：宿主附加选项（canPick/autoSpin/onInteractionChange 等） */
  hostOptions?: Omit<
    RenderCubeHostOptions,
    "container" | "renderCube" | "onManualMove" | "onStateChange"
  >;
};

export class CubePlayer {
  /** cubing 后端为 TwistyPlayer；render 后端为 null（消费方不得直接依赖它，阶段 0 已收敛） */
  element: TwistyPlayer | null = null;
  private renderHost: RenderCubeHost | null = null;
  private renderCube: RenderCube | null = null;
  /** render 后端播放队列 {seq, i, playing}；playing=false 表示已暂停 */
  private renderQueue: { seq: string[]; i: number; playing: boolean } | null = null;
  private renderPollId = 0;
  private baseFace: Face;
  private cubeObj: Object3D | null = null;
  private cubeVisible = true;
  /** 当前公式（自身维护：cubing 的 TwistyPlayer.alg getter 会抛错，不能读取） */
  private _alg = "";
  /** 设置公式后的延迟重绘定时器（cubing 后端场景懒初始化窗口内重试） */
  private renderRetries: ReturnType<typeof setTimeout>[] = [];

  /** 当前公式（用于编辑器捕获起始态等；cubing 侧不提供读取 API） */
  get currentAlg(): string {
    return this._alg;
  }

  constructor(container: HTMLElement, options: CubePlayerOptions = {}) {
    this.baseFace = options.baseFace ?? "D";
    if ((options.backend ?? "cubing") === "render") {
      this.initRenderBackend(container, options);
    } else {
      this.initCubingBackend(container, options);
    }
  }

  // ---- cubing 后端（现状保留） ----
  private initCubingBackend(container: HTMLElement, options: CubePlayerOptions): void {
    this.element = new TwistyPlayer({
      puzzle: "3x3x3",
      alg: "",
      visualization: "3D",
      background: "none",
      controlPanel: "none",
      hintFacelets: "none",
      experimentalMovePressInput: "none",
      experimentalDragInput: "auto",
      experimentalSetupAlg: baseFaceSetupAlg(this.baseFace),
      cameraLatitude: options.cameraLatitude ?? 20,
      cameraLongitude: options.cameraLongitude ?? 30,
      cameraDistance: options.cameraDistance ?? 6.5,
    });
    Object.assign(this.element.style, { width: "100%", height: "100%" });
    container.appendChild(this.element);
    void this.element
      .experimentalCurrentThreeJSPuzzleObject(() => {
        if (this.cubeObj) this.cubeObj.visible = this.cubeVisible;
      })
      .then((obj) => {
        this.cubeObj = obj ?? null;
        if (obj) obj.visible = this.cubeVisible;
      })
      .catch(() => {});
  }

  // ---- render 后端（R1 阶段1） ----
  private initRenderBackend(container: HTMLElement, options: CubePlayerOptions): void {
    const rc = new RenderCube({
      speed: 1,
      onStateChange: (s) => options.onStateChange?.(s),
    });
    const host = new RenderCubeHost({
      container,
      renderCube: rc,
      onManualMove: (ev) => options.onManualMove?.(ev),
      onStateChange: (s) => options.onStateChange?.(s),
      ...options.hostOptions,
    });
    this.renderCube = rc;
    this.renderHost = host;
    this.renderPollId = window.setInterval(() => this.renderPoll(), 60);
  }

  /** render 后端播放队列驱动：空闲时播下一条；播完或暂停后清队列 */
  private renderPoll(): void {
    const rc = this.renderCube;
    const q = this.renderQueue;
    if (!rc || !q) return;
    if (!q.playing) {
      if (!rc.isAnimating) this.renderQueue = null;
      return;
    }
    if (!rc.isAnimating && q.i < q.seq.length) {
      const name = q.seq[q.i++];
      if (MOVES[name]) rc.playMove(name);
    }
    if (q.i >= q.seq.length && !rc.isAnimating) this.renderQueue = null;
  }

  private stopRenderQueue(): void {
    if (this.renderQueue) this.renderQueue.playing = false;
  }

  /// ---- 抽象渲染接口（阶段 0 收敛；两后端等价实现） ----

  onThreeScene(onRecreate: () => void): Promise<Object3D> {
    if (this.renderCube) {
      // render 后端无场景重建：root 已挂在宿主场景，onRecreate 不触发
      void onRecreate;
      return Promise.resolve(this.renderCube.root);
    }
    return this.element!.experimentalCurrentThreeJSPuzzleObject(onRecreate);
  }

  async requestRender(): Promise<void> {
    if (this.renderHost) return; // 宿主自驱 rAF 每帧渲染
    try {
      const vantages = await this.element!.experimentalCurrentVantages();
      for (const v of vantages) v.scheduleRender();
    } catch {
      // 场景未就绪忽略
    }
  }

  async showCube(visible: boolean): Promise<void> {
    this.cubeVisible = visible;
    if (this.renderCube) {
      this.renderCube.setVisible(visible);
      return;
    }
    if (this.cubeObj) this.cubeObj.visible = visible;
    await this.requestRender();
  }

  /** 追加一步并立即动画：键盘映射的核心通道 */
  applyMove(move: string): void {
    this._alg = this._alg ? `${this._alg} ${move}` : move;
    if (this.renderCube) {
      const name = move.trim();
      if (MOVES[name]) this.renderCube.playMove(name);
      return;
    }
    this.element!.experimentalAddMove(move, { cancel: true });
  }

  /** 整段公式替换并直达末态（cubing jumpToEnd 等价；render 后端 = setState 末态） */
  setMoves(moves: string): void {
    this._alg = moves;
    if (this.renderCube) {
      this.stopRenderQueue();
      this.renderCube.setState(applyAlg(solvedState(), moves));
      return;
    }
    this.element!.alg = moves;
    this.element!.jumpToEnd();
    this.clearRenderRetries();
    this.kickRender();
    this.renderRetries = [500, 2000, 5000].map((ms) => setTimeout(() => this.kickRender(), ms));
  }

  /** 取消挂起的延迟重绘（cubing 后端） */
  private clearRenderRetries(): void {
    for (const id of this.renderRetries) clearTimeout(id);
    this.renderRetries = [];
  }

  /** 强制 cubing 重绘 */
  private async kickRender(): Promise<void> {
    try {
      const vantages = await this.element!.experimentalCurrentVantages();
      for (const v of vantages) v.scheduleRender();
    } catch {
      // 场景未就绪时忽略
    }
  }

  /** 播放：render 后端从头连播 _alg 序列（cubing 时间轴从头播放等价） */
  play(): void {
    if (this.renderCube) {
      const seq = this._alg.split(/\s+/).filter(Boolean);
      if (seq.length === 0) {
        this.renderQueue = null;
        return;
      }
      this.stopRenderQueue();
      this.renderQueue = { seq, i: 0, playing: true };
      return;
    }
    this.element!.play();
  }

  pause(): void {
    if (this.renderCube) {
      this.stopRenderQueue();
      return;
    }
    this.element!.pause();
  }

  reset(): void {
    this._alg = "";
    if (this.renderCube) {
      this.stopRenderQueue();
      this.renderCube.reset();
      return;
    }
    this.element!.alg = "";
    this.clearRenderRetries();
    this.kickRender();
    this.renderRetries = [500, 2000].map((ms) => setTimeout(() => this.kickRender(), ms));
  }

  /** 撤销最后一步（render 后端弹历史栈；cubing 原生动画撤销） */
  undoLastMove(): void {
    this._alg = this._alg.split(/\s+/).filter(Boolean).slice(0, -1).join(" ");
    if (this.renderCube) {
      this.renderCube.undo();
      return;
    }
    this.element!.experimentalRemoveFinalChild();
  }

  /** tempoScale：1 = 1x，越大越快 */
  setSpeed(speed: number): void {
    if (this.renderCube) {
      this.renderCube.setSpeed(speed);
      return;
    }
    this.element!.tempoScale = speed;
  }

  setCamera(latitude: number, longitude: number, distance: number): void {
    if (this.renderHost) {
      this.renderHost.setCamera(
        (longitude * Math.PI) / 180,
        (latitude * Math.PI) / 180,
        distance,
      );
      return;
    }
    this.element!.cameraLatitude = latitude;
    this.element!.cameraLongitude = longitude;
    this.element!.cameraDistance = distance;
  }

  /** 释放后端资源（render 后端卸载宿主与轮询；cubing 后端移除元素） */
  dispose(): void {
    if (this.renderHost) {
      window.clearInterval(this.renderPollId);
      this.renderHost.dispose();
      this.renderHost = null;
      this.renderCube = null;
      this.renderQueue = null;
      return;
    }
    this.clearRenderRetries();
    this.element?.remove();
  }
}