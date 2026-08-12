import { Alg } from "cubing/alg";

/**
 * 层 B 封装：基于 cubing/alg 的公式解析与序列化（docs/formula.md）。
 * 覆盖 WCA/SiGN：六面、M/E/S 中层、r/l/u/b/d/f 双层、x/y/z 翻面、
 * 交换子 [..]、共轭 [..:]、括号分组、多行注释。
 */

export type ParseResult =
  | { ok: true; moves: string; normalized: string }
  | { ok: false; error: string };

/** 解析并校验一串标准记法，成功返回规范化字符串，失败返回错误信息 */
export function parseMoves(input: string): ParseResult {
  try {
    const alg = Alg.fromString(input);
    return { ok: true, moves: input.trim(), normalized: alg.toString() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function normalizeMoves(input: string): string {
  return Alg.fromString(input).toString();
}

/** 把复合动作 token 拆成单面动作：UD' → [U, D']；R2' → [R2']（保持修饰）。
 * 用于单步应用/播放：cubing 动画处理复合动作会崩溃（areQuantumMovesSameAxis）。 */
export function splitCompoundMove(token: string): string[] {
  const parts = token.match(/[UDFBLRudfbMESxyz](\d*'?)/g);
  if (!parts || parts.length <= 1) return [token];
  return parts;
}

export function invertMoves(input: string): string {
  return Alg.fromString(input).invert().toString();
}

/** 展开交换子/共轭/分组，得到平铺移动序列 */
export function expandMoves(input: string): string {
  return Alg.fromString(input).expand().toString();
}

/** 公式库校验：空串或非法记法返回错误信息，合法返回 null */
export function validateFormulaMoves(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return "公式为空";
  const result = parseMoves(trimmed);
  return result.ok ? null : result.error;
}

/** 浏览器自检：逐条解析代表性记法，返回可读结果行 */
export function notationSelfTest(): string[] {
  const cases = [
    "R U R' U R U2' R'",
    "M2 E S'",
    "r U2 x r U2 r U2 r' U2 l U2 r' U2 r U2 r' U2 r'",
    "x y' z2",
    "[R, U]",
    "[R: U]",
    "(R' U R' U') (R D' R' D) R' UD' (R2 U' R2' D R2)",
    "(R' U R' U') (R D' R' D) R' U' D' (R2 U' R2' D R2)",
    "y x' // inspection\nU R2 U' F' L F' U' L' // XX-Cross",
    "U M' U' R' U' R U M2' U' R' U r",
  ];
  return cases.map((c) => {
    const r = parseMoves(c);
    const label = JSON.stringify(c).replace(/\n/g, "\\n");
    return r.ok ? `OK   ${label}\n     → ${r.normalized}` : `FAIL ${label}\n     → ${r.error}`;
  });
}
