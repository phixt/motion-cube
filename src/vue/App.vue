<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import WinButton from "../vendor/winui-on-web/components/WinButton.vue";
import WinNavigationView from "../vendor/winui-on-web/components/WinNavigationView.vue";
import WinTitleBar from "../vendor/winui-on-web/components/WinTitleBar.vue";
import WinToolTipService from "../vendor/winui-on-web/components/WinToolTipService.vue";
import { isLocale } from "../i18n";
import { isTextEntryTarget } from "../input/textEntry";
import { bindingKey } from "../input/keymap";
import {
  audioMutedRef,
  loadKeymap,
  loadSettings,
  parallaxIntensityRef,
  saveParallaxIntensity,
  saveSettings,
  toggleAudioMuted,
  type ParallaxIntensity,
} from "../settings";
import { disposeAudio, initAudio, setAudioRoute } from "../audio/audioManager";
import { localeRef, setMotionCubeLocale, useI18n } from "./i18n";
import { APP_ROUTES } from "./router";
import {
  applyMaterial,
  applyTheme,
  applyUiScale,
  cycle,
  loadMaterial,
  loadTheme,
  loadUiScale,
  MATERIAL_MODES,
  THEME_MODES,
  UI_SCALES,
  type MaterialMode,
  type ThemeMode,
  type UiScale,
} from "./theme";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const isPaneOpen = ref(true);
const themeMode = ref<ThemeMode>(loadTheme());
const materialMode = ref<MaterialMode>(loadMaterial());
const uiScale = ref<UiScale>(loadUiScale());
const locale = localeRef;

const onLocaleChange = (e: Event): void => {
  const v = (e.target as HTMLSelectElement).value;
  if (!isLocale(v)) return;
  setMotionCubeLocale(v);
  saveSettings({ ...loadSettings(), locale: v });
};

watch(
  themeMode,
  (v) => {
    applyTheme(v);
    localStorage.setItem("motion-cube.theme", v);
  },
  { immediate: true },
);
watch(
  materialMode,
  (v) => {
    applyMaterial(v);
    localStorage.setItem("motion-cube.material", v);
  },
  { immediate: true },
);
watch(
  uiScale,
  (v) => {
    applyUiScale(v);
    localStorage.setItem("motion-cube.uiScale", String(v));
  },
  { immediate: true },
);

const navMenuItems = computed(() =>
  APP_ROUTES.map((r) => ({ Tag: r.name, Icon: r.icon, Content: t(r.titleKey) })),
);

const selectedNavigationItem = computed({
  get: () => navMenuItems.value.find((i) => i.Tag === route.name) ?? navMenuItems.value[0],
  set: (item) => {
    if (item?.Tag) void router.push({ name: item.Tag });
  },
});

const onItemInvoked = (args: { InvokedItemContainer?: { Tag?: string; SelectsOnInvoked?: boolean } } | undefined) => {
  const item = args?.InvokedItemContainer;
  if (!item || item.SelectsOnInvoked === false || !item.Tag) return;
  if (item.Tag !== route.name) void router.push({ name: item.Tag });
};

const onPaneToggle = () => {
  isPaneOpen.value = !isPaneOpen.value;
};
const cycleTheme = () => {
  themeMode.value = cycle(THEME_MODES, themeMode.value);
};
const cycleMaterial = () => {
  materialMode.value = cycle(MATERIAL_MODES, materialMode.value);
};
const cycleUiScale = () => {
  uiScale.value = cycle(UI_SCALES, uiScale.value);
};
const themeLabel = computed(() => t(`theme.${themeMode.value}`));
const materialLabel = computed(() => t(`material.${materialMode.value}`));
const uiScaleLabel = computed(() => `${t("uiScale.label")}: ${Math.round(uiScale.value * 100)}%`);

const PARALLAX_LEVEL_KEYS = ["off", "low", "medium", "high"] as const;
const parallaxLabel = computed(
  () => `${t("parallax.label")}: ${t(`parallax.${PARALLAX_LEVEL_KEYS[parallaxIntensityRef.value]}`)}`,
);
const cycleParallax = () => {
  const next = ((parallaxIntensityRef.value + 1) % 4) as ParallaxIntensity;
  saveParallaxIntensity(next);
};

