<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import WinButton from "../../vendor/winui-on-web/components/WinButton.vue";
import WinSlider from "../../vendor/winui-on-web/components/WinSlider.vue";
import WinTextBox from "../../vendor/winui-on-web/components/WinTextBox.vue";
import WinTextBlock from "../../vendor/winui-on-web/components/WinTextBlock.vue";
import { createGameSession, type GameSession } from "../../game/session";
import { clearSnapshot, loadSnapshot, saveSnapshot } from "../../data/snapshot";
import { parseMoves } from "../../notation/alg";
import { useI18n } from "../i18n";
import { applyAlg as applyAlgState, isUniform, randomScramble, solvedState } from "../../cube/solver";
import { playSfx } from "../../audio/audioManager";
import type { SolveResult } from "../../cube/solver";
import {
  disposeSolverWorker,
  solveAsync,
  SolveCancelledError,
  warmupSolvers,
} from "../../cube/solver/solverClient";
import * as methodOpts from "../../cube/solver/methodOptions";
import SolverOptionsPanel from "../components/SolverOptionsPanel.vue";
import { baseFaceSetupAlg } from "../../cube/stickering";
import { loadSettings } from "../../settings";

const { t } = useI18n();
const globalBase = loadSettings().baseFace;

/** cubing 两套动画时长基准（render.md F2）：
 *  - `experimentalAddMove`（逐步打乱/解法演示/键盘）走 CatchUpHelper，1x = 500ms；
 *  - `element.play()`（时间轴整段播放）走 AlgDuration，1x = 1000ms。 */
const CUBING_CATCHUP_SEC = 0.5;
const CUBING_TIMELINE_SEC = 1.0;

const stageEl = ref<HTMLElement | null>(null);
const grayPanelEl = ref<HTMLElement | null>(null);
const moveLogEl = ref<HTMLElement | null>(null);

const algText = ref("");
const playing = ref(false);
const status = ref("");
/** 每步实际秒数（s/步，统一基准 1000ms@1.00s/步，与 cubing tempoScale=1 动画时长对齐）。
 *  演示播放与打乱共用同一 s/步 语义（消灭 420ms 与 1000ms 两套基准的旧遗留）。 */
const speed = ref(1.0);
const scrambleSpeed = ref(0.33); // 默认 ≈ 3x（1000ms/3）
/** 显示日志上限：移动日志只渲染最近 N 步（纯展示，**不参与持久化**） */
const LOG_LIMIT = 24;
const moves = ref<string[]>([]);
/** 进度序列（完整、不截断）：进度快照的**唯一**写入源（P1-7）。
 *  与显示日志 moves 彻底解耦——旧实现把 24 条封顶的显示日志当持久化来源，走超 24 步后
 *  恢复只还原最后 24 步（魔方回到错误的中间状态）。取值 = player.currentAlg，即「当前魔方
 *  状态」的完整表达（含打乱/应用公式/逐步动作），恢复即按它整段重放。 */
const progressAlg = ref("");

const solveMethod = ref<methodOpts.SolverBase>("cfop");
const solveOptions = ref<methodOpts.SolverOptions>(methodOpts.loadSolverOptions());
/** 解法底（多色底 / 6 色底，多选面集合）：默认放全局底色上；可加选其它色；空数组=跟随
 *  全局底（重置语义）。消费：doSolve 对集合中每底分别求解并取最短。 */
const solveBase = ref<methodOpts.SolveBaseChoice>([]);
{
  const loaded = methodOpts.loadSolveBases();
  solveBase.value = loaded.length ? loaded : [loadSettings().baseFace];
}
/** 二级选项面板展开态（点方法按钮展开/再点收起；高级不常驻） */
const optionsOpen = ref(false);
const currentOptionGroup = computed(() =>
  methodOpts.METHOD_OPTION_GROUPS.find((g) => g.method === solveMethod.value),
);
const selectMethod = (m: methodOpts.SolverBase): void => {
  if (solveMethod.value === m) optionsOpen.value = !optionsOpen.value;
  else {
    solveMethod.value = m;
    optionsOpen.value = true;
  }
};
watch(solveOptions, (v) => methodOpts.saveSolverOptions(v), { deep: true });
watch(solveBase, (v) => methodOpts.saveSolveBases(v), { deep: true });
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
  const ok = await copyText(scrambleAlg.value);
  status.value = ok ? t("hud.copied") : t("hud.copyFail");
  if (ok) playSfx("save");
};

