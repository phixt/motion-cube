<script setup lang="ts">
/**
 * 音乐与音效中心（参考 Nmoku AudioHubScreen，适配 WinUI 11 Fluent 双栏布局）：
 * - 左栏：音乐 / 音效独立开关 + 音量滑条 + 切页策略 + 3 SFX 试听快捷区；
 * - 右栏：专辑封面 + 正在播放进度条（可拖动跳转）+ BGM 曲目卡片浏览（点击交叉淡化切曲）+ 一键恢复当前场景曲；
 * - 顶栏：全局静音快捷开关（与全局 M 快捷键及标题栏按钮完全同步）。
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import WinButton from "../../vendor/winui-on-web/components/WinButton.vue";
import WinSlider from "../../vendor/winui-on-web/components/WinSlider.vue";
import WinTextBlock from "../../vendor/winui-on-web/components/WinTextBlock.vue";
import {
  audioAssetPath,
  BGM_CATALOG,
  getBgmPlaybackStatus,
  playSfx,
  previewBgmTrack,
  restoreSceneBgm,
  seekBgm,
  type BgmPlaybackStatus,
  type BgmTrackId,
  type SfxId,
} from "../../audio/audioManager";
import {
  audioMutedRef,
  bgmMutedRef,
  bgmScopeRef,
  bgmVolumeRef,
  setBgmScope,
  setBgmVolume,
  setSfxVolume,
  sfxMutedRef,
  sfxVolumeRef,
  toggleAudioMuted,
  toggleBgmMuted,
  toggleSfxMuted,
  type BgmScopeMode,
} from "../../settings";
import { useI18n } from "../i18n";

const { t } = useI18n();
const coverSrc = audioAssetPath("cover.png");

const status = ref<BgmPlaybackStatus>(getBgmPlaybackStatus());
const seeking = ref(false);
const seekRatio = ref(0);
const flashSfx = ref<SfxId | null>(null);
let flashTimer = 0;
let pollTimer = 0;

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const total = Math.floor(sec);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function refreshStatus(): void {
  const st = getBgmPlaybackStatus();
  status.value = st;
  if (!seeking.value) {
    seekRatio.value = st.durationSec > 0.1 ? Math.max(0, Math.min(1, st.currentSec / st.durationSec)) : 0;
  }
}

onMounted(() => {
  refreshStatus();
  pollTimer = window.setInterval(refreshStatus, 180);
});

onBeforeUnmount(() => {
  if (pollTimer) window.clearInterval(pollTimer);
  if (flashTimer) window.clearTimeout(flashTimer);
});

const bgmPct = computed({
  get: () => Math.round(bgmVolumeRef.value * 100),
  set: (v: number) => setBgmVolume(v / 100),
});

const sfxPct = computed({
  get: () => Math.round(sfxVolumeRef.value * 100),
  set: (v: number) => setSfxVolume(v / 100),
});

const activeTrackMeta = computed(
  () => BGM_CATALOG.find((m) => m.id === status.value.trackId) ?? null,
);

const nowPlayingTitle = computed(() => {
  if (!activeTrackMeta.value) return t("audio.hub.stopped");
  return t(activeTrackMeta.value.titleKey);
});

const nowPlayingBadge = computed(() => {
  if (audioMutedRef.value) return t("audio.hub.stateGlobalMuted");
  if (bgmMutedRef.value) return t("audio.hub.stateBgmMuted");
  if (status.value.playing) return t("audio.hub.statePlaying");
  return t("audio.hub.stateStandby");
});

const timeDisplay = computed(() => {
  const dur = status.value.durationSec;
  const cur = seeking.value ? seekRatio.value * dur : status.value.currentSec;
  return `${formatTime(cur)} / ${formatTime(dur)}`;
});

const onSeekStart = (): void => {
  seeking.value = true;
};

const onSeekInput = (e: Event): void => {
  const val = Number((e.target as HTMLInputElement).value);
  if (!Number.isFinite(val)) return;
  seekRatio.value = val;
};

const onSeekCommit = (): void => {
  const dur = status.value.durationSec;
  if (dur > 0.1) {
    seekBgm(seekRatio.value * dur);
  }
  seeking.value = false;
  refreshStatus();
};

const onSelectTrack = (id: BgmTrackId): void => {
  previewBgmTrack(id);
  refreshStatus();
};

const onRestoreScene = (): void => {
  restoreSceneBgm();
  refreshStatus();
};

const onScopeChange = (mode: BgmScopeMode): void => {
  setBgmScope(mode);
  refreshStatus();
};

const onTestSfx = (id: SfxId): void => {
  playSfx(id);
  flashSfx.value = id;
  if (flashTimer) window.clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => {
    flashSfx.value = null;
  }, 260);
};
</script>

<template>
  <div class="audio-hub-page">
    <header class="audio-hub-header">
      <div class="audio-hub-title-wrap">
        <WinTextBlock class="page-title" :Text="t('audio.hub.title')" FontSize="24" FontWeight="SemiBold" />
        <WinTextBlock class="audio-hub-sub" :Text="t('audio.hub.sub')" FontSize="13" />
      </div>
      <div class="audio-hub-head-actions">
        <WinButton
          id="hub-master-mute"
          :class="['hub-mute-btn', { 'is-muted': audioMutedRef }]"
          :Content="audioMutedRef ? t('audio.hub.masterMuted') : t('audio.hub.masterOn')"
          @Click="toggleAudioMuted" />
      </div>
    </header>

    <div class="audio-hub-columns">
      <!-- 左栏：独立开关 + 音量滑条 + 切页策略 + 3 SFX 试听 -->
      <section class="hub-card hub-col-controls">
        <div class="hub-section-label">{{ t("audio.hub.sectionControls") }}</div>

        <div class="hub-switch-row">
          <button
            id="hub-bgm-toggle"
            type="button"
            class="hub-toggle-tile"
            :class="{ 'is-off': bgmMutedRef }"
            @click="toggleBgmMuted">
            <span class="hub-toggle-icon" aria-hidden="true">{{ bgmMutedRef ? "\uE74F" : "\uE8D6" }}</span>
            <span class="hub-toggle-text">
              <span class="hub-toggle-name">{{ t("audio.bgmToggle") }}</span>
              <span class="hub-toggle-state">{{ bgmMutedRef ? t("audio.off") : t("audio.on") }}</span>
            </span>
          </button>

          <button
            id="hub-sfx-toggle"
            type="button"
            class="hub-toggle-tile"
            :class="{ 'is-off': sfxMutedRef }"
            @click="toggleSfxMuted">
            <span class="hub-toggle-icon" aria-hidden="true">{{ sfxMutedRef ? "\uE74F" : "\uE767" }}</span>
            <span class="hub-toggle-text">
              <span class="hub-toggle-name">{{ t("audio.sfxToggle") }}</span>
              <span class="hub-toggle-state">{{ sfxMutedRef ? t("audio.off") : t("audio.on") }}</span>
            </span>
          </button>
        </div>

        <div v-if="audioMutedRef" class="hub-muted-banner">
          {{ t("audio.hub.globalMutedHint") }}
        </div>

        <div class="hub-slider-block">
          <div class="hub-slider-head">
            <span>{{ t("audio.bgmVolume", { pct: bgmPct }) }}</span>
          </div>
          <WinSlider
            id="hub-bgm-slider"
            class="hub-slider"
            v-model:Value="bgmPct"
            :Minimum="0"
            :Maximum="100"
            :Width="260"
            StepFrequency="5" />
        </div>

        <div class="hub-slider-block">
          <div class="hub-slider-head">
            <span>{{ t("audio.sfxVolume", { pct: sfxPct }) }}</span>
          </div>
          <WinSlider
            id="hub-sfx-slider"
            class="hub-slider"
            v-model:Value="sfxPct"
            :Minimum="0"
            :Maximum="100"
            :Width="260"
            StepFrequency="5" />
        </div>

        <div class="hub-divider" />

        <div class="hub-section-label">{{ t("audio.hub.scopeLabel") }}</div>
        <div class="hub-scope-row">
          <WinButton
            id="hub-scope-scene"
            :class="['hub-scope-btn', { active: bgmScopeRef === 'scene' }]"
            :Content="t('audio.hub.scopeScene')"
            @Click="onScopeChange('scene')" />
          <WinButton
            id="hub-scope-lock"
            :class="['hub-scope-btn', { active: bgmScopeRef === 'lock' }]"
            :Content="t('audio.hub.scopeLock')"
            @Click="onScopeChange('lock')" />
        </div>

        <div class="hub-divider" />

        <div class="hub-section-label">{{ t("audio.hub.sectionSfx") }}</div>
        <div class="hub-sfx-grid">
          <button
            id="hub-sfx-solved"
            type="button"
            class="hub-sfx-btn"
            :class="{ flash: flashSfx === 'solved' }"
            @click="onTestSfx('solved')">
            <span class="hub-sfx-name">{{ t("audio.hub.sfxSolved") }}</span>
            <span class="hub-sfx-desc">{{ t("audio.hub.sfxSolvedDesc") }}</span>
          </button>
          <button
            id="hub-sfx-scramble"
            type="button"
            class="hub-sfx-btn"
            :class="{ flash: flashSfx === 'scramble' }"
            @click="onTestSfx('scramble')">
            <span class="hub-sfx-name">{{ t("audio.hub.sfxScramble") }}</span>
            <span class="hub-sfx-desc">{{ t("audio.hub.sfxScrambleDesc") }}</span>
          </button>
          <button
            id="hub-sfx-save"
            type="button"
            class="hub-sfx-btn"
            :class="{ flash: flashSfx === 'save' }"
            @click="onTestSfx('save')">
            <span class="hub-sfx-name">{{ t("audio.hub.sfxSave") }}</span>
            <span class="hub-sfx-desc">{{ t("audio.hub.sfxSaveDesc") }}</span>
          </button>
        </div>

        <div class="hub-footnote">
          {{ t("audio.hub.shortcutNote") }}
        </div>
      </section>

      <!-- 右栏：专辑封面 + 正在播放进度条 + BGM 曲目卡片浏览 -->
      <section class="hub-card hub-col-library">
        <div class="hub-lib-head">
          <div class="hub-section-label">{{ t("audio.hub.sectionLibrary") }}</div>
          <WinButton
            id="hub-restore-scene"
            :Content="t('audio.hub.restoreScene')"
            @Click="onRestoreScene" />
        </div>

        <div class="hub-now-card">
          <img class="hub-cover" :src="coverSrc" alt="Motion Cube OST" />
          <div class="hub-now-body">
            <div class="hub-now-top">
              <span class="hub-now-title">{{ nowPlayingTitle }}</span>
              <span class="hub-now-badge" :class="{ playing: status.playing }">{{ nowPlayingBadge }}</span>
            </div>
            <div class="hub-seek-row">
              <input
                id="hub-seek-slider"
                class="hub-seek"
                type="range"
                min="0"
                max="1"
                step="0.002"
                :value="seekRatio"
                :disabled="status.durationSec <= 0.1"
                @pointerdown="onSeekStart"
                @input="onSeekInput"
                @change="onSeekCommit" />
              <span class="hub-time">{{ timeDisplay }}</span>
            </div>
          </div>
        </div>

        <div class="hub-track-list">
          <button
            v-for="track in BGM_CATALOG"
            :key="track.id"
            :id="`hub-track-${track.id}`"
            type="button"
            class="hub-track-card"
            :class="{ active: status.trackId === track.id }"
            @click="onSelectTrack(track.id)">
            <div class="hub-track-main">
              <div class="hub-track-head">
                <span class="hub-track-title">{{ t(track.titleKey) }}</span>
                <span class="hub-track-meta">{{ t(track.badgeKey) }}</span>
              </div>
              <div class="hub-track-desc">{{ t(track.descKey) }}</div>
            </div>
            <span v-if="status.trackId === track.id" class="hub-track-playing">
              {{ status.playing ? t("audio.hub.statePlaying") : t("audio.hub.stateSelected") }}
            </span>
          </button>
        </div>

        <div class="hub-footnote">
          {{ t("audio.note") }}
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.audio-hub-page {
  height: 100%;
  box-sizing: border-box;
  overflow: auto;
  padding: 14px 24px 18px;
  color: var(--text-primary);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.audio-hub-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.audio-hub-title-wrap {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.audio-hub-sub {
  color: var(--text-secondary);
}

.hub-mute-btn.is-muted {
  border-color: rgba(235, 92, 92, 0.65);
  color: #ff9a9a;
}

.audio-hub-columns {
  display: grid;
  grid-template-columns: minmax(290px, 0.92fr) minmax(320px, 1.08fr);
  gap: 14px;
  align-items: start;
}

@media (max-width: 900px) {
  .audio-hub-columns {
    grid-template-columns: 1fr;
  }
}

.hub-card {
  border-radius: var(--ControlCornerRadius, 8px);
  border: 1px solid var(--stroke-divider);
  background: var(--ctrl-fill-default);
  padding: 13px 16px;
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.hub-section-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--accent-base, #60cdfe);
  letter-spacing: 0.2px;
}

.hub-switch-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.hub-toggle-tile {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 6px;
  border: 1px solid var(--ctrl-border);
  background: var(--ctrl-fill-secondary);
  color: var(--text-primary);
  cursor: pointer;
  text-align: left;
  transition: border-color 140ms ease, background 140ms ease;
}

.hub-toggle-tile:hover {
  border-color: var(--accent-base, #60cdfe);
}

.hub-toggle-tile.is-off {
  opacity: 0.68;
  border-color: var(--stroke-divider);
}

.hub-toggle-icon {
  font-family: var(--SymbolThemeFontFamily, "WinUIOnWebIcons", "Segoe Fluent Icons", "Segoe MDL2 Assets");
  font-size: 16px;
  color: var(--accent-base, #60cdfe);
  flex: none;
}

.hub-toggle-tile.is-off .hub-toggle-icon {
  color: var(--text-tertiary);
}

.hub-toggle-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.hub-toggle-name {
  font-size: 13px;
  font-weight: 600;
}

.hub-toggle-state {
  font-size: 12px;
  color: var(--text-secondary);
}

.hub-muted-banner {
  padding: 7px 10px;
  border-radius: 6px;
  border: 1px solid rgba(235, 110, 110, 0.35);
  background: rgba(235, 92, 92, 0.1);
  color: var(--text-primary);
  font-size: 12px;
}

.hub-slider-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.hub-slider-head {
  font-size: 13px;
  color: var(--text-secondary);
}

.hub-divider {
  height: 1px;
  background: var(--stroke-divider);
  margin: 2px 0;
}

.hub-scope-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.hub-scope-btn.active {
  outline: 2px solid var(--accent-base, #60cdfe);
  outline-offset: 1px;
}

.hub-sfx-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.hub-sfx-btn {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 10px 10px;
  border-radius: 6px;
  border: 1px solid var(--ctrl-border);
  background: var(--ctrl-fill-secondary);
  color: var(--text-primary);
  cursor: pointer;
  text-align: left;
  transition: border-color 140ms ease, background 140ms ease, transform 80ms ease;
}

.hub-sfx-btn:hover {
  border-color: var(--accent-base, #60cdfe);
}

.hub-sfx-btn.flash {
  border-color: var(--accent-base, #60cdfe);
  background: rgba(96, 205, 254, 0.14);
}

.hub-sfx-name {
  font-size: 13px;
  font-weight: 600;
}

.hub-sfx-desc {
  font-size: 11px;
  color: var(--text-tertiary);
  line-height: 1.35;
}

.hub-lib-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.hub-now-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 14px;
  border-radius: 8px;
  border: 1px solid var(--stroke-divider);
  background: var(--ctrl-fill-secondary);
}

.hub-cover {
  width: 52px;
  height: 52px;
  border-radius: 10px;
  object-fit: cover;
  flex: none;
  border: 1px solid var(--stroke-divider);
}

.hub-now-body {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.hub-now-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.hub-now-title {
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.hub-now-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(128, 128, 128, 0.16);
  color: var(--text-secondary);
  white-space: nowrap;
}

.hub-now-badge.playing {
  background: rgba(96, 205, 254, 0.16);
  color: var(--accent-base, #60cdfe);
}

.hub-seek-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.hub-seek {
  flex: 1 1 auto;
  accent-color: var(--accent-base, #60cdfe);
  cursor: pointer;
}

.hub-time {
  font-size: 12px;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.hub-track-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.hub-track-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 8px;
  border: 1px solid var(--ctrl-border);
  border-left: 3px solid transparent;
  background: var(--ctrl-fill-secondary);
  color: var(--text-primary);
  cursor: pointer;
  text-align: left;
  transition: border-color 140ms ease, background 140ms ease;
}

.hub-track-card:hover {
  border-color: var(--accent-base, #60cdfe);
}

.hub-track-card.active {
  border-color: var(--accent-base, #60cdfe);
  border-left-width: 3px;
  background: rgba(96, 205, 254, 0.1);
}

.hub-track-main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.hub-track-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}

.hub-track-title {
  font-size: 14px;
  font-weight: 600;
}

.hub-track-meta {
  font-size: 11px;
  color: var(--text-tertiary);
}

.hub-track-desc {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.45;
}

.hub-track-playing {
  font-size: 11px;
  font-weight: 600;
  color: var(--accent-base, #60cdfe);
  white-space: nowrap;
}

.hub-footnote {
  font-size: 12px;
  color: var(--text-tertiary);
  line-height: 1.5;
}
</style>
