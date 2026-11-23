/**
 * 手-魔方段级碰撞代理（纯 three.js 计算，无 DOM/播放器依赖）：
 * 以魔方单位坐标（1 = 块边长，3×3×3 魔方中心在原点、范围 [-1.5, +1.5]³）计算手掌与
 * 各指段的紧致 AABB，并检测与魔方包围盒的相交及近似穿透深度。
 */
import { Box3, Matrix4, Mesh, Vector3, type Group } from "three";
import { FINGER_ORDER, type FingerName } from "./HandRig";
import type { FingerNodes } from "./handMesh";

export type HandSegmentBox = {
  part: "palm" | `${FingerName}-seg${number}`;
  finger?: FingerName;
  segmentIndex?: number;
  /** 魔方单位空间下的轴对齐包围盒（3×3×3 魔方为 [-1.5, 1.5]³） */
  box: Box3;
};

export type CubeCollisionHit = {
  part: HandSegmentBox["part"];
  finger?: FingerName;
  segmentIndex?: number;
  /** 与魔方包围盒相交的近似穿透深度（魔方单位） */
  penetration: number;
};

const _invParent = new Matrix4();
const _relMat = new Matrix4();
const _corner = new Vector3();

/** 把局部包围盒的 8 个角点经矩阵变换到目标空间得到紧致 AABB */
function transformLocalBox(local: Box3, mat: Matrix4): Box3 {
  const out = new Box3();
  const { min, max } = local;
  const xs = [min.x, max.x];
  const ys = [min.y, max.y];
  const zs = [min.z, max.z];
  for (const x of xs) {
    for (const y of ys) {
      for (const z of zs) {
        _corner.set(x, y, z).applyMatrix4(mat);
        out.expandByPoint(_corner);
      }
    }
  }
  return out;
}

/**
 * 计算手掌 + 全部指段在「魔方单位空间」（handRoot 的父坐标系）下的 AABB。
 * 无论 handRoot 是否挂载到按 CUBE_UNIT_WORLD 缩放的父组，返回值均为一致的魔方单位。
 */
export function computeHandSegmentBoxes(
  handRoot: Group,
  fingers: Record<FingerName, FingerNodes>,
): HandSegmentBox[] {
  handRoot.updateWorldMatrix(true, true);
  const hasParent = handRoot.parent !== null;
  if (hasParent) {
    _invParent.copy(handRoot.parent!.matrixWorld).invert();
  }
  const toCubeSpace = (matWorld: Matrix4): Matrix4 =>
    hasParent ? _relMat.multiplyMatrices(_invParent, matWorld) : matWorld;

  const boxes: HandSegmentBox[] = [];
  // 手掌主体网格包围盒
  for (const child of handRoot.children) {
    const mesh = child as Mesh;
    if (mesh.isMesh && mesh.userData?.part === "palm" && mesh.geometry) {
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      if (mesh.geometry.boundingBox) {
        boxes.push({
          part: "palm",
          box: transformLocalBox(mesh.geometry.boundingBox, toCubeSpace(mesh.matrixWorld)),
        });
      }
      break;
    }
  }
  // 各指段：局部坐标 x∈[-radius, +radius], y∈[-thickness, +thickness], z∈[0, len]
  const segLocal = new Box3();
  for (const name of FINGER_ORDER) {
    const nodes = fingers[name];
    if (!nodes) continue;
    for (let i = 0; i < nodes.segments.length; i++) {
      const seg = nodes.segments[i];
      segLocal.min.set(-seg.radius, -seg.thickness, 0);
      segLocal.max.set(seg.radius, seg.thickness, seg.len);
      boxes.push({
        part: `${name}-seg${i}`,
        finger: name,
        segmentIndex: i,
        box: transformLocalBox(segLocal, toCubeSpace(seg.joint.matrixWorld)),
      });
    }
  }
  return boxes;
}

/**
 * 检测手部段包围盒与魔方 [-cubeHalfExtent, +cubeHalfExtent]³ 的穿透碰撞。
 * tolerance > 0 时允许表层轻触（穿透深度 ≤ tolerance 不记为穿透）。
 */
export function checkHandCubeCollision(
  boxes: readonly HandSegmentBox[],
  cubeHalfExtent = 1.5,
  tolerance = 0,
): CubeCollisionHit[] {
  const hits: CubeCollisionHit[] = [];
  const h = cubeHalfExtent;
  for (const entry of boxes) {
    const b = entry.box;
    const ox = Math.min(b.max.x, h) - Math.max(b.min.x, -h);
    if (ox <= tolerance) continue;
    const oy = Math.min(b.max.y, h) - Math.max(b.min.y, -h);
    if (oy <= tolerance) continue;
    const oz = Math.min(b.max.z, h) - Math.max(b.min.z, -h);
    if (oz <= tolerance) continue;
    hits.push({
      part: entry.part,
      ...(entry.finger ? { finger: entry.finger, segmentIndex: entry.segmentIndex } : {}),
      penetration: Math.min(ox, oy, oz),
    });
  }
  return hits;
}
