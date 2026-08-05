/**
 * 手法库模型（docs/start.md）：与公式强关联但可单独编辑使用。
 * TODO(spike): 定义手法数据的 JSON 结构（手指姿态序列、吸附、路径）。
 */
export type Technique = {
  id: string;
  name: string;
  /** 关联的公式 id（可为空） */
  formulaId?: string;
};