const copySolve = async (): Promise<void> => {
  const res = solveResult.value;
  if (!res || !res.moves.length) return;
  // 复制口径 = 演示口径（P1-8）：setupAlg（整块旋转到底）→ moves（解法）→ endAlg（收尾整块
  // 旋转）。旧实现漏掉 endAlg，复制出的公式终点朝向与屏幕演示不一致——标准 D 底时 endAlg
  // 恰为空所以看不出来，非 D 全局底（红/蓝底等）必现。
  const full = [res.setupAlg, res.moves.join(" "), res.endAlg]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
  const ok = await copyText(full);
  status.value = ok ? t("hud.copied") : t("hud.copyFail");
  if (ok) playSfx("save");
};

// 解法演示：从当前打乱态逐步施加解法（不重放打乱）
const demoRunning = ref(false);
let activeDemoKind: "none" | "scramble" | "solve" = "none";
let demoToken = 0;
let sleepResolve: (() => void) | null = null;
const cancelDemo = (): void => {
  demoToken++;
  activeDemoKind = "none";
  if (sleepResolve) { const r = sleepResolve; sleepResolve = null; r(); }
  if (demoRunning.value) demoRunning.value = false;
};

// Worker 求解取消句柄（Step 1：求解迁出主线程，支持真实中断）
let activeSolveCancel: (() => void) | null = null;
const cancelSolve = (): void => {
  if (activeSolveCancel) {
    const fn = activeSolveCancel;
    activeSolveCancel = null;
    fn();
  }
  if (solving.value) {
    solving.value = false;
    status.value = "";
  }
};

let session: GameSession | null = null;
/** 追踪上一次已知的魔方是否已还原：仅在「非还原 → 还原」跃迁时触发 sfx_solved，避免初始/重置误响 */
let wasSolved = true;

/** 显示日志：只留最近 LOG_LIMIT 步；快照走 progressAlg（完整序列），两者互不影响 */
const logMove = (move: string): void => {
  moves.value.push(move);
  if (moves.value.length > LOG_LIMIT) moves.value.splice(0, moves.value.length - LOG_LIMIT);
  void nextTick(() => {
    if (moveLogEl.value) moveLogEl.value.scrollLeft = moveLogEl.value.scrollWidth;
  });
};

/** 把 player 的完整序列同步到进度序列（= 快照写入源） */
const syncProgress = (): void => {
  progressAlg.value = session?.player.currentAlg ?? "";
};

onMounted(() => {
  if (!stageEl.value || !grayPanelEl.value) return;
  session = createGameSession(stageEl.value, grayPanelEl.value, {
    onMove: (m) => {
      cancelDemo();
      logMove(m);
      syncProgress();
      const nowSolved = isUniform(currentState());
      if (!wasSolved && nowSolved) playSfx("solved");
      wasSolved = nowSolved;
    },
    // session 的 undo/reset 先回调 hook、再改 player 序列 → nextTick 读「改之后」的完整序列
    onUndo: () => {
      cancelDemo();
      moves.value.pop();
      void nextTick(() => {
        syncProgress();
        wasSolved = isUniform(currentState());
      });
    },
    onReset: () => {
      cancelDemo();
      moves.value = [];
      wasSolved = true;
      void nextTick(syncProgress);
    },
    onStatus: (s) => (status.value = s),
    onPlaying: (p) => (playing.value = p),
  });
  // 求解表预热（Web Worker 后台执行，零主线程卡顿）
  warmupSolvers();
  // 进度快照：进入游戏恢复上次达成步骤
  const snap = loadSnapshot();
  if (snap) {
    // 恢复口径：整段完整序列（与快照写入源同源）；显示日志只回填最近 LOG_LIMIT 步
    const parsed = parseMoves(snap.alg);
    const restored = parsed.ok ? parsed.normalized : snap.alg;
    session.player.setMoves(restored);
    // cubing 惰性渲染：恢复状态后强制重绘（走 CubePlayer 抽象接口）
    void session.player.requestRender();
    progressAlg.value = restored;
    moves.value = restored.split(/\s+/).filter(Boolean).slice(-LOG_LIMIT);
    wasSolved = isUniform(currentState());
    status.value = t("hud.statusRestored");
  }
});

onBeforeUnmount(() => {
  cancelDemo();
  cancelSolve();
  disposeSolverWorker();
  session?.dispose();
  session = null;
});

