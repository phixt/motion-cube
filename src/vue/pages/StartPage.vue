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
      <!-- 环境氛围层：将右侧高清折光魔方自然融入 Fluent 窗口，消除画布边界割裂 -->
      <div class="bg-ambient-wash" />

      <!-- 远景层（0.38× 视差）：空间旋转轨道弧 + 刻度经纬线（呼应魔方 R/U/F 运动轴） -->
      <div class="bg-layer bg-layer-far">
        <svg class="bg-orbit bg-orbit-main" viewBox="0 0 640 480" fill="none">
          <defs>
            <linearGradient id="mc-orbit-grad-a" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="currentColor" stop-opacity="0.06" />
              <stop offset="50%" stop-color="currentColor" stop-opacity="0.42" />
              <stop offset="100%" stop-color="currentColor" stop-opacity="0.04" />
            </linearGradient>
            <linearGradient id="mc-orbit-grad-b" x1="1" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="currentColor" stop-opacity="0.04" />
              <stop offset="55%" stop-color="currentColor" stop-opacity="0.34" />
              <stop offset="100%" stop-color="currentColor" stop-opacity="0.05" />
            </linearGradient>
          </defs>
          <!-- 主倾斜椭圆轨道（U/R 运动弧） -->
          <ellipse
            cx="420"
            cy="240"
            rx="210"
            ry="118"
            transform="rotate(-19 420 240)"
            stroke="url(#mc-orbit-grad-a)"
            stroke-width="1.4"
          />
          <ellipse
            cx="420"
            cy="240"
            rx="168"
            ry="88"
            transform="rotate(28 420 240)"
            stroke="url(#mc-orbit-grad-b)"
            stroke-width="1.2"
            stroke-dasharray="5 7"
          />
          <!-- 极淡远景等轴三轴线 -->
          <line x1="115" y1="365" x2="295" y2="262" stroke="currentColor" stroke-width="1" opacity="0.22" />
          <line x1="205" y1="76" x2="205" y2="262" stroke="currentColor" stroke-width="1" opacity="0.18" stroke-dasharray="3 6" />
          <!-- 旋转方向微标箭头 -->
          <path d="M582 146 L594 156 L579 162" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.46" />
          <path d="M254 316 L243 305 L258 299" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" opacity="0.38" />
          <!-- 轨道刻度节点 -->
          <circle cx="592" cy="156" r="2.6" fill="currentColor" opacity="0.52" />
          <circle cx="245" cy="306" r="2.4" fill="currentColor" opacity="0.42" />
          <circle cx="420" cy="122" r="2" fill="currentColor" opacity="0.32" />
        </svg>
      </div>

      <!-- 中景层（1.0× 视差）：差异化魔方解构几何构件 + 极轻独立相位悬浮呼吸 -->
      <div class="bg-layer bg-layer-mid">
        <!-- 左上：解构三层薄片（呼应魔方三层滑动切片） -->
        <svg class="bg-iso bg-piece bg-piece-slices tint-blue" viewBox="0 0 128 116" fill="none">
          <!-- 底层切片 -->
          <polygon points="64,46 112,72 64,98 16,72" class="face-right" />
          <polygon points="64,46 112,72 64,98 16,72" class="face-edge" />
          <!-- 中层微错位切片 -->
          <g transform="translate(5, -18)">
            <polygon points="64,46 112,72 64,98 16,72" class="face-left" />
            <polygon points="64,46 112,72 64,98 16,72" class="face-edge" />
          </g>
          <!-- 顶层斜切高光片 -->
          <g transform="translate(-4, -36)">
            <polygon points="64,46 112,72 64,98 16,72" class="face-top" />
            <polyline points="26,72 64,51 102,72" class="face-glint" />
            <polygon points="64,46 112,72 64,98 16,72" class="face-edge" />
          </g>
        </svg>

        <!-- 中上：带内挖圆弧与折射线的斜切棱晶块 -->
        <svg class="bg-iso bg-piece bg-piece-prism tint-cyan" viewBox="0 0 116 116" fill="none">
          <polygon points="58,10 100,34 58,58 16,34" class="face-top" />
          <polygon points="16,34 58,58 58,104 16,80" class="face-left" />
          <polygon points="100,34 58,58 58,104 100,80" class="face-right" />
          <!-- 内挖球腔剖面微弧 -->
          <circle cx="58" cy="58" r="19" class="cavity-arc" stroke-dasharray="4 3" />
          <line x1="34" y1="24" x2="82" y2="90" class="face-glint" />
          <polygon points="58,10 100,34 100,80 58,104 16,80 16,34" class="face-edge" />
        </svg>

        <!-- 左下：双块错位拧转 L 型角块簇 -->
        <svg class="bg-iso bg-piece bg-piece-corner tint-emerald" viewBox="0 0 124 108" fill="none">
          <!-- 底层块 -->
          <polygon points="48,32 84,52 48,72 12,52" class="face-top" />
          <polygon points="12,52 48,72 48,96 12,76" class="face-left" />
          <polygon points="84,52 48,72 48,96 84,76" class="face-right" />
          <polygon points="48,32 84,52 84,76 48,96 12,76 12,52" class="face-edge" />
          <!-- 右上微偏角块 -->
          <g transform="translate(26, -16)">
            <polygon points="48,26 80,44 48,62 16,44" class="face-top" />
            <polygon points="16,44 48,62 48,82 16,64" class="face-left" />
            <polygon points="80,44 48,62 48,82 80,64" class="face-right" />
            <polygon points="48,26 80,44 80,64 48,82 16,64 16,44" class="face-edge" />
          </g>
        </svg>

        <!-- 中下：精致 6 轴等轴十字轴标（与主魔方内部 6 轴结构遥相呼应） -->
        <svg class="bg-iso bg-piece bg-piece-axes tint-amber" viewBox="0 0 104 104" fill="none">
          <line x1="52" y1="14" x2="52" y2="90" class="axis-line" />
          <line x1="18" y1="33" x2="86" y2="71" class="axis-line" />
          <line x1="86" y1="33" x2="18" y2="71" class="axis-line" />
          <polygon points="52,42 61,47 61,57 52,62 43,57 43,47" class="face-top" />
          <polygon points="52,42 61,47 61,57 52,62 43,57 43,47" class="face-edge" />
          <circle cx="52" cy="14" r="3.2" class="axis-cap" />
          <circle cx="52" cy="90" r="3.2" class="axis-cap" />
          <circle cx="18" cy="33" r="3.2" class="axis-cap" />
          <circle cx="86" cy="71" r="3.2" class="axis-cap" />
          <circle cx="86" cy="33" r="3.2" class="axis-cap" />
          <circle cx="18" cy="71" r="3.2" class="axis-cap" />
        </svg>

        <!-- 右上：倒角斜切透明棱片 -->
        <svg class="bg-iso bg-piece bg-piece-shard tint-violet" viewBox="0 0 96 108" fill="none">
          <polygon points="48,8 84,28 72,82 36,98 14,62 24,22" class="face-left" />
          <polygon points="48,8 84,28 48,48 24,22" class="face-top" />
          <polygon points="84,28 48,48 72,82" class="face-right" />
          <polyline points="24,22 48,48 36,98" class="face-glint" />
          <polygon points="48,8 84,28 72,82 36,98 14,62 24,22" class="face-edge" />
        </svg>
      </div>

      <!-- 近景光点层（1.6× 视差）：锐利四角星芒与微环，克制点缀纵深 -->
      <div class="bg-layer bg-layer-near">
        <svg class="bg-star star-1" viewBox="0 0 20 20" fill="none">
          <path d="M10 1 L11.8 8.2 L19 10 L11.8 11.8 L10 19 L8.2 11.8 L1 10 L8.2 8.2 Z" fill="currentColor" />
        </svg>
        <svg class="bg-star star-2" viewBox="0 0 20 20" fill="none">
          <path d="M10 2 L11.5 8.5 L18 10 L11.5 11.5 L10 18 L8.5 11.5 L2 10 L8.5 8.5 Z" fill="currentColor" />
        </svg>
        <svg class="bg-star star-3" viewBox="0 0 20 20" fill="none">
          <path d="M10 3 L11.2 8.8 L17 10 L11.2 11.2 L10 17 L8.8 11.2 L3 10 L8.8 8.8 Z" fill="currentColor" />
        </svg>
        <span class="bg-ring ring-1" />
        <span class="bg-ring ring-2" />
        <span class="bg-ring ring-3" />
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
  max-width: 840px;
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

