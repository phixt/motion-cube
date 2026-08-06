import type { CubePlayer } from "../cube/CubePlayer";
import { t } from "../i18n";
import { parseMoves } from "../notation/alg";

/**
 * 游戏页 DOM HUD：公式输入/播放控制/速度 + 移动日志。
 * 挂载到 #hud（root）；底部日志面板挂到同层容器（路由切换时随页面一起清理）。
 */
export type HudApi = {
  logMove: (move: string) => void;
  removeLastMove: () => void;
  clearLog: () => void;
  setStatus: (text: string) => void;
  setPlaying: (playing: boolean) => void;
};

export function mountHud(root: HTMLElement, player: CubePlayer): HudApi {
  root.innerHTML = `
    <div class="controls-row">
      <input id="alg-input" type="text" spellcheck="false" placeholder="${t("hud.algPlaceholder")}" />
      <button id="btn-apply">${t("hud.apply")}</button>
      <button id="btn-play">${t("hud.play")}</button>
      <button id="btn-reset">${t("hud.reset")}</button>
      <button id="btn-gray">${t("gray.btn")}</button>
      <label class="speed-label">${t("hud.speed")} <output id="speed-out">1.0x</output></label>
      <input id="speed" type="range" min="0.1" max="3" step="0.1" value="1" />
      <span id="hud-status"></span>
    </div>
    <div class="key-help">${t("hud.keyHelp")}</div>
  `;

  const input = root.querySelector<HTMLInputElement>("#alg-input")!;
  const btnApply = root.querySelector<HTMLButtonElement>("#btn-apply")!;
  const btnPlay = root.querySelector<HTMLButtonElement>("#btn-play")!;
  const btnReset = root.querySelector<HTMLButtonElement>("#btn-reset")!;
  const speed = root.querySelector<HTMLInputElement>("#speed")!;
  const speedOut = root.querySelector<HTMLOutputElement>("#speed-out")!;
  const status = root.querySelector<HTMLSpanElement>("#hud-status")!;

  const bottom = document.createElement("div");
  bottom.id = "bottom-panel";
  bottom.innerHTML = `
    <div class="panel-title">${t("hud.logTitle")} <span class="panel-muted">${t("hud.logMuted")}</span></div>
    <div id="move-log"></div>
  `;
  (root.parentElement ?? root).appendChild(bottom);
  const moveLog = bottom.querySelector<HTMLDivElement>("#move-log")!;

  let playing = false;

  const api: HudApi = {
    logMove(move) {
      const chip = document.createElement("span");
      chip.className = "move-chip";
      chip.textContent = move;
      moveLog.appendChild(chip);
      while (moveLog.children.length > 24) moveLog.firstElementChild?.remove();
      moveLog.scrollLeft = moveLog.scrollWidth;
    },
    removeLastMove() {
      moveLog.lastElementChild?.remove();
    },
    clearLog() {
      moveLog.replaceChildren();
    },
    setStatus(text) {
      status.textContent = text;
    },
    setPlaying(value) {
      playing = value;
      btnPlay.textContent = value ? t("hud.pause") : t("hud.play");
    },
  };

  btnApply.addEventListener("click", () => {
    const moves = input.value.trim();
    if (!moves) {
      api.setStatus(t("hud.statusEmpty"));
      return;
    }
    const parsed = parseMoves(moves);
    if (!parsed.ok) {
      api.setStatus(t("hud.statusParseFail", { error: parsed.error }));
      return;
    }
    player.setMoves(parsed.normalized);
    input.value = parsed.normalized;
    api.clearLog();
    api.setStatus(t("hud.statusApplied"));
  });

  btnPlay.addEventListener("click", () => {
    if (playing) {
      player.pause();
      api.setPlaying(false);
    } else {
      player.play();
      api.setPlaying(true);
    }
  });

  btnReset.addEventListener("click", () => {
    player.reset();
    api.setPlaying(false);
  });

  speed.addEventListener("input", () => {
    const v = Number(speed.value);
    player.setSpeed(v);
    speedOut.textContent = `${v.toFixed(1)}x`;
  });

  return api;
}
