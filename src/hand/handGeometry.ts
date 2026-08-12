/**
 * 手部几何构建（HandRigView 与 HandCalibView 共用，避免两处比例漂移）。
 * 输入：标定配置 + 骨架（关节表/段定义）+ 手型符号；输出 three.js 层级。
 * 坐标系：数据单位（1 = 块边长），几何按 cfg.handScale 放大；
 * 调用方再按 CUBE_UNIT_WORLD 缩放到 cubing 世界尺度。
 */
import {
  Color,
  CylinderGeometry,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { FingerName } from "./HandRig";
import type { HandRig } from "./HandRig";
import type { HandRigConfig } from "./handRigStore";

/** 肤色（调亮后的暖米色；cubing/标定双渲染器均按此输出，明暗主题下观感统一） */
export const SKIN = 0xe4d4bd;
export const PAD = 0x4ade80;
export const BACK = 0xf59e0b;
export const OUTLINE = 0x2b2b33;

/** 把 sRGB 十六进制色直接写入线性存储（用于线性输出渲染器，如 cubing 的 TwistyPlayer） */
function srgbColor(hex: number): Color {
  return new Color().setRGB(
    ((hex >> 16) & 0xff) / 255,
    ((hex >> 8) & 0xff) / 255,
    (hex & 0xff) / 255,
  );
}

export type SegmentNode = { joint: Group; len: number; radius: number };
export type FingerNodes = { root: Group; joints: Group[]; segments: SegmentNode[] };

export type HandGeometry = {
  root: Group;
  fingers: Record<FingerName, FingerNodes>;
  thumbRoot: Group;
  thumbDof: Group;
};

const FOUR = ["index", "middle", "ring", "pinky"] as const;

export function buildHandGeometry(
  cfg: HandRigConfig,
  rig: HandRig,
  sideSign: number,
  withMarks = true,
  /**
   * 渲染器输出色彩空间：true = 线性输出（cubing TwistyPlayer，需 setRGB 直写 sRGB 值）；
   * false = 默认 sRGB 输出（HandCalibView 自带渲染器，用标准 hex 让 ColorManagement 正确往返）
   */
  linearOutput = false,
  /** 网格描边（左视图等轮廓不清晰时启用） */
  withOutline = false,
): HandGeometry {
  const H = cfg.handScale;
  // cubing 渲染器启用 ACES 色调映射，会明显压暗中明度颜色（肤色尤其明显）；
  // 关闭 toneMapped 让手部按材质原色输出，避免在浅色背景/魔方旁显得暗脏。
  const skin = new MeshBasicMaterial({ color: linearOutput ? srgbColor(SKIN) : new Color(SKIN), toneMapped: false });
  const pad = new MeshBasicMaterial({ color: linearOutput ? srgbColor(PAD) : new Color(PAD), toneMapped: false });
  const back = new MeshBasicMaterial({ color: linearOutput ? srgbColor(BACK) : new Color(BACK), toneMapped: false });
  const outlineMat = withOutline ? new LineBasicMaterial({ color: OUTLINE, toneMapped: false }) : null;
  const addOutline = (mesh: Mesh): void => {
    if (!outlineMat) return;
    mesh.add(new LineSegments(new EdgesGeometry(mesh.geometry), outlineMat));
  };
  const root = new Group();

  // 手掌：宽（拇指↔小指）× 厚 × 长；圆角盒体（略微圆滑，与大鱼际融合）；前表面落在 mcpZ
  const palmMesh = new Mesh(
    new RoundedBoxGeometry(
      cfg.palm.width * H,
      cfg.palm.height * H,
      cfg.palm.length * H,
      3,
      0.08 * H,
    ),
    skin,
  );
  palmMesh.position.set(0, -0.02 * H, (cfg.palm.mcpZ - cfg.palm.length / 2) * H);
  root.add(palmMesh);
  addOutline(palmMesh);

  // 大鱼际（thenar eminence）：拇指根处椭球凸块，略超出拇指侧掌缘，形成"根部隆起"
  const thenarMesh = new Mesh(new SphereGeometry(0.5, 20, 16), skin);
  thenarMesh.scale.set(
    cfg.thenar.width * H,
    cfg.thenar.height * H,
    cfg.thenar.length * H,
  );
  thenarMesh.position.set(
    cfg.thenar.x * H,
    cfg.thenar.y * H,
    cfg.thenar.z * H,
  );
  root.add(thenarMesh);
  addOutline(thenarMesh);

  // 四指：沿掌宽展开（x × fingerSpacing），y 略偏向指背，z 在 MCP 线
  const fingers = {} as Record<FingerName, FingerNodes>;
  for (const name of FOUR) {
    const base = cfg.bases[name];
    const nodes = buildFingerChain(rig, name, H, skin, pad, back, withMarks, addOutline);
    nodes.root.position.set(base.x * cfg.fingerSpacing * H * sideSign, base.y * H, cfg.palm.mcpZ * H);
    root.add(nodes.root);
    fingers[name] = nodes;
  }

  // 拇指：thumbRoot(thumbBase) → thumbDof(CMC 展收/对掌) → 拇指链
  const thumbRoot = new Group();
  const thumbDof = new Group();
  thumbRoot.add(thumbDof);
  const tc = cfg.thumbCorner;
  thumbRoot.position.set(tc.x * H * sideSign, tc.y * H, tc.z * H);
  const thumbNodes = buildFingerChain(rig, "thumb", H, skin, pad, back, withMarks, addOutline);
  thumbDof.add(thumbNodes.root);
  root.add(thumbRoot);
  fingers.thumb = thumbNodes;

  return { root, fingers, thumbRoot, thumbDof };
}

/** 单指链：root → joint0 → 段0 → joint1 → 段1 …；关节默认 rotation 0（= bend 180 伸直） */
function buildFingerChain(
  rig: HandRig,
  name: FingerName,
  H: number,
  skin: MeshBasicMaterial,
  pad: MeshBasicMaterial,
  back: MeshBasicMaterial,
  withMarks: boolean,
  addOutline?: (mesh: Mesh) => void,
): FingerNodes {
  const def = rig.fingers[name];
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
      const len = seg.length * H;
      const radius = (seg.width / 2) * H;
      const mesh = new Mesh(new CylinderGeometry(radius, radius, len, 10), skin);
      mesh.rotation.x = Math.PI / 2; // 圆柱 Y 轴 → 指方向 Z
      mesh.position.z = len / 2;
      joint.add(mesh);
      addOutline?.(mesh);
      if (withMarks) {
        // 腹（绿，-Y）/ 背（橙，+Y）标记
        const p = new Mesh(new SphereGeometry(0.04 * H, 8, 8), pad);
        p.position.set(0, -(radius + 0.05 * H), len / 2);
        joint.add(p);
        const b = new Mesh(new SphereGeometry(0.04 * H, 8, 8), back);
        b.position.set(0, radius + 0.05 * H, len / 2);
        joint.add(b);
      }
      const next = new Group();
      next.position.z = len;
      joint.add(next);
      segments.push({ joint, len, radius });
      cursor = next;
    }
  }
  return { root, joints, segments };
}