/* === 空间运动几何背景（纯 SVG/CSS，零额外 WebGL 开销） === */
.startpage-background {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
}

/* 右侧主魔方背后的柔和环境漫射场，与深/浅主题自然融合 */
.bg-ambient-wash {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(46% 58% at 70% 48%, rgba(72, 148, 255, 0.13) 0%, rgba(124, 96, 255, 0.05) 42%, transparent 74%),
    radial-gradient(34% 40% at 18% 22%, rgba(56, 198, 168, 0.06) 0%, transparent 70%);
}

:global(html.theme-light) .bg-ambient-wash {
  background:
    radial-gradient(46% 58% at 70% 48%, rgba(74, 152, 248, 0.13) 0%, rgba(72, 206, 178, 0.06) 44%, transparent 74%),
    radial-gradient(34% 40% at 18% 22%, rgba(92, 164, 246, 0.08) 0%, transparent 70%);
}

.bg-layer {
  position: absolute;
  inset: 0;
  will-change: transform;
}

.bg-layer-far {
  transform: translate3d(
    calc(var(--par-u, 0) * 9px * var(--bg-parallax-scale, 1)),
    calc(var(--par-v, 0) * 6px * var(--bg-parallax-scale, 1)),
    0
  );
}

.bg-layer-mid {
  transform: translate3d(
    calc(var(--par-u, 0) * 22px * var(--bg-parallax-scale, 1)),
    calc(var(--par-v, 0) * 14px * var(--bg-parallax-scale, 1)),
    0
  );
}

