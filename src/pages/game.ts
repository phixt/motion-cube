import { CubePlayer } from "../cube/CubePlayer";
import { GrayOverlay } from "../cube/GrayOverlay";
import { createGrayState, presetGrayState, type GrayPreset, type GrayState } from "../cube/stickering";
import "../styles/game.css";
import { KeymapController, type SpecialAction } from "../input/keymap";
import { loadKeymap, loadSettings } from "../settings";
import { renderGrayPanel } from "../ui/grayPanel";
import { mountHud, type HudApi } from "../ui/hud";
import { navBar } from "../ui/nav";
import { t } from "../i18n";

declare global {
  interface Window {
    __motionCube?: { player: CubePlayer; keymap: KeymapController };
  }
}

/** 挂载游戏页，返回清理函数（路由切换时调用） */
export function mountGamePage(root: HTMLElement): () => void {
  root.innerHTML = `
    <div class="game-page">
      <header class="game-top">
        <h1>Motion Cube <span class="hud-sub">${t("game.sub")}</span></h1>
      </header>
      <main class="stage" id="stage"></main>
      <div id="hud"></div>
    </div>
  `;
  const gameTop = root.querySelector<HTMLElement>(".game-top")!;
  gameTop.appendChild(navBar("game"));

  const stage = root.querySelector<HTMLElement>("#stage")!;
  const hudRoot = root.querySelector<HTMLElement>("#hud")!;
  const settings = loadSettings();
  const player = new CubePlayer(stage, { cameraDistance: 6.5, baseFace: settings.baseFace });
  const hud: HudApi = mountHud(hudRoot, player);

  // 标灰：状态 + 3D 覆盖层 + 面板
  const gray: { state: GrayState } = { state: createGrayState() };
  const overlay = new GrayOverlay(player);
  void overlay.init().then(() => overlay.requestApply(gray.state));
  const grayPanelBox = document.createElement("div");
  grayPanelBox.id = "gray-panel";
  grayPanelBox.hidden = true;
  root.querySelector(".game-page")?.appendChild(grayPanelBox);
  let grayPanelApi: ReturnType<typeof renderGrayPanel>;
  overlay.setRenderListener(() => grayPanelApi?.refresh());
  grayPanelApi = renderGrayPanel(grayPanelBox, {
    getState: () => gray.state,
    setState: (s) => {
      gray.state = s;
      overlay.requestApply(s);
      grayPanelApi.refresh();
    },
    getBase: () => settings.baseFace,
    getPositions: () => overlay.currentPositions(),
    applyPreset: (p: GrayPreset | "clear") => {
      gray.state = p === "clear" ? createGrayState() : presetGrayState(p, settings.baseFace);
      overlay.requestApply(gray.state);
      grayPanelApi.refresh();
    },
  });
  hudRoot.querySelector<HTMLButtonElement>("#btn-gray")?.addEventListener("click", () => {
    grayPanelBox.hidden = !grayPanelBox.hidden;
  });

  const history: string[] = [];
  let playing = false;

  function handleSpecial(action: SpecialAction): void {
    if (action === "undo") {
      if (history.length === 0) {
        hud.setStatus("没有可撤销的步骤");
        return;
      }
      history.pop();
      hud.removeLastMove();
      player.undoLastMove();
      hud.setStatus(history.length ? "已撤销一步" : "已清空");
    } else if (action === "reset") {
      history.length = 0;
      hud.clearLog();
      player.reset();
      playing = false;
      hud.setPlaying(false);
      hud.setStatus("已重置");
    } else if (action === "toggle-play") {
      playing = !playing;
      if (playing) player.play();
      else player.pause();
      hud.setPlaying(playing);
    }
  }

  const keymap = new KeymapController(
    player,
    {
      onMove: (move) => {
        history.push(move);
        hud.logMove(move);
        hud.setStatus("");
      },
      onSpecial: handleSpecial,
    },
    loadKeymap(),
  );
  keymap.setMoveCooldown(settings.moveCooldownMs);
  keymap.attach();

  window.__motionCube = { player, keymap };

  return () => {
    overlay.dispose();
    keymap.detach();
    delete window.__motionCube;
    root.innerHTML = "";
  };
}
