<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import WinButton from "../../vendor/winui-on-web/components/WinButton.vue";
import WinSlider from "../../vendor/winui-on-web/components/WinSlider.vue";
import WinTextBox from "../../vendor/winui-on-web/components/WinTextBox.vue";
import WinTextBlock from "../../vendor/winui-on-web/components/WinTextBlock.vue";
import { createGameSession, type GameSession } from "../../game/session";
import { clearSnapshot, loadSnapshot, saveSnapshot } from "../../data/snapshot";
import { parseMoves } from "../../notation/alg";
import { useI18n } from "../i18n";
import { applyAlg as applyAlgState, randomScramble, solvedState, solve as solveCube, prepareSolvers } from "../../cube/solver";
import type { SolveResult } from "../../cube/solver";
import { baseFaceSetupAlg } from "../../cube/stickering";
import { loadSettings } from "../../settings";

const { t } = useI18n();

const stageEl = ref<HTMLElement | null>(null);
const grayPanelEl = ref<HTMLElement | null>(null);
const moveLogEl = ref<HTMLElement | null>(null);

const algText = ref("");
const playing = ref(false);
const status = ref("");
const speed = ref(1);
const moves = ref<string[]>([]);

const solveMethod = ref<"cfop" | "cfop-adv" | "roux">("cfop");
const solving = ref(false);
const solveResult = ref<SolveResult | null>(null);
const solveError = ref("");
const scrambleAlg = ref("");

/** 复制文本到剪贴板（失败时降级 execCommand；返回是否成功） */
const copyText = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
};

const copyScramble = async (): Promise<void> => {
  if (!scrambleAlg.value) return;
  status.value = (await copyText(scrambleAlg.value)) ? t("hud.copied") : t("hud.copyFail");
};

const copySolve = async (): Promise<void> => {
  if (!solveResult.value || !solveResult.value.moves.length) return;
  status.value = (await copyText(solveResult.value.moves.join(" "))) ? t("hud.copied") : t("hud.copyFail");
};

// 解法演示：从当前打乱态逐步施加解法（不重放打乱）
const demoRunning = ref(false);
let demoToken = 0;
let sleepResolve: (() => void) | null = null;
const cancelDemo = (): void => {
  demoToken++;
  if (sleepResolve) { const r = sleepResolve; sleepResolve = null; r(); }
  if (demoRunning.value) demoRunning.value = false;
};

let session: GameSession | null = null;

const logMove = (move: string): void => {
  moves.value.push(move);
  if (moves.value.length > 24) moves.value.splice(0, moves.value.length - 24);
  void nextTick(() => {
    if (moveLogEl.value) moveLogEl.value.scrollLeft = moveLogEl.value.scrollWidth;
  });
};

onMounted(() => {
  if (!stageEl.value || !grayPanelEl.value) return;
  session = createGameSession(stageEl.value, grayPanelEl.value, {
    onMove: (m) => { cancelDemo(); logMove(m); },
    onUndo: () => { cancelDemo(); moves.value.pop(); },
    onReset: () => { cancelDemo(); moves.value = []; },
    onStatus: (s) => (status.value = s),
    onPlaying: (p) => (playing.value = p),
  });
  // 求解表预热：避免首次点击求解把建表（PDB+图库，~几百 ms）算进求解耗时
  const run = (): void => { try { prepareSolvers(); } catch { /* 预热失败也可在首次求解时惰性建表 */ } };
  if ("requestIdleCallback" in window) (window as unknown as { requestIdleCallback: (f: () => void, o?: { timeout: number }) => void }).requestIdleCallback(run, { timeout: 2000 });
  else setTimeout(run, 100);
// 进度快照：进入游戏恢复上次达成步骤
  const snap = loadSnapshot();
  if (snap) {
    session.player.setMoves(snap.alg);
    // cubing 惰性渲染：恢复状态后强制重绘（走 CubePlayer 抽象接口）
    void session.player.requestRender();
    const parsed = parseMoves(snap.alg);
    moves.value = parsed.ok ? parsed.normalized.split(/\s+/).filter(Boolean) : [];
    status.value = "已恢复上次进度";
  }
});

onBeforeUnmount(() => {
  cancelDemo();
  session?.dispose();
  session = null;
});

const applyAlg = (): void => {
  cancelDemo();
  const normalized = session?.applyAlg(algText.value);
  scrambleAlg.value = "";
  if (normalized !== null && normalized !== undefined) algText.value = normalized;
};
const togglePlay = (): void => session?.togglePlay();
const reset = (): void => {
  cancelDemo();
  session?.player.reset();
  moves.value = [];
  scrambleAlg.value = "";
  status.value = t("hud.statusReset");
};
const toggleGray = (): void => session?.gray.togglePanel();

