<script setup lang="ts">
/**
 * 首页风格化晶体折光魔方 + 硬边焦散光斑（中量档）：
 * 封装 StartCausticCubeView（Three.js + 自定义 GLSL），自动同步明/暗主题、
 * prefers-reduced-motion、页面可见性与卸载 dispose()；WebGL 不可用时无缝回退 PseudoCube3D。
 */
import { onBeforeUnmount, onMounted, ref } from "vue";
import { StartCausticCubeView, type StartCubeTheme } from "../../render/startCausticCube";
import PseudoCube3D from "./PseudoCube3D.vue";

const props = defineProps<{
  parallaxHost?: HTMLElement | null;
}>();

const hostRef = ref<HTMLElement | null>(null);
const fallbackCss = ref(false);

let view: StartCausticCubeView | null = null;
let themeObserver: MutationObserver | null = null;
let darkMq: MediaQueryList | null = null;
let motionMq: MediaQueryList | null = null;

function resolveTheme(): StartCubeTheme {
  const cls = document.documentElement.classList;
  if (cls.contains("theme-light")) return "light";
  if (cls.contains("theme-dark")) return "dark";
  return darkMq?.matches ? "dark" : "light";
}

const syncTheme = (): void => {
  view?.setTheme(resolveTheme());
};

const onMotionChange = (): void => {
  view?.setReducedMotion(motionMq?.matches ?? false);
};

const onVisibility = (): void => {
  if (document.hidden) view?.pause();
  else view?.resume();
};

onMounted(() => {
  if (!hostRef.value) return;
  darkMq = window.matchMedia("(prefers-color-scheme: dark)");
  motionMq = window.matchMedia("(prefers-reduced-motion: reduce)");
  try {
    view = new StartCausticCubeView(hostRef.value, {
      parallaxHost: props.parallaxHost ?? hostRef.value.closest(".start-page"),
      theme: resolveTheme(),
      reducedMotion: motionMq.matches,
    });
  } catch {
    fallbackCss.value = true;
    return;
  }
  themeObserver = new MutationObserver(syncTheme);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  darkMq.addEventListener("change", syncTheme);
  motionMq.addEventListener("change", onMotionChange);
  document.addEventListener("visibilitychange", onVisibility);
});

onBeforeUnmount(() => {
  themeObserver?.disconnect();
  themeObserver = null;
  darkMq?.removeEventListener("change", syncTheme);
  motionMq?.removeEventListener("change", onMotionChange);
  document.removeEventListener("visibilitychange", onVisibility);
  view?.dispose();
  view = null;
});
</script>

<template>
  <PseudoCube3D v-if="fallbackCss" />
  <div v-else ref="hostRef" class="caustic-cube-stage" />
</template>

<style scoped>
.caustic-cube-stage {
  position: relative;
  width: clamp(310px, 44vmin, 420px);
  height: clamp(335px, 48vmin, 450px);
  max-height: 100%;
  aspect-ratio: 420 / 450;
  pointer-events: none;
}
</style>