const applyAlg = (): void => {
  cancelDemo();
  const normalized = session?.applyAlg(algText.value);
  scrambleAlg.value = "";
  if (normalized !== null && normalized !== undefined) {
    algText.value = normalized;
    syncProgress(); // 应用公式后完整序列 = 新公式（快照随之更新，不再停留在旧进度）
    wasSolved = isUniform(currentState());
  }
};
const togglePlay = (): void => {
  if (!playing.value) {
    // 时间轴整段播放使用 1000ms 基准
    session?.setSpeed(CUBING_TIMELINE_SEC / (speed.value || 1));
  }
  session?.togglePlay();
};
const reset = (): void => {
  cancelDemo();
  session?.player.reset();
  moves.value = [];
  scrambleAlg.value = "";
  wasSolved = true;
  syncProgress();
  status.value = t("hud.statusReset");
};
const toggleGray = (): void => session?.gray.togglePanel();

// speed = 每步秒数（s/步）：逐步演示走 catch-up 500ms 基准，时间轴播放走 1000ms 基准（F2/F5）
watch(speed, (v) => {
  if (activeDemoKind === "scramble") return;
  const base = activeDemoKind === "solve" ? CUBING_CATCHUP_SEC : CUBING_TIMELINE_SEC;
  session?.setSpeed(base / (v || 1));
});
watch(scrambleSpeed, (v) => {
  if (activeDemoKind === "scramble") {
    session?.setSpeed(CUBING_CATCHUP_SEC / (v || 0.05));
  }
});

// 每步达成后自动保存快照（复用编辑器/tauri 持久）：只监听完整进度序列（字符串，非深监听，
// 每步一次轻量落盘），与 24 条封顶的显示日志彻底解耦（P1-7）
watch(progressAlg, (alg) => saveSnapshot(alg));

const clearProgress = (): void => {
  cancelDemo();
  clearSnapshot();
  session?.player.reset();
  moves.value = [];
  scrambleAlg.value = "";
  wasSolved = true;
  syncProgress();
};

/** 生成随机打乱（20 步，与 WCA 同风格）并逐步播放。
 *  F2/F5：`applyMove` 走 cubing catch-up（500ms@1x），故 `tempoScale = 0.5 / s` 使每步动画
 *  填满 `s * 1000ms` 区间（消除 50% 停顿）；且每步动态读取 `scrambleSpeed.value`，打乱中改速即时生效。 */
const scrambleCube = async (): Promise<void> => {
  if (!session || demoRunning.value) return;
  cancelDemo();
  playSfx("scramble");
  wasSolved = false;
  const scr = randomScramble(20).join(" ");
  scrambleAlg.value = scr;
  status.value = t("hud.scrambled", { n: 20 });
  session.player.pause();
  demoRunning.value = true;
  activeDemoKind = "scramble";
  const myToken = demoToken;
  let applied = 0;
  for (const mv of scr.split(" ")) {
    if (demoToken !== myToken) break;
    const sec = scrambleSpeed.value || 0.05;
    session.player.setSpeed(CUBING_CATCHUP_SEC / sec);
    const delay = Math.max(60, sec * 1000);
    session.player.applyMove(mv);
    applied++;
    await new Promise<void>((r) => {
      sleepResolve = r;
      setTimeout(() => { if (sleepResolve === r) sleepResolve = null; r(); }, delay);
    });
  }
  if (demoToken !== myToken) {
    // 被打断：公式条只保留**真正执行过**的步，保持「展示口径 = 实际执行序列」
    scrambleAlg.value = scr.split(" ").slice(0, applied).join(" ");
    return;
  }
  activeDemoKind = "none";
  demoRunning.value = false;
  session.player.pause(); // 停在打乱态
  session.player.setSpeed(CUBING_TIMELINE_SEC / (speed.value || 1)); // 恢复演示滑条速度（防打乱倍速残留）
};

/** 当前真实魔方状态：已解 + 底色整体旋转（六色底开关关 = 固定 D）+ 玩家步 */
const currentState = (): Uint8Array => {
  const s = loadSettings();
  const base = s.sixColorBase ? s.baseFace : "D";
  const setup = baseFaceSetupAlg(base);
  const alg = (setup ? setup + " " : "") + (session?.player.currentAlg ?? "");
  return applyAlgState(solvedState(), alg);
};

const doSolve = async (): Promise<void> => {
  if (!session || solving.value || demoRunning.value) return;
  cancelDemo();
  cancelSolve();
  solving.value = true;
  solveResult.value = null;
  solveError.value = "";
  status.value = t("solve.solving");
  const bases = solveBase.value.length ? solveBase.value : [loadSettings().baseFace];
  const method = methodOpts.resolveSolverMethod(solveMethod.value, solveOptions.value);
  const { promise, cancel } = solveAsync(currentState(), method, bases);
  activeSolveCancel = cancel;
  try {
    const chosen = await promise;
    if (activeSolveCancel !== cancel) return;
    solveResult.value = chosen;
    status.value = chosen.moves.length ? t("solve.total", { n: chosen.moves.length }) : t("solve.empty");
    if (chosen.moves.length) playSfx("solved");
  } catch (e) {
    if (e instanceof SolveCancelledError) return;
    solveError.value = (e as Error).message;
    status.value = t("solve.fail", { error: solveError.value });
  } finally {
    if (activeSolveCancel === cancel) activeSolveCancel = null;
    solving.value = false;
  }
};

