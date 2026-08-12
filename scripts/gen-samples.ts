// 生成示例数据 data/samples/library.json（分类 + 公式 + 手法，用数据层 API 构建保证合法）。
// 运行：npx tsx scripts/gen-samples.ts
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createCategory, type Category } from "../src/data/category.ts";
import { createFormula } from "../src/data/formula.ts";
import { serializeLibraryData, type LibraryData } from "../src/data/libraryStore.ts";
import { createTechnique } from "../src/data/technique.ts";
import { defaultHandPose, type Contact } from "../src/hand/HandRig.ts";

const OUT = "data/samples";
mkdirSync(OUT, { recursive: true });

// 分类树（最多 4 层）；大流派（CFOP/Roux/ZZ）用标签，不建分类节点
const categories: Category[] = [];
const oll = createCategory({ id: "cat-oll", name: "OLL", parentId: null }, categories);
categories.push(oll);
const pll = createCategory({ id: "cat-pll", name: "PLL", parentId: null }, categories);
categories.push(pll);
const oneLookLL = createCategory({ id: "cat-1lll", name: "1LLL", parentId: null }, categories);
categories.push(oneLookLL);
const cmll = createCategory({ id: "cat-cmll", name: "CMLL", parentId: null }, categories);
categories.push(cmll);
// ZBLL ⊆ 1LLL（分类单选：ZBLL 公式归到最小集合 ZBLL）
const zbll = createCategory({ id: "cat-zbll", name: "ZBLL", parentId: oneLookLL.id }, categories);
categories.push(zbll);

const flickFormula = createFormula({ name: "单拨 U", moves: "U", tags: ["手法示例"] });
const formulas = [
  createFormula({
    name: "V Perm",
    moves: "(R' U R' U') (R D' R' D) R' UD' (R2 U' R2' D R2)",
    tags: ["CFOP"],
    categoryId: pll.id,
  }),
  createFormula({
    name: "OLL 21",
    moves: "R U2 R' U' R U' R'",
    tags: ["CFOP"],
    categoryId: oll.id,
  }),
  createFormula({
    name: "H Perm",
    moves: "M2 U M2 U2 M2 U M2",
    tags: ["CFOP"],
    categoryId: pll.id,
  }),
  createFormula({
    name: "ZBLL（示例）",
    moves: "R U R' U R U2 R'",
    tags: ["CFOP", "单手"],
    categoryId: zbll.id, // 单选：分到最小集合（ZBLL ⊆ 1LLL）
  }),
  // 以下为 cuberoot.me 公式库（数据源 speedcubedb）真实公式样例，
  // 见 https://cuberoot.me/zh/alg/3x3；setup 解法请查 speedcubedb。
  createFormula({
    name: "OLL 1（速拧参考）",
    moves: "R U2 R2 F R F' U2 R' F R F'",
    tags: ["CFOP", "速拧参考"],
    categoryId: oll.id,
  }),
  createFormula({
    name: "PLL Aa（速拧参考）",
    moves: "x (R' U R' D2) (R U' R' D2) R2 x'",
    tags: ["CFOP", "速拧参考"],
    categoryId: pll.id,
  }),
  createFormula({
    name: "CMLL O Adjacent（速拧参考）",
    moves: "R U R' F' R U R' U' R' F R2 U' R'",
    tags: ["Roux", "速拧参考"],
    categoryId: cmll.id,
  }),
  createFormula({
    name: "ZBLL U 1（速拧参考）",
    moves: "(R' U' R U' R' U2' R2) (U' L' U R' U' L)",
    tags: ["CFOP", "速拧参考"],
    categoryId: zbll.id,
  }),
  createFormula({
    name: "1LLL 1 1（速拧参考）",
    moves: "U' (F' U' L' U L F) (L' U' L U' L' U B' U B L)",
    tags: ["CFOP", "速拧参考"],
    categoryId: oneLookLL.id,
  }),
  flickFormula,
];

// 手法示例：单拨 U（docs_old.md 手法一），左手食指，60fps，三关键帧
const contactAtUL: Contact[] = [
  { finger: "index", segmentIndex: 2, side: "pad", t: 0.67, target: "UL 边" },
];
const contactOnL: Contact[] = [
  { finger: "index", segmentIndex: 0, side: "back", t: 0.45, target: "L 面" },
];
function pose(pip: number, dip: number, contacts: Contact[] = []) {
  const p = defaultHandPose("right");
  p.bends.index[1] = pip;
  p.bends.index[2] = dip;
  p.contacts = contacts;
  return p;
}
const technique = createTechnique({
  name: "单拨 U（示例）",
  formulaId: flickFormula.id,
  frameRate: 60,
  keyframes: [
    { frame: 0, pose: pose(135, 175, contactAtUL) },
    { frame: 30, pose: pose(90, 155) },
    { frame: 60, pose: pose(45, 135, contactOnL) },
  ],
  stepMapping: [{ stepIndex: 0, startFrame: 0, endFrame: 60 }],
});

const lib: LibraryData = { version: 1, categories, formulas, techniques: [technique] };
writeFileSync(join(OUT, "library.json"), serializeLibraryData(lib));
// 旧的两文件格式废弃，清理
rmSync(join(OUT, "formulas.json"), { force: true });
rmSync(join(OUT, "techniques.json"), { force: true });
console.log("samples written:", join(OUT, "library.json"));
