import "./style.css";
import { CubePlayer } from "./cube/CubePlayer";
import { KeymapController, type SpecialAction } from "./input/keymap";
import { mountHud, type HudApi } from "./ui/hud";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("missing #app mount point");
}

app.innerHTML = `
  <header class="hud-bar">
    <h1>Motion Cube <span class="hud-sub">spike</span></h1>
  </header>
  <main class="stage" id="stage"></main>
  <div id="hud"></div>
`;

const stage = app.querySelector<HTMLElement>("#stage");
const hudRoot = app.querySelector<HTMLElement>("#hud");
if (!stage || !hudRoot) {
  throw new Error("missing stage/hud mount points");
}

const player = new CubePlayer(stage, { cameraDistance: 6.5 });
const hud: HudApi = mountHud(hudRoot, player);

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

const keymap = new KeymapController(player, {
  onMove: (move) => {
    history.push(move);
    hud.logMove(move);
    hud.setStatus("");
  },
  onSpecial: handleSpecial,
});
keymap.attach();

// 调试句柄：浏览器控制台可验证（puppeteer/手动）
declare global {
  interface Window {
    __motionCube?: { player: CubePlayer; keymap: KeymapController };
  }
}
window.__motionCube = { player, keymap };
