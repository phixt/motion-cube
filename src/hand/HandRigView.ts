/**
 * 手/手掌 3D 视图（docs/todo.md：手 3D 模型里程碑）。
 * 简化圆柱段 + 手掌盒体；每段指腹（绿）/指背（橙）方向标记；接触点白球。
 * 与魔方同场景：注入 cubing.js TwistyPlayer 的 three.js 场景（同 GrayOverlay 模式）。
 * 坐标：魔方单位（1 = 块边长），整个组按 CUBE_UNIT_WORLD 缩放到 cubing 世界尺度。
 * 几何参数来自手部标定配置（handRigStore）：在标定页「固化」后此处自动生效。
 * 拇指特例：2 段 3 关节（CMC/MCP/IP），CMC 三轴（展收/抬离/对掌）在 thumbDof 上；
 * 拇指根默认放在手掌拇指侧掌根（thumbBase 为其相对偏移）。
 */
import {
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
  type Object3D,
} from "three";
import type { CubePlayer } from "../cube/CubePlayer";
import {
  clampBend,
  FINGER_ORDER,
  type Contact,
  type FingerName,
  type HandRig,
  type HandType,
  type Pose,
} from "./HandRig";
import {
  checkHandCubeCollision,
  computeHandSegmentBoxes,
  type CubeCollisionHit,
  type HandSegmentBox,
} from "./handCollision";
import { applyThumbPoseNodes, buildHandMesh, meshSurfaceOffset, type FingerNodes } from "./handMesh";
import { createRigFromConfig, loadHandRigConfig, type HandRigConfig } from "./handRigStore";

/** 1 魔方单位（块边长）≈ cubing 世界单位（sticker 面内间距 ±0.33 ↔ 规范 ±1 推出） */
export const CUBE_UNIT_WORLD = 0.33;

const degToRad = (d: number) => (d * Math.PI) / 180;

export class HandRigView {
  private readonly group = new Group();
  private rig: HandRig;
  private config: HandRigConfig;
  private handType: HandType;
  private root!: Group; // 手掌根（palm.transform）
  private thenarPivot!: Group; // 大鱼际单轴下沉枢轴（0°–90°）
  private thumbAnchor!: Group; // 拇指根锚点（随 thenarPivot 移动并保持手掌参考系轴向）
  private thumbRoot!: Group; // 拇指根（thumbBase）
  private thumbDof!: Group; // CMC 展收/抬离/对掌旋转
  private fingers = {} as Record<FingerName, FingerNodes>;
  private contactPool: Mesh[] = [];
  private contactGeo = new SphereGeometry(0.045, 8, 8);
  private contactMat = new MeshBasicMaterial({
    color: new Color().setRGB(1, 1, 1),
    toneMapped: false,
  });
  private ready = false;
  private disposed = false;
  private pose: Pose | null = null;
  private dirty = false;
  private userVisible = true;

  constructor(
    private readonly player: CubePlayer,
    handType: HandType = "right",
  ) {
    this.handType = handType;
    this.config = loadHandRigConfig();
    this.rig = createRigFromConfig(this.config, handType);
    // 只做坐标映射；手部几何在 build 时按 config.handScale 放大（位置保持魔方单位语义）
    this.group.scale.setScalar(CUBE_UNIT_WORLD);
    this.buildRig();
  }

  /** 注入场景；cubing 每次调度渲染时回调（场景重建时自愈重挂 + 重放姿态） */
  async init(): Promise<void> {
    if (this.disposed) return;
    const obj = await this.player.onThreeScene(() => {
      if (this.disposed) return;
      this.attach(obj);
      this.applyPose();
    });
    if (this.disposed) return;
    this.attach(obj);
    this.ready = true;
    this.applyPose();
    void this.requestRender(); // 按需渲染：首次强制一帧，否则画布保持空白
  }

  private attach(obj: Object3D): void {
    const scene = obj.parent ?? obj;
    if (this.group.parent !== scene) scene.add(this.group);
  }

  get type(): HandType {
    return this.handType;
  }

  setHandType(type: HandType): void {
    if (type === this.handType) return;
    this.handType = type;
    this.rig = createRigFromConfig(this.config, type);
    this.buildRig();
    this.dirty = true;
    this.applyPose();
    void this.requestRender();
  }

  setPose(pose: Pose | null): void {
    this.pose = pose;
    this.dirty = true;
    this.applyPose();
    void this.requestRender();
  }

  /** 手部显隐（编辑器快捷键 M 之外的 H；与姿态无关，独立控制） */
  setVisible(visible: boolean): void {
    this.userVisible = visible;
    this.dirty = true;
    this.applyPose();
    void this.requestRender();
  }

  /** 当前显隐开关状态（只读，不改动既有公开方法签名） */
  get visible(): boolean {
    return this.userVisible;
  }

  /** 强制重绘一帧（同 GrayOverlay；走 CubePlayer 抽象接口） */
  private async requestRender(): Promise<void> {
    await this.player.requestRender();
  }

  /** 当前驱动姿态（测试/调试用） */
  currentPose(): Pose | null {
    return this.pose;
  }

  /** 当前手掌与各指段在魔方单位空间下的 AABB 代理（用于接触校验/穿透检测） */
  getSegmentBoxes(): HandSegmentBox[] {
    return computeHandSegmentBoxes(this.root, this.fingers);
  }