.bg-layer-near {
  transform: translate3d(
    calc(var(--par-u, 0) * 38px * var(--bg-parallax-scale, 1)),
    calc(var(--par-v, 0) * 24px * var(--bg-parallax-scale, 1)),
    0
  );
}

/* 远景旋转轨道层 */
.bg-orbit {
  position: absolute;
  display: block;
  color: var(--geo-color);
}

.bg-orbit-main {
  width: min(86vw, 820px);
  height: auto;
  top: 50%;
  left: 52%;
  transform: translate(-50%, -50%);
  opacity: 0.92;
}

/* 中景差异化解构魔方构件 */
.bg-iso {
  position: absolute;
  display: block;
}

.bg-piece {
  --c-top: rgba(160, 184, 224, 0.14);
  --c-left: rgba(118, 148, 198, 0.10);
  --c-right: rgba(84, 114, 168, 0.07);
  --c-edge: rgba(182, 206, 242, 0.24);
  --c-glint: rgba(226, 242, 255, 0.34);
}

.bg-piece .face-top {
  fill: var(--c-top);
}
.bg-piece .face-left {
  fill: var(--c-left);
}
.bg-piece .face-right {
  fill: var(--c-right);
}
.bg-piece .face-edge {
  stroke: var(--c-edge);
  stroke-width: 1.3;
  stroke-linejoin: round;
}
.bg-piece .face-glint {
  stroke: var(--c-glint);
  stroke-width: 1.1;
  stroke-linecap: round;
}
.bg-piece .cavity-arc {
  stroke: var(--c-glint);
  stroke-width: 1.1;
  fill: none;
  opacity: 0.72;
}
.bg-piece .axis-line {
  stroke: var(--c-edge);
  stroke-width: 1.3;
  stroke-linecap: round;
}
.bg-piece .axis-cap {
  fill: var(--c-top);
  stroke: var(--c-edge);
  stroke-width: 1.2;
}

/* 淡彩主题变体（深色） */
.tint-blue {
  --c-top: rgba(96, 178, 255, 0.16);
  --c-left: rgba(58, 132, 224, 0.12);
  --c-right: rgba(40, 96, 182, 0.09);
  --c-edge: rgba(138, 204, 255, 0.28);
  --c-glint: rgba(206, 236, 255, 0.42);
}
.tint-cyan {
  --c-top: rgba(86, 224, 242, 0.15);
  --c-left: rgba(48, 172, 206, 0.11);
  --c-right: rgba(34, 126, 166, 0.08);
  --c-edge: rgba(132, 236, 250, 0.26);
  --c-glint: rgba(212, 252, 255, 0.40);
}
.tint-emerald {
  --c-top: rgba(74, 224, 160, 0.15);
  --c-left: rgba(40, 174, 120, 0.11);
  --c-right: rgba(28, 128, 88, 0.08);
  --c-edge: rgba(118, 238, 186, 0.26);
  --c-glint: rgba(204, 255, 230, 0.38);
}
.tint-amber {
  --c-top: rgba(255, 196, 104, 0.16);
  --c-left: rgba(236, 146, 68, 0.12);
  --c-right: rgba(190, 102, 46, 0.08);
  --c-edge: rgba(255, 212, 140, 0.28);
  --c-glint: rgba(255, 242, 204, 0.40);
}
.tint-violet {
  --c-top: rgba(164, 142, 255, 0.15);
  --c-left: rgba(122, 98, 224, 0.11);
  --c-right: rgba(88, 70, 178, 0.08);
  --c-edge: rgba(192, 176, 255, 0.26);
  --c-glint: rgba(232, 224, 255, 0.38);
}

