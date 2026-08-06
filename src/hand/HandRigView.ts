/**
 * 手/手掌 3D 视图（docs/todo.md：手 3D 模型里程碑）。
 * 简化圆柱段 + 手掌盒体；每段指腹（绿）/指背（橙）方向标记；接触点白球。
 * 与魔方同场景：注入 cubing.js TwistyPlayer 的 three.js 场景（同 GrayOverlay 模式）。
 * 坐标：魔方单位（1 = 块边长），整个组按 CUBE_UNIT_WORLD 缩放到 cubing 世界尺度。
 * 拇指特例：2 段 3 关节（CMC/MCP/IP），CMC 展收/对掌旋转在 thumbDof 上；
 * 拇指根默认放在手掌拇指侧角落（thumbBase 为其相对偏移）。
 */
import {
  BoxGeometry,
  CylinderGeometry,
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
  createDefaultRig,
  type Contact,
  type FingerName,
  type HandRig,
  type HandType,
  type Pose,
} from "./HandRig";

/** 1 魔方单位（块边长）≈ cubing 世界单位（sticker 面内间距 ±0.33 ↔ 规范 ±1 推出） */
export const CUBE_UNIT_WORLD = 0.33;

/**
 * 手部整体放大系数：按真实比例，小拇指长度 ≈ 3.1 个块边长；
 * 当前骨架数据小拇指（0.55+0.42+0.36=1.33 单位）→ 3.1/1.33 ≈ 2.33。
 */
export const HAND_SCALE = 3.1 / 1.33;

const SKIN = 0xcfc0a8;
const PAD = 0x4ade80;
const BACK = 0xf59e0b;
const CONTACT = 0xffffff;

/** 拇指根自然位置（左手 +X 侧；右手镜像）；pose.thumbBase 为其相对偏移 */
const THUMB_CORNER = new Vector3(0.4, 0.0, -0.3);

// cubing 场景无灯光（魔方贴纸为自发光材质）；手用不受光照影响的基础材质，保证可见
const SKIN_MAT = new MeshBasicMaterial({ color: SKIN });

const degToRad = (d: number) => (d * Math.PI) / 180;

type SegmentNode = {
  joint: Group;
  len: number;
  radius: number;
};

type FingerNodes = {
  root: Group;
  joints: Group[];
  segments: SegmentNode[];
};

export class HandRigView {
  private readonly group = new Group();
  private rig: HandRig;
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
    this.rig = createDefaultRig(handType);
    // 只做坐标映射；手部几何在 build 时按 HAND_SCALE 放大（位置保持魔方单位语义）
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
    this.rig = createDefaultRig(type);
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

    const palm = pose.palm.transform;
    this.root.position.set(palm.position.x, palm.position.y, palm.position.z);
    this.root.quaternion.set(
      palm.quaternion.x,
      palm.quaternion.y,
      palm.quaternion.z,
      palm.quaternion.w,
    );

    const tb = pose.palm.thumbBase;
    this.thumbRoot.position.set(
      tb.position.x + THUMB_CORNER.x * HAND_SCALE * this.sideSign,
      tb.position.y + THUMB_CORNER.y * HAND_SCALE,
      tb.position.z + THUMB_CORNER.z * HAND_SCALE,
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
        new SphereGeometry(0.045 * HAND_SCALE, 8, 8),
        new MeshBasicMaterial({ color: CONTACT }),
      );
      marker.position.copy(contactLocalPoint(c, seg, this.sideSign));
      seg.joint.add(marker);
      this.contactPool.push(marker);
    }
  }

  private buildRig(): void {
    for (const child of this.group.children) child.removeFromParent();
    this.contactPool.forEach((m) => m.removeFromParent());
    this.contactPool.length = 0;

    this.root = new Group();
    this.group.add(this.root);

    // 手掌：宽（拇指↔小指）1.15 × 厚 0.32 × 长 0.95（× HAND_SCALE）
    const palmMesh = new Mesh(
      new BoxGeometry(1.15 * HAND_SCALE, 0.32 * HAND_SCALE, 0.95 * HAND_SCALE),
      SKIN_MAT,
    );
    palmMesh.position.y = -0.02 * HAND_SCALE;
    this.root.add(palmMesh);

    // 手指根部（左手，右手镜像 X）：y 略偏向指背（× HAND_SCALE）
    const bases: Record<Exclude<FingerName, "thumb">, [number, number]> = {
      index: [0.3, 0.34],
      middle: [0.08, 0.38],
      ring: [-0.13, 0.34],
      pinky: [-0.31, 0.26],
    };
    for (const name of FINGER_ORDER) {
      if (name === "thumb") continue;
      const [bx, bz] = bases[name];
      const nodes = this.buildFinger(name);
      nodes.root.position.set(bx * HAND_SCALE * this.sideSign, 0.08 * HAND_SCALE, bz * HAND_SCALE);
      this.root.add(nodes.root);
      this.fingers[name] = nodes;
    }

    // 拇指：thumbRoot(thumbBase) → thumbDof(CMC 展收/对掌) → 拇指链
    this.thumbRoot = new Group();
    this.thumbDof = new Group();
    this.thumbRoot.add(this.thumbDof);
    const thumbNodes = this.buildFinger("thumb");
    this.thumbDof.add(thumbNodes.root);
    this.root.add(this.thumbRoot);
    this.fingers.thumb = thumbNodes;
  }

  private buildFinger(name: FingerName): FingerNodes {
    const def = this.rig.fingers[name];
    const root = new Group();
    const joints: Group[] = [];
    const segments: SegmentNode[] = [];
    let cursor = root;
    for (let j = 0; j < def.joints.length; j++) {
      const joint = new Group();
      cursor.add(joint);
      joints.push(joint);
      const seg = def.segments[j];
      if (seg) {
        const len = seg.length * HAND_SCALE;
        const radius = (seg.width / 2) * HAND_SCALE;
        const mesh = new Mesh(new CylinderGeometry(radius, radius, len, 10), SKIN_MAT);
        mesh.rotation.x = Math.PI / 2; // 圆柱 Y 轴 → 指方向 Z
        mesh.position.z = len / 2;
        joint.add(mesh);
        // 腹（绿，-Y）/ 背（橙，+Y）标记
        const pad = new Mesh(new SphereGeometry(0.04 * HAND_SCALE, 8, 8), new MeshBasicMaterial({ color: PAD }));
        pad.position.set(0, -(radius + 0.05 * HAND_SCALE), len / 2);
        joint.add(pad);
        const back = new Mesh(new SphereGeometry(0.04 * HAND_SCALE, 8, 8), new MeshBasicMaterial({ color: BACK }));
        back.position.set(0, radius + 0.05 * HAND_SCALE, len / 2);
        joint.add(back);
        const next = new Group();
        next.position.z = len;
        joint.add(next);
        segments.push({ joint, len, radius });
        cursor = next;
      }
    }
    return { root, joints, segments };
  }
}

/** 接触点在该段局部坐标：z = t×len，按侧偏移（腹 -Y / 背 +Y / 拇指侧 / 小指侧） */
function contactLocalPoint(c: Contact, seg: SegmentNode, sideSign: number): Vector3 {
  const off = seg.radius + 0.05 * HAND_SCALE;
  const x =
    c.side === "thumbSide" ? sideSign * off : c.side === "pinkySide" ? -sideSign * off : 0;
  const y = c.side === "pad" ? -off : c.side === "back" ? off : 0;
  return new Vector3(x, y, c.t * seg.len);
}
