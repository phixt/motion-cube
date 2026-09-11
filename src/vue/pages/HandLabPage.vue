<script setup lang="ts">
/**
 * #/hand-lab 手部 A/B 对照（low-poly 重构调试页，不进侧栏）。
 * 左：旧 buildHandGeometry（圆柱方案，feat/hand-lowpoly 起点冻结基线）；
 * 右：新 buildHandMesh（截面放样方案）。同一标定配置 + 默认姿态
 * （bend 级联 + 拇指 CMC 三轴），缓慢自转便于绕视对比；dispose 完整（真机教训）。
 */
import { onBeforeUnmount, onMounted, ref } from "vue";
import { Group, PerspectiveCamera, Scene, WebGLRenderer } from "three";
import { FINGER_ORDER, type FingerName, type HandRig } from "../../hand/HandRig";
import { createRigFromConfig, loadHandRigConfig, type HandRigConfig } from "../../hand/handRigStore";
import { buildHandGeometry } from "../../hand/handGeometry"; // 冻结旧方案（A 基线，合并前删除）
import { buildHandMesh } from "../../hand/handMesh";
import { CUBE_UNIT_WORLD } from "../../hand/HandRigView";

type FingerJoints = { joints: { rotation: { x: number } }[] };
type HandLike = {
  root: Group;
  fingers: Record<FingerName, FingerJoints>;
  thumbDof: { rotation: { set: (x: number, y: number, z: number) => void } };
};

const DEG = Math.PI / 180;

/** 默认姿态：各关节 bend 级联 + 拇指 CMC 三轴（语义同 HandRigView.applyPose） */
function applyRestPose(hand: HandLike, rig: HandRig, cfg: HandRigConfig): void {
  for (const name of FINGER_ORDER) {
    const bends = rig.fingers[name].joints.map((j) => j.bend);
    hand.fingers[name].joints.forEach((jt, i) => {
      jt.rotation.x = (180 - (bends[i] ?? 180)) * DEG;
    });
  }
  const cmc = cfg.thumbCmc;
  hand.thumbDof.rotation.set(-cmc.elevation * DEG, cmc.abduction * DEG, -cmc.rotation * DEG);
}

class HandLabView {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly ro: ResizeObserver;
  private raf = 0;

  constructor(container: HTMLElement, hand: Group) {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    container.appendChild(this.renderer.domElement);
    const group = new Group();
    group.scale.setScalar(CUBE_UNIT_WORLD);
    group.add(hand);
    this.scene.add(group);
    this.camera = new PerspectiveCamera(32, 1, 0.05, 20);
    this.camera.position.set(1.7, 1.5, 2.9);
    this.camera.lookAt(0, 0.05, 0.25);
    this.ro = new ResizeObserver(() => this.fit(container));
    this.ro.observe(container);
    this.fit(container);
    const loop = (): void => {
      this.raf = requestAnimationFrame(loop);
      group.rotation.y += 0.004; // 慢自转便于绕视对比
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  private fit(container: HTMLElement): void {
    const w = container.clientWidth || 480;
    const h = container.clientHeight || 360;
    this.renderer.setSize(w, h, true);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.renderer.dispose();
    try {
      this.renderer.forceContextLoss?.();
    } catch {
      // 某些 WebGL 实现无此方法，忽略
    }
    this.renderer.domElement.remove();
  }
}

const oldRef = ref<HTMLElement | null>(null);
const newRef = ref<HTMLElement | null>(null);
let viewOld: HandLabView | null = null;
let viewNew: HandLabView | null = null;

onMounted(() => {
  if (!oldRef.value || !newRef.value) return;
  const cfg = loadHandRigConfig();
  // A：旧圆柱方案（handGeometry.ts 冻结基线）
  const rigA = createRigFromConfig(cfg, "right");
  const oldHand = buildHandGeometry(cfg, rigA, 1, true, false, false);
  applyRestPose(oldHand as unknown as HandLike, rigA, cfg);
  // B：新 low-poly 放样方案（handMesh.ts）
  const rigB = createRigFromConfig(cfg, "right");
  const newHand = buildHandMesh(cfg, rigB, 1, { withMarks: true, linearOutput: false });
  applyRestPose(newHand as unknown as HandLike, rigB, cfg);
  viewOld = new HandLabView(oldRef.value, oldHand.root);
  viewNew = new HandLabView(newRef.value, newHand.root);
  (globalThis as { __motionCubeHandLab?: unknown }).__motionCubeHandLab = { viewOld, viewNew };
});

onBeforeUnmount(() => {
  viewOld?.dispose();
  viewNew?.dispose();
  viewOld = null;
  viewNew = null;
  delete (globalThis as { __motionCubeHandLab?: unknown }).__motionCubeHandLab;
});
</script>

<template>
  <div class="hand-lab-page">
    <div class="lab-title">手部 A/B 对照 · #/hand-lab（low-poly 重构调试页）</div>
    <div class="lab-note">
      左 = 旧圆柱方案（冻结基线）｜右 = 新截面放样方案（0.4.0）。同一标定配置与默认姿态，缓慢自转。
    </div>
    <div class="lab-views">
      <div class="lab-box">
        <div ref="oldRef" class="lab-canvas"></div>
        <div class="lab-tag">旧 · buildHandGeometry</div>
      </div>
      <div class="lab-box">
        <div ref="newRef" class="lab-canvas"></div>
        <div class="lab-tag">新 · buildHandMesh（low-poly）</div>
      </div>
    </div>
  </div>
</template>

<style>
.hand-lab-page {
  height: 100%;
  box-sizing: border-box;
  overflow: auto;
  padding: 24px 28px;
  color: var(--text-primary);
}
.lab-title {
  font-size: 22px;
  font-weight: 600;
}
.lab-note {
  color: var(--text-tertiary);
  font-size: 13px;
  margin-top: 6px;
}
.lab-views {
  display: flex;
  gap: 16px;
  margin-top: 16px;
  flex-wrap: wrap;
}
.lab-box {
  flex: 1 1 420px;
  min-width: 320px;
}
.lab-canvas {
  position: relative;
  width: 100%;
  height: 460px;
  border: 1px solid var(--stroke-divider);
  border-radius: var(--ControlCornerRadius, 6px);
  background: var(--ctrl-solid-fill, #101014);
  overflow: hidden;
}
.lab-tag {
  margin-top: 6px;
  color: var(--text-secondary);
  font-size: 13px;
}
</style>
