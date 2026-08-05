/**
 * 公式库模型（docs/formula.md）。
 * 只存公式本身（moves），不存速度/手法；与手法库通过 id 弱关联。
 */
export type Formula = {
  id: string;
  name: string;
  /** 标准记法字符串 */
  moves: string;
  tags: string[];
};
