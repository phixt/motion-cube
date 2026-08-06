import { CubePlayer } from "../cube/CubePlayer";
import { KeymapController, type SpecialAction } from "../input/keymap";
import { loadKeymap, loadSettings } from "../settings";
import { mountHud, type HudApi } from "../ui/hud";
import { navBar } from "../ui/nav";

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
        <h1>Motion Cube <span class="hud-sub">game</span></h1>
      </header>
      <main class="stage" id="stage"></main>
      <div id="hud"></div>
    </div>
  `;
  const gameTop = root.querySelector<HTMLElement>(".game-top")!;
  gameTop.appendChild(navBar("game"));

  const stage = root.querySelector<HTMLElement>("#stage")!;
  const hudRoot = root.querySelector<HTMLElement>("#hud")!;
  const player = new CubePlayer(stage, { cameraDistance: 6.5 });
  const hud: HudApi = mountHud(hudRoot, player);
  const settings = loadSettings();
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
    keymap.detach();
    delete window.__motionCube;
    root.innerHTML = "";
  };
}