const closeSolve = (): void => {
  cancelDemo();
  cancelSolve();
  solveResult.value = null;
  solveError.value = "";
};

/** 演示：从当前打乱态开始，逐步播放解法（不重放打乱）。
 *  F2/F5：每步走 catch-up 500ms 基准（`tempoScale = 0.5 / s`）并动态读取 `speed.value`。 */
const demoSolve = async (): Promise<void> => {
  const s = session;
  if (!s || !solveResult.value) return;
  if (demoRunning.value) {
    cancelDemo();
    return;
  }
  const movesToShow = solveResult.value.moves;
  if (!movesToShow.length) return;
  cancelDemo();
  demoRunning.value = true;
  activeDemoKind = "solve";
  const myToken = demoToken;
  s.player.pause();
  const play = async (mv: string): Promise<boolean> => {
    if (demoToken !== myToken) return false;
    const sec = speed.value || 0.05;
    s.player.setSpeed(CUBING_CATCHUP_SEC / sec);
    const delay = Math.max(60, sec * 1000);
    s.player.applyMove(mv);
    await new Promise<void>((r) => {
      sleepResolve = r;
      setTimeout(() => { if (sleepResolve === r) sleepResolve = null; r(); }, delay);
    });
    return true;
  };
  const setup = solveResult.value.setupAlg;
  if (setup) {
    for (const mv of setup.split(" ")) if (!(await play(mv))) return;
  }
  for (const mv of movesToShow) if (!(await play(mv))) return;
  const endAlg = solveResult.value.endAlg;
  if (endAlg) {
    for (const mv of endAlg.split(" ")) if (!(await play(mv))) return;
  }
  activeDemoKind = "none";
  demoRunning.value = false;
  scrambleAlg.value = "";
  wasSolved = isUniform(currentState());
  if (wasSolved) playSfx("solved");
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
      <div class="hud-row">
        <WinTextBox v-model:Text="algText" class="hud-alg" :PlaceholderText="t('hud.algPlaceholder')" />
        <WinButton id="btn-apply" :Content="t('hud.apply')" @Click="applyAlg" />
        <WinButton id="btn-play" :Content="playing ? t('hud.pause') : t('hud.play')" @Click="togglePlay" />
        <WinButton id="btn-scramble" :Content="t('hud.scramble')" @Click="scrambleCube" />
        <WinButton id="btn-reset" :Content="t('hud.reset')" @Click="reset" />
        <WinButton id="btn-gray" :Content="t('gray.btn')" @Click="toggleGray" />
        <WinButton id="btn-clear-progress" :Content="t('hud.clearProgress')" @Click="clearProgress" />
      </div>
      <div class="hud-row hud-row-2">
        <span class="speed-group">
          <WinTextBlock class="speed-label" :Text="`${t('hud.speed')} ${speed.toFixed(2)} s/步`" FontSize="13" />
          <WinSlider id="speed" class="hud-speed" v-model:Value="speed" :Minimum="0.05" :Maximum="2" :Width="92" StepFrequency="0.05" />
        </span>
        <span class="speed-group">
          <WinTextBlock class="speed-label" :Text="`${t('hud.scrambleSpeed')} ${scrambleSpeed.toFixed(2)} s/步`" FontSize="13" />
          <WinSlider id="scramble-speed" class="hud-speed" v-model:Value="scrambleSpeed" :Minimum="0.05" :Maximum="0.5" :Width="92" StepFrequency="0.05" />
        </span>
        <span id="solve-method" class="solve-method">
          <WinButton id="btn-method-cfop" :class="['method-btn', { active: solveMethod === 'cfop' }]" :Content="t('solve.methodCfop')" @Click="selectMethod('cfop')" />
          <WinButton id="btn-method-roux" :class="['method-btn', { active: solveMethod === 'roux' }]" :Content="t('solve.methodRoux')" @Click="selectMethod('roux')" />
          <WinButton id="btn-solve" :Content="t('solve.btn')" @Click="doSolve" />
        </span>
        <span id="hud-status" class="hud-status">{{ status }}</span>
      </div>
    </div>

    <div v-if="scrambleAlg" class="scramble-bar">
      <span class="scramble-label">{{ t("hud.scrambleAlg") }}</span>
      <code id="scramble-alg" class="scramble-alg">{{ scrambleAlg }}</code>
      <WinButton id="btn-copy-scramble" :Content="t('hud.copy')" @Click="copyScramble" />
    </div>

    <WinTextBlock class="key-help" :Text="t('hud.keyHelp')" FontSize="12" />

    <main ref="stageEl" class="stage"></main>

    <!-- 方法二级选项面板：浮在 3D 视图左侧中部空白处（脱离顶部方法栏，左中空白定位） -->
    <SolverOptionsPanel
      v-if="optionsOpen && currentOptionGroup"
      id="solver-options"
      class="solve-options-float"
      v-model="solveOptions"
      :solve-base="solveBase"
      :global-base="globalBase"
      @update:solve-base="(b) => (solveBase = b)"
      :group="currentOptionGroup"
    />

    <div ref="grayPanelEl" id="gray-panel" class="gray-panel"></div>

    <div v-if="solving" class="solve-panel">
      <div class="solve-title">{{ t("solve.solving") }}…</div>
      <div class="solve-actions">
        <WinButton id="btn-solve-cancel" :Content="t('solve.cancel')" @Click="cancelSolve" />
      </div>
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
        <li v-if="solveResult.setupAlg" class="solve-stage solve-stage-rotate">
          <span class="stage-short">{{ t("solve.rotate") }}（{{ solveResult.base }}）</span>
          <span class="stage-moves">{{ solveResult.setupAlg }}</span>
          <span class="stage-note" v-if="solveResult.rotateFrom">{{ t("solve.rotateHint", { color: solveResult.base, face: solveResult.rotateFrom }) }}</span>
          <span class="stage-count">({{ solveResult.setupAlg.split(" ").length }})</span>
        </li>
        <li v-for="(s, i) in solveResult.stages" :key="i" class="solve-stage">
          <span class="stage-short">{{ s.short }}</span>
          <span class="stage-algs" v-if="s.algs && s.algs.length">{{ s.algs.join(" · ") }}</span>
          <span class="stage-moves">{{ s.moves.join(" ") || "–" }}</span>
          <span class="stage-count">{{ s.moves.length }}</span>
        </li>
        <li v-if="solveResult.endAlg" class="solve-stage solve-stage-rotate">
          <span class="stage-short">{{ t("solve.rotateEnd") }}</span>
          <span class="stage-moves">{{ solveResult.endAlg }}</span>
          <span class="stage-count">({{ solveResult.endAlg.split(" ").length }})</span>
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

/* 方法二级选项面板：浮在 3D 视图左侧中部空白（脱离顶部方法栏，左中定位） */
.solve-options-float {
  position: absolute;
  left: 16px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 30;
  max-width: 250px;
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
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
  padding: 8px 14px;
  background: var(--ctrl-fill-default);
  -webkit-backdrop-filter: blur(18px) saturate(150%);
  backdrop-filter: blur(18px) saturate(150%);
  border-bottom: 1px solid var(--stroke-divider);
}

/* 两行结构：第1行=公式+按钮；第2行=速度组×2+方法+状态（间距 18px，防拥挤遮挡） */
.hud-row {
  display: flex;
  align-items: center;
  gap: 8px;
  row-gap: 10px;
  flex-wrap: wrap;
}
.hud-row-2 {
  gap: 18px;
  row-gap: 10px;
  padding-top: 2px;
}

.hud-alg {
  flex: 1 1 340px;
  min-width: 260px;
  font-family: ui-monospace, Consolas, monospace;
}

/* 速度组：label+滑条 整组不拆行且不缩放（flex:none 防换行时被挤压变形/与邻组重叠） */
.speed-group {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
}

.speed-label {
  color: var(--text-secondary);
  white-space: nowrap;
}

/* WinSlider 内部 .win-slider 宽由 Width prop 控制（缺省 200px 会溢出 110px 容器盖到右侧，
 * 此处 Width="92" 与容器宽一致，防蓝条 track 溢出重叠相邻 label/滑条） */
.hud-speed {
  width: 92px;
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

/* 解法底旋转步骤：单列在公式开头（解法以所选底为基础） */
.solve-stage-rotate {
  color: var(--accent-base, #2266ff);
  border-bottom: 1px dashed var(--stroke-divider, rgba(128, 128, 128, 0.2));
}
.solve-stage-rotate .stage-short {
  color: var(--accent-base, #2266ff);
}
.solve-stage-rotate .stage-note {
  color: var(--text-tertiary);
  font-size: 11px;
  font-style: italic;
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
  position: relative; /* 高于全屏 stage 的层叠，避免被画布边缘遮断 */
  white-space: nowrap;
  overflow: visible;
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
