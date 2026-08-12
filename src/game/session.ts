/**
 * 游戏会话（Vue 壳版）：CubePlayer + 键盘/标灰/撤销/重置/播放 逻辑，与 HUD 解耦。
 * HUD 由 GamePage.vue 用 Win 控件渲染，通过 hooks 同步日志/状态/播放态。
 */
import { CubePlayer } from "../cube/CubePlayer";
import { GrayOverlay } from "../cube/GrayOverlay";
import { createGrayState, presetGrayState, type GrayPreset, type GrayState } from "../cube/stickering";
import { KeymapController, type SpecialAction } from "../input/keymap";
import { t } from "../i18n";
import { parseMoves } from "../notation/alg";
import { loadKeymap, loadSettings } from "../settings";
import { renderGrayPanel } from "../ui/grayPanel";

declare global {
  interface Window {
    __motionCube?: { player: CubePlayer; keymap: KeymapController };
  }
}

export type GameSessionHooks = {
  onMove: (move: string) => void;
  onUndo: () => void;
  onReset: () => void;
  onStatus: (text: string) => void;
  onPlaying: (playing: boolean) => void;
};

export type GameSession = {
  player: CubePlayer;
  keymap: KeymapController;
  gray: { togglePanel: () => void };
  togglePlay: () => void;
  /** 应用公式：成功返回规范化后的公式串，失败返回 null */
  applyAlg: (input: string) => string | null;
  setSpeed: (v: number) => void;
  dispose: () => void;
};

export function createGameSession(
  stage: HTMLElement,
  grayPanelHost: HTMLElement,
  hooks: GameSessionHooks,
): GameSession {
  const settings = loadSettings();
  const player = new CubePlayer(stage, { cameraDistance: 6.5, baseFace: settings.baseFace });

  // ---- 标灰：状态 + 3D 覆盖层 + 面板 ----
  const grayState: { state: GrayState } = { state: createGrayState() };
  const overlay = new GrayOverlay(player);
  void overlay.init().then(() => overlay.requestApply(grayState.state));
  grayPanelHost.hidden = true;
  let grayPanelApi: ReturnType<typeof renderGrayPanel>;
  overlay.setRenderListener(() => grayPanelApi?.refresh());
  grayPanelApi = renderGrayPanel(grayPanelHost, {
    getState: () => grayState.state,
    setState: (s) => {
      grayState.state = s;
      overlay.requestApply(s);
      grayPanelApi.refresh();
    },
    getBase: () => settings.baseFace,
    getKind: () => "mutable",
    getPositions: () => overlay.currentPositions(),
    applyPreset: (p: GrayPreset | "clear") => {
      grayState.state = p === "clear" ? createGrayState() : presetGrayState(p, settings.baseFace);
      overlay.requestApply(grayState.state);
      grayPanelApi.refresh();
    },
  });

  const history: string[] = [];
  let playing = false;

  function setPlaying(value: boolean): void {
    playing = value;
    hooks.onPlaying(value);
  }

  function undo(): void {
    if (history.length === 0) {
      hooks.onStatus(t("hud.statusNoUndo"));
      return;
    }
    history.pop();
    hooks.onUndo();
    player.undoLastMove();
    hooks.onStatus(history.length ? t("hud.statusUndo") : t("hud.statusCleared"));
  }

  function reset(): void {
    history.length = 0;
    hooks.onReset();
    player.reset();
    setPlaying(false);
    hooks.onStatus(t("hud.statusReset"));
  }

  function togglePlay(): void {
    if (playing) {
      player.pause();
      setPlaying(false);
    } else {
      player.play();
      setPlaying(true);
    }
  }

  function applyAlg(input: string): string | null {
    const moves = input.trim();
    if (!moves) {
      hooks.onStatus(t("hud.statusEmpty"));
      return null;
    }
    const parsed = parseMoves(moves);
    if (!parsed.ok) {
      hooks.onStatus(t("hud.statusParseFail", { error: parsed.error }));
      return null;
    }
    player.setMoves(parsed.normalized);
    hooks.onReset();
    hooks.onStatus(t("hud.statusApplied"));
    return parsed.normalized;
  }

  function handleSpecial(action: SpecialAction): void {
    if (action === "undo") undo();
    else if (action === "reset") reset();
    else if (action === "toggle-play") togglePlay();
  }

  const keymap = new KeymapController(
    player,
    {
      onMove: (move) => {
        history.push(move);
        hooks.onMove(move);
        hooks.onStatus("");
      },
      onSpecial: handleSpecial,
    },
    loadKeymap(),
  );
  keymap.setMoveCooldown(settings.moveCooldownMs);
  keymap.attach();

  window.__motionCube = { player, keymap };

  return {
    player,
    keymap,
    gray: {
      togglePanel: () => {
        grayPanelHost.hidden = !grayPanelHost.hidden;
      },
    },
    togglePlay,
    applyAlg,
    setSpeed: (v) => player.setSpeed(v),
    dispose: () => {
      overlay.dispose();
      keymap.detach();
      delete window.__motionCube;
    },
  };
}
