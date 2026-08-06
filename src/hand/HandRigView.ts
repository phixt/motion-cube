/**
 * 手/手掌 3D 视图（docs/todo.md：手 3D 模型里程碑）。
 * 简化圆柱段 + 手掌盒体；每段指腹（绿）/指背（橙）方向标记；接触点白球。
 * 与魔方同场景：注入 cubing.js TwistyPlayer 的 three.js 场景（同 GrayOverlay 模式）。
 * 坐标：魔方单位（1 = 块边长），整个组按 CUBE_UNIT_WORLD 缩放到 cubing 世界尺度。
 * 几何参数来自手部标定配置（handRigStore）：在标定页「固化」后此处自动生效。
 * 拇指特例：2 段 3 关节（CMC/MCP/IP），CMC 展收/对掌旋转在 thumbDof 上；
 * 拇指根默认放在手掌拇指侧角落（thumbBase 为其相对偏移）。
 */
import {
  Group,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
  type Object3D,
} from "three";
import type { CubePlayer } from "../cube/CubePlayer";
import {
  FINGER_ORDER,
  type Contact,
  type FingerName,
  type HandRig,
  type HandType,
  type Pose,
} from "./HandRig";
import { buildHandGeometry, type FingerNodes } from "./handGeometry";
import { createRigFromConfig, loadHandRigConfig, type HandRigConfig } from "./handRigStore";

/** 1 魔方单位（块边长）≈ cubing 世界单位（sticker 面内间距 ±0.33 ↔ 规范 ±1 推出） */
export const CUBE_UNIT_WORLD = 0.33;

const CONTACT = 0xffffff;

const degToRad = (d: number) => (d * Math.PI) / 180;

export class HandRigView {
  private readonly group = new Group();
  private rig: HandRig;
  private config: HandRigConfig;
  private handType: HandType;
  private root!: Group; // 手掌根（palm.transform）
  private thumbRoot!: Group; // 拇指根（thumbBase）
  private thumbDof!: Group; // CMC 展收/对掌旋转
  private fingers = {} as Record<FingerName, FingerNodes>;
  private contactPool: Mesh[] = [];
  private ready = false;
  private pose: Pose | null = null;
  private dirty = false;

  constructor(
    private readonly player: CubePlayer,
    handType: HandType = "left",
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
    const obj = await this.player.element.experimentalCurrentThreeJSPuzzleObject(() => {
      this.attach(obj);
      this.applyPose();
    });
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

  /** 强制 cubing 重绘（同 GrayOverlay.requestRender） */
  private async requestRender(): Promise<void> {
    try {
      const vantages = await this.player.element.experimentalCurrentVantages();
      for (const v of vantages) v.scheduleRender();
    } catch {
      // 场景未就绪时忽略
    }
  }

  /** 当前驱动姿态（测试/调试用） */
  currentPose(): Pose | null {
    return this.pose;
  }

  private get sideSign(): number {
    return this.handType === "left" ? 1 : -1;
  }

  private applyPose(): void {
    if (!this.ready || !this.group.parent) return;
    if (!this.dirty) return;
    this.dirty = false;
    const pose = this.pose;
    if (!pose) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;

    const H = this.config.handScale;
    const palm = pose.palm.transform;
    this.root.position.set(palm.position.x, palm.position.y, palm.position.z);
    this.root.quaternion.set(
      palm.quaternion.x,
      palm.quaternion.y,
      palm.quaternion.z,
      palm.quaternion.w,
    );

    const tb = pose.palm.thumbBase;
    const tc = this.config.thumbCorner;
    this.thumbRoot.position.set(
      tb.position.x + tc.x * H * this.sideSign,
      tb.position.y + tc.y * H,
      tb.position.z + tc.z * H,
    );
    this.thumbRoot.quaternion.set(tb.quaternion.x, tb.quaternion.y, tb.quaternion.z, tb.quaternion.w);
    // CMC 展收（右手镜像）/ 对掌旋转
    this.thumbDof.rotation.z = degToRad(pose.thumbCMC.abduction * this.sideSign);
    this.thumbDof.rotation.y = degToRad(pose.thumbCMC.rotation);

    for (const name of FINGER_ORDER) {
      const nodes = this.fingers[name];
      const bends = pose.bends[name];
      for (let j = 0; j < nodes.joints.length; j++) {
        // bend = 指腹侧夹角（180 伸直）；绕 X 旋转使段向指腹（-Y）弯
        nodes.joints[j].rotation.x = degToRad(180 - (bends[j] ?? 180));
      }
    }

    // 接触点：小段局部坐标 → 挂到该段关节组，随 FK 自动变换
    for (const m of this.contactPool) m.removeFromParent();
    this.contactPool.length = 0;
    for (const c of pose.contacts) {
      const seg = this.fingers[c.finger]?.segments[c.segmentIndex];
      if (!seg) continue;
      const marker = new Mesh(
        new SphereGeometry(0.045 * H, 8, 8),
        new MeshBasicMaterial({ color: CONTACT }),
      );
      marker.position.copy(contactLocalPoint(c, seg, this.sideSign, H));
      seg.joint.add(marker);
      this.contactPool.push(marker);
    }
  }

  private buildRig(): void {
    for (const child of this.group.children) child.removeFromParent();
    this.contactPool.forEach((m) => m.removeFromParent());
    this.contactPool.length = 0;

    const built = buildHandGeometry(this.config, this.rig, this.sideSign, true);
    this.root = built.root;
    this.fingers = built.fingers;
    this.thumbRoot = built.thumbRoot;
    this.thumbDof = built.thumbDof;
    this.group.add(this.root);
  }
}

/** 接触点在该段局部坐标：z = t×len，按侧偏移（腹 -Y / 背 +Y / 拇指侧 / 小指侧） */
function contactLocalPoint(c: Contact, seg: FingerNodes["segments"][number], sideSign: number, H: number): Vector3 {
  const off = seg.radius + 0.05 * H;
  const x =
    c.side === "thumbSide" ? sideSign * off : c.side === "pinkySide" ? -sideSign * off : 0;
  const y = c.side === "pad" ? -off : c.side === "back" ? off : 0;
  return new Vector3(x, y, c.t * seg.len);
}
