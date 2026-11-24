<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import { useRouter } from "vue-router";
import WinButton from "../../vendor/winui-on-web/components/WinButton.vue";
import WinTextBlock from "../../vendor/winui-on-web/components/WinTextBlock.vue";
import { useI18n } from "../i18n";
import { useParallax } from "../composables/useParallax";
import CausticCube3D from "../components/CausticCube3D.vue";

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
      <!-- 远景层（0.4× 视差）：大等轴六边形线框与极淡像素网格点阵 -->
      <div class="bg-layer bg-layer-far">
        <svg class="bg-iso bg-far-hex-a" viewBox="0 0 180 200" fill="none">
          <polygon
            points="90,8 168,54 168,146 90,192 12,146 12,54"
            stroke="currentColor"
            stroke-width="2"
          />
          <polyline points="12,54 90,100 168,54" stroke="currentColor" stroke-width="1.2" opacity="0.55" />
          <line x1="90" y1="100" x2="90" y2="192" stroke="currentColor" stroke-width="1.2" opacity="0.55" />
        </svg>
        <svg class="bg-iso bg-far-hex-b" viewBox="0 0 160 180" fill="none">
          <polygon
            points="80,8 148,48 148,132 80,172 12,132 12,48"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-dasharray="6 5"
          />
        </svg>
      </div>

      <!-- 中景层（1.0× 视差）：纯静态伪 3D 等轴方块（三面明暗分色，部分带极淡魔方彩晶点缀） -->
      <div class="bg-layer bg-layer-mid">
        <!-- 左上角：冰蓝淡彩等轴单块 -->
        <svg class="bg-iso bg-cubie bg-cubie-tl tint-blue" viewBox="0 0 96 108" fill="none">
          <polygon points="48,6 88,29 48,52 8,29" class="face-top" />
          <polygon points="8,29 48,52 48,98 8,75" class="face-left" />
          <polygon points="88,29 48,52 48,98 88,75" class="face-right" />
          <polygon points="48,6 88,29 88,75 48,98 8,75 8,29" class="face-edge" />
        </svg>

        <!-- 中上留白：琥珀橘淡彩阶梯双块 -->
        <svg class="bg-iso bg-cubie bg-cubie-top tint-amber" viewBox="0 0 116 96" fill="none">
          <!-- 后块 -->
          <polygon points="74,8 106,26 74,44 42,26" class="face-top" />
          <polygon points="42,26 74,44 74,78 42,60" class="face-left" />
          <polygon points="106,26 74,44 74,78 106,60" class="face-right" />
          <!-- 前矮块 -->
          <polygon points="42,36 74,54 42,72 10,54" class="face-top" />
          <polygon points="10,54 42,72 42,90 10,72" class="face-left" />
          <polygon points="74,54 42,72 42,90 74,72" class="face-right" />
          <polyline points="42,26 74,8 106,26 106,60 74,78 74,72 42,90 10,72 10,54 42,36" class="face-edge" />
        </svg>

        <!-- 左下外沿：翡翠绿淡彩伪 3D 角块 -->
        <svg class="bg-iso bg-cubie bg-cubie-bl tint-green" viewBox="0 0 88 98" fill="none">
          <polygon points="44,8 80,28 44,48 8,28" class="face-top" />
          <polygon points="8,28 44,48 44,88 8,68" class="face-left" />
          <polygon points="80,28 44,48 44,88 80,68" class="face-right" />
          <polygon points="44,8 80,28 80,68 44,88 8,68 8,28" class="face-edge" />
        </svg>

        <!-- 中下偏右：柔玫红淡彩扁棱片 -->
        <svg class="bg-iso bg-cubie bg-cubie-bm tint-rose" viewBox="0 0 92 74" fill="none">
          <polygon points="46,6 84,28 46,50 8,28" class="face-top" />
          <polygon points="8,28 46,50 46,66 8,44" class="face-left" />
          <polygon points="84,28 46,50 46,66 84,44" class="face-right" />
          <polygon points="46,6 84,28 84,44 46,66 8,44 8,28" class="face-edge" />
        </svg>

        <!-- 右上魔方远后景：克制中性灰等轴块 -->
        <svg class="bg-iso bg-cubie bg-cubie-tr tint-neutral" viewBox="0 0 108 122" fill="none">
          <polygon points="54,8 98,33 54,58 10,33" class="face-top" />
          <polygon points="10,33 54,58 54,110 10,85" class="face-left" />
          <polygon points="98,33 54,58 54,110 98,85" class="face-right" />
          <polygon points="54,8 98,33 98,85 54,110 10,85 10,33" class="face-edge" />
        </svg>
      </div>

      <!-- 近景微粒层（1.6× 视差）：少量像素风 '+' 十字与小菱片，增强前后纵深 -->
      <div class="bg-layer bg-layer-near">
        <span class="bg-mote bg-plus mote-1"></span>
        <span class="bg-mote bg-plus mote-2"></span>
        <span class="bg-mote bg-plus mote-3"></span>
        <span class="bg-mote bg-pixel-dia mote-4"></span>
        <span class="bg-mote bg-pixel-dia mote-5"></span>
        <span class="bg-mote bg-pixel-dia mote-6"></span>
      </div>
    </div>

    <div class="startpage-content">
      <div class="startpage-left">
        <WinTextBlock class="start-title" :Text="t('start.title')" FontSize="38" FontWeight="SemiBold" />
        <WinTextBlock class="page-sub" :Text="t('start.sub')" FontSize="14" />
        <WinButton class="start-play" :Content="t('start.play')" Style="AccentButtonStyle" MinWidth="220" @Click="play" />
      </div>
      <aside v-if="showCube" class="startpage-cube" aria-hidden="true">
        <CausticCube3D :parallax-host="rootRef" />
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
  padding: 16px 24px;
  color: var(--text-primary);
}

