import { TwistyPlayer } from "cubing/twisty";
import { baseFaceSetupAlg, type Face } from "./stickering";

/**
 * 层 A/C 封装：基于 cubing.js TwistyPlayer 的 3D 魔方（3x3x3）。
 * 键盘交互关闭内置输入，由 input/keymap 自定义层接管；拖拽保留原生行为待 Spike 验证。
 */
export type CubePlayerOptions = {
  cameraLatitude?: number;
  cameraLongitude?: number;
  cameraDistance?: number;
  /** 全局底色：游戏起始时旋转魔方使底色面朝下 */
  baseFace?: Face;
};

export class CubePlayer {
  readonly element: TwistyPlayer;

  constructor(container: HTMLElement, options: CubePlayerOptions = {}) {
    this.element = new TwistyPlayer({
      puzzle: "3x3x3",
      alg: "",
      visualization: "3D",
      background: "none",
      controlPanel: "none",
      hintFacelets: "none",
      // 键盘：关闭内置输入，由 keymap 层接管（docs/base.md 要求自定义键位）
      experimentalMovePressInput: "none",
      // 拖拽：保留内置视角拖拽，验证其行为后再决定自定义手势层
      experimentalDragInput: "auto",
      experimentalSetupAlg: baseFaceSetupAlg(options.baseFace ?? "D"),
      cameraLatitude: options.cameraLatitude ?? 20,
      cameraLongitude: options.cameraLongitude ?? 30,
      cameraDistance: options.cameraDistance ?? 6.5,
    });
    Object.assign(this.element.style, { width: "100%", height: "100%" });
    container.appendChild(this.element);
  }

  /** 追加一步并立即动画：键盘映射的核心通道 */
  applyMove(move: string): void {
    this.element.experimentalAddMove(move, { cancel: true });
  }

  /** 整段公式替换（应用/编辑场景） */
  setMoves(moves: string): void {
    this.element.alg = moves;
  }

  play(): void {
    this.element.play();
  }

  pause(): void {
    this.element.pause();
  }

  reset(): void {
    this.element.alg = "";
  }

  /** 撤销最后一步（原生动画撤销） */
  undoLastMove(): void {
    this.element.experimentalRemoveFinalChild();
  }

  /** tempoScale：1 = 1x，越大越快 */
  setSpeed(speed: number): void {
    this.element.tempoScale = speed;
  }

  setCamera(latitude: number, longitude: number, distance: number): void {
    this.element.cameraLatitude = latitude;
    this.element.cameraLongitude = longitude;
    this.element.cameraDistance = distance;
  }
}
