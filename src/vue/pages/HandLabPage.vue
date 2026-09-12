<script setup lang="ts">
/**
 * #/hand-lab 手部调试页（low-poly 方案，不进侧栏）。
 * buildHandMesh（截面放样方案）单视图：标定配置 + 姿态切换
 * （测量直姿 / 编辑器默认姿态），缓慢自转便于绕视；dispose 完整（真机教训）。
 * （旧 buildHandGeometry 圆柱方案已随合并清理删除，A/B 对照使命完成。）
 */
import { onBeforeUnmount, onMounted, ref } from "vue";
import { Group, PerspectiveCamera, Scene, WebGLRenderer } from "three";
import { defaultHandPose, FINGER_ORDER, type FingerName, type HandRig, type Pose } from "../../hand/HandRig";
import { createRigFromConfig, loadHandRigConfig, type HandRigConfig } from "../../hand/handRigStore";
import { buildHandMesh } from "../../hand/handMesh";
import { CUBE_UNIT_WORLD } from "../../hand/HandRigView";

type FingerJoints = { joints: { rotation: { x: number } }[] };
type HandLike = {
  root: Group;
  fingers: Record<FingerName, FingerJoints>;
  thumbRoot: { position: { set: (x: number, y: number, z: number) => void }; quaternion: { set: (x: number, y: number, z: number, w: number) => void } };
  thumbDof: { rotation: { set: (x: number, y: number, z: number) => void } };
};

const DEG = Math.PI / 180;

/** 姿态模式：rest = 测量直姿（骨架默认弯度，掌在原点）；editor = 编辑器默认手位
 *  （defaultHandPose：掌部位姿 + 弯度 + 拇指 CMC，与动画编辑器新建手法一致，
 *  用于诊断拇指轴朝向） */
const poseMode = ref<"rest" | "editor">("rest");

/** 测量直姿：各关节 bend 级联 + 拇指 CMC 三轴（语义同 HandRigView.applyPose） */
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

/** 编辑器默认姿态：defaultHandPose 的掌部位姿 + 关节弯度 + 拇指 CMC */
function applyEditorPose(hand: HandLike, pose: Pose): void {
  const t = pose.palm.transform;
  hand.root.position.set(t.position.x, t.position.y, t.position.z);
  hand.root.quaternion.set(t.quaternion.x, t.quaternion.y, t.quaternion.z, t.quaternion.w);
  const tb = pose.palm.thumbBase;
  hand.thumbRoot.position.set(tb.position.x, tb.position.y, tb.position.z);
  hand.thumbRoot.quaternion.set(tb.quaternion.x, tb.quaternion.y, tb.quaternion.z, tb.quaternion.w);
  for (const name of FINGER_ORDER) {
    const bends = pose.bends[name];
    hand.fingers[name].joints.forEach((jt, i) => {
      jt.rotation.x = (180 - (bends[i] ?? 180)) * DEG;
    });
  }
  hand.thumbDof.rotation.set(
    -pose.thumbCMC.elevation * DEG,
    pose.thumbCMC.abduction * DEG,
    -pose.thumbCMC.rotation * DEG,
  );
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

const newRef = ref<HTMLElement | null>(null);
let viewNew: HandLabView | null = null;

function buildHands(): void {
  if (!newRef.value) return;
  viewNew?.dispose();
  const cfg = loadHandRigConfig();
  const editorPose = defaultHandPose("right");
  const apply = poseMode.value === "editor"
    ? (h: HandLike) => applyEditorPose(h, editorPose)
    : (h: HandLike, rig: HandRig) => applyRestPose(h, rig, cfg);
  // 新 low-poly 放样方案（handMesh.ts）
  const rigB = createRigFromConfig(cfg, "right");
  const newHand = buildHandMesh(cfg, rigB, 1, { withMarks: true, linearOutput: false });
  apply(newHand as unknown as HandLike, rigB);
  viewNew = new HandLabView(newRef.value, newHand.root);
  (globalThis as { __motionCubeHandLab?: unknown }).__motionCubeHandLab = { view: viewNew };
}

onMounted(buildHands);

onBeforeUnmount(() => {
  viewNew?.dispose();
  viewNew = null;
  delete (globalThis as { __motionCubeHandLab?: unknown }).__motionCubeHandLab;
});
</script>

<template>
  <div class="hand-lab-page">
    <div class="lab-title">手部调试 · #/hand-lab（low-poly 截面放样方案）</div>
    <div class="lab-note">
      标定配置实时加载（0.4.0），缓慢自转。姿态：
      <button class="lab-mode" :class="{ on: poseMode === 'rest' }" @click="poseMode = 'rest'; buildHands()">测量直姿</button>
      <button class="lab-mode" :class="{ on: poseMode === 'editor' }" @click="poseMode = 'editor'; buildHands()">编辑器默认姿态</button>
    </div>
    <div class="lab-views">
      <div class="lab-box">
        <div ref="newRef" class="lab-canvas"></div>
        <div class="lab-tag">buildHandMesh（low-poly）</div>
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
.lab-mode {
  border: 1px solid var(--stroke-divider);
  border-radius: 4px;
  background: var(--ctrl-fill-default);
  color: var(--text-secondary);
  font-size: 12px;
  padding: 2px 8px;
  margin-left: 4px;
  cursor: pointer;
}
.lab-mode.on {
  background: var(--ctrl-solid-fill);
  color: var(--text-primary);
}
.lab-tag {
  margin-top: 6px;
  color: var(--text-secondary);
  font-size: 13px;
}
</style>
