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
import { applyAlg as applyAlgState, randomScramble, solvedState, solve as solveCube, prepareSolvers } from "../../cube/solver";
import type { SolveResult } from "../../cube/solver";
import * as methodOpts from "../../cube/solver/methodOptions";
import SolverOptionsPanel from "../components/SolverOptionsPanel.vue";
import { baseFaceSetupAlg } from "../../cube/stickering";
import { loadSettings } from "../../settings";

const { t } = useI18n();

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
const moves = ref<string[]>([]);

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

// speed = 每步秒数（s/步）；cubing tempoScale = 1/s（基准 1000ms@1.00s/步）
watch(speed, (v) => session?.setSpeed(1 / (v || 1)));

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
 *  打乱速度用独立滑条 scrambleSpeed（s/步，默认 0.33s ≈ 3x；上限 3.0s、下限 0.20s ≈ 5x）。
 *  步间隔 = s/步 × 1000ms —— 与 cubing 动画时长（tempoScale=1 时 1000ms）同基准，动画播完
 *  再下一步，避免跳变截断。与演示播放统一「s/步」语义（消灭旧 420ms/1000ms 双基准遗留）。 */
const scrambleCube = async (): Promise<void> => {
  if (!session || demoRunning.value) return;
  cancelDemo();
  const scr = randomScramble(20).join(" ");
  scrambleAlg.value = scr;
  status.value = t("hud.scrambled", { n: 20 });
  session.player.pause();
  demoRunning.value = true;
  const myToken = demoToken;
  // 打乱动画实时速度 = 1/s（cubing tempoScale）；步间隔 = s/步 × 1000ms（播完再下一步）
  session.player.setSpeed(1 / scrambleSpeed.value);
  const delay = Math.max(60, scrambleSpeed.value * 1000);
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
  session.player.setSpeed(1 / speed.value); // 恢复演示滑条速度（防打乱倍速残留）
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
      // 解法底（多色底/6 色底，多选集合）：对每底分别求解并取最短；空数组兜底=全局底
      const bases = solveBase.value.length ? solveBase.value : [loadSettings().baseFace];
      const method = methodOpts.resolveSolverMethod(solveMethod.value, solveOptions.value);
      let best: SolveResult | null = null;
      for (const b of bases) {
        const res = solveCube(currentState(), method, b);
        if (!best || res.moves.length < best.moves.length) best = res;
      }
      /* bases 恒非空（默认放全局底色上，面板最少保留一个底） */
      const chosen = best as SolveResult;
      solveResult.value = chosen;
      status.value = chosen.moves.length ? t("solve.total", { n: chosen.moves.length }) : t("solve.empty");
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

/** 演示：从当前打乱态开始，逐步播放解法（不重放打乱）。
 *  若解被指定底（solveResult.setupAlg 非空）：先播 setupAlg（动态：把「所选底色中心当前所在
 *  面位」整体旋转到 D，视觉转到对应底）→ 播 moves → 末尾播 endAlg（动态收尾：把还原终点
 *  整块旋转到所选底朝向 solved）——「全程所选底视角、解完停在所选底」语义落地（2026-08-22
 *  实证：baseFaceSetupAlg 表 F↔x'/B↔x 方向修复 + solve 动态 setup/endAlg；verify 34/34）。 */
const demoSolve = async (): Promise<void> => {
  const s = session;
  if (!s || !solveResult.value || demoRunning.value) return;
  const movesToShow = solveResult.value.moves;
  if (!movesToShow.length) return;
  cancelDemo();
  demoRunning.value = true;
  const myToken = demoToken;
  s.player.pause();
  // s/步 统一基准：cubing tempoScale = 1/s；步间隔 = s/步 × 1000ms（动画播完再下一步）
  s.player.setSpeed(1 / speed.value); // 演示用演示滑条速度（打乱后防残留）
  const delay = Math.max(60, speed.value * 1000);
  const play = async (mv: string): Promise<boolean> => {
    if (demoToken !== myToken) return false;
    s.player.applyMove(mv);
    await new Promise<void>((r) => {
      sleepResolve = r;
      setTimeout(() => { if (sleepResolve === r) sleepResolve = null; r(); }, delay);
    });
    return true;
  };
  // 解法底视角保持（方案 A）：开头播 setupAlg 把魔方整块旋转到所选底朝向（视觉）；
  // 中段播 moves（该底视角坐标解，还原到标准 solved）；末尾播 endAlg（setupAlg 的逆整块
  // 旋转）把标准 solved 转回所选底朝向收尾——全程保持所选底视角、解完也停在该底朝向，
  // 消除「整块旋转即被解回标准朝向」的「底不生效 / 底变成对面」视觉遗留。
  const setup = solveResult.value.setupAlg;
  if (setup) {
    for (const mv of setup.split(" ")) if (!(await play(mv))) return;
  }
  for (const mv of movesToShow) if (!(await play(mv))) return;
  const endAlg = solveResult.value.endAlg;
  if (endAlg) {
    for (const mv of endAlg.split(" ")) if (!(await play(mv))) return;
  }
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
      :global-base="loadSettings().baseFace"
      @update:solve-base="(b) => (solveBase = b)"
      :group="currentOptionGroup"
    />

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
