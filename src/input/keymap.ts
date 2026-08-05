/**
 * 层 C'：自定义键盘映射。
 * 任意物理键 → SiGN 动作；覆盖 6 面、M/E/S 中层、r/l/u/b/d/f 双层、x/y/z 翻面。
 * 以下为草稿键位，Spike 验证后再定稿（docs/base.md 未指定具体按键）。
 */
export const KEYMAP_DRAFT = {
  U: "U", D: "D", L: "L", R: "R", F: "F", B: "B",
  M: "M", E: "E", S: "S",
  X: "x", Y: "y", Z: "z",
} as const;