watch(speed, (v) => session?.setSpeed(v));

// 每步达成后自动保存快照（复用编辑器/tauri 持久）
watch(
  moves,
  (m) => saveSnapshot(m.join(" ")),
  { deep: true },
);

const clearProgress = (): void => {
  cancelDemo();
  clearSnapshot();
  session?.player.reset();
  moves.value = [];
  scrambleAlg.value = "";
};

/** 生成随机打乱（20 步，与 WCA 同风格）并逐步播放。
 *  打乱固定 3 倍速（用户确认：打乱默认 3x，不受演示滑条控制）；
 *  解法演示播放仍由 speed 滑条控制（见 demoSolve）。 */
const scrambleCube = async (): Promise<void> => {
  if (!session || demoRunning.value) return;
  cancelDemo();
  const scr = randomScramble(20).join(" ");
  scrambleAlg.value = scr;
  status.value = t("hud.scrambled", { n: 20 });
  session.player.pause();
  demoRunning.value = true;
  const myToken = demoToken;
  // 打乱默认 3 倍速独立于滑条（420/3=140ms 每步；不低于 60ms）
  const delay = Math.max(60, 420 / 3);
  for (const mv of scr.split(" ")) {
    if (demoToken !== myToken) return;
    session.player.applyMove(mv);
    await new Promise<void>((r) => {
      sleepResolve = r;
      setTimeout(() => { if (sleepResolve === r) sleepResolve = null; r(); }, delay);
    });
  }
  if (demoToken !== myToken) return;
  demoRunning.value = false;
  session.player.pause(); // 停在打乱态
};

/** 当前真实魔方状态：已解 + 底色整体旋转（六色底开关关 = 固定 D）+ 玩家步 */
const currentState = (): Uint8Array => {
  const s = loadSettings();
  const base = s.sixColorBase ? s.baseFace : "D";
  const setup = baseFaceSetupAlg(base);
  const alg = (setup ? setup + " " : "") + (session?.player.currentAlg ?? "");
  return applyAlgState(solvedState(), alg);
};

const doSolve = (): void => {
  if (!session || solving.value || demoRunning.value) return;
  cancelDemo();
  solving.value = true;
  solveResult.value = null;
  solveError.value = "";
  status.value = t("solve.solving");
  // 让状态栏/按钮先刷新，再跑同步求解（预热未完成时首解会建表 ~几百 ms）
  void nextTick(() => {
    try {
      const res = solveCube(currentState(), solveMethod.value);
      solveResult.value = res;
      status.value = res.moves.length ? t("solve.total", { n: res.moves.length }) : t("solve.empty");
    } catch (e) {
      solveError.value = (e as Error).message;
      status.value = t("solve.fail", { error: solveError.value });
    } finally {
      solving.value = false;
    }
  });
};

const closeSolve = (): void => {
  cancelDemo();
  solveResult.value = null;
  solveError.value = "";
};

/** 演示：从当前打乱态开始，逐步播放解法（不重放打乱） */
const demoSolve = async (): Promise<void> => {
  if (!session || !solveResult.value || demoRunning.value) return;
  const movesToShow = solveResult.value.moves;
  if (!movesToShow.length) return;
  cancelDemo();
  demoRunning.value = true;
  const myToken = demoToken;
  session.player.pause();
  const delay = Math.max(60, 420 / speed.value);
  for (const mv of movesToShow) {
    if (demoToken !== myToken) return;
    session.player.applyMove(mv);
    await new Promise<void>((r) => {
      sleepResolve = r;
      setTimeout(() => { if (sleepResolve === r) sleepResolve = null; r(); }, delay);
    });
  }
  if (demoToken !== myToken) return;
  demoRunning.value = false;
  scrambleAlg.value = "";
  status.value = t("solve.done");
};
</script>

