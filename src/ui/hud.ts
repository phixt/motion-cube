import type { CubePlayer } from "../cube/CubePlayer";
import { notationSelfTest, parseMoves } from "../notation/alg";

/**
 * DOM HUD 层（Spike 版）：公式输入/播放控制/速度/记法自检 + 移动日志。
 * 后续替换为正式工具栏与库面板。
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
      <input id="alg-input" type="text" spellcheck="false"
        placeholder="公式，如 R U R' U R U2' R'（支持 M/E/S、r/u 双层、x/y/z、交换子）" />
      <button id="btn-apply">应用</button>
      <button id="btn-play">播放</button>
      <button id="btn-reset">重置</button>
      <label class="speed-label">速度 <output id="speed-out">1.0x</output></label>
      <input id="speed" type="range" min="0.1" max="3" step="0.1" value="1" />
      <button id="btn-verify">记法自检</button>
      <span id="hud-status"></span>
    </div>
    <div class="key-help">
      面 U D L R F B ｜ 中层 M E S ｜ 旋转 X Y Z ｜ 反转 Shift ｜ 双层 Space+面键 ｜
      撤销 Backspace ｜ 重置 Esc ｜ 播放/暂停 P ｜ 拖拽=转视角
    </div>
  `;

  const input = root.querySelector<HTMLInputElement>("#alg-input")!;
  const btnApply = root.querySelector<HTMLButtonElement>("#btn-apply")!;
  const btnPlay = root.querySelector<HTMLButtonElement>("#btn-play")!;
  const btnReset = root.querySelector<HTMLButtonElement>("#btn-reset")!;
  const btnVerify = root.querySelector<HTMLButtonElement>("#btn-verify")!;
  const speed = root.querySelector<HTMLInputElement>("#speed")!;
  const speedOut = root.querySelector<HTMLOutputElement>("#speed-out")!;
  const status = root.querySelector<HTMLSpanElement>("#hud-status")!;

  const bottom = document.createElement("div");
  bottom.id = "bottom-panel";
  bottom.innerHTML = `
    <div class="panel-title">移动日志 <span class="panel-muted">（键盘/按钮产生的逐步动作）</span></div>
    <div id="move-log"></div>
    <pre id="self-test" hidden></pre>
  `;
  document.body.appendChild(bottom);
  const moveLog = bottom.querySelector<HTMLDivElement>("#move-log")!;
  const selfTest = bottom.querySelector<HTMLPreElement>("#self-test")!;

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
      btnPlay.textContent = value ? "暂停" : "播放";
    },
  };

  btnApply.addEventListener("click", () => {
    const moves = input.value.trim();
    if (!moves) {
      api.setStatus("请输入公式");
      return;
    }
    const parsed = parseMoves(moves);
    if (!parsed.ok) {
      api.setStatus(`解析失败：${parsed.error}`);
      return;
    }
    player.setMoves(parsed.normalized);
    input.value = parsed.normalized;
    api.clearLog();
    api.setStatus("已应用");
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

  btnVerify.addEventListener("click", () => {
    const lines = notationSelfTest();
    selfTest.textContent = lines.join("\n");
    selfTest.hidden = false;
    const failed = lines.filter((l) => l.startsWith("FAIL")).length;
    api.setStatus(`记法自检完成：${lines.length - failed}/${lines.length} 通过`);
  });

  return api;
}
