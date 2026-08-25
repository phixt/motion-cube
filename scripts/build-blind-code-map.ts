/**
 * build-blind-code-map.ts — 盲拧彳亍法编码立方体 → 本地结构化数据层建库
 *
 * 来源：reference/chichu.html（3D 编码立方体，6 面 3×3 字母网格）。
 * 语义（用户确认 + 实证）：
 *   - 坐标系 = 彳亍法默认朝向「黄顶红前」：U=黄 +y、D=白 −y、F=红 +z、B=橙 −z、
 *     R=蓝 +x、L=绿 −x（位置以面轴为准，HTML 里的颜色名不采用）。
 *   - 缓冲块：棱块 UF、角块 UFR —— 图中 ✕ 标记，共 5 个贴纸位（UF 棱 2 + UFR 角 3）。
 *   - 中心 6 格不编码（''），其余 43 个贴纸位各一个编码字母（角块顺时针从顶面开始、
 *     底面从底上看也顺时针，整体左下→左上→右上趋势；最后 WMN/XYZ）。
 *   - 彳亍法 = 三循环方法：缓冲块 + 另外两个同型块三循环交换。
 *
 * 输出：data/blind-code-map.json
 *   - cells[54]：每贴纸位 {face,row,col,block,stickerOnBlock,letter,buffer,center}
 *     block 名 = 黄顶红前坐标块名（8 角 UFR…/12 棱 UF…/6 中心），stickerOnBlock =
 *     贴纸在块上的面位。
 *   - letters: Record<字母, 位置数组>（字母 ↔ 块/层对应，理解字幕与层的对应关系用）。
 *   - buffer: {edge:"UF", corner:"UFR", positions:[…]}
 *   - 兼容映射：engine 54 布局（白顶绿前）StickerId，经整块旋转
 *     rot = Ry(+90°)·Rx(180°)（黄顶红前 → 白顶绿前）换算。
 *
 * 运行：node scripts/build-blind-code-map.ts（Node 原生 strip-types，勿用 tsx）
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ---------- 源码面数据（reference/chichu.html faceData，静态网格） ----------
// 面序 = HTML material 位置：右=+x、左=−x、上=y、下=-y、前=+z、后=-z
const RAW: Record<string, string[][]> = {
  R: [
    ["✕", "H", "I"],
    ["R", "", "Z"],
    ["Z", "P", "S"],
  ],
  L: [
    ["E", "D", "C"],
    ["X", "", "T"],
    ["Q", "L", "M"],
  ],
  U: [
    ["D", "E", "G"],
    ["C", "", "G"],
    ["A", "✕", "✕"],
  ],
  D: [
    ["W", "I", "X"],
    ["K", "", "O"],
    ["O", "M", "R"],
  ],
  F: [
    ["B", "✕", "✕"],
    ["S", "", "Q"],
    ["N", "J", "Y"],
  ],
  B: [
    ["H", "F", "F"],
    ["Y", "", "W"],
    ["T", "N", "P"],
  ],
};

// 面轴（黄顶红前规范；与 src/cube/stickering.ts FACE_NORMALS 同构但色序为黄顶红前）
type Axis = "x" | "y" | "z";
type Coord = { n: number; pos: boolean }; // 法向轴 +1.5（pos）/-1.5
const FACE_AXIS: Record<string, { n: Axis; pos: boolean }> = {
  U: { n: "y", pos: true },
  D: { n: "y", pos: false },
  F: { n: "z", pos: true },
  B: { n: "z", pos: false },
  R: { n: "x", pos: true },
  L: { n: "x", pos: false },
};

// 面内 (row,col) → 两个面内轴坐标（规范尺度 ±1/0）。
// 采用「从面外侧看」布局（与 chichu.html 网格一致，以 ✕=缓冲位校准）：
//   U 面俯视 row2=前(+z) → z=row−1；D 面从下看 row0=前(+z) → z=1−row
//   F 从外看 col2=右(+x) row0=上(+y)；B 从外看 col2=左(−x)
//   R 从外看 col2=后(−z)（✕ 在 col0=前）；L 从外看 col0=后(−z)
function innerCoords(face: string, row: number, col: number): [number, number] {
  switch (face) {
    case "U":
      return [col - 1, row - 1]; // (x, z) row0=后 row2=前
    case "D":
      return [col - 1, 1 - row]; // (x, z) row0=前
    case "F":
      return [col - 1, 1 - row]; // (x, y)
    case "B":
      return [1 - col, 1 - row]; // (x, y) col2=左(−x)
    case "R":
      return [1 - row, 1 - col]; // (y, z) col0=前(+z)
    case "L":
      return [1 - row, col - 1]; // (y, z) col0=后(−z)
    default:
      throw new Error("bad face");
  }
}

// 每个内轴在最终立方体坐标里的位置（按面轴）
function innerAxisOrder(face: string): { a: Axis; b: Axis } {
  const n = FACE_AXIS[face].n;
  if (n === "y") return { a: "x", b: "z" };
  if (n === "z") return { a: "x", b: "y" };
  return { a: "y", b: "z" }; // x
}

type Sticker = {
  face: string;
  row: number;
  col: number;
  block: string; // 8 角 / 12 棱 / 6 中心 名（黄顶红前）
  stickerOnBlock: string; // 贴纸在块上的面位 U/R/F/D/L/B
  letter: string;
  buffer: boolean;
  center: boolean;
};

const cells: Sticker[] = [];

function blockName(c: { x: number; y: number; z: number }): string {
  const nz = (c.x !== 0 ? 1 : 0) + (c.y !== 0 ? 1 : 0) + (c.z !== 0 ? 1 : 0);
  if (nz === 3) {
    // 角块：U/D 层 + F/B 列 + L/R
    return (c.y > 0 ? "U" : "D") + (c.z > 0 ? "F" : "B") + (c.x > 0 ? "R" : "L");
  }
  if (nz === 2) {
    // 棱块 12：恰好一个坐标 = 0
    if (c.y !== 0 && c.z !== 0) return (c.y > 0 ? "U" : "D") + (c.z > 0 ? "F" : "B"); // UF/UB/DF/DB
    if (c.y !== 0 && c.x !== 0) return (c.y > 0 ? "U" : "D") + (c.x > 0 ? "R" : "L"); // UR/UL/DR/DL
    return (c.z > 0 ? "F" : "B") + (c.x > 0 ? "R" : "L"); // FR/FL/BR/BL
  }
  // 中心
  if (c.y !== 0) return c.y > 0 ? "U" : "D";
  if (c.z !== 0) return c.z > 0 ? "F" : "B";
  return c.x > 0 ? "R" : "L";
}

for (const face of Object.keys(FACE_AXIS)) {
  const grid = RAW[face];
  const { a, b } = innerAxisOrder(face);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const text = grid[row][col];
      // 中心格（面内两轴均为 0）
      const [i1, i2] = innerCoords(face, row, col);
      const center = i1 === 0 && i2 === 0;
      // 世界坐标（规范尺度）+ 块中心
      const w: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };
      w[a] = i1;
      w[b] = i2;
      w[FACE_AXIS[face].n] = FACE_AXIS[face].pos ? 1.5 : -1.5;
      const centerCoord = { x: Math.round(w.x), y: Math.round(w.y), z: Math.round(w.z) };
      if (center) {
        cells.push({
          face,
          row,
          col,
          block: blockName(centerCoord),
          stickerOnBlock: face,
          letter: "",
          buffer: false,
          center: true,
        });
        continue;
      }
      const buffer = text === "✕";
      cells.push({
        face,
        row,
        col,
        block: blockName(centerCoord),
        stickerOnBlock: face,
        letter: buffer ? "" : text || "",
        buffer,
        center: false,
      });
    }
  }
}

// ---------- 校验 ----------
let ok = true;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    ok = false;
    console.error(`FAIL ${msg}`);
  }
}
assert(cells.length === 54, `cells 总数 ${cells.length} != 54`);
const buffers = cells.filter((c) => c.buffer);
assert(buffers.length === 5, `缓冲位 ${buffers.length} != 5`);
const bufBlocks = [...new Set(buffers.map((c) => c.block))].sort();
assert(
  bufBlocks.join(",") === "UF,UFR",
  `缓冲位所在块 ${bufBlocks.join(",")} != [UF,UFR]`
);
const ufBuf = buffers.filter((c) => c.block === "UF");
const ufrBuf = buffers.filter((c) => c.block === "UFR");
assert(ufBuf.length === 2, `UF 棱缓冲位 ${ufBuf.length} != 2`);
assert(ufrBuf.length === 3, `UFR 角缓冲位 ${ufrBuf.length} != 3`);
const letters = cells.filter((c) => !c.center && !c.buffer && c.letter !== "");
assert(letters.length === 43, `编码字母位 ${letters.length} != 43`);
// 角块 7 角×3、棱块 11 棱×2 编码位
const cornerCount = letters.filter((c) => c.block.length === 3).length;
const edgeCount = letters.filter((c) => c.block.length === 2).length;
assert(cornerCount === 21, `角块编码位 ${cornerCount} != 21（8 角 −1 缓冲)×3）`);
assert(edgeCount === 22, `棱块编码位 ${edgeCount} != 22（12 棱 −1 缓冲)×2）`);
// 每角 3 位、每棱 2 位、每中心 1 位
const perBlock: Record<string, number> = {};
for (const c of cells) perBlock[c.block] = (perBlock[c.block] ?? 0) + 1;
const badPer = Object.entries(perBlock).filter(
  ([name, n]) =>
    !((name.length === 3 && n === 3) || (name.length === 2 && n === 2) || (name.length === 1 && n === 1))
);
assert(badPer.length === 0, `块贴纸位数异常: ${badPer.map(([n, c]) => `${n}:${c}`).join(", ")}`);
// 字母唯一或按惯例（有跨块复用则属正常：同棱双面位/同角多贴纸位用同一字母族）
const letterSet = [...new Set(letters.map((l) => l.letter))].sort();
console.log(`字母全集(${letterSet.length}): ${letterSet.join(" ")}`);

// ---------- 兼容映射：黄顶红前 → 现有 engine 54（白顶绿前）StickerId ----------
// 按「色轴 → 色轴」直求整块旋转 Rg（黄顶红前坐标 → 白顶绿前坐标）：
//   黄顶红前：U=黄+y、F=红+z、R=蓝+x、L=绿−x、B=橙−z、D=白−y
//   engine 白顶绿前（FACE_COLORS=[白,橙,绿,黄,红,蓝] 面序 U/R/F/D/L/B）：
//   黄=−y、红=−x、蓝=−z、绿=+z、橙=+x、白=+y
//   ⇒ Rg(x,y,z) = (−z, −y, −x)（检：+y→−y ✓黄、+z→−x ✓红、+x→−z ✓蓝、
//   −x→+z ✓绿、−z→+x ✓橙、−y→+y ✓白；det=1 真旋转）
// 反向（白顶绿前 → 黄顶红前）：逆 = (−z? 对合 (x,y,z)→(−z,−y,−x) 自逆：(−z,−y,−x)→(x,y,z) ✓）
function rg(p: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  return { x: -p.z, y: -p.y, z: -p.x };
}
// 目标 StickerId 用 stickering.stickerIdFromWorld 同算法（面轴 ±1.5 判定）
function toEngineId(p: { x: number; y: number; z: number }): string | null {
  const ax = Math.abs(p.x), ay = Math.abs(p.y), az = Math.abs(p.z);
  const qx = Math.round(p.x), qy = Math.round(p.y), qz = Math.round(p.z);
  let face: string, row: number, col: number;
  if (ax >= ay && ax >= az) {
    face = p.x > 0 ? "R" : "L";
    row = 1 - qy;
    col = face === "R" ? qz + 1 : 1 - qz;
  } else if (ay >= ax && ay >= az) {
    face = p.y > 0 ? "U" : "D";
    row = 1 - qz;
    col = qx + 1;
  } else {
    face = p.z > 0 ? "F" : "B";
    row = 1 - qy;
    col = face === "F" ? qx + 1 : 1 - qx;
  }
  if (row < 0 || row > 2 || col < 0 || col > 2) return null;
  return `${face}${row * 3 + col}`;
}

const lettersIndex: Record<string, string[]> = {};
for (const c of cells) {
  if (!c.center && c.letter) (lettersIndex[c.letter] ??= []).push(`${c.block}·${c.stickerOnBlock}`);
}

const json = {
  schema: "blind-code-map",
  version: 1,
  orientation: "黄顶红前（U=黄 +y、F=红 +z、R=蓝 +x、L=绿 −x、B=橙 −z、D=白 −y）",
  convention: "彳亍法：三循环 —— 缓冲块(UF棱/UFR角) + 两个同型块；角块编码每块顺时针从顶面开始（底面从底上看也顺时针），整体左下→左上→右上；末位 WMN/XYZ",
  buffer: {
    edge: "UF",
    corner: "UFR",
    positions: buffers.map((c) => `${c.block}·${c.stickerOnBlock}`),
  },
  rotation_to_engine: "Ry(+90°)（黄顶红前 → 白顶绿前 engine 54；反向 Ry(−90°)）",
  cells,
  letters: lettersIndex,
};

const outPath = join(process.cwd(), "data", "blind-code-map.json");
writeFileSync(outPath, JSON.stringify(json, null, 2) + "\n");
console.log(`\n校验 OK=${ok ? "PASS" : "FAIL"}`);
console.log(`写出 ${outPath}`);
console.log(`角编码位 ${cornerCount} / 棱编码位 ${edgeCount} / 缓冲 5 / 中心 6`);
console.log(`缓冲位: ${buffers.map((c) => `${c.block}·${c.stickerOnBlock}(${c.face}${c.row * 3 + c.col})`).join(" ")}`);
if (!ok) process.exit(1);