<template>
  <div class="game-page-vue">
    <header class="game-header">
      <WinTextBlock :Text="t('game.title')" FontSize="20" FontWeight="SemiBold" />
      <WinTextBlock class="game-sub" :Text="t('game.sub')" FontSize="13" />
    </header>

    <div class="game-hud">
      <WinTextBox v-model:Text="algText" class="hud-alg" :PlaceholderText="t('hud.algPlaceholder')" />
      <WinButton id="btn-apply" :Content="t('hud.apply')" @Click="applyAlg" />
      <WinButton id="btn-play" :Content="playing ? t('hud.pause') : t('hud.play')" @Click="togglePlay" />
      <WinButton id="btn-scramble" :Content="t('hud.scramble')" @Click="scrambleCube" />
      <WinButton id="btn-reset" :Content="t('hud.reset')" @Click="reset" />
      <WinButton id="btn-gray" :Content="t('gray.btn')" @Click="toggleGray" />
      <WinButton id="btn-clear-progress" :Content="t('hud.clearProgress')" @Click="clearProgress" />
      <WinTextBlock class="speed-label" :Text="`${t('hud.speed')} ${speed.toFixed(1)}x`" FontSize="13" />
      <WinSlider id="speed" class="hud-speed" v-model:Value="speed" :Minimum="0.1" :Maximum="3" StepFrequency="0.1" />
      <span id="solve-method" class="solve-method">
        <WinButton id="btn-method-cfop" :class="['method-btn', { active: solveMethod === 'cfop' }]" :Content="t('solve.methodCfop')" @Click="solveMethod = 'cfop'" />
        <WinButton id="btn-method-cfop-adv" :class="['method-btn', { active: solveMethod === 'cfop-adv' }]" :Content="t('solve.methodCfopAdv')" @Click="solveMethod = 'cfop-adv'" />
        <WinButton id="btn-method-roux" :class="['method-btn', { active: solveMethod === 'roux' }]" :Content="t('solve.methodRoux')" @Click="solveMethod = 'roux'" />
        <WinButton id="btn-solve" :Content="t('solve.btn')" @Click="doSolve" />
      </span>
      <span id="hud-status" class="hud-status">{{ status }}</span>
    </div>

    <div v-if="scrambleAlg" class="scramble-bar">
      <span class="scramble-label">{{ t("hud.scrambleAlg") }}</span>
      <code id="scramble-alg" class="scramble-alg">{{ scrambleAlg }}</code>
      <WinButton id="btn-copy-scramble" :Content="t('hud.copy')" @Click="copyScramble" />
    </div>

    <WinTextBlock class="key-help" :Text="t('hud.keyHelp')" FontSize="12" />

    <main ref="stageEl" class="stage"></main>

    <div ref="grayPanelEl" id="gray-panel" class="gray-panel"></div>

    <div v-if="solving" class="solve-panel">
      <div class="solve-title">{{ t("solve.solving") }}…</div>
    </div>

    <div v-else-if="solveError" class="solve-panel">
      <div class="solve-title">{{ t("solve.fail") }}</div>
      <div class="solve-error">{{ solveError }}</div>
      <WinButton :Content="t('solve.close')" @Click="closeSolve" />
    </div>

    <div v-else-if="solveResult" class="solve-panel">
      <div class="solve-title">
        {{ solveResult.short }}
        <span class="panel-muted">
          {{ t("solve.total", { n: solveResult.moves.length }) }} · {{ Math.round(solveResult.ms) }}ms
        </span>
      </div>
      <ul class="solve-stages">
        <li v-for="(s, i) in solveResult.stages" :key="i" class="solve-stage">
          <span class="stage-short">{{ s.short }}</span>
          <span class="stage-algs" v-if="s.algs && s.algs.length">{{ s.algs.join(" · ") }}</span>
          <span class="stage-moves">{{ s.moves.join(" ") || "–" }}</span>
          <span class="stage-count">{{ s.moves.length }}</span>
        </li>
      </ul>
      <div class="solve-actions">
        <WinButton v-if="solveResult.moves.length" :Content="demoRunning ? t('solve.stop') : t('solve.demo')" @Click="demoSolve" />
        <WinButton v-if="solveResult.moves.length" id="btn-copy-solve" :Content="t('hud.copy')" @Click="copySolve" />
        <WinButton :Content="t('solve.close')" @Click="closeSolve" />
      </div>
    </div>

    <div id="bottom-panel" class="bottom-panel">
      <div class="panel-title">
        {{ t("hud.logTitle") }}
        <span class="panel-muted">{{ t("hud.logMuted") }}</span>
      </div>
      <div ref="moveLogEl" id="move-log" class="move-log">
        <span v-for="(m, i) in moves" :key="i" class="move-chip">{{ m }}</span>
      </div>
    </div>
  </div>
</template>

