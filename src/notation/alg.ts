/**
 * 层 B 封装：基于 cubing/alg 的公式解析与序列化。
 * 存储用 JSON，导入/导出用标准 R L 字符串（见 docs/formula.md）。
 * TODO(spike): 验证 M/E/S、双层、x/y/z、交换子、多行注释的解析与回写。
 */
export type FormulaJson = {
  name: string;
  /** 标准 WCA/SiGN 字符串，如 "R U R' U R U2' R'" */
  moves: string;
};
