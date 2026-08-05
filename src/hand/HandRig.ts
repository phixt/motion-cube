/**
 * 层 E（项目独有核心）：手指/手掌抽象模型。
 * 从 docs/example.md 抽象：手指分段、关节角（近端/远端）、指腹/指背方向、
 * 与魔方的接触点。先用简化几何（圆柱段），后续接动画编辑器。
 */
export type Joint = "metacarpal" | "proximal" | "distal";

export type FingerPose = {
  /** 各关节弯曲角（度），参考 example.md：伸直 180 / 自然 135 / 极限 90 */
  bend: Record<Joint, number>;
};