<style>
.game-page-vue {
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.game-header {
  z-index: 35;
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 8px 14px 0;
  pointer-events: none;
  color: var(--text-primary);
}

.game-sub {
  color: var(--text-secondary);
}

.game-hud {
  z-index: 30;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 6px;
  padding: 8px 14px;
  background: var(--ctrl-fill-default);
  -webkit-backdrop-filter: blur(18px) saturate(150%);
  backdrop-filter: blur(18px) saturate(150%);
  border-bottom: 1px solid var(--stroke-divider);
}

.hud-alg {
  flex: 1 1 340px;
  min-width: 260px;
  font-family: ui-monospace, Consolas, monospace;
}

.speed-label {
  color: var(--text-secondary);
  white-space: nowrap;
}

.hud-speed {
  width: 140px;
}

.hud-status {
  color: var(--SystemFillColorCautionBrush, #f6a625);
  font-size: 13px;
}

.solve-method {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.scramble-bar {
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 14px;
  font-size: 13px;
  color: var(--text-secondary);
}

.scramble-label {
  white-space: nowrap;
  color: var(--text-secondary);
}

.scramble-alg {
  flex: 1 1 auto;
  min-width: 0;
  overflow-x: auto;
  white-space: nowrap;
  font-family: ui-monospace, Consolas, monospace;
  color: var(--text-primary);
}

.solve-method .method-btn.active {
  --btn-accent: var(--accent-base, #60cdfe);
  border-color: var(--accent-base, #60cdfe);
}

.solve-panel {
  position: absolute;
  right: 12px;
  top: 118px;
  z-index: 28;
  width: 340px;
  max-height: calc(100% - 130px);
  overflow: auto;
  padding: 10px 12px;
  border-radius: var(--ControlCornerRadius, 8px);
  background: var(--flyout-bg, rgba(20, 20, 24, 0.88));
  -webkit-backdrop-filter: var(--flyout-backdrop);
  backdrop-filter: var(--flyout-backdrop);
  color: var(--text-primary);
  font-size: 13px;
}

.solve-title {
  font-weight: 600;
  margin-bottom: 6px;
  color: var(--text-primary);
}

.solve-error {
  color: var(--SystemFillColorCautionBrush, #f6a625);
  margin-bottom: 8px;
  word-break: break-all;
}

.solve-stages {
  list-style: none;
  margin: 0 0 8px;
  padding: 0;
}

.solve-stage {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 3px 0;
  border-bottom: 1px solid var(--stroke-divider, rgba(128, 128, 128, 0.2));
}

.stage-short {
  flex: 0 0 64px;
  color: var(--text-secondary);
  font-weight: 600;
}

.stage-algs {
  flex: 0 0 auto;
  color: var(--text-tertiary);
  font-size: 11px;
  background: rgba(128, 128, 128, 0.12);
  border-radius: 4px;
  padding: 1px 6px;
}

.stage-moves {
  flex: 1;
  font-family: ui-monospace, Consolas, monospace;
  font-size: 12px;
  color: var(--text-primary);
  word-break: break-all;
}

.stage-count {
  flex: 0 0 auto;
  color: var(--text-tertiary);
  font-size: 12px;
}

.solve-actions {
  display: flex;
  gap: 8px;
}

.key-help {
  z-index: 29;
  color: var(--text-tertiary);
  pointer-events: none;
  padding: 6px 14px 0;
}

.stage {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.gray-panel {
  position: absolute;
  right: 12px;
  top: 118px;
  z-index: 28;
  width: 300px;
  max-height: calc(100% - 130px);
  overflow: auto;
  padding: 10px 12px;
  border-radius: var(--ControlCornerRadius, 8px);
  background: var(--flyout-bg, rgba(20, 20, 24, 0.88));
  -webkit-backdrop-filter: var(--flyout-backdrop);
  backdrop-filter: var(--flyout-backdrop);
  color: var(--text-primary);
  font-size: 13px;
}

.gray-panel .gray-title {
  font-weight: 600;
  margin-bottom: 6px;
  color: var(--text-primary);
}

.gray-panel .gray-presets {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.gray-panel .gray-presets button {
  padding: 2px 9px;
  font-size: 12px;
}

.gray-panel .gray-net {
  display: block;
  width: 100%;
  height: auto;
  margin: 0 auto;
  user-select: none;
}

.gray-panel .gray-cell {
  cursor: pointer;
  stroke-width: 0;
}

.gray-panel .gray-body {
  pointer-events: none;
}

.gray-panel .gray-face-label {
  font-size: 10px;
  fill: var(--text-tertiary);
  pointer-events: none;
}

.gray-panel .gray-net:focus {
  outline: 1px solid var(--accent-base);
  outline-offset: 2px;
}

.bottom-panel {
  position: absolute;
  left: 12px;
  bottom: 12px;
  z-index: 28;
  max-width: min(640px, 70vw);
  padding: 8px 12px;
  border-radius: var(--ControlCornerRadius, 8px);
  background: var(--flyout-bg, rgba(12, 12, 16, 0.55));
  -webkit-backdrop-filter: var(--flyout-backdrop);
  backdrop-filter: var(--flyout-backdrop);
  color: var(--text-primary);
  font-size: 13px;
}

.panel-title {
  margin-bottom: 4px;
  color: var(--text-secondary);
}

.panel-muted {
  font-size: 11px;
  color: var(--text-tertiary);
}

.move-log {
  display: flex;
  overflow-x: auto;
  white-space: nowrap;
  max-width: 100%;
}

.move-chip {
  display: inline-block;
  margin: 2px;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--ctrl-fill-secondary);
  font-family: ui-monospace, Consolas, monospace;
  color: var(--text-primary);
}
</style>
