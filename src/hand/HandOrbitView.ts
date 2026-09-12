/**
 * 手部交互视图（0.4.0 十六轮）：标定页第三视图——右手透视特写，供近距离目检
 * 掌指衔接等细节。静态 = 固定机位（掌侧 3/4 斜角，按需渲染）；动态 = OrbitControls
 * 拖拽旋转 + 滚轮缩放（阻尼），rAF 循环渲染。测量直姿（手指伸直 + 拇指 CMC 外翻），
 * 与俯视/左视共用同一配置源；setConfig 重建几何，动态模式下保留用户视角。
 */
import {
  Box3,
  Group,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createRigFromConfig, type HandRigConfig } from "./handRigStore";
import { buildHandMesh } from "./handMesh";
import { CUBE_UNIT_WORLD } from "./HandRigView";
import { disposeObject } from "./HandCalibView";

export type HandOrbitMode = "static" | "dynamic";

export class HandOrbitView {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly rootGroup = new Group();
  private readonly wrapper: HTMLElement;
  private readonly disposables: { obj: Object3D }[] = [];
  private readonly resizeObserver: ResizeObserver;
  private raf = 0;
  private mode: HandOrbitMode = "static";
  private handCenter = new Vector3();

  constructor(container: HTMLElement, cfg: HandRigConfig) {
    this.wrapper = container;
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    container.appendChild(this.renderer.domElement);

    this.camera = new PerspectiveCamera(35, 1, 0.05, 50);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 0.35;
    this.controls.maxDistance = 8;

    this.rootGroup.scale.setScalar(CUBE_UNIT_WORLD);
    this.scene.add(this.rootGroup);

    this.resizeObserver = new ResizeObserver(() => this.fit());
    this.resizeObserver.observe(container);
    this.fit();
    this.setConfig(cfg);
  }

  /** 动/静切换：动态开控制 + rAF 循环；静态回默认机位、按需渲染 */
  setMode(mode: HandOrbitMode): void {
    this.mode = mode;
    this.controls.enabled = mode === "dynamic";
    if (mode === "static") {
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.resetCamera();
      this.render();
    } else {
      this.loop();
    }
  }

  setConfig(cfg: HandRigConfig): void {
    this.rebuild(cfg);
    if (this.mode === "static") this.resetCamera();
    this.render();
  }

  dispose(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.rebuild(null);
    this.renderer.dispose();
    try {
      this.renderer.forceContextLoss?.();
    } catch {
      // 某些 WebGL 实现无此方法，忽略
    }
    this.renderer.domElement.remove();
  }

  private rebuild(cfg: HandRigConfig | null): void {
    for (const d of this.disposables) disposeObject(d.obj);
    this.disposables.length = 0;
    for (const child of [...this.rootGroup.children]) this.rootGroup.remove(child);
    if (!cfg) return;
    const rig = createRigFromConfig(cfg, "right");
    const built = buildHandMesh(cfg, rig, 1, { withMarks: true, linearOutput: false });
    // 拇指自然外翻（CMC 三轴，轴语义同 HandCalibView/HandRigView.applyPose），手指伸直
    const cmc = rig.fingers.thumb.joints[0];
    built.thumbDof.rotation.set(
      degToRad(-(cmc.elevation ?? 0)),
      degToRad(cmc.abduction ?? 0),
      degToRad(-(cmc.rotation ?? 0)),
    );
    this.rootGroup.add(built.root);
    this.scene.updateMatrixWorld(true);
    this.handCenter = new Box3().setFromObject(built.root).getCenter(new Vector3());
    this.disposables.push({ obj: built.root });
  }

  /** 默认机位：对准掌前缘斜坡法线（法线 ≈ (0,−0.4,0.92)）的掌侧 3/4 特写，
   * 肌凸/根窝/填充棱正对镜头 */
  private resetCamera(): void {
    const c = this.handCenter;
    const d = 2.7;
    this.camera.position.set(c.x + d * 0.3, c.y - d * 0.42, c.z + d * 0.86);
    this.camera.lookAt(c);
    this.controls.target.copy(c);
    this.controls.update();
  }

  private fit(): void {
    const w = this.wrapper.clientWidth || 480;
    const h = this.wrapper.clientHeight || 320;
    this.renderer.setSize(w, h, true);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.mode === "static") this.render();
  }

  private loop = (): void => {
    if (this.mode !== "dynamic") return; // 切回静态后残留帧自停
    this.raf = requestAnimationFrame(this.loop);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}

const degToRad = (d: number) => (d * Math.PI) / 180;
