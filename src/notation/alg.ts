import { Alg } from "cubing/alg";

/**
 * 层 B 封装：基于 cubing/alg 的公式解析与序列化。
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

/** 把复合动作 token 拆成单面动作：UD' → [U, D']；RwUw → [Rw, Uw]；R2' → [R2']（保持修饰）。
 * 用于单步应用/播放：cubing 动画处理复合动作会崩溃（areQuantumMovesSameAxis）。 */
export function splitCompoundMove(token: string): string[] {
  const parts = token.match(/[UDFBLRudfbMESxyz]w?(\d*'?)/g);
  if (!parts || parts.length <= 1) return [token];
  return parts;
}

/** 合法单步记法（面/宽层/中层/整块旋转 + 可选 2 + 可选 '） */
const SINGLE_MOVE_RE = /^(?:[UDLRFB]|[rludfb]|[MES]|[xyz])\d?'?$/;
/** 连写切分用：全局扫描单步 token（注意需手动重置 lastIndex） */
const MOVE_TOKEN_RE = /(?:[UDLRFB]|[rludfb]|[MES]|[xyz])\d?'?/g;

/**
 * 容错切分：把「连写缺空格」的记法串（如外部抓取数据里的 "R'L' B RL"、"R2'u'"）拆成
 * 单步并补空格。仅供**外部数据**边界使用（内置公式库）——用户手输路径仍走严格的
 * parseMoves，避免把 typo 当成合法输入。
 *
 * 语义与求解器引擎（src/cube/solver/engine.ts 的 parseAlg）保持一致：
 * 裸数字 token（如 "U L 2 U" 里的 "2"）是上游数据的格式残留，**丢弃**而不是并入前一步
 * （引擎的 moveRe 要求数字紧跟字母，"L 2" 判为 L + 残留 2）。
 * 无法完整切分（中间夹着无法识别的字符）时返回 null，由调用方按非法处理。
 */
export function splitMoveTokens(input: string): string | null {
  const out: string[] = [];
  for (const raw of input.trim().split(/\s+/)) {
    if (!raw) continue;
    if (SINGLE_MOVE_RE.test(raw)) {
      out.push(raw);
      continue;
    }
    // 裸数字：上游格式残留，丢弃（与引擎 parseAlg 一致）
    if (/^[2-5]$/.test(raw)) continue;
    // 连写：逐 token 切分，且必须整段消费完（夹着无法识别的字符 → 判非法）
    MOVE_TOKEN_RE.lastIndex = 0;
    const parts: string[] = [];
    let consumed = 0;
    let m: RegExpExecArray | null;
    while ((m = MOVE_TOKEN_RE.exec(raw))) {
      if (m.index !== consumed) return null;
      parts.push(m[0]);
      consumed = m.index + m[0].length;
    }
    if (!parts.length || consumed !== raw.length) return null;
    out.push(...parts);
  }
  return out.length ? out.join(" ") : null;
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
