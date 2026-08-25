// 从 rubik-cube.html 程序化提取 F2L_TABLE 与 RAW 公式库，生成 TS 数据文件（避免手抄错误）。
// 用法：node scripts/extract-solver-data.mjs
import { readFileSync, writeFileSync } from "node:fs";

const SRC = "C:\\Users\\phx_lumin\\Downloads\\rubik-cube.html";
const html = readFileSync(SRC, "utf8");
const lines = html.split(/\r?\n/);

function sliceBlock(startMarker, endMarker) {
  const start = lines.findIndex((l) => l.includes(startMarker));
  const end = lines.findIndex((l, i) => i > start && l.includes(endMarker));
  if (start < 0 || end < 0) throw new Error(`block not found: ${startMarker} .. ${endMarker}`);
  return lines.slice(start + 1, end).join("\n");
}

// F2L_TABLE 对象字面量
const f2lBody = sliceBlock("RC.F2L_TABLE = {", "};");
const f2lTs = `/** f2lTable.ts — 由 rubik-cube.html f2l-table.js 提取（勿手改）。
 * 每个 FR 槽 F2L case 的最短 <R,U,F> 插入；key = "<cornerCode>_<edgeCode>"
 * （角 DRF / 棱 FR 的 piece code）。150 种，最长 9 步。 */
export const F2L_TABLE: Record<string, string> = {
${f2lBody}
};
`;
writeFileSync("src/cube/solver/f2lTable.ts", f2lTs, "utf8");

// RAW 公式库
const rawBody = sliceBlock("const RAW = [", "];");
const rawTs = `/** algsRaw.ts — 由 rubik-cube.html algs.js 提取（勿手改）。
 * 公式名 + 算法串；加载时逐条 applyAlg 验证并分类（pureLL / rouxSafe），
 * 不符其类别的算法被丢弃（只让库变小，绝不让错误序列进入解法）。 */
export const ALG_RAW: Array<[string, string]> = [
${rawBody}
];
`;
writeFileSync("src/cube/solver/algsRaw.ts", rawTs, "utf8");

console.log("extracted f2lTable.ts + algsRaw.ts");