.startpage-content {
  position: relative;
  z-index: 1;
  height: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 18px;
  max-width: 820px;
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
  height: 100%;
  margin-left: -12px;
  margin-right: 0;
}

/* === 多层视差静态伪 3D 背景（纯 SVG/CSS，零额外 WebGL 负担） === */
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

.bg-layer-far {
  transform: translate3d(
    calc(var(--par-u, 0) * 10px * var(--bg-parallax-scale, 1)),
    calc(var(--par-v, 0) * 7px * var(--bg-parallax-scale, 1)),
    0
  );
}

.bg-layer-mid {
  transform: translate3d(
    calc(var(--par-u, 0) * 24px * var(--bg-parallax-scale, 1)),
    calc(var(--par-v, 0) * 16px * var(--bg-parallax-scale, 1)),
    0
  );
}

.bg-layer-near {
  transform: translate3d(
    calc(var(--par-u, 0) * 40px * var(--bg-parallax-scale, 1)),
    calc(var(--par-v, 0) * 26px * var(--bg-parallax-scale, 1)),
    0
  );
}

.bg-iso {
  position: absolute;
  display: block;
}

/* 远景等轴线框 */
.bg-far-hex-a {
  width: 230px;
  top: 8%;
  left: 11%;
  color: var(--geo-color);
  opacity: 0.72;
}

.bg-far-hex-b {
  width: 190px;
  bottom: 4%;
  right: 12%;
  color: var(--geo-color);
  opacity: 0.65;
}

/* 中景静态伪 3D 等轴方块：三面明暗平涂 + 细腻外棱 */
.bg-cubie {
  --c-top: rgba(160, 178, 212, 0.14);
  --c-left: rgba(128, 146, 184, 0.11);
  --c-right: rgba(96, 114, 152, 0.08);
  --c-edge: rgba(180, 196, 224, 0.22);
}

.bg-cubie .face-top {
  fill: var(--c-top);
}
.bg-cubie .face-left {
  fill: var(--c-left);
}
.bg-cubie .face-right {
  fill: var(--c-right);
}
.bg-cubie .face-edge {
  stroke: var(--c-edge);
  stroke-width: 1.4;
  stroke-linejoin: round;
}

/* 淡彩变体（深色默认） */
.tint-blue {
  --c-top: rgba(108, 186, 255, 0.17);
  --c-left: rgba(68, 138, 224, 0.13);
  --c-right: rgba(46, 98, 182, 0.10);
  --c-edge: rgba(146, 208, 255, 0.28);
}
.tint-amber {
  --c-top: rgba(255, 198, 108, 0.16);
  --c-left: rgba(242, 148, 72, 0.12);
  --c-right: rgba(196, 106, 48, 0.09);
  --c-edge: rgba(255, 212, 138, 0.26);
}
.tint-green {
  --c-top: rgba(96, 228, 162, 0.16);
  --c-left: rgba(54, 182, 122, 0.12);
  --c-right: rgba(34, 132, 88, 0.09);
  --c-edge: rgba(132, 240, 188, 0.26);
}
.tint-rose {
  --c-top: rgba(255, 134, 174, 0.15);
  --c-left: rgba(224, 88, 138, 0.11);
  --c-right: rgba(168, 56, 102, 0.08);
  --c-edge: rgba(255, 166, 198, 0.24);
}
.tint-neutral {
  --c-top: rgba(176, 188, 216, 0.12);
  --c-left: rgba(136, 148, 178, 0.09);
  --c-right: rgba(98, 110, 140, 0.07);
  --c-edge: rgba(194, 206, 232, 0.20);
}