  /** 检测当前姿态与 3×3×3 魔方包围盒的穿透碰撞（魔方单位） */
  checkCubeCollision(cubeHalfExtent = 1.5, tolerance = 0): CubeCollisionHit[] {
    return checkHandCubeCollision(this.getSegmentBoxes(), cubeHalfExtent, tolerance);
  }

  private get sideSign(): number {
    // 命名对调（2026-08-12）：模型里拇指在 +X 的手渲染为右手 → "right" 对应 +X
    return this.handType === "right" ? 1 : -1;
  }

  private applyPose(): void {
    if (!this.ready || !this.group.parent) return;
    if (!this.dirty) return;
    this.dirty = false;
    const pose = this.pose;
    this.group.visible = this.userVisible && !!pose;
    if (!pose) return;

    const H = this.config.handScale;
    const palm = pose.palm.transform;
    this.root.position.set(palm.position.x, palm.position.y, palm.position.z);
    this.root.quaternion.set(
      palm.quaternion.x,
      palm.quaternion.y,
      palm.quaternion.z,
      palm.quaternion.w,
    );

    applyThumbPoseNodes(
      {
        thenarPivot: this.thenarPivot,
        thumbAnchor: this.thumbAnchor,
        thumbRoot: this.thumbRoot,
        thumbDof: this.thumbDof,
      },
      this.sideSign,
      pose.thumbCMC,
      this.config.thenarFold,
      pose.palm.thumbBase,
    );

    for (const name of FINGER_ORDER) {
      const nodes = this.fingers[name];
      const def = this.rig.fingers[name];
      const bends = pose.bends[name];
      for (let j = 0; j < nodes.joints.length; j++) {
        // bend = 指腹侧夹角（180 伸直）；按关节解剖范围钳制后绕 X 旋转使段向指腹（-Y）弯
        const raw = bends[j] ?? def.joints[j]?.bend ?? 180;
        const clamped = def.joints[j] ? clampBend(def.joints[j], raw) : raw;
        nodes.joints[j].rotation.x = degToRad(180 - clamped);
      }
    }

    // 接触点：复用共享几何/材质与 Mesh 池，避免 60Hz 播放无界泄漏 GPU 缓冲
    for (const m of this.contactPool) m.removeFromParent();
    let used = 0;
    for (const c of pose.contacts) {
      const seg = this.fingers[c.finger]?.segments[c.segmentIndex];
      if (!seg) continue;
      let marker = this.contactPool[used];
      if (!marker) {
        marker = new Mesh(this.contactGeo, this.contactMat);
        this.contactPool.push(marker);
      }
      marker.scale.setScalar(H);
      marker.position.copy(contactLocalPoint(c, seg, this.sideSign, H));
      seg.joint.add(marker);
      used++;
    }
  }

  private clearRigTree(): void {
    for (const m of this.contactPool) m.removeFromParent();
    for (const child of [...this.group.children]) {
      child.removeFromParent();
      disposeMeshTree(child);
    }
  }

  private buildRig(): void {
    this.clearRigTree();

    // 0.4.0 low-poly 重构：handMesh 截面放样生成器（API 与旧 buildHandGeometry 同构；
    // 顶点色线性编码，输出变换由各渲染器自理）
    const built = buildHandMesh(this.config, this.rig, this.sideSign, {
      withMarks: true,
      linearOutput: true,
    });
    this.root = built.root;
    this.fingers = built.fingers;
    this.thenarPivot = built.thenarPivot;
    this.thumbAnchor = built.thumbAnchor;
    this.thumbRoot = built.thumbRoot;
    this.thumbDof = built.thumbDof;
    this.group.add(this.root);
  }

  /** 释放手部几何与材质（编辑器卸载时调用，不改动既有公开方法签名） */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.ready = false;
    this.clearRigTree();
    this.contactPool.length = 0;
    this.contactGeo.dispose();
    this.contactMat.dispose();
    this.group.removeFromParent();
  }
}

function disposeMeshTree(root: Object3D): void {
  const seenGeo = new Set<{ dispose(): void }>();
  const seenMat = new Set<{ dispose(): void }>();
  root.traverse((node) => {
    const mesh = node as Mesh;
    if (mesh.geometry && typeof mesh.geometry.dispose === "function") seenGeo.add(mesh.geometry);
    const mat = mesh.material;
    if (Array.isArray(mat)) {
      for (const m of mat) if (m && typeof m.dispose === "function") seenMat.add(m);
    } else if (mat && typeof mat.dispose === "function") {
      seenMat.add(mat);
    }
  });
  for (const g of seenGeo) g.dispose();
  for (const m of seenMat) m.dispose();
}

/** 接触点在该段局部坐标：z = t×len，按侧偏移（腹 -Y / 背 +Y 用厚度；拇指/小指侧用宽度） */
function contactLocalPoint(c: Contact, seg: FingerNodes["segments"][number], sideSign: number, H: number): Vector3 {
  const offX = meshSurfaceOffset(seg, "x", H);
  const offY = meshSurfaceOffset(seg, "y", H);
  const x =
    c.side === "thumbSide" ? sideSign * offX : c.side === "pinkySide" ? -sideSign * offX : 0;
  const y = c.side === "pad" ? -offY : c.side === "back" ? offY : 0;
  return new Vector3(x, y, c.t * seg.len);
}