/* 浅色主题校准 */
:global(html.theme-light) .tint-blue {
  --c-top: rgba(62, 142, 238, 0.22);
  --c-left: rgba(42, 110, 202, 0.16);
  --c-right: rgba(30, 82, 162, 0.11);
  --c-edge: rgba(44, 112, 198, 0.36);
  --c-glint: rgba(255, 255, 255, 0.78);
}
:global(html.theme-light) .tint-cyan {
  --c-top: rgba(34, 174, 200, 0.21);
  --c-left: rgba(24, 138, 168, 0.15);
  --c-right: rgba(18, 102, 132, 0.11);
  --c-edge: rgba(28, 142, 172, 0.35);
  --c-glint: rgba(255, 255, 255, 0.78);
}
:global(html.theme-light) .tint-emerald {
  --c-top: rgba(38, 184, 124, 0.21);
  --c-left: rgba(24, 144, 96, 0.15);
  --c-right: rgba(18, 106, 72, 0.11);
  --c-edge: rgba(28, 142, 96, 0.34);
  --c-glint: rgba(255, 255, 255, 0.74);
}
:global(html.theme-light) .tint-amber {
  --c-top: rgba(232, 152, 48, 0.22);
  --c-left: rgba(206, 112, 34, 0.16);
  --c-right: rgba(170, 82, 26, 0.11);
  --c-edge: rgba(196, 112, 38, 0.36);
  --c-glint: rgba(255, 255, 255, 0.74);
}
:global(html.theme-light) .tint-violet {
  --c-top: rgba(124, 98, 232, 0.20);
  --c-left: rgba(92, 70, 198, 0.15);
  --c-right: rgba(68, 52, 158, 0.11);
  --c-edge: rgba(96, 74, 196, 0.34);
  --c-glint: rgba(255, 255, 255, 0.74);
}

/* 独立相位缓慢呼吸悬浮（极轻位移，绝不抢主体视线） */
@keyframes float-slow-a {
  0%, 100% { transform: translateY(0px) rotate(-5deg); }
  50% { transform: translateY(-7px) rotate(-3.5deg); }
}
@keyframes float-slow-b {
  0%, 100% { transform: translateY(0px) rotate(4deg); }
  50% { transform: translateY(6px) rotate(5.5deg); }
}
@keyframes float-slow-c {
  0%, 100% { transform: translateY(0px) rotate(6deg); }
  50% { transform: translateY(-6px) rotate(4.2deg); }
}

.bg-piece-slices {
  width: 96px;
  top: 7%;
  left: 4%;
  animation: float-slow-a 12s ease-in-out infinite;
}
.bg-piece-prism {
  width: 82px;
  top: 6%;
  left: 37%;
  animation: float-slow-b 14s ease-in-out infinite;
}
.bg-piece-corner {
  width: 92px;
  bottom: 7%;
  left: 6%;
  animation: float-slow-c 13s ease-in-out infinite;
}
.bg-piece-axes {
  width: 78px;
  bottom: 7%;
  left: 36%;
  animation: float-slow-a 15s ease-in-out -4s infinite;
}
.bg-piece-shard {
  width: 76px;
  top: 7%;
  right: 4%;
  animation: float-slow-b 11s ease-in-out -3s infinite;
}

/* 近景四角星芒与极细光环 */
.bg-star {
  position: absolute;
  width: 14px;
  height: 14px;
  color: var(--geo-color);
  opacity: 0.92;
}
.star-1 {
  top: 18%;
  left: 27%;
  width: 15px;
  height: 15px;
}
.star-2 {
  top: 22%;
  right: 12%;
  width: 12px;
  height: 12px;
}
.star-3 {
  bottom: 20%;
  left: 24%;
  width: 13px;
  height: 13px;
}

.bg-ring {
  position: absolute;
  display: block;
  border-radius: 50%;
  border: 1.3px solid var(--geo-color);
  opacity: 0.78;
}
.ring-1 {
  width: 10px;
  height: 10px;
  top: 14%;
  right: 33%;
}
.ring-2 {
  width: 8px;
  height: 8px;
  bottom: 16%;
  right: 9%;
}
.ring-3 {
  width: 11px;
  height: 11px;
  bottom: 12%;
  left: 48%;
}

@media (prefers-reduced-motion: reduce) {
  .bg-layer-far,
  .bg-layer-mid,
  .bg-layer-near {
    transform: none;
  }
  .bg-piece-slices,
  .bg-piece-prism,
  .bg-piece-corner,
  .bg-piece-axes,
  .bg-piece-shard {
    animation: none;
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

  .bg-piece-prism,
  .bg-piece-axes {
    opacity: 0.52;
  }
}
</style>
