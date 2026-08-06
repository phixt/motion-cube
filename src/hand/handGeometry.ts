/**
 * 手部几何构建（HandRigView 与 HandCalibView 共用，避免两处比例漂移）。
 * 输入：标定配置 + 骨架（关节表/段定义）+ 手型符号；输出 three.js 层级。
 * 坐标系：数据单位（1 = 块边长），几何按 cfg.handScale 放大；
 * 调用方再按 CUBE_UNIT_WORLD 缩放到 cubing 世界尺度。
 */
import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
} from "three";
import type { FingerName } from "./HandRig";
import type { HandRig } from "./HandRig";
import type { HandRigConfig } from "./handRigStore";

export const SKIN = 0xcfc0a8;
export const PAD = 0x4ade80;
export const BACK = 0xf59e0b;

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
): HandGeometry {
  const H = cfg.handScale;
  const skin = new MeshBasicMaterial({ color: SKIN });
  const pad = new MeshBasicMaterial({ color: PAD });
  const back = new MeshBasicMaterial({ color: BACK });
  const root = new Group();

  // 手掌：宽（拇指↔小指）× 厚 × 长；前表面落在 mcpZ，手指/拇指从掌前缘伸出
  const palmMesh = new Mesh(
    new BoxGeometry(cfg.palm.width * H, cfg.palm.height * H, cfg.palm.length * H),
    skin,
  );
  palmMesh.position.set(0, -0.02 * H, (cfg.palm.mcpZ - cfg.palm.length / 2) * H);
  root.add(palmMesh);

  // 四指：沿掌宽展开（x × fingerSpacing），y 略偏向指背，z 在 MCP 线
  const fingers = {} as Record<FingerName, FingerNodes>;
  for (const name of FOUR) {
    const base = cfg.bases[name];
    const nodes = buildFingerChain(rig, name, H, skin, pad, back, withMarks);
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
  const thumbNodes = buildFingerChain(rig, "thumb", H, skin, pad, back, withMarks);
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
