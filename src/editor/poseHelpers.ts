/**
 * 编辑器姿态工具纯函数（无 Vue/DOM 依赖）：
 * 脱响应式拍平、结构自检、四元数↔欧拉角（复用暂存对象避免 60Hz 热路径分配）、单轨插值。
 */
import { Euler, Quaternion } from "three";
import type { TechniqueKeyframe } from "../data/technique";
import { FINGER_ORDER, type Pose } from "../hand/HandRig";
import { applyEasing, interpolatePose, keyframeSegment, type EasingFn } from "../timeline/Timeline";

const _tmpEuler = new Euler();
const _tmpQuat = new Quaternion();

const degToRad = (d: number): number => (d * Math.PI) / 180;
const radToDeg = (r: number): number => (r * 180) / Math.PI;

/** 把姿态转成普通对象快照（脱 Vue 响应式代理，避免 CDP / Tauri IPC 序列化成 {}） */
export function plainPose(p: Pose): Pose {
  const t = p.palm.transform;
  const tb = p.palm.thumbBase;
  const bends = {} as Pose["bends"];
  for (const name of FINGER_ORDER) {
    const arr = p.bends[name] ?? [];
    bends[name] = Array.from(arr);
  }
  return {
    palm: {
      transform: {
        position: { x: t.position.x, y: t.position.y, z: t.position.z },
        quaternion: { w: t.quaternion.w, x: t.quaternion.x, y: t.quaternion.y, z: t.quaternion.z },
      },
      thumbBase: {
        position: { x: tb.position.x, y: tb.position.y, z: tb.position.z },
        quaternion: { w: tb.quaternion.w, x: tb.quaternion.x, y: tb.quaternion.y, z: tb.quaternion.z },
      },
    },
    bends,
    thumbCMC: {
      abduction: p.thumbCMC.abduction,
      elevation: p.thumbCMC.elevation,
      rotation: p.thumbCMC.rotation,
      ...(p.thumbCMC.thenarFold !== undefined ? { thenarFold: p.thumbCMC.thenarFold } : {}),
    },
    contacts: (p.contacts ?? []).map((c) => ({ ...c })),
  };
}

/** 姿态结构自检：缺 palm/bends/thumbCMC 的残缺对象一律视为不可用 */
export function isPoseUsable(p: Pose | null | undefined): p is Pose {
  if (!p || typeof p !== "object") return false;
  const palm = (p as { palm?: { transform?: { position?: unknown; quaternion?: unknown } } }).palm?.transform;
  if (!palm || !palm.position || !palm.quaternion) return false;
  if (!Array.isArray((p as { bends?: { thumb?: unknown } }).bends?.thumb)) return false;
  const cmc = (p as { thumbCMC?: unknown }).thumbCMC;
  return !!cmc && typeof cmc === "object";
}

/** 手掌四元数 → 欧拉角（度，three XYZ 顺序）；复用模块级暂存对象，热路径零 GC 压力 */
export function poseRotationDeg(pose: Pose): { x: number; y: number; z: number } {
  const q = pose.palm.transform.quaternion;
  _tmpQuat.set(q.x, q.y, q.z, q.w);
  _tmpEuler.setFromQuaternion(_tmpQuat, "XYZ");
  return { x: radToDeg(_tmpEuler.x), y: radToDeg(_tmpEuler.y), z: radToDeg(_tmpEuler.z) };
}

/** 欧拉角（度，three XYZ 顺序） → 四元数 {w,x,y,z} */
export function eulerDegToQuat(
  rx: number,
  ry: number,
  rz: number,
): { w: number; x: number; y: number; z: number } {
  _tmpEuler.set(degToRad(rx), degToRad(ry), degToRad(rz), "XYZ");
  _tmpQuat.setFromEuler(_tmpEuler);
  return { w: _tmpQuat.w, x: _tmpQuat.x, y: _tmpQuat.y, z: _tmpQuat.z };
}

/**
 * 单轨插值：从升序关键帧列表中计算指定帧的单手姿态。
 * broken=true 表示「关键帧存在但姿态残缺」，上层应跳过 setPose（不覆盖手部）。
 */
export function trackPoseAtFrame(
  sorted: readonly TechniqueKeyframe[],
  frame: number,
  side: "left" | "right",
): { pose: Pose | null; broken: boolean } {
  if (sorted.length === 0) return { pose: null, broken: false };
  const raw = (kf: TechniqueKeyframe): Pose | null => {
    const p = side === "left" ? kf.left : kf.right;
    if (!isPoseUsable(p)) return null;
    return plainPose(p);
  };
  let pose: Pose | null = null;
  if (sorted.length === 1) {
    pose = raw(sorted[0]);
  } else {
    const seg = keyframeSegment(sorted, frame);
    if (!seg) {
      pose = raw(sorted[0]);
    } else if (seg.a === seg.b) {
      pose = raw(seg.a);
    } else {
      const a = raw(seg.a);
      const b = raw(seg.b);
      if (a && b) {
        const eased = applyEasing((seg.a.easing ?? "linear") as EasingFn, seg.local);
        pose = interpolatePose(a, b, eased);
        if (!isPoseUsable(pose)) pose = null;
      }
    }
  }
  return { pose, broken: pose === null && sorted.length > 0 };
}