const audioLabel = computed(
  () => `${t("audio.label")}: ${audioMutedRef.value ? t("audio.off") : t("audio.on")}`,
);
const toggleAudioMute = () => {
  toggleAudioMuted();
};

/** 判断游戏页当前键位是否把裸 M 键占作魔方动作（默认 KeyM = 中层 M 转） */
function isPlainMBoundInGame(): boolean {
  const cfg = loadKeymap();
  const target = bindingKey({ code: "KeyM", shift: false, space: false });
  for (const b of Object.values(cfg.moves)) {
    if (bindingKey(b) === target) return true;
  }
  for (const b of Object.values(cfg.specials)) {
    if (bindingKey(b) === target) return true;
  }
  return false;
}

/** 全局 M 静音快捷键（输入框打字/按键改绑捕获期不抢键；游戏页若 M 已绑中层转则让行，并用 Alt+M 兜底） */
const onGlobalAudioKeyDown = (e: KeyboardEvent): void => {
  if (e.code !== "KeyM" || e.repeat) return;
  if (document.body.dataset.mcKeyCapture === "1") return;
  if (isTextEntryTarget(e.target)) return;

  if (e.altKey && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    toggleAudioMuted();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
  if (route.name === "game" && isPlainMBoundInGame()) return;

  e.preventDefault();
  toggleAudioMuted();
};

watch(
  () => route.name,
  (name) => {
    setAudioRoute(name);
  },
);

// ---- Tauri 无边框自绘标题栏窗口控制（decorations: false，仅桌面端启用） ----
const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const isMaximized = ref(false);
let unlistenResize: (() => void) | null = null;

async function withTauriWindow(fn: (win: import("@tauri-apps/api/window").Window) => Promise<void> | void): Promise<void> {
  if (!isTauri) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await fn(getCurrentWindow());
}

const onWinMinimize = () => {
  void withTauriWindow((w) => w.minimize());
};
const onWinToggleMaximize = () => {
  void withTauriWindow(async (w) => {
    await w.toggleMaximize();
    isMaximized.value = await w.isMaximized();
  });
};
const onWinClose = () => {
  void withTauriWindow((w) => w.close());
};
const onTitlebarMouseDown = (e: MouseEvent) => {
  if (!isTauri || e.button !== 0) return;
  const target = e.target as HTMLElement | null;
  if (target?.closest("button, select, input, a, .titlebar-actions, .win-caption-controls")) return;
  if (e.detail === 2) {
    onWinToggleMaximize();
  } else {
    void withTauriWindow((w) => w.startDragging());
  }
};

onMounted(() => {
  initAudio(route.name);
  window.addEventListener("keydown", onGlobalAudioKeyDown);
  if (!isTauri) return;
  void withTauriWindow(async (w) => {
    isMaximized.value = await w.isMaximized();
    unlistenResize = await w.onResized(async () => {
      isMaximized.value = await w.isMaximized();
    });
  });
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onGlobalAudioKeyDown);
  disposeAudio();
  unlistenResize?.();
  unlistenResize = null;
});
</script>

