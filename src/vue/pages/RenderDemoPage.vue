<template>
  <div class="rdemo">
    <div ref="stage" class="rstage"></div>
    <div class="rbar">
      <button @click="scramble">打乱 ×20（连播）</button>
      <button @click="undo">撤销一步</button>
      <button @click="fit">适配视角</button>
      <button @click="algDemo">演示 (R U R' U')×3</button>
      <button @click="toggleSpin">{{ spinOn ? "自转:ON" : "自转:OFF" }}</button>
      <span class="rinfo">{{ info }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { RenderCube } from "../../cube/render/RenderCube.ts";
import { RenderCubeHost } from "../../cube/render/RenderCubeHost.ts";
import { MOVE_NAMES, MOVES } from "../../cube/solver/engine.ts";

const stage = ref<HTMLElement | null>(null);
const info = ref("ready");
const spinOn = ref(false);

let host: RenderCubeHost | null = null;
let rc: RenderCube | null = null;
let queue: string[] = [];
let playing = false;
let pollId = 0;

/** 脸 moves（6 面 × 3 向，排除 layers=[0] 的中层 M/E/S） */
const FACE_MOVES = MOVE_NAMES.filter((n) => {
  const l = MOVES[n].layers;
  return l.length === 1 && l[0] !== 0;
});

function renderInfo() {
  if (!rc) return;
  const st = rc.committedPose.state;
  let solved = true;
  for (let i = 0; i < 54; i++) if (st[i] !== ((i / 9) | 0)) { solved = false; break; }
  const hex = (rc.debugSticker(0, 0)?.hex ?? "") + (rc.debugSticker(13, 0)?.hex ?? "");
  info.value = `queue=${queue.length} anim=${rc.isAnimating} solved=${solved} c0=${hex}`;
}

function poll() {
  if (queue.length && !rc!.isAnimating) {
    rc!.playMove(queue.shift()!);
    playing = queue.length > 0;
    renderInfo();
  }
}

function scramble() {
  if (!rc) return;
  queue = [];
  for (let i = 0; i < 20; i++) queue.push(FACE_MOVES[(Math.random() * FACE_MOVES.length) | 0]);
  playing = true;
  renderInfo();
}

function undo() {
  rc?.undo();
  playing = false;
  queue = [];
  renderInfo();
}

function fit() {
  if (!host) return;
  host.setDistance(host.fitDist());
}

function algDemo() {
  if (!rc) return;
  queue = [];
  for (let i = 0; i < 3; i++) for (const m of ["R", "U", "R'", "U'"]) queue.push(m);
  playing = true;
  renderInfo();
}

function toggleSpin() {
  spinOn.value = !spinOn.value;
  if (host) (host as unknown as { autoSpin: boolean }).autoSpin = spinOn.value;
}

onMounted(() => {
  if (!stage.value) return;
  rc = new RenderCube({
    speed: 1,
    onStateChange: () => renderInfo(),
  });
  host = new RenderCubeHost({
    container: stage.value,
    renderCube: rc,
    autoSpin: false,
    canPick: () => queue.length === 0 && !playing,
    onManualMove: (ev) => {
      (window as unknown as { __lastManual?: object }).__lastManual = ev;
      info.value = `manual axis=${ev.axis} layer=${ev.layer} q=${ev.q} mi=${ev.mi ?? "—"}` + ` queue=${queue.length}`;
    },
    onInteractionChange: (on) => {
      if (on) playing = false; // 交互时暂停连播（reference：playing 停止）
      spinOn.value = false;
    },
  });
  pollId = window.setInterval(poll, 60);
  renderInfo();
});

onBeforeUnmount(() => {
  window.clearInterval(pollId);
  host?.dispose();
  host = null;
  rc = null;
});
</script>

<style scoped>
.rdemo {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: #0b0e18;
  color: #eaf0ff;
  font-family: system-ui, sans-serif;
}
.rstage {
  flex: 1;
  min-height: 0;
  position: relative;
}
.rstage canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.rbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid #1c2336;
  background: #11162a;
  flex-wrap: wrap;
}
.rbar button {
  appearance: none;
  border: 1px solid #2c3552;
  border-radius: 8px;
  background: #1b2340;
  color: #eaf0ff;
  font: inherit;
  font-size: 12px;
  padding: 5px 10px;
  cursor: pointer;
}
.rbar button:hover {
  background: #26304f;
}
.rinfo {
  margin-left: auto;
  font-size: 11px;
  color: #a7b3d4;
  white-space: pre;
}
</style>