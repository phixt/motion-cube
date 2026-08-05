/**
 * 层 D'：魔方动作与手指动作的同步时间线。
 * 一个时间点包含：魔方转动（Alg 中的一步）与对应的手指/手掌姿态。
 * TODO(spike): 确认 cubing twisty 时间线 API 的帧级可控性。
 */
export type TimelineEvent = {
  at: number;
  /** 魔方动作，如 "R'" */
  move: string;
  /** 关联手法动作 id（可空，公式与手法高解耦） */
  techniqueId?: string;
};
