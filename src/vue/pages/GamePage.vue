<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import WinButton from "../../vendor/winui-on-web/components/WinButton.vue";
import WinSlider from "../../vendor/winui-on-web/components/WinSlider.vue";
import WinTextBox from "../../vendor/winui-on-web/components/WinTextBox.vue";
import WinTextBlock from "../../vendor/winui-on-web/components/WinTextBlock.vue";
import { createGameSession, type GameSession } from "../../game/session";
import { useI18n } from "../i18n";

const { t } = useI18n();

const stageEl = ref<HTMLElement | null>(null);
const grayPanelEl = ref<HTMLElement | null>(null);
const moveLogEl = ref<HTMLElement | null>(null);

const algText = ref("");
const playing = ref(false);
const status = ref("");
const speed = ref(1);
const moves = ref<string[]>([]);

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
    onMove: logMove,
    onUndo: () => moves.value.pop(),
    onReset: () => (moves.value = []),
    onStatus: (s) => (status.value = s),
    onPlaying: (p) => (playing.value = p),
  });
});

onBeforeUnmount(() => {
  session?.dispose();
  session = null;
});

const applyAlg = (): void => {
  const normalized = session?.applyAlg(algText.value);
  if (normalized !== null && normalized !== undefined) algText.value = normalized;
};
const togglePlay = (): void => session?.togglePlay();
const reset = (): void => session?.player.reset();
const toggleGray = (): void => session?.gray.togglePanel();

watch(speed, (v) => session?.setSpeed(v));
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
      <WinButton id="btn-reset" :Content="t('hud.reset')" @Click="reset" />
      <WinButton id="btn-gray" :Content="t('gray.btn')" @Click="toggleGray" />
      <WinTextBlock class="speed-label" :Text="`${t('hud.speed')} ${speed.toFixed(1)}x`" FontSize="13" />
      <WinSlider id="speed" class="hud-speed" v-model:Value="speed" :Minimum="0.1" :Maximum="3" StepFrequency="0.1" />
      <span id="hud-status" class="hud-status">{{ status }}</span>
    </div>

    <WinTextBlock class="key-help" :Text="t('hud.keyHelp')" FontSize="12" />

    <main ref="stageEl" class="stage"></main>

    <div ref="grayPanelEl" id="gray-panel" class="gray-panel"></div>

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