<template>
  <WinToolTipService />
  <WinTitleBar
    class="app-titlebar"
    :class="{ 'is-tauri-desktop': isTauri }"
    :Title="t('app.title')"
    PreferredHeightOption="Tall"
    :IsBackButtonVisible="false"
    :IsPaneToggleButtonVisible="true"
    TitleBarContentHorizontalAlignment="Stretch"
    @mousedown="onTitlebarMouseDown"
    @PaneToggleRequested="onPaneToggle">
    <div class="titlebar-actions">
      <select class="lang-select" :value="locale" @change="onLocaleChange">
        <option value="zh-CN">中文</option>
        <option value="en">English</option>
      </select>
      <WinButton :Content="`${t('theme.label')}: ${themeLabel}`" @Click="cycleTheme" />
      <WinButton :Content="`${t('material.label')}: ${materialLabel}`" @Click="cycleMaterial" />
      <WinButton :Content="uiScaleLabel" @Click="cycleUiScale" />
      <WinButton :Content="parallaxLabel" @Click="cycleParallax" />
      <WinButton id="btn-audio-mute" :Content="audioLabel" @Click="toggleAudioMute" />
      <div v-if="isTauri" class="win-caption-controls" role="group" aria-label="Window controls">
        <button type="button" class="win-caption-btn" aria-label="Minimize" @click="onWinMinimize">&#xE921;</button>
        <button type="button" class="win-caption-btn" :aria-label="isMaximized ? 'Restore' : 'Maximize'" @click="onWinToggleMaximize">
          {{ isMaximized ? "\uE923" : "\uE922" }}
        </button>
        <button type="button" class="win-caption-btn win-caption-close" aria-label="Close" @click="onWinClose">&#xE8BB;</button>
      </div>
    </div>
  </WinTitleBar>

  <div class="app-content wco-titlebar">
    <WinNavigationView
      v-model:IsPaneOpen="isPaneOpen"
      :SelectedItem="selectedNavigationItem"
      :MenuItems="navMenuItems"
      :FooterMenuItems="[]"
      IsBackButtonVisible="Collapsed"
      :IsPaneToggleButtonVisible="false"
      :IsSettingsVisible="false"
      @ItemInvoked="onItemInvoked">
      <router-view v-slot="{ Component }">
        <Transition name="page-fade" mode="out-in">
          <div class="mc-page-view" :key="route.fullPath">
            <component :is="Component" />
          </div>
        </Transition>
      </router-view>
    </WinNavigationView>
  </div>
</template>

<style>
.app-content {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.mc-page-view {
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.app-content.wco-titlebar {
  box-sizing: border-box;
  padding-top: max(env(titlebar-area-height, 0px), 48px);
}

.app-titlebar {
  background: var(--SolidBackgroundFillColorBaseBrush, var(--app-bg));
}

.titlebar-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-left: auto;
  align-items: center;
  -webkit-app-region: no-drag;
}

.app-titlebar.is-tauri-desktop {
  --TitleBarMinDragRegionWidth: 0px;
}

.win-caption-controls {
  display: flex;
  align-items: stretch;
  height: 100%;
  margin-left: 8px;
  -webkit-app-region: no-drag;
}

.win-caption-btn {
  width: 46px;
  height: 100%;
  border: 0;
  background: transparent;
  color: var(--text-primary);
  font-family: var(--SymbolThemeFontFamily, "WinUIOnWebIcons", "Segoe Fluent Icons", "Segoe MDL2 Assets");
  font-size: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}

.win-caption-btn:hover {
  background: var(--subtle-secondary, rgba(128, 128, 128, 0.16));
}

.win-caption-btn.win-caption-close:hover {
  background: #c42b1c;
  color: #ffffff;
}

.lang-select {
  box-sizing: border-box;
  min-height: 32px;
  padding: 4px 10px;
  border: 1px solid var(--ctrl-border);
  border-radius: var(--ControlCornerRadius, 4px);
  background: var(--ctrl-fill-input-active, var(--ctrl-solid-fill));
  color: var(--text-primary);
  font-size: 14px;
  font-family: inherit;
  cursor: pointer;
}

.lang-select:focus {
  outline: 2px solid var(--accent-base);
  outline-offset: 1px;
}

/* 材质：mica = 实色背景；acrylic = 半透明 + 磨砂 */
html.material-mica body {
  background: var(--app-bg, #202020);
}

html.material-acrylic body {
  background:
    radial-gradient(1200px 700px at 20% -10%, rgba(76, 194, 255, 0.14), transparent 60%),
    radial-gradient(1000px 600px at 110% 20%, rgba(108, 203, 95, 0.10), transparent 55%),
    var(--app-bg, #202020);
}

html.material-acrylic .app-content {
  -webkit-backdrop-filter: blur(28px) saturate(170%);
  backdrop-filter: blur(28px) saturate(170%);
}

html.material-acrylic .app-titlebar {
  background: rgba(120, 120, 128, 0.16);
  -webkit-backdrop-filter: blur(24px) saturate(170%);
  backdrop-filter: blur(24px) saturate(170%);
}

/* 页面过渡：轻量淡入 + 上移 */
.page-fade-enter-active,
.page-fade-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

.page-fade-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.page-fade-leave-to {
  opacity: 0;
}
</style>
