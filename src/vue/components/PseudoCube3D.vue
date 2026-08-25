<script setup lang="ts">
/** 首页伪 3D 魔方：无边框 stickerless 风格 + 极细格线分块。
 *  transform 三层分离：tilt(静态倾斜) / parallax(消费 --par-u/--par-v) / spin(40s 自转)。
 *  消费 StartPage 根节点注入的视差 CSS 变量，不自行监听 pointer。 */
const FACES = ["front", "back", "left", "right", "top", "bottom"] as const;

const cellStyle = (face: (typeof FACES)[number]): Record<string, string> => ({
  background: `var(--cube-face-${face})`,
});
</script>

<template>
  <div class="cube-stage">
    <div class="cube-tilt">
      <div class="cube-parallax">
        <div class="cube-spin">
          <div v-for="face in FACES" :key="face" class="cube-face" :class="`cube-face-${face}`">
            <div v-for="k in 9" :key="k" class="cube-cell" :style="cellStyle(face)" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cube-stage {
  --cube-size: clamp(100px, 15vmin, 190px);
  position: relative;
  width: var(--cube-size);
  height: var(--cube-size);
  perspective: 1700px;
}

.cube-tilt,
.cube-parallax,
.cube-spin {
  position: absolute;
  inset: 0;
  transform-style: preserve-3d;
}

.cube-tilt {
  transform: rotateX(-18deg);
}

.cube-parallax {
  transform: rotateX(calc(var(--par-v, 0) * -4deg)) rotateY(calc(var(--par-u, 0) * 6deg));
  will-change: transform;
}

.cube-spin {
  animation: cube-spin 40s linear infinite;
}

.cube-face {
  position: absolute;
  inset: 0;
  box-sizing: border-box;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(3, 1fr);
  gap: 1px;
  padding: 1px;
  background: var(--cube-gap, rgba(0, 0, 0, 0.35));
  backface-visibility: hidden;
}

.cube-cell {
  min-width: 0;
  min-height: 0;
}

.cube-face-front {
  transform: translateZ(calc(var(--cube-size) / 2));
}
.cube-face-back {
  transform: rotateY(180deg) translateZ(calc(var(--cube-size) / 2));
}
.cube-face-right {
  transform: rotateY(90deg) translateZ(calc(var(--cube-size) / 2));
}
.cube-face-left {
  transform: rotateY(-90deg) translateZ(calc(var(--cube-size) / 2));
}
.cube-face-top {
  transform: rotateX(90deg) translateZ(calc(var(--cube-size) / 2));
}
.cube-face-bottom {
  transform: rotateX(-90deg) translateZ(calc(var(--cube-size) / 2));
}

@keyframes cube-spin {
  from {
    transform: rotateY(0deg);
  }
  to {
    transform: rotateY(360deg);
  }
}
</style>
