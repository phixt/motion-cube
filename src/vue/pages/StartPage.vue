<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import { useRouter } from "vue-router";
import WinButton from "../../vendor/winui-on-web/components/WinButton.vue";
import WinTextBlock from "../../vendor/winui-on-web/components/WinTextBlock.vue";
import { useI18n } from "../i18n";
import { useParallax } from "../composables/useParallax";
import PseudoCube3D from "../components/PseudoCube3D.vue";

const { t } = useI18n();
const router = useRouter();

const play = () => void router.push({ name: "game" });

const rootRef = ref<HTMLElement | null>(null);
useParallax(rootRef);

// 窄窗口（<900px）卸载魔方：仅 CSS display:none 仍会跑动画/视差
const cubeMq = window.matchMedia("(min-width: 900px)");
const showCube = ref(cubeMq.matches);
const onCubeMq = () => {
  showCube.value = cubeMq.matches;
};
cubeMq.addEventListener("change", onCubeMq);
onBeforeUnmount(() => cubeMq.removeEventListener("change", onCubeMq));
</script>

<template>
  <div class="start-page" ref="rootRef">
    <div class="startpage-background" aria-hidden="true">
      <div class="bg-layer bg-layer-1">
        <div class="bg-shape bg-ring bg-drift-a"></div>
        <div class="bg-shape bg-diamond bg-drift-b"></div>
        <div class="bg-shape bg-triangle bg-drift-c"></div>
      </div>
      <div class="bg-layer bg-layer-2">
        <div class="bg-shape bg-ring bg-drift-d"></div>
        <div class="bg-shape bg-diamond bg-drift-e"></div>
      </div>
    </div>

    <div class="startpage-content">
      <div class="startpage-left">
        <WinTextBlock class="start-title" :Text="t('start.title')" FontSize="38" FontWeight="SemiBold" />
        <WinTextBlock class="page-sub" :Text="t('start.sub')" FontSize="14" />
        <WinButton class="start-play" :Content="t('start.play')" Style="AccentButtonStyle" MinWidth="220" @Click="play" />
      </div>
      <aside v-if="showCube" class="startpage-cube" aria-hidden="true">
        <PseudoCube3D />
      </aside>
    </div>
  </div>
</template>

<style scoped>
.start-page {
  --bg-parallax-scale: 1;
  position: relative;
  height: 100%;
  box-sizing: border-box;
  overflow: hidden;
  padding: 24px;
  color: var(--text-primary);
}

.startpage-content {
  position: relative;
  z-index: 1;
  height: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 48px;
  max-width: 980px;
  margin: 0 auto;
}

.startpage-left {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
  gap: 16px;
}

.start-title {
  color: var(--text-primary);
}

.page-sub {
  color: var(--text-secondary);
}

.start-play {
  margin-top: 12px;
}

.startpage-cube {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 40px;
}

.startpage-background {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
}

.bg-layer {
  position: absolute;
  inset: 0;
  will-change: transform;
}

.bg-layer-1 {
  transform: translate3d(
    calc(var(--par-u, 0) * 18px * var(--bg-parallax-scale, 1)),
    calc(var(--par-v, 0) * 12px * var(--bg-parallax-scale, 1)),
    0
  );
}

.bg-layer-2 {
  transform: translate3d(
    calc(var(--par-u, 0) * 32px * var(--bg-parallax-scale, 1)),
    calc(var(--par-v, 0) * 20px * var(--bg-parallax-scale, 1)),
    0
  );
}

.bg-shape {
  position: absolute;
}

.bg-ring {
  width: 220px;
  height: 220px;
  border-radius: 50%;
  border: 3px solid var(--geo-color);
}

.bg-diamond {
  width: 120px;
  height: 120px;
  background: var(--geo-color);
  clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);
}

.bg-triangle {
  width: 160px;
  height: 140px;
  background: var(--geo-color);
  clip-path: polygon(50% 0, 100% 100%, 0 100%);
}

/* 慢漂移：形状内层 CSS 动画，视差外层 JS transform，互不冲突 */
.bg-drift-a {
  top: 12%;
  left: 8%;
  animation: drift-a 52s ease-in-out infinite alternate;
}
.bg-drift-b {
  bottom: 16%;
  left: 16%;
  animation: drift-b 64s ease-in-out infinite alternate;
}
.bg-drift-c {
  top: 20%;
  right: 10%;
  animation: drift-c 46s ease-in-out infinite alternate;
}
.bg-drift-d {
  bottom: 10%;
  right: 20%;
  animation: drift-d 58s ease-in-out infinite alternate;
}
.bg-drift-e {
  top: 6%;
  right: 38%;
  animation: drift-e 70s ease-in-out infinite alternate;
}

@keyframes drift-a {
  from {
    transform: translate3d(0, 0, 0);
  }
  to {
    transform: translate3d(40px, -28px, 0);
  }
}
@keyframes drift-b {
  from {
    transform: translate3d(0, 0, 0);
  }
  to {
    transform: translate3d(-36px, 24px, 0);
  }
}
@keyframes drift-c {
  from {
    transform: translate3d(0, 0, 0);
  }
  to {
    transform: translate3d(28px, 32px, 0);
  }
}
@keyframes drift-d {
  from {
    transform: translate3d(0, 0, 0);
  }
  to {
    transform: translate3d(-44px, -20px, 0);
  }
}
@keyframes drift-e {
  from {
    transform: translate3d(0, 0, 0);
  }
  to {
    transform: translate3d(20px, 36px, 0);
  }
}

@media (max-width: 900px) {
  .start-page {
    --bg-parallax-scale: 0.5;
  }

  .startpage-content {
    grid-template-columns: 1fr;
    justify-items: center;
    text-align: center;
    gap: 0;
  }

  .startpage-left {
    align-items: center;
    text-align: center;
  }
}

@media (prefers-reduced-motion: reduce) {
  .bg-drift-a,
  .bg-drift-b,
  .bg-drift-c,
  .bg-drift-d,
  .bg-drift-e {
    animation: none;
  }
}
</style>
