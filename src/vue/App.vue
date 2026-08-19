<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import WinButton from "../vendor/winui-on-web/components/WinButton.vue";
import WinNavigationView from "../vendor/winui-on-web/components/WinNavigationView.vue";
import WinTitleBar from "../vendor/winui-on-web/components/WinTitleBar.vue";
import WinToolTipService from "../vendor/winui-on-web/components/WinToolTipService.vue";
import { isLocale } from "../i18n";
import {
  loadSettings,
  parallaxIntensityRef,
  saveParallaxIntensity,
  saveSettings,
  type ParallaxIntensity,
} from "../settings";
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
</script>

<template>
  <WinToolTipService />
  <WinTitleBar
    class="app-titlebar"
    :Title="t('app.title')"
    PreferredHeightOption="Tall"
    :IsBackButtonVisible="false"
    :IsPaneToggleButtonVisible="true"
    TitleBarContentHorizontalAlignment="Stretch"
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