/* 浅色主题适配：提高微弱彩度与清晰棱线，保持柔和克制 */
:global(html.theme-light) .tint-blue {
  --c-top: rgba(84, 162, 245, 0.20);
  --c-left: rgba(58, 126, 214, 0.15);
  --c-right: rgba(42, 92, 172, 0.11);
  --c-edge: rgba(56, 124, 208, 0.30);
}
:global(html.theme-light) .tint-amber {
  --c-top: rgba(245, 172, 68, 0.20);
  --c-left: rgba(226, 128, 48, 0.15);
  --c-right: rgba(188, 96, 36, 0.11);
  --c-edge: rgba(212, 126, 46, 0.28);
}
:global(html.theme-light) .tint-green {
  --c-top: rgba(52, 196, 126, 0.19);
  --c-left: rgba(34, 158, 98, 0.14);
  --c-right: rgba(24, 118, 74, 0.10);
  --c-edge: rgba(36, 152, 96, 0.28);
}
:global(html.theme-light) .tint-rose {
  --c-top: rgba(238, 104, 148, 0.18);
  --c-left: rgba(206, 72, 118, 0.13);
  --c-right: rgba(162, 48, 88, 0.10);
  --c-edge: rgba(198, 74, 118, 0.26);
}
:global(html.theme-light) .tint-neutral {
  --c-top: rgba(120, 134, 164, 0.15);
  --c-left: rgba(94, 108, 138, 0.11);
  --c-right: rgba(70, 84, 114, 0.08);
  --c-edge: rgba(96, 110, 140, 0.24);
}

/* 构图排布：避开左侧主文字与右侧主魔方，平衡四周负空间 */
.bg-cubie-tl {
  width: 68px;
  top: 7%;
  left: 4%;
  transform: rotate(-6deg);
}
.bg-cubie-top {
  width: 84px;
  top: 5%;
  left: 39%;
  transform: rotate(4deg);
}
.bg-cubie-bl {
  width: 62px;
  bottom: 7%;
  left: 7%;
  transform: rotate(7deg);
}
.bg-cubie-bm {
  width: 66px;
  bottom: 8%;
  left: 36%;
  transform: rotate(-5deg);
}
.bg-cubie-tr {
  width: 82px;
  top: 7%;
  right: 4%;
  transform: rotate(6deg);
}

/* 近景像素风 '+' 十字与小菱片 */
.bg-mote {
  position: absolute;
  display: block;
}

.bg-plus {
  width: 10px;
  height: 10px;
}
.bg-plus::before,
.bg-plus::after {
  content: "";
  position: absolute;
  background: var(--geo-color);
  opacity: 0.9;
}
.bg-plus::before {
  left: 4px;
  top: 0;
  width: 2px;
  height: 10px;
}
.bg-plus::after {
  left: 0;
  top: 4px;
  width: 10px;
  height: 2px;
}

.bg-pixel-dia {
  width: 8px;
  height: 8px;
  background: var(--geo-color);
  transform: rotate(45deg);
  opacity: 0.85;
}

.mote-1 {
  top: 19%;
  left: 28%;
}
.mote-2 {
  bottom: 22%;
  left: 25%;
}
.mote-3 {
  top: 24%;
  right: 13%;
}
.mote-4 {
  top: 14%;
  right: 34%;
}
.mote-5 {
  bottom: 18%;
  right: 8%;
}
.mote-6 {
  bottom: 13%;
  left: 48%;
}

@media (prefers-reduced-motion: reduce) {
  .bg-layer-far,
  .bg-layer-mid,
  .bg-layer-near {
    transform: none;
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

  .bg-cubie-top,
  .bg-cubie-bm {
    opacity: 0.55;
  }
}
</style